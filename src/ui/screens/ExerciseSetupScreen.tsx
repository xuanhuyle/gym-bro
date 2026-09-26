/**
 * Semantic exercise selection: Body region → Exercise → Machine → Variant.
 * There is no START button: as soon as the exercise variant is resolved (the
 * user picks it, or it is the only one for that machine) the exercise is
 * ARMED — acquisition starts and the session screen takes over (memory,
 * weight, placement). Lists come from the catalogue; recall from the memory layer.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Catalogue, catalogue as defaultCatalogue } from '../../catalogue/catalogue';
import { fmtDay, fmtOneLine } from '../../memory/format';
import { TrainingEntry } from '../../memory/history';
import { machineMemory, regionMemory } from '../../memory/queries';
import { MachineMemoryLine, RegionMemoryLine } from '../components/Memory';
import { Button, Card, Chips, styles } from '../components/common';

export interface ExerciseChoice {
  regionId: string;
  variantId: string;
}

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
  /** Called once, automatically, when the exercise variant is resolved. */
  onArm: (c: ExerciseChoice) => void;
  onCancel: () => void;
  catalogue?: Catalogue;
  /** Completed-session history (chronological). */
  history?: TrainingEntry[];
  now?: Date;
}) {
  const cat = props.catalogue ?? defaultCatalogue;
  const history = props.history ?? [];
  const now = props.now ?? new Date();
  const [regionId, setRegionId] = useState<string | null>(null);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const armed = useRef(false);

  // Context complete → arm. No button.
  useEffect(() => {
    if (regionId && variantId && !armed.current) {
      armed.current = true;
      props.onArm({ regionId, variantId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId, variantId]);

  const exercises = regionId ? cat.exercisesForRegion(regionId) : [];
  const equipment = exerciseId ? cat.equipmentForExercise(exerciseId) : [];
  const variants = exerciseId && equipmentId ? cat.variantsFor(exerciseId, equipmentId) : [];
  const hasNamedVariants = variants.some((v) => v.variantName);
  const machine = equipmentId ? machineMemory(history, equipmentId) : null;

  const chooseEquipment = (id: string) => {
    setEquipmentId(id);
    const vs = exerciseId ? cat.variantsFor(exerciseId, id) : [];
    setVariantId(vs.length === 1 ? vs[0].id : null);
  };
  const chooseExercise = (id: string) => {
    setExerciseId(id);
    const eq = cat.equipmentForExercise(id);
    if (eq.length === 1) {
      setEquipmentId(eq[0].id);
      const vs = cat.variantsFor(id, eq[0].id);
      setVariantId(vs.length === 1 ? vs[0].id : null);
    } else {
      setEquipmentId(null);
      setVariantId(null);
    }
  };
  const chooseRegion = (id: string) => {
    setRegionId(id);
    setExerciseId(null);
    setEquipmentId(null);
    setVariantId(null);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>New exercise</Text>
      <Text style={[styles.muted, { marginBottom: 8 }]}>Recording arms by itself once the exercise is chosen — no start button.</Text>
      <Step n={1} title="Body region">
        <Picker items={cat.bodyRegions()} label={(r) => r.name} value={regionId} onChange={chooseRegion} />
        {regionId ? <RegionMemoryLine memory={regionMemory(history, cat, regionId, now)} name={cat.region(regionId).name} now={now} /> : null}
      </Step>
      {regionId ? (
        <Step n={2} title="Exercise">
          <Picker items={exercises} label={(e) => e.name} value={exerciseId} onChange={chooseExercise} />
        </Step>
      ) : null}
      {exerciseId ? (
        <Step n={3} title="Machine / equipment">
          <Picker items={equipment} label={(m) => m.name} value={equipmentId} onChange={chooseEquipment} />
          {machine ? <MachineMemoryLine memory={machine} currentVariantId={null} now={now} /> : null}
        </Step>
      ) : null}
      {equipmentId && hasNamedVariants ? (
        <Step n={4} title="Variant">
          <Picker items={variants} label={(v) => v.variantName ?? 'Standard'} value={variantId} onChange={setVariantId} />
          {machine?.variants
            .filter((v) => variants.some((x) => x.id === v.variantId))
            .map((v) => (
              <View key={v.variantId}>
                <Text style={styles.muted}>
                  {cat.variant(v.variantId).variantName ?? 'Standard'} — {fmtDay(v.last.date, now)} · {fmtOneLine(v.last)}
                </Text>
              </View>
            ))}
        </Step>
      ) : null}
      <Button title="Cancel" kind="secondary" onPress={props.onCancel} />
    </ScrollView>
  );
}
