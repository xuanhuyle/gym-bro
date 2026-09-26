/**
 * Text + standalone-HTML debug reports for an analysis result. Pure TS; used
 * by the Node CLI (scripts/analyze.ts). The HTML report is a single file with
 * inline SVG so errors can be inspected in any browser.
 */

import { AnalysisResult } from './analyze';
import { Evaluation } from './evaluate';

export function formatSummary(res: AnalysisResult, evaluation?: Evaluation | null): string {
  const q = res.quality;
  const lines: string[] = [];
  lines.push(`algorithm ${res.algorithmVersion}`);
  lines.push(
    `samples ${q.rawSampleCount}, duration ${q.durationSec.toFixed(1)} s, rate ${q.meanRateHz.toFixed(1)} Hz, gaps ${q.gaps.length}, orientation spread ${q.orientationSpreadDeg.toFixed(1)}°`,
  );
  lines.push(
    `vertical sign ${res.verticalSign > 0 ? '+1' : '-1'} (votes up ${res.signVotes.up.toFixed(1)} / down ${res.signVotes.down.toFixed(1)}), swing threshold ${(res.swingThresholdM * 100).toFixed(1)} cm, rotation limit ${res.rotationLimitDegS.toFixed(1)} °/s`,
  );
  lines.push(`detected: ${res.sets.length} set(s), ${res.totalReps} rep(s): ${res.sets.map((s) => s.repCount).join(' / ') || '—'}`);
  for (const s of res.sets) {
    const c = s.cadence;
    lines.push(
      `  set ${s.index + 1}: ${s.repCount} reps, ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)} s, ` +
        `period ${c.repPeriodSec?.toFixed(2) ?? '—'} s (${c.repsPerMin?.toFixed(1) ?? '—'}/min, CV ${c.periodCv?.toFixed(2) ?? '—'}, ${c.reliable ? 'reliable' : 'unreliable'}), ` +
        `up ${c.upSec?.toFixed(2) ?? '—'} s / down ${c.downSec?.toFixed(2) ?? '—'} s, rel. amplitude ${(s.meanAmplitudeM * 100).toFixed(1)} cm`,
    );
  }
  for (const r of res.rests) lines.push(`  rest after set ${r.afterSet + 1}: ${r.durationSec.toFixed(1)} s`);
  const rejected = res.candidates.filter((c) => !c.accepted);
  if (rejected.length) {
    lines.push(`rejected candidates (${rejected.length}):`);
    for (const c of rejected) {
      lines.push(
        `  #${c.id} at ${c.peakSec.toFixed(1)} s: ${c.rejectReasons.join(', ')} (dur ${c.durationSec.toFixed(2)} s, amp ${(c.amplitudeM * 100).toFixed(1)} cm, vert ${c.verticality.toFixed(2)}, rot ${c.rotationRmsDegS.toFixed(1)} °/s)`,
      );
    }
  }
  for (const w of res.warnings) lines.push(`warning: ${w}`);
  if (evaluation) {
    lines.push('');
    lines.push(...formatEvaluation(evaluation));
  }
  return lines.join('\n');
}

