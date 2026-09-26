import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { ExerciseContext, MovementPattern } from '../../recording/schema';
import { Button, Card, Chips, Field, styles } from '../components/common';

const PATTERNS: readonly MovementPattern[] = ['Push', 'Pull', 'Legs', 'Other'];
// Minimal suggestions only; free text is always allowed. Not an exercise ontology.
const REGIONS: Record<MovementPattern, readonly string[]> = {
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Back', 'Biceps', 'Rear delts'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Other: ['Core', 'Other'],
};
const EXERCISES: Record<MovementPattern, readonly string[]> = {
  Push: ['Chest Press', 'Shoulder Press', 'Triceps Pushdown'],
  Pull: ['Lat Pulldown', 'Seated Row', 'Biceps Curl'],
  Legs: ['Leg Press', 'Leg Extension', 'Leg Curl'],
  Other: [],
};

export function SetupScreen(props: { initial: ExerciseContext; onStart: (c: ExerciseContext) => void; onCancel: () => void }) {
  const [c, setC] = useState<ExerciseContext>(props.initial);
  const [loadText, setLoadText] = useState(props.initial.loadKg != null ? String(props.initial.loadKg) : '');
  const set = (patch: Partial<ExerciseContext>) => setC((p) => ({ ...p, ...patch }));

  const start = () => {
    const load = loadText.trim() === '' ? null : Number(loadText.replace(',', '.'));
    props.onStart({ ...c, loadKg: load != null && Number.isFinite(load) ? load : null });
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Exercise</Text>
        <Card>
          <Text style={styles.label}>Movement pattern</Text>
          <Chips options={PATTERNS} value={c.movementPattern} onChange={(v) => set({ movementPattern: v })} />
          <Text style={styles.label}>Body region</Text>
          <Chips options={REGIONS[c.movementPattern]} value={c.bodyRegion} onChange={(v) => set({ bodyRegion: v })} />
          <Field label="…or type body region" value={c.bodyRegion} onChangeText={(v) => set({ bodyRegion: v })} />
          <Text style={styles.label}>Exercise</Text>
          <Chips options={EXERCISES[c.movementPattern]} value={c.exercise} onChange={(v) => set({ exercise: v })} />
          <Field label="…or type exercise" value={c.exercise} onChangeText={(v) => set({ exercise: v })} />
          <Field label="Variant (e.g. Wide Grip)" value={c.variant} onChangeText={(v) => set({ variant: v })} />
          <Field label="Load (kg)" value={loadText} onChangeText={setLoadText} keyboardType="decimal-pad" />
          <Field label="Machine (optional, e.g. gym + brand)" value={c.machine} onChangeText={(v) => set({ machine: v })} />
          <Field label="Notes (e.g. how the phone is attached)" value={c.notes} onChangeText={(v) => set({ notes: v })} multiline />
        </Card>
        <Card title="Before you press Start">
          <Text style={styles.body}>• Phone firmly attached to the top plate of the weight stack.{'\n'}• After Start: keep the stack still for at least 10 s before the first rep.{'\n'}• After the last rep: keep it still for 10 s, then Stop.{'\n'}• Keep the app open. The screen will stay on.</Text>
        </Card>
        <Button title="Start recording" onPress={start} big />
        <Button title="Cancel" kind="secondary" onPress={props.onCancel} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
