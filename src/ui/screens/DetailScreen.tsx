import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { analyzeSamples, AnalysisResult } from '../../analysis/analyze';
import { evaluate, evaluateCounts, Evaluation } from '../../analysis/evaluate';
import { contextLabel, Recording, UserReported } from '../../recording/schema';
import { summarize } from '../../session/machine';
import { ExerciseSessionRecord } from '../../session/record';
import { fmtDay, fmtKg, fmtReps, fmtSigned } from '../../memory/format';
import { previousComparable } from '../../memory/queries';
import { deleteRecording, loadHistory, loadRecording, loadSession, shareRecordingJson, shareSamplesCsv, updateMeta } from '../../storage/recordingStore';
import { fmtClock } from './ExerciseSessionScreen';
import { Button, Card, Chips, colors, Row, styles } from '../components/common';
import { TraceChart } from '../components/TraceChart';

const SIGNALS = ['position', 'verticalAccel', 'horizontalAccel', 'rotationRate'] as const;
const SIGNAL_NAMES = { position: 'Displacement', verticalAccel: 'Vert. accel', horizontalAccel: 'Horiz. accel', rotationRate: 'Rotation' } as const;
type SignalName = (typeof SIGNAL_NAMES)[keyof typeof SIGNAL_NAMES];

const f1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));

export function DetailScreen(props: { id: string; onBack: () => void }) {
  const [rec, setRec] = useState<Recording | null>(null);
  const [session, setSession] = useState<ExerciseSessionRecord | null>(null);
  const [memory, setMemory] = useState<ReturnType<typeof previousComparable>>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  useEffect(() => {
    // Defer so the spinner renders before the (synchronous) file read.
    const h = setTimeout(() => {
      try {
        setRec(loadRecording(props.id));
        setSession(loadSession(props.id) ?? null);
        try {
          setMemory(previousComparable(loadHistory() ?? [], props.id));
        } catch {
          setMemory(null);
        }
      } catch (e) {
        setError(String(e));
      }
    }, 50);
    return () => clearTimeout(h);
  }, [props.id]);

  const res: AnalysisResult | null = useMemo(() => (rec ? analyzeSamples(rec.samples) : null), [rec, runId]);

  if (error) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={{ color: colors.danger }}>{error}</Text>
        <Button title="Back" onPress={props.onBack} />
      </View>
    );
  }
  if (!rec || !res) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Loading and analysing…</Text>
      </View>
    );
  }
  return <DetailBody rec={rec} res={res} session={session} memory={memory} onBack={props.onBack} onReanalyze={() => setRunId((n) => n + 1)} onSaved={(u) => setRec({ ...rec, userReported: u })} />;
}

