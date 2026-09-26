import React, { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { COL, contextLabel, ExerciseContext } from '../../recording/schema';
import { ActiveRecorder, startRecorder } from '../recorder';
import { Button, Card, colors, Row, styles } from '../components/common';

const FLUSH_MS = 2000;

/** Raw recording (developer mode): free-text context, manual STOP, no session logic. */
export function RecordingScreen(props: { context: ExerciseContext; onDone: (id: string | null) => void }) {
  useKeepAwake();
  const [status, setStatus] = useState<'starting' | 'recording' | 'stopping' | 'failed'>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [count, setCount] = useState(0);
  const [live, setLive] = useState<{ acc: number; rot: number } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const ref = useRef<{ rec: ActiveRecorder; t0: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    let uiTimer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      let rec: ActiveRecorder;
      try {
        rec = await startRecorder(props.context, setWarning);
      } catch (e) {
        if (cancelled) return;
        setStatus('failed');
        Alert.alert('Cannot record', e instanceof Error ? e.message : String(e), [{ text: 'OK', onPress: () => props.onDone(null) }]);
        return;
      }
      if (cancelled) {
        rec.dispose();
        return;
      }
      ref.current = { rec, t0: Date.now() };
      setStatus('recording');
      flushTimer = setInterval(() => ref.current?.rec.flush(), FLUSH_MS);
      uiTimer = setInterval(() => {
        const r = ref.current;
        if (!r) return;
        setElapsed((Date.now() - r.t0) / 1000);
        setCount(r.rec.count());
        const l = r.rec.latest();
        if (l) setLive({ acc: Math.hypot(l[COL.acc_x], l[COL.acc_y], l[COL.acc_z]), rot: Math.hypot(l[COL.rr_alpha], l[COL.rr_beta], l[COL.rr_gamma]) });
      }, 250);
    })();
    return () => {
      cancelled = true;
      if (flushTimer) clearInterval(flushTimer);
      if (uiTimer) clearInterval(uiTimer);
      ref.current?.rec.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    const r = ref.current;
    if (!r || status !== 'recording') return;
    setStatus('stopping');
    try {
      r.rec.stop();
    } catch (e) {
      Alert.alert('Problem while saving', String(e));
    }
    ref.current = null;
    props.onDone(r.rec.id);
  };

  const rate = elapsed > 1 ? count / elapsed : 0;
  const moving = live ? live.acc > 0.3 || live.rot > 20 : false;
  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60);

  return (
    <View style={[styles.screen, styles.content, { justifyContent: 'space-between' }]}>
      <View>
        <Text style={styles.muted}>{contextLabel(props.context)}</Text>
        <Text style={{ fontSize: 64, fontWeight: '800', color: status === 'recording' ? colors.danger : colors.muted, fontVariant: ['tabular-nums'] }}>
          {status === 'recording' ? '● ' : ''}
          {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
        </Text>
        <Card>
          <Row label="Status" value={status} />
          <Row label="Samples saved" value={count.toLocaleString()} />
          <Row label="Sample rate" value={rate ? `${rate.toFixed(0)} Hz` : '—'} tone={rate && rate < 50 ? 'warn' : undefined} />
          <Row label="Live motion" value={live ? `${live.acc.toFixed(2)} m/s² · ${live.rot.toFixed(0)} °/s` : '—'} />
          <Row label="" value={moving ? 'MOVING' : 'still'} tone={moving ? 'good' : undefined} />
        </Card>
        {warning ? <Text style={{ color: colors.warn, marginBottom: 8 }}>{warning}</Text> : null}
        <Text style={styles.muted}>Keep the stack still ~10 s before the first rep and after the last rep. Do not switch apps or lock the phone.</Text>
      </View>
      <Button title={status === 'stopping' ? 'Saving…' : 'STOP'} kind="danger" big onPress={stop} disabled={status !== 'recording'} />
    </View>
  );
}
