/**
 * Semantic exercise selection: Body region → Exercise → Machine → Variant →
 * muscle preview → Weight → START EXERCISE. All lists come from the catalogue.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Catalogue, catalogue as defaultCatalogue } from '../../catalogue/catalogue';
import { lastWeight, WeightBook } from '../../catalogue/weightMemory';
import { Button, Card, Chips, colors, styles } from '../components/common';

export interface ExerciseChoice {
  regionId: string;
  variantId: string;
  loadKg: number;
}

const WEIGHT_STEP = 2.5;

function Step(props: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <Text style={styles.cardTitle}>
        {props.n}. {props.title}
      </Text>
      {props.children}
    </Card>
  );
}

/** Chips keyed by id but displayed by name. */
function Picker<T extends { id: string }>(props: { items: T[]; label: (t: T) => string; value: string | null; onChange: (id: string) => void }) {
  const names = props.items.map(props.label);
  const current = props.items.find((i) => i.id === props.value);
  return <Chips options={names} value={current ? props.label(current) : null} onChange={(name) => props.onChange(props.items[names.indexOf(name)].id)} />;
}

export function ExerciseSetupScreen(props: {
  weights: WeightBook;
  onStart: (c: ExerciseChoice) => void;
  onCancel: () => void;
  catalogue?: Catalogue;
  initial?: { regionId: string; variantId: string } | null;
}) {
  const cat = props.catalogue ?? defaultCatalogue;
  const init = props.initial ? cat.variant(props.initial.variantId) : null;
  const [regionId, setRegionId] = useState<string | null>(props.initial?.regionId ?? null);
  const [exerciseId, setExerciseId] = useState<string | null>(init?.exerciseId ?? null);
  const [equipmentId, setEquipmentId] = useState<string | null>(init?.equipmentId ?? null);
  const [variantId, setVariantId] = useState<string | null>(init?.id ?? null);
  const [weightText, setWeightText] = useState<string>(() => {
    const w = init ? lastWeight(props.weights, init) : null;
    return w ? String(w.kg) : '';
  });
  const [weightHint, setWeightHint] = useState<string | null>(null);

  const exercises = regionId ? cat.exercisesForRegion(regionId) : [];
  const equipment = exerciseId ? cat.equipmentForExercise(exerciseId) : [];
  const variants = exerciseId && equipmentId ? cat.variantsFor(exerciseId, equipmentId) : [];
  const muscles = useMemo(() => (variantId ? cat.musclesForVariant(variantId) : null), [cat, variantId]);

  const chooseVariant = (id: string | null) => {
    setVariantId(id);
    if (!id) return;
    const w = lastWeight(props.weights, cat.variant(id));
    if (w) {
      setWeightText(String(w.kg));
      setWeightHint(w.exact ? 'Last time you used this weight.' : 'Weight from the last time on this machine (other variant).');
    } else setWeightHint(null);
  };
  const chooseEquipment = (id: string) => {
    setEquipmentId(id);
    const vs = exerciseId ? cat.variantsFor(exerciseId, id) : [];
    chooseVariant(vs.length === 1 ? vs[0].id : null);
  };
  const chooseExercise = (id: string) => {
    setExerciseId(id);
    const eq = cat.equipmentForExercise(id);
    if (eq.length === 1) {
      setEquipmentId(eq[0].id);
      const vs = cat.variantsFor(id, eq[0].id);
      chooseVariant(vs.length === 1 ? vs[0].id : null);
    } else {
      setEquipmentId(null);
      chooseVariant(null);
    }
  };
  const chooseRegion = (id: string) => {
    setRegionId(id);
    setExerciseId(null);
    setEquipmentId(null);
    chooseVariant(null);
  };

  const kg = Number(weightText.replace(',', '.'));
  const weightOk = weightText.trim() !== '' && Number.isFinite(kg) && kg >= 0;
  const bump = (d: number) => setWeightText(String(Math.max(0, Math.round(((weightOk ? kg : 0) + d) * 10) / 10)));
  const ready = !!(regionId && variantId && weightOk);
  const hasNamedVariants = variants.some((v) => v.variantName);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>New exercise</Text>
        <Step n={1} title="Body region">
          <Picker items={cat.bodyRegions()} label={(r) => r.name} value={regionId} onChange={chooseRegion} />
        </Step>
        {regionId ? (
          <Step n={2} title="Exercise">
            <Picker items={exercises} label={(e) => e.name} value={exerciseId} onChange={chooseExercise} />
          </Step>
        ) : null}
        {exerciseId ? (
          <Step n={3} title="Machine / equipment">
            <Picker items={equipment} label={(m) => m.name} value={equipmentId} onChange={chooseEquipment} />
          </Step>
        ) : null}
        {equipmentId && hasNamedVariants ? (
          <Step n={4} title="Variant">
            <Picker items={variants} label={(v) => v.variantName ?? 'Standard'} value={variantId} onChange={chooseVariant} />
          </Step>
        ) : null}
        {muscles ? (
          <Card title="Muscles worked">
            <Text style={styles.label}>Primary</Text>
            <Text style={[styles.body, { marginBottom: 8, fontWeight: '600' }]}>{muscles.primary.map((m) => m.name).join(', ')}</Text>
            {muscles.secondary.length ? (
              <>
                <Text style={styles.label}>Secondary</Text>
                <Text style={styles.body}>{muscles.secondary.map((m) => m.name).join(', ')}</Text>
              </>
            ) : null}
          </Card>
        ) : null}
        {variantId ? (
          <Card title="Weight">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Button title={`−${WEIGHT_STEP}`} kind="secondary" onPress={() => bump(-WEIGHT_STEP)} />
              <TextInput
                accessibilityLabel="Weight in kg"
                value={weightText}
                onChangeText={(t) => {
                  setWeightText(t);
                  setWeightHint(null);
                }}
                keyboardType="decimal-pad"
                placeholder="kg"
                style={[styles.input, { width: 100, fontSize: 24, textAlign: 'center' }]}
              />
              <Text style={styles.body}>kg</Text>
              <Button title={`+${WEIGHT_STEP}`} kind="secondary" onPress={() => bump(WEIGHT_STEP)} />
            </View>
            {weightHint ? <Text style={[styles.muted, { marginTop: 6 }]}>{weightHint}</Text> : null}
          </Card>
        ) : null}
        {ready ? (
          <Card title="Then">
            <Text style={styles.body}>
              Strap the phone firmly to the top plate of the weight stack, press START EXERCISE, keep the stack still for ~10 s, then do your 3 sets.
              Sets, rests and completion are detected automatically — no more buttons.
            </Text>
            <Text style={{ color: colors.warn, marginTop: 6, fontSize: 13 }}>Automatic set detection is not yet validated on a real machine.</Text>
          </Card>
        ) : null}
        <Button title="START EXERCISE" big disabled={!ready} onPress={() => ready && props.onStart({ regionId: regionId!, variantId: variantId!, loadKg: kg })} />
        <Button title="Cancel" kind="secondary" onPress={props.onCancel} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
