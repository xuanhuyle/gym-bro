/**
 * Contextual recall ("what did I do last time?") shown where decisions are
 * made — not in a separate history screen.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Catalogue } from '../../catalogue/catalogue';
import { fmtAgo, fmtDay, fmtKg, fmtOneLine, fmtReps, fmtRests, fmtSigned } from '../../memory/format';
import { TrainingEntry } from '../../memory/history';
import { MachineMemory, RegionMemory, ResumeWeight, VariantMemory } from '../../memory/queries';
import { Card, colors, styles } from './common';

const sourceTag = (e: TrainingEntry) => (e.source === 'corrected' ? 'counts confirmed by you' : 'auto-captured counts');

function variantLabel(e: TrainingEntry) {
  return `${e.labels.exercise}${e.labels.variant ? ` · ${e.labels.variant}` : ''}`;
}

export function VariantMemoryCard({ memory, now }: { memory: VariantMemory; now: Date }) {
  const { last, previous, change } = memory;
  if (!last) {
    return (
      <Card title="Last time">
        <Text style={styles.muted}>No previous session with this exercise, machine and variant.</Text>
      </Card>
    );
  }
  return (
    <Card>
      <Text style={styles.label}>
        LAST TIME — {fmtDay(last.date, now)} ({fmtAgo(last.date, now)})
      </Text>
      <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>{fmtKg(last.loadKg)}</Text>
      <Text style={[styles.body, { fontSize: 18, fontWeight: '600' }]}>{fmtReps(last.reps)} reps</Text>
      {last.restsSec.length ? <Text style={styles.body}>Rest: {fmtRests(last.restsSec)}</Text> : null}
      <Text style={[styles.muted, { fontSize: 12 }]}>{sourceTag(last)}</Text>
      {previous ? (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.label}>PREVIOUS — {fmtDay(previous.date, now)}</Text>
          <Text style={styles.body}>
            {fmtKg(previous.loadKg)} · {fmtReps(previous.reps)} reps
          </Text>
          {change?.comparable ? (
            <Text style={styles.muted}>
              Last vs previous: {change.diff.loadDeltaKg != null ? fmtSigned(change.diff.loadDeltaKg, ' kg') : '? kg'} · {fmtSigned(change.diff.totalRepsDelta)} reps
              {change.diff.setCountDelta ? ` · ${fmtSigned(change.diff.setCountDelta)} sets` : ''}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.muted, { marginTop: 6 }]}>
        {memory.sessionsRecent} session{memory.sessionsRecent === 1 ? '' : 's'} in the last {memory.recentDays} days · {memory.sessionsTotal} in total
      </Text>
    </Card>
  );
}

export function RegionMemoryLine({ memory, name, now }: { memory: RegionMemory; name: string; now: Date }) {
  if (!memory.lastTrained) return <Text style={styles.muted}>{name}: not trained yet.</Text>;
  const [w7, w30] = memory.windows;
  return (
    <Text style={styles.muted}>
      {name} last trained {fmtDay(memory.lastTrained, now)} ({fmtAgo(memory.lastTrained, now)}) · 7 days: {w7.sessions} sessions, {w7.sets} sets · 30 days: {w30.sessions} sessions, {w30.sets} sets
    </Text>
  );
}

export function MachineMemoryLine({ memory, currentVariantId, now }: { memory: MachineMemory; currentVariantId: string | null; now: Date }) {
  const last = memory.last;
  if (!last) return <Text style={styles.muted}>First time on this machine.</Text>;
  if (last.variantId === currentVariantId) return null; // the variant card already says it
  return (
    <Text style={styles.muted}>
      Last on this machine: {variantLabel(last)} — {fmtDay(last.date, now)} · {fmtOneLine(last)}
    </Text>
  );
}

/** The recall line next to the weight field; fallbacks are named as such. */
export function WeightMemoryHint({ resume, now }: { resume: ResumeWeight; now: Date }) {
  if (!resume) return <Text style={styles.muted}>No previous weight for this exercise on this machine.</Text>;
  switch (resume.kind) {
    case 'history':
      return <Text style={[styles.body, { fontWeight: '600' }]}>Last time: {fmtOneLine(resume.entry)} ({fmtDay(resume.entry.date, now)})</Text>;
    case 'chosen-not-completed':
      return <Text style={styles.muted}>Weight chosen last time ({fmtDay(resume.at, now)}); that session was not completed.</Text>;
    case 'fallback-other-variant':
      return (
        <Text style={{ color: colors.warn, fontSize: 13 }}>
          Not this variant — pre-filled from {resume.entry.labels.variant ?? 'another variant'} on the same machine ({fmtDay(resume.entry.date, now)}). Not comparable; adjust as needed.
        </Text>
      );
  }
}

export function RecentVariantRow({ entry, cat, now }: { entry: TrainingEntry; cat: Catalogue; now: Date }) {
  return (
    <View>
      <Text style={styles.body}>{variantLabel(entry)}</Text>
      <Text style={styles.muted}>
        {cat.equipment(entry.equipmentId).name} · {fmtDay(entry.date, now)} · {fmtOneLine(entry)}
      </Text>
    </View>
  );
}
