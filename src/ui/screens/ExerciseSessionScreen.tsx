/**
 * Live exercise session. It opens ARMED as soon as the exercise is chosen (no
 * START button): acquisition runs while the user straps the phone to the
 * stack; placement motion is ignored; when the phone is still the session is
 * READY and Set 1 starts by itself on a coherent rep sequence (first rep
 * included), then Rest → Set → … → SAVED without touching the phone. Raw 100 Hz samples are recorded exactly
 * as in the raw recorder; the session state is persisted after every
 * meaningful change so a crash keeps the sets already done.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { COL, ExerciseContext } from '../../recording/schema';
import { LiveSession } from '../../session/live';
import { summarize } from '../../session/machine';
import { ExerciseSelection, ExerciseSessionRecord, newSessionRecord } from '../../session/record';
import { catalogue } from '../../catalogue/catalogue';
import { TrainingEntry } from '../../memory/history';
import { ResumeWeight, variantMemory } from '../../memory/queries';
import { compatibleMachines, switchMachine } from '../../memory/context';
import { fmtOneLine } from '../../memory/format';
import { DEFAULT_PRESCRIPTION, describePrescription, Prescription, sessionConfigFor } from '../../planning/prescription';
import { deleteRecording, saveSession, updateMeta } from '../../storage/recordingStore';
import { VariantMemoryCard, WeightMemoryHint } from '../components/Memory';
import { ActiveRecorder, startRecorder } from '../recorder';
import { Button, Card, colors, styles } from '../components/common';

const WEIGHT_STEP = 2.5;

const FLUSH_MS = 2000;

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function ExerciseSessionScreen(props: {
  selection: ExerciseSelection;
  /** Weight resumed from memory (null if none); editable while armed. */
  loadKg: number | null;
  context: ExerciseContext;
  onExit: (id: string | null) => void;
  history?: TrainingEntry[];
  resume?: ResumeWeight;
  /** The user changed the weight (e.g. to remember it for next time). */
  onWeightChange?: (kg: number | null) => void;
  /** Abandon before Set 1 (wrong exercise): the armed recording is discarded. */
  onChangeExercise?: () => void;
  /** Same exercise on another compatible machine (e.g. this one is occupied): re-arm with that variant. */
  onSwitchMachine?: (variantId: string) => void;
  prescription?: Prescription;
  now?: Date;
}) {
  useKeepAwake();
  const prescription = props.prescription ?? DEFAULT_PRESCRIPTION;
  const [loadKg, setLoadKg] = useState<number | null>(props.loadKg);
  const [weightText, setWeightText] = useState(props.loadKg != null ? String(props.loadKg) : '');
  const [status, setStatus] = useState<'starting' | 'running' | 'saved' | 'failed'>('starting');
  const [, setTick] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const ref = useRef<{ rec: ActiveRecorder; live: LiveSession; record: ExerciseSessionRecord; nowSec: number } | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  const persist = (complete = false) => {
    const r = ref.current;
    if (!r) return;
    r.record = { ...r.record, state: r.live.state, status: complete ? 'complete' : 'in-progress', updatedAt: new Date().toISOString() };
    try {
      saveSession(r.record);
    } catch (e) {
      setWarning(`Could not save session: ${String(e)}`);
    }
  };

  const finalize = () => {
    const r = ref.current;
    if (!r) return;
    timers.current.forEach(clearInterval);
    timers.current = [];
    try {
      r.rec.stop();
    } catch (e) {
      setWarning(`Problem while saving the recording: ${String(e)}`);
    }
    persist(true);
    setStatus('saved');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let rec: ActiveRecorder;
      try {
        rec = await startRecorder(props.context, setWarning);
      } catch (e) {
        if (cancelled) return;
        setStatus('failed');
        Alert.alert('Cannot record', e instanceof Error ? e.message : String(e), [{ text: 'OK', onPress: () => props.onExit(null) }]);
        return;
      }
      if (cancelled) {
        rec.dispose();
        return;
      }
      const live = new LiveSession({ session: sessionConfigFor(prescription) });
      const record = newSessionRecord(rec.id, props.selection, loadKg, live.detector.opts, live.state, new Date().toISOString(), prescription);
      ref.current = { rec, live, record, nowSec: 0 };
      persist();
      setStatus('running');
      timers.current.push(
        setInterval(() => {
          const r = ref.current;
          if (!r) return;
          const rows = r.rec.flush();
          if (rows.length) r.nowSec = rows[rows.length - 1][COL.t];
          let changed = false;
          try {
            changed = r.live.ingest(rows);
          } catch (e) {
            setWarning(`Detector error: ${String(e)}`);
          }
          if (r.live.state.phase === 'COMPLETE') finalize();
          else if (changed) persist();
        }, FLUSH_MS),
        setInterval(() => {
          const r = ref.current;
          const l = r?.rec.latest();
          if (r && l) r.nowSec = Math.max(r.nowSec, l[COL.t]);
          setTick((n) => n + 1);
        }, 250),
      );
    })();
    return () => {
      cancelled = true;
      timers.current.forEach(clearInterval);
      timers.current = [];
      if (ref.current && ref.current.live.state.phase !== 'COMPLETE') ref.current.rec.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyWeight = (text: string) => {
    setWeightText(text);
    const kg = text.trim() === '' ? null : Number(text.replace(',', '.'));
    if (kg != null && !(Number.isFinite(kg) && kg >= 0)) return;
    setLoadKg(kg);
    props.onWeightChange?.(kg);
    const r = ref.current;
    if (!r) return;
    r.record = { ...r.record, loadKg: kg };
    persist();
    try {
      updateMeta(r.rec.id, { context: { ...props.context, loadKg: kg } });
    } catch {
      /* the session record already holds the weight */
    }
  };
  const bump = (d: number) => {
    const cur = Number(weightText.replace(',', '.'));
    applyWeight(String(Math.max(0, Math.round(((Number.isFinite(cur) ? cur : 0) + d) * 10) / 10)));
  };

  const discardArmed = () => {
    const r = ref.current;
    timers.current.forEach(clearInterval);
    timers.current = [];
    if (r) {
      r.rec.dispose();
      try {
        deleteRecording(r.rec.id);
      } catch {
        /* nothing was recorded that matters */
      }
      ref.current = null;
    }
  };
  const pickMachine = (equipmentId: string) => {
    const ctx = switchMachine(props.history ?? [], catalogue, null, { exerciseId: sel.exerciseId, variantId: sel.variantId }, equipmentId);
    discardArmed();
    props.onSwitchMachine?.(ctx.variantId);
  };

  const changeExercise = () => {
    discardArmed();
    props.onChangeExercise?.();
  };

  const finishNow = () =>
    Alert.alert('Finish exercise now?', 'Use this if automatic detection did not end the exercise. Sets detected so far are kept.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Finish',
        onPress: () => {
          const r = ref.current;
          if (!r) return;
          r.live.ingest(r.rec.flush(), true);
          r.live.finish(r.nowSec);
          finalize();
        },
      },
    ]);

  const r = ref.current;
  const summary = r ? summarize(r.live.state, r.nowSec) : null;
  const sel = props.selection;
  const now = props.now ?? new Date();
  const machines = compatibleMachines(props.history ?? [], catalogue, sel.exerciseId);
  const phase = summary?.phase ?? null;
  const preSet = status === 'running' && (phase === 'ARMED' || phase === 'READY');

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>{sel.labels.exercise.toUpperCase()}</Text>
        <Text style={styles.muted}>
          {sel.labels.equipment}
          {sel.labels.variant ? ` · ${sel.labels.variant}` : ''}
        </Text>
        {preSet ? null : <Text style={{ fontSize: 32, fontWeight: '700', color: colors.text, marginBottom: 12 }}>{loadKg != null ? `${loadKg} kg` : '— kg'}</Text>}

        {status === 'starting' ? <Text style={styles.muted}>Starting sensors…</Text> : null}
        {preSet ? (
          <View style={{ marginVertical: 8 }}>
            {phase === 'ARMED' ? (
              <>
                <Text style={big(colors.primary)}>ARMED</Text>
                <Text style={styles.body}>Strap the phone firmly to the top plate of the stack. It starts by itself — no button.</Text>
              </>
            ) : (
              <>
                <Text style={big(colors.good)}>READY</Text>
                <Text style={styles.body}>Phone is still on the stack. Wait ~5 s, then start your first set.</Text>
              </>
            )}
            {r!.live.state.pending.length ? <Text style={styles.muted}>Movement detected…</Text> : null}
            <Card title="Weight" style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Button title={`−${WEIGHT_STEP}`} kind="secondary" onPress={() => bump(-WEIGHT_STEP)} />
                <TextInput
                  accessibilityLabel="Weight in kg"
                  value={weightText}
                  onChangeText={applyWeight}
                  keyboardType="decimal-pad"
                  placeholder="kg"
                  style={[styles.input, { width: 100, fontSize: 24, textAlign: 'center' }]}
                />
                <Text style={styles.body}>kg</Text>
                <Button title={`+${WEIGHT_STEP}`} kind="secondary" onPress={() => bump(WEIGHT_STEP)} />
              </View>
              <View style={{ marginTop: 6 }}>
                <WeightMemoryHint resume={props.resume ?? null} now={now} />
              </View>
            </Card>
            <VariantMemoryCard memory={variantMemory(props.history ?? [], sel.variantId, now)} now={now} />
            <Text style={styles.muted}>
              Primary: {sel.muscles.primary.join(', ')}
              {sel.muscles.secondary.length ? ` · Secondary: ${sel.muscles.secondary.join(', ')}` : ''}
            </Text>
            <Text style={[styles.muted, { marginTop: 6 }]}>Plan: {describePrescription(prescription)}</Text>
            {props.onSwitchMachine && machines.length > 1 ? (
              <Card title="Machine" style={{ marginTop: 12 }}>
                <Text style={styles.body}>{sel.labels.equipment}</Text>
                <Text style={[styles.muted, { marginBottom: 6 }]}>Occupied or different? Switch — history follows the machine.</Text>
                {machines
                  .filter((m) => m.equipment.id !== sel.equipmentId)
                  .map((m) => (
                    <Button
                      key={m.equipment.id}
                      title={`${m.equipment.name}${m.last ? ` · last ${fmtOneLine(m.last)}` : ' · first time'}`}
                      kind="secondary"
                      onPress={() => pickMachine(m.equipment.id)}
                    />
                  ))}
              </Card>
            ) : null}
            {props.onChangeExercise ? <Button title="Change exercise" kind="secondary" onPress={changeExercise} style={{ marginTop: 12 }} /> : null}
          </View>
        ) : null}

        {summary
          ? summary.sets.map((s, i) => {
              const rest = summary.rests.find((x) => x.afterSet === s.index);
              const active = !s.closed && summary.phase === 'ACTIVE_SET';
              return (
                <View key={s.index}>
                  <View style={line}>
                    <Text style={active ? big(colors.good) : mid}>SET {s.index + 1}</Text>
                    <Text style={active ? big(colors.good) : mid}>{s.reps} reps</Text>
                  </View>
                  {rest ? (
                    <View style={line}>
                      <Text style={rest.ongoing ? big(colors.primary) : mid}>REST</Text>
                      <Text style={[rest.ongoing ? big(colors.primary) : mid, { fontVariant: ['tabular-nums'] }]}>{fmtClock(rest.durationSec)}</Text>
                    </View>
                  ) : null}
                  {i === summary.sets.length - 1 && summary.phase === 'REST' && r!.live.state.pending.length ? <Text style={styles.muted}>Movement detected…</Text> : null}
                </View>
              );
            })
          : null}

        {status === 'saved' ? (
          <View style={{ marginTop: 16 }}>
            <Text style={big(colors.good)}>SAVED ✓</Text>
            <Text style={styles.muted}>
              {summary?.sets.length ?? 0} sets · {summary?.totalReps ?? 0} reps
              {r?.live.state.completion ? ` · ended: ${r.live.state.completion.reason}` : ''}
            </Text>
            <Button title="Review & correct" onPress={() => props.onExit(r?.rec.id ?? null)} style={{ marginTop: 12 }} />
          </View>
        ) : null}

        {warning ? <Text style={{ color: colors.warn, marginTop: 12 }}>{warning}</Text> : null}
        {status === 'running' ? (
          <>
            <Text style={[styles.muted, { marginTop: 16 }]}>
              Counts appear a few seconds after each rep. Automatic set/rest detection is pending validation on a real weight stack — note your real counts.
            </Text>
            <Button title="Finish exercise now" kind="secondary" onPress={finishNow} style={{ marginTop: 12 }} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const big = (color: string) => ({ fontSize: 36, fontWeight: '800' as const, color });
const mid = { fontSize: 22, fontWeight: '600' as const, color: colors.muted };
const line = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'baseline' as const, marginVertical: 4 };