function DetailBody({
  rec,
  res,
  session,
  memory,
  onBack,
  onReanalyze,
  onSaved,
}: {
  rec: Recording;
  res: AnalysisResult;
  session: ExerciseSessionRecord | null;
  memory: ReturnType<typeof previousComparable>;
  onBack: () => void; onReanalyze: () => void; onSaved: (u: UserReported) => void }) {
  const [signal, setSignal] = useState<SignalName>('Displacement');
  const [showCandidates, setShowCandidates] = useState(false);
  const truth = rec.userReported;
  const ev = truth && truth.sets.length ? evaluate(res, { sets: truth.sets, restsSec: truth.restsSec }) : null;
  const live = session ? summarize(session.state, session.state.watermarkSec) : null;
  const liveEv =
    live && truth && truth.sets.length
      ? evaluateCounts(
          live.sets.map((x) => x.reps),
          live.rests.filter((r) => !r.ongoing).map((r) => r.durationSec),
          { sets: truth.sets, restsSec: truth.restsSec },
        )
      : null;
  const signalKey = SIGNALS.find((k) => SIGNAL_NAMES[k] === signal)!;

  const exportAs = async (kind: 'json' | 'csv') => {
    try {
      if (kind === 'json') await shareRecordingJson(rec.id);
      else await shareSamplesCsv(rec.id);
    } catch (e) {
      Alert.alert('Export failed', String(e));
    }
  };
  const remove = () =>
    Alert.alert('Delete recording?', 'This cannot be undone. Export it first if you may need it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRecording(rec.id);
          onBack();
        },
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Button title="‹ Recordings" kind="secondary" onPress={onBack} style={{ alignSelf: 'flex-start' }} />
      <Text style={styles.h1}>{contextLabel(rec.context) || rec.id}</Text>
      <Text style={styles.muted}>
        {new Date(rec.createdAt).toLocaleString()} · {rec.device.modelName ?? rec.device.platform} {rec.device.osVersion ?? ''}
        {rec.stoppedAt == null ? ' · INTERRUPTED' : ''}
      </Text>

      {session && live ? (
        <Card title={`Automatic session result (${session.status === 'complete' ? 'complete' : 'interrupted'})`} style={{ marginTop: 12 }}>
          <Row label="Exercise" value={`${session.selection.labels.exercise}${session.selection.labels.variant ? ' · ' + session.selection.labels.variant : ''}`} />
          <Row label="Machine" value={session.selection.labels.equipment} />
          <Row label="Weight" value={session.loadKg != null ? `${session.loadKg} kg` : '—'} />
          <Row label="Primary muscles" value={session.selection.muscles.primary.join(', ')} />
          {session.selection.muscles.secondary.length ? <Row label="Secondary muscles" value={session.selection.muscles.secondary.join(', ')} /> : null}
          {live.sets.map((x) => {
            const rest = live.rests.find((r) => r.afterSet === x.index && !r.ongoing);
            return (
              <React.Fragment key={x.index}>
                <Row label={`Set ${x.index + 1}`} value={`${x.reps} reps`} />
                {rest ? <Row label="Rest" value={fmtClock(rest.durationSec)} /> : null}
              </React.Fragment>
            );
          })}
          <Row label="Ended by" value={session.state.completion?.reason ?? '— (app closed before completion)'} />
          <Row label="Ignored movements" value={session.state.ignored.filter((i) => i.reason === 'isolated').length} />
          <Text style={{ color: colors.warn, fontSize: 12, marginTop: 6 }}>Live segmentation is hardware-validation-pending. The offline re-analysis below uses the whole recording.</Text>
        </Card>
      ) : null}

      {memory ? (
        <Card title="Compared with the previous session">
          {memory.previous && memory.change?.comparable ? (
            <>
              <Row label={`Previous (${fmtDay(memory.previous.date)})`} value={`${fmtKg(memory.previous.loadKg)} · ${fmtReps(memory.previous.reps)}`} />
              <Row label="This session" value={`${fmtKg(memory.entry.loadKg)} · ${fmtReps(memory.entry.reps)}`} />
              <Row
                label="Change"
                value={`${memory.change.diff.loadDeltaKg != null ? fmtSigned(memory.change.diff.loadDeltaKg, ' kg') : '? kg'} · ${fmtSigned(memory.change.diff.totalRepsDelta)} reps · ${fmtSigned(memory.change.diff.setCountDelta)} sets`}
              />
              <Text style={[styles.muted, { fontSize: 12 }]}>Same exercise, machine and variant only.</Text>
            </>
          ) : (
            <Text style={styles.muted}>First session with this exercise, machine and variant.</Text>
          )}
        </Card>
      ) : null}

      <Card title={session ? 'Offline re-analysis (whole recording)' : 'Detected'} style={{ marginTop: 12 }}>
        <Row label="Sets" value={res.sets.length} />
        <Row label="Reps per set" value={res.sets.map((s) => s.repCount).join(' / ') || '—'} />
        {res.rests.map((r) => (
          <Row key={r.afterSet} label={`Rest after set ${r.afterSet + 1}`} value={`${f1(r.durationSec)} s`} />
        ))}
        {res.sets.map((s) => (
          <Text key={s.index} style={[styles.muted, { marginTop: 4 }]}>
            Set {s.index + 1}: {s.repCount} reps · {f1(s.startSec)}–{f1(s.endSec)} s · cadence{' '}
            {s.cadence.repsPerMin ? `${s.cadence.repsPerMin.toFixed(1)}/min (${f1(s.cadence.repPeriodSec)} s/rep)` : '—'}
            {s.cadence.reliable ? '' : ' (unreliable)'} · up {f1(s.cadence.upSec)} s / down {f1(s.cadence.downSec)} s · rel. amplitude {f1(s.meanAmplitudeM * 100)} cm
          </Text>
        ))}
        {res.warnings.map((w, i) => (
          <Text key={i} style={{ color: colors.warn, marginTop: 6 }}>
            ⚠ {w}
          </Text>
        ))}
      </Card>

      <TruthEditor rec={rec} res={res} liveReps={live ? live.sets.map((x) => x.reps) : null} onSaved={onSaved} />

      {liveEv ? <ComparisonCard title={liveEv.exact ? 'Live session vs actual: exact match ✓' : 'Live session vs actual: mismatch ✗'} ev={liveEv} /> : null}
      {ev ? (
        <Card title={ev.exact ? 'Comparison: exact match ✓' : 'Comparison: mismatch ✗'}>
          <Row label="Sets (actual / detected)" value={`${ev.truthSets} / ${ev.detectedSets}`} tone={ev.truthSets === ev.detectedSets ? 'good' : 'danger'} />
          {Array.from({ length: Math.max(ev.truthReps.length, ev.detectedReps.length) }, (_, i) => (
            <Row
              key={i}
              label={`Set ${i + 1} reps (actual / detected)`}
              value={`${ev.truthReps[i] ?? '—'} / ${ev.detectedReps[i] ?? '—'}`}
              tone={ev.truthReps[i] === ev.detectedReps[i] ? 'good' : 'danger'}
            />
          ))}
          {ev.truthRestsSec.map((t, i) => (
            <Row key={`r${i}`} label={`Rest ${i + 1} (actual / detected)`} value={`${f1(t)} / ${f1(ev.detectedRestsSec[i])} s`} />
          ))}
          <Row label="Total reps (actual / detected)" value={`${ev.truthTotal} / ${ev.detectedTotal}`} />
        </Card>
      ) : null}

      <Card title="Debug view">
        <Chips options={Object.values(SIGNAL_NAMES)} value={signal} onChange={setSignal} />
        <TraceChart res={res} signal={signalKey} />
        <Text style={[styles.muted, { marginTop: 6 }]}>Green = detected sets · blue numbers = accepted reps · red × = rejected candidates · grey bars = still periods. Scroll sideways.</Text>
        <Row label="Samples / duration" value={`${res.quality.rawSampleCount} / ${f1(res.quality.durationSec)} s`} />
        <Row label="Mean sample rate" value={`${f1(res.quality.meanRateHz)} Hz`} tone={res.quality.meanRateHz < 50 ? 'warn' : undefined} />
        <Row label="Timestamp gaps" value={res.quality.gaps.length} tone={res.quality.gaps.length ? 'warn' : undefined} />
        <Row label="Orientation spread" value={`${f1(res.quality.orientationSpreadDeg)}°`} />
        <Row label="Up/down" value={`${res.verticalSign > 0 ? '+1' : '−1'} (${res.signSource}; votes ${f1(res.signVotes.up)}/${f1(res.signVotes.down)})`} />
        <Row label="Swing threshold" value={`${f1(res.swingThresholdM * 100)} cm`} />
        <Row label="Algorithm" value={res.algorithmVersion} />
        <Button title={showCandidates ? 'Hide candidates' : `Show all ${res.candidates.length} rep candidates`} kind="secondary" onPress={() => setShowCandidates((v) => !v)} />
        {showCandidates
          ? res.candidates.map((c) => (
              <Text key={c.id} style={[styles.mono, { color: c.accepted ? colors.text : colors.danger }]}>
                #{c.id} {c.peakSec.toFixed(1)}s {c.accepted ? `set ${c.setIndex! + 1}` : c.rejectReasons.join('+')} dur {c.durationSec.toFixed(2)} amp {(c.amplitudeM * 100).toFixed(1)}cm vert {c.verticality.toFixed(2)} rot {c.rotationRmsDegS.toFixed(0)}
              </Text>
            ))
          : null}
        <Button title="Re-run analysis" kind="secondary" onPress={onReanalyze} />
      </Card>

      <Card title="Export">
        <Text style={[styles.muted, { marginBottom: 6 }]}>JSON = everything (context, your actual counts, all raw samples). Use it to send the recording back for analysis.</Text>
        <Button title="Export JSON (recommended)" onPress={() => exportAs('json')} />
        <Button title="Export raw samples CSV" kind="secondary" onPress={() => exportAs('csv')} />
      </Card>
      <Button title="Delete recording" kind="danger" onPress={remove} />
    </ScrollView>
  );
}

