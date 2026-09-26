/**
 * Debug chart of an analysis trace: estimated stack displacement with detected
 * sets (green bands), accepted reps (blue) and rejected candidates (red), plus
 * an optional secondary signal. Horizontally scrollable.
 */
import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { AnalysisResult } from '../../analysis/analyze';
import { colors, styles } from './common';

type Signal = 'position' | 'verticalAccel' | 'rotationRate' | 'horizontalAccel';

const LABELS: Record<Signal, string> = {
  position: 'Estimated vertical displacement (relative, m)',
  verticalAccel: 'Vertical acceleration (m/s²)',
  horizontalAccel: 'Horizontal acceleration (m/s²)',
  rotationRate: 'Rotation rate (°/s)',
};

function decimate(t: Float64Array, y: Float64Array, maxPts: number): [number, number][] {
  const n = t.length;
  if (n <= maxPts) return Array.from({ length: n }, (_, i) => [t[i], y[i]]);
  const bucket = Math.ceil(n / (maxPts / 2));
  const out: [number, number][] = [];
  for (let s = 0; s < n; s += bucket) {
    let lo = s;
    let hi = s;
    for (let i = s; i < Math.min(n, s + bucket); i++) {
      if (y[i] < y[lo]) lo = i;
      if (y[i] > y[hi]) hi = i;
    }
    const [a, b] = lo < hi ? [lo, hi] : [hi, lo];
    out.push([t[a], y[a]]);
    if (a !== b) out.push([t[b], y[b]]);
  }
  return out;
}

export function TraceChart({ res, signal, pxPerSec = 8, height = 180 }: { res: AnalysisResult; signal: Signal; pxPerSec?: number; height?: number }) {
  const tr = res.trace;
  const y = tr[signal];
  const tEnd = tr.t.length ? tr.t[tr.t.length - 1] : 1;
  const width = Math.max(320, Math.round(tEnd * pxPerSec));
  const { pts, lo, hi } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < y.length; i++) {
      if (y[i] < lo) lo = y[i];
      if (y[i] > hi) hi = y[i];
    }
    if (!(hi > lo)) {
      lo -= 1;
      hi += 1;
    }
    return { pts: decimate(tr.t, y, Math.min(4000, width * 2)), lo, hi };
  }, [tr, y, width]);
  if (!tr.t.length) return <Text style={styles.muted}>No trace.</Text>;
  const X = (t: number) => (t / tEnd) * (width - 4) + 2;
  const Y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (height - 24);
  const step = tEnd > 300 ? 30 : tEnd > 60 ? 10 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= tEnd; t += step) ticks.push(t);
  const pos = tr.position;

  return (
    <View>
      <Text style={[styles.muted, { marginBottom: 4 }]}>
        {LABELS[signal]} [{lo.toPrecision(3)} … {hi.toPrecision(3)}]
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Svg width={width} height={height}>
          {res.sets.map((s) => (
            <Rect key={`s${s.index}`} x={X(s.startSec)} y={0} width={Math.max(1, X(s.endSec) - X(s.startSec))} height={height} fill="#2e7d3222" />
          ))}
          {tr.quietSec.map(([a, b], i) => (
            <Rect key={`q${i}`} x={X(a)} y={height - 5} width={Math.max(1, X(b) - X(a))} height={5} fill="#90a4ae" />
          ))}
          {lo < 0 && hi > 0 ? <Line x1={0} x2={width} y1={Y(0)} y2={Y(0)} stroke="#bbb" strokeDasharray="4 4" /> : null}
          {ticks.map((t) => (
            <SvgText key={`t${t}`} x={X(t) + 2} y={height - 8} fontSize={9} fill={colors.muted}>
              {`${t}s`}
            </SvgText>
          ))}
          <Polyline points={pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} fill="none" stroke="#333" strokeWidth={1} />
          {signal === 'position'
            ? res.candidates.map((c) => {
                const i = Math.min(pos.length - 1, Math.round(c.peakSec * res.config.fs));
                const col = c.accepted ? colors.primary : colors.danger;
                const label = c.accepted ? String(res.sets[c.setIndex!].repIds.indexOf(c.id) + 1) : '×';
                return (
                  <React.Fragment key={`c${c.id}`}>
                    <Circle cx={X(c.peakSec)} cy={Y(pos[i])} r={3.5} fill={col} />
                    <SvgText x={X(c.peakSec) + 4} y={Y(pos[i]) - 4} fontSize={10} fill={col}>
                      {label}
                    </SvgText>
                  </React.Fragment>
                );
              })
            : null}
        </Svg>
      </ScrollView>
    </View>
  );
}
