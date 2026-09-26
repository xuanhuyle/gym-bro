import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { COL, contextLabel, ExerciseContext, RECORDING_FORMAT, RECORDING_SCHEMA_VERSION, RecordingEvent, RecordingMeta, SAMPLE_COLUMNS } from '../../recording/schema';
import { checkMotionAvailability, MotionStream, REQUESTED_INTERVAL_MS, startMotionStream } from '../../sensors/motionSource';
import { appendSamples, createRecording, newRecordingId, updateMeta } from '../../storage/recordingStore';
import { Button, Card, colors, Row, styles } from '../components/common';

const FLUSH_MS = 2000;

export function RecordingScreen(props: { context: ExerciseContext; onDone: (id: string | null) => void }) {
  useKeepAwake();
  const [status, setStatus] = useState<'starting' | 'recording' | 'stopping' | 'failed'>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [count, setCount] = useState(0);
  const [live, setLive] = useState<{ acc: number; rot: number } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const ref = useRef<{ id: string; stream: MotionStream; events: RecordingEvent[]; count: number; t0: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    let uiTimer: ReturnType<typeof setInterval> | undefined;
    let appSub: { remove(): void } | undefined;

    (async () => {
      const avail = await checkMotionAvailability();
      if (cancelled) return;
      if (!avail.available) {
        setStatus('failed');
        Alert.alert('Motion sensors unavailable', `DeviceMotion is not available on this device (permission: ${avail.permission}).`, [{ text: 'OK', onPress: () => props.onDone(null) }]);
        return;
      }
      if (avail.permission === 'denied') setWarning('Motion permission denied — data may be empty. Enable Motion & Fitness for Expo Go in iOS Settings.');

      const now = new Date();
      const id = newRecordingId(now);
      const events: RecordingEvent[] = [{ wallMs: now.getTime(), type: 'start' }];
      const meta: RecordingMeta = {
        format: RECORDING_FORMAT,
        schemaVersion: RECORDING_SCHEMA_VERSION,
        id,
        createdAt: now.toISOString(),
        startedAt: now.toISOString(),
        stoppedAt: null,
        context: props.context,
        device: {
          platform: Platform.OS,
          osVersion: Device.osVersion ?? null,
          modelName: Device.modelName ?? null,
          appVersion: Constants.expoConfig?.version ?? null,
          expoSdk: Constants.expoConfig?.sdkVersion ?? null,
        },
        sensor: {
          api: 'expo-sensors DeviceMotion',
          requestedIntervalMs: REQUESTED_INTERVAL_MS,
          reportedIntervalMs: null,
          timestampOriginSec: null,
          columns: [...SAMPLE_COLUMNS],
        },
        events,
        userReported: null,
        sampleCount: 0,
      };
      try {
        createRecording(meta);
      } catch (e) {
        setStatus('failed');
        Alert.alert('Could not create recording file', String(e), [{ text: 'OK', onPress: () => props.onDone(null) }]);
        return;
      }
      const stream = startMotionStream(REQUESTED_INTERVAL_MS);
      ref.current = { id, stream, events, count: 0, t0: Date.now() };
      setStatus('recording');

      const flush = () => {
        const r = ref.current;
        if (!r) return;
        const rows = r.stream.drain();
        try {
          appendSamples(r.id, rows);
          r.count += rows.length;
        } catch (e) {
          setWarning(`Saving failed: ${String(e)}`);
        }
      };
      flushTimer = setInterval(flush, FLUSH_MS);
      uiTimer = setInterval(() => {
        const r = ref.current;
        if (!r) return;
        setElapsed((Date.now() - r.t0) / 1000);
        setCount(r.count);
        const l = r.stream.latest();
        if (l) setLive({ acc: Math.hypot(l[COL.acc_x], l[COL.acc_y], l[COL.acc_z]), rot: Math.hypot(l[COL.rr_alpha], l[COL.rr_beta], l[COL.rr_gamma]) });
      }, 250);
      appSub = AppState.addEventListener('change', (s) => {
        const r = ref.current;
        if (!r) return;
        r.events.push({ wallMs: Date.now(), type: s === 'active' ? 'app-active' : 'app-background', detail: s });
        if (s !== 'active') {
          flush();
          setWarning('The app left the foreground. iOS pauses sensor data while the app is not visible — there will be a gap.');
        }
        try {
          updateMeta(r.id, { events: r.events });
        } catch {
          /* best effort */
        }
      });
    })();

    return () => {
      cancelled = true;
      if (flushTimer) clearInterval(flushTimer);
      if (uiTimer) clearInterval(uiTimer);
      appSub?.remove();
      ref.current?.stream.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    const r = ref.current;
    if (!r || status !== 'recording') return;
    setStatus('stopping');
    r.stream.stop();
    try {
      const rows = r.stream.drain();
      appendSamples(r.id, rows);
      r.count += rows.length;
      r.events.push({ wallMs: Date.now(), type: 'stop' });
      updateMeta(r.id, {
        stoppedAt: new Date().toISOString(),
        sampleCount: r.count,
        events: r.events,
        sensor: {
          api: 'expo-sensors DeviceMotion',
          requestedIntervalMs: REQUESTED_INTERVAL_MS,
          reportedIntervalMs: r.stream.reportedIntervalMs(),
          timestampOriginSec: r.stream.originSec(),
          columns: [...SAMPLE_COLUMNS],
        },
      });
    } catch (e) {
      Alert.alert('Problem while saving', String(e));
    }
    ref.current = null;
    props.onDone(r.id);
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