function ComparisonCard({ title, ev }: { title: string; ev: Evaluation }) {
  return (
    <Card title={title}>
      {Array.from({ length: Math.max(ev.truthReps.length, ev.detectedReps.length) }, (_, i) => (
        <Row key={i} label={`Set ${i + 1} reps (actual / detected)`} value={`${ev.truthReps[i] ?? '—'} / ${ev.detectedReps[i] ?? '—'}`} tone={ev.truthReps[i] === ev.detectedReps[i] ? 'good' : 'danger'} />
      ))}
      {ev.truthRestsSec.map((t, i) => (
        <Row key={`r${i}`} label={`Rest ${i + 1} (actual / detected)`} value={`${f1(t)} / ${f1(ev.detectedRestsSec[i])} s`} />
      ))}
    </Card>
  );
}

function TruthEditor({ rec, res, liveReps, onSaved }: { rec: Recording; res: AnalysisResult; liveReps: number[] | null; onSaved: (u: UserReported) => void }) {
  const init = rec.userReported;
  const [reps, setReps] = useState<string[]>(init ? init.sets.map((s) => String(s.reps)) : ['']);
  const [rests, setRests] = useState<string[]>(init ? init.restsSec.map((r) => (r == null ? '' : String(r))) : []);
  const [notes, setNotes] = useState(init?.notes ?? '');
  const [dirty, setDirty] = useState(false);

  const setCount = (n: number) => {
    setReps((r) => Array.from({ length: n }, (_, i) => r[i] ?? ''));
    setRests((r) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => r[i] ?? ''));
    setDirty(true);
  };
  const copyDetected = (counts: number[]) => {
    setReps(counts.length ? counts.map(String) : ['']);
    setRests(counts.slice(1).map(() => ''));
    setDirty(true);
  };
  const save = () => {
    const sets = reps.map((r) => ({ reps: Math.max(0, Math.round(Number(r))) }));
    if (sets.some((s) => !Number.isFinite(s.reps)) || reps.some((r) => r.trim() === '')) {
      Alert.alert('Enter the reps for every set');
      return;
    }
    const u: UserReported = {
      sets,
      restsSec: rests.map((r) => (r.trim() === '' || !Number.isFinite(Number(r)) ? null : Number(r))),
      notes,
      updatedAt: new Date().toISOString(),
    };
    try {
      updateMeta(rec.id, { userReported: u });
      onSaved(u);
      setDirty(false);
    } catch (e) {
      Alert.alert('Save failed', String(e));
    }
  };

  return (
    <Card title="What actually happened (ground truth / correction)">
      <Text style={[styles.muted, { marginBottom: 8 }]}>Enter what you really did. This corrects the log and is what detection is compared against.</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={styles.body}>Sets: {reps.length}  </Text>
        <Button title="−" kind="secondary" onPress={() => reps.length > 1 && setCount(reps.length - 1)} style={{ paddingVertical: 4, marginRight: 6 }} />
        <Button title="+" kind="secondary" onPress={() => setCount(reps.length + 1)} style={{ paddingVertical: 4 }} />
      </View>
      {reps.map((r, i) => (
        <View key={i}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[styles.body, { width: 110 }]}>Set {i + 1} reps</Text>
            <TextInput
              value={r}
              onChangeText={(v) => {
                setReps((p) => p.map((x, j) => (j === i ? v : x)));
                setDirty(true);
              }}
              keyboardType="number-pad"
              style={[styles.input, { width: 80 }]}
            />
          </View>
          {i < reps.length - 1 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={[styles.muted, { width: 110 }]}>rest after (s)</Text>
              <TextInput
                value={rests[i] ?? ''}
                placeholder="optional"
                onChangeText={(v) => {
                  setRests((p) => p.map((x, j) => (j === i ? v : x)));
                  setDirty(true);
                }}
                keyboardType="decimal-pad"
                style={[styles.input, { width: 80 }]}
              />
            </View>
          ) : null}
        </View>
      ))}
      <TextInput
        value={notes}
        onChangeText={(v) => {
          setNotes(v);
          setDirty(true);
        }}
        placeholder="Notes (e.g. touched the phone during rest 2; partial last rep)"
        multiline
        style={[styles.input, { minHeight: 60, marginTop: 4 }]}
      />
      <Button title={dirty ? 'Save' : init ? 'Saved ✓' : 'Save'} onPress={save} disabled={!dirty} />
      {liveReps ? <Button title="Copy live session counts (then correct them)" kind="secondary" onPress={() => copyDetected(liveReps)} /> : null}
      <Button title="Copy detected counts (then correct them)" kind="secondary" onPress={() => copyDetected(res.sets.map((s) => s.repCount))} />
    </Card>
  );
}