export function formatEvaluation(e: Evaluation): string[] {
  const lines = [`comparison vs user-reported truth: ${e.exact ? 'EXACT MATCH' : 'MISMATCH'}`];
  lines.push(`  sets: truth ${e.truthSets}, detected ${e.detectedSets}`);
  lines.push(`  reps: truth ${e.truthReps.join(' / ')} (total ${e.truthTotal}), detected ${e.detectedReps.join(' / ')} (total ${e.detectedTotal}), abs error ${e.totalAbsRepError}`);
  if (e.restErrorsSec.length) {
    lines.push(
      `  rests: truth ${e.truthRestsSec.map((r) => (r == null ? '?' : r.toFixed(1))).join(' / ')}, detected ${e.detectedRestsSec.map((r) => r.toFixed(1)).join(' / ')}`,
    );
  }
  return lines;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Downsample by min/max decimation so peaks survive. */
function decimate(t: ArrayLike<number>, y: ArrayLike<number>, maxPts: number): [number, number][] {
  const n = t.length;
  if (n <= maxPts) return Array.from({ length: n }, (_, i) => [t[i], y[i]]);
  const bucket = Math.ceil(n / (maxPts / 2));
  const out: [number, number][] = [];
  for (let s = 0; s < n; s += bucket) {
    let lo = s,
      hi = s;
    for (let i = s; i < Math.min(n, s + bucket); i++) {
      if (y[i] < y[lo]) lo = i;
      if (y[i] > y[hi]) hi = i;
    }
    const [a, b] = lo < hi ? [lo, hi] : [hi, lo];
    out.push([t[a], y[a]]);
    if (b !== a) out.push([t[b], y[b]]);
  }
  return out;
}

export function htmlReport(title: string, res: AnalysisResult, summary: string): string {
  const tr = res.trace;
  const tEnd = tr.t.length ? tr.t[tr.t.length - 1] : 1;
  const W = Math.max(1200, Math.min(12000, Math.round(tEnd * 12)));
  const H = 170;
  const padL = 50;
  const x = (t: number) => padL + (t / tEnd) * (W - padL - 10);

  const panel = (label: string, y: ArrayLike<number>, color: string, unit: string, extra?: (yy: (v: number) => number) => string) => {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < y.length; i++) {
      if (y[i] < lo) lo = y[i];
      if (y[i] > hi) hi = y[i];
    }
    if (!(hi > lo)) {
      lo -= 1;
      hi += 1;
    }
    const yy = (v: number) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 25);
    const pts = decimate(tr.t, y, 6000)
      .map(([t, v]) => `${x(t).toFixed(1)},${yy(v).toFixed(1)}`)
      .join(' ');
    const bands = res.sets
      .map((s) => `<rect x="${x(s.startSec)}" y="0" width="${x(s.endSec) - x(s.startSec)}" height="${H}" fill="#2e7d3222"/>`)
      .join('');
    const quiet = tr.quietSec.map(([a, b]) => `<rect x="${x(a)}" y="${H - 6}" width="${x(b) - x(a)}" height="6" fill="#90a4ae"/>`).join('');
    const zero = lo < 0 && hi > 0 ? `<line x1="${padL}" x2="${W}" y1="${yy(0)}" y2="${yy(0)}" stroke="#bbb" stroke-dasharray="4 4"/>` : '';
    const ticks: string[] = [];
    const step = tEnd > 600 ? 60 : tEnd > 120 ? 10 : 5;
    for (let t = 0; t <= tEnd; t += step) ticks.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${H - 12}" y2="${H}" stroke="#999"/><text x="${x(t) + 2}" y="${H - 1}" font-size="9" fill="#666">${t}s</text>`);
    return `<div class="p"><div class="l">${esc(label)} <span>[${lo.toPrecision(3)} … ${hi.toPrecision(3)} ${unit}]</span></div>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${bands}${quiet}${zero}${ticks.join('')}<polyline fill="none" stroke="${color}" stroke-width="1" points="${pts}"/>${extra ? extra(yy) : ''}</svg></div>`;
  };

  const markers = (yy: (v: number) => number) =>
    res.candidates
      .map((c) => {
        const col = c.accepted ? '#1565c0' : '#d32f2f';
        const lbl = c.accepted ? String(c.setIndex! + 1) + '.' + (res.sets[c.setIndex!].repIds.indexOf(c.id) + 1) : c.rejectReasons.join('+');
        const pi = Math.min(tr.position.length - 1, Math.round(c.peakSec * res.config.fs));
        return `<g><line x1="${x(c.startSec)}" x2="${x(c.startSec)}" y1="0" y2="${H - 12}" stroke="${col}" stroke-opacity=".25"/><circle cx="${x(c.peakSec)}" cy="${yy(tr.position[pi])}" r="3" fill="${col}"/><text x="${x(c.peakSec) + 3}" y="${yy(tr.position[pi]) - 4}" font-size="9" fill="${col}">${esc(lbl)}</text><title>#${c.id} ${esc(c.rejectReasons.join(', ') || 'accepted')} dur ${c.durationSec.toFixed(2)}s amp ${(c.amplitudeM * 100).toFixed(1)}cm vert ${c.verticality.toFixed(2)} rot ${c.rotationRmsDegS.toFixed(1)}</title></g>`;
      })
      .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:13px system-ui,sans-serif;margin:16px;color:#222;background:#fff}pre{background:#f5f5f5;padding:10px;overflow:auto}.w{overflow-x:auto;border:1px solid #ddd}.p .l{font-weight:600;margin:6px 0 0 4px}.p .l span{font-weight:400;color:#777}</style></head><body>
<h2>${esc(title)}</h2><p>Green bands = detected sets. Blue dots = accepted reps (set.rep). Red = rejected candidates (reason). Grey bars at bottom = still periods used as zero anchors. Hover a dot for details. Scroll horizontally.</p>
<pre>${esc(summary)}</pre><div class="w">
${panel('Estimated vertical displacement (relative)', tr.position, '#333', 'm', markers)}
${panel('Vertical acceleration (band-passed)', tr.verticalAccel, '#6a1b9a', 'm/s²')}
${panel('Horizontal acceleration magnitude', tr.horizontalAccel, '#ef6c00', 'm/s²')}
${panel('Rotation rate magnitude', tr.rotationRate, '#00838f', '°/s')}
${panel('Activity (moving RMS of vertical accel)', tr.activity, '#558b2f', 'm/s²')}
</div></body></html>`;
}
