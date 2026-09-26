/**
 * Read-only queries over the catalogue. Every UI choice list comes from here,
 * so the flow Region → Exercise → Equipment → Variant → Muscles is data-driven.
 */

import { CATALOGUE } from './data';
import { BodyRegion, CatalogueData, Equipment, Exercise, ExerciseVariant, Muscle } from './types';

export interface MuscleMap {
  primary: Muscle[];
  secondary: Muscle[];
}

export interface VariantSelection {
  region: BodyRegion;
  exercise: Exercise;
  equipment: Equipment;
  variant: ExerciseVariant;
  muscles: MuscleMap;
}

export class Catalogue {
  constructor(readonly data: CatalogueData = CATALOGUE) {}

  get version(): string {
    return this.data.version;
  }

  bodyRegions(): BodyRegion[] {
    return this.data.bodyRegions;
  }

  exercisesForRegion(regionId: string): Exercise[] {
    return this.data.exercises.filter((e) => e.bodyRegionIds.includes(regionId) && this.variantsForExercise(e.id).length > 0);
  }

  variantsForExercise(exerciseId: string): ExerciseVariant[] {
    return this.data.variants.filter((v) => v.exerciseId === exerciseId);
  }

  /** Equipment compatible with an exercise = equipment used by at least one of its variants (catalogue order). */
  equipmentForExercise(exerciseId: string): Equipment[] {
    const ids = new Set(this.variantsForExercise(exerciseId).map((v) => v.equipmentId));
    return this.data.equipment.filter((m) => ids.has(m.id));
  }

  variantsFor(exerciseId: string, equipmentId: string): ExerciseVariant[] {
    return this.data.variants.filter((v) => v.exerciseId === exerciseId && v.equipmentId === equipmentId);
  }

  musclesForVariant(variantId: string): MuscleMap {
    const v = this.variant(variantId);
    const pick = (role: 'primary' | 'secondary') => v.contributions.filter((c) => c.role === role).map((c) => this.muscle(c.muscleId));
    return { primary: pick('primary'), secondary: pick('secondary') };
  }

  region(id: string): BodyRegion {
    return must(this.data.bodyRegions.find((x) => x.id === id), 'body region', id);
  }
  exercise(id: string): Exercise {
    return must(this.data.exercises.find((x) => x.id === id), 'exercise', id);
  }
  equipment(id: string): Equipment {
    return must(this.data.equipment.find((x) => x.id === id), 'equipment', id);
  }
  variant(id: string): ExerciseVariant {
    return must(this.data.variants.find((x) => x.id === id), 'variant', id);
  }
  muscle(id: string): Muscle {
    return must(this.data.muscles.find((x) => x.id === id), 'muscle', id);
  }

  selection(regionId: string, variantId: string): VariantSelection {
    const variant = this.variant(variantId);
    return {
      region: this.region(regionId),
      exercise: this.exercise(variant.exerciseId),
      equipment: this.equipment(variant.equipmentId),
      variant,
      muscles: this.musclesForVariant(variantId),
    };
  }

  /** Referential-integrity and sanity problems in the data (empty = valid). */
  validate(): string[] {
    const d = this.data;
    const problems: string[] = [];
    const dupes = (kind: string, ids: string[]) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) problems.push(`duplicate ${kind} id ${id}`);
        seen.add(id);
      }
    };
    dupes('region', d.bodyRegions.map((x) => x.id));
    dupes('muscle', d.muscles.map((x) => x.id));
    dupes('equipment', d.equipment.map((x) => x.id));
    dupes('exercise', d.exercises.map((x) => x.id));
    dupes('variant', d.variants.map((x) => x.id));
    const has = <T extends { id: string }>(arr: T[], id: string) => arr.some((x) => x.id === id);
    for (const e of d.exercises) {
      if (!e.bodyRegionIds.length) problems.push(`exercise ${e.id} has no body region`);
      for (const r of e.bodyRegionIds) if (!has(d.bodyRegions, r)) problems.push(`exercise ${e.id}: unknown region ${r}`);
      if (!d.variants.some((v) => v.exerciseId === e.id)) problems.push(`exercise ${e.id} has no variant`);
    }
    for (const v of d.variants) {
      if (!has(d.exercises, v.exerciseId)) problems.push(`variant ${v.id}: unknown exercise ${v.exerciseId}`);
      if (!has(d.equipment, v.equipmentId)) problems.push(`variant ${v.id}: unknown equipment ${v.equipmentId}`);
      if (!v.contributions.some((c) => c.role === 'primary')) problems.push(`variant ${v.id} has no primary muscle`);
      const ms = v.contributions.map((c) => c.muscleId);
      if (new Set(ms).size !== ms.length) problems.push(`variant ${v.id} lists a muscle twice`);
      for (const m of ms) if (!has(d.muscles, m)) problems.push(`variant ${v.id}: unknown muscle ${m}`);
      const siblings = d.variants.filter((o) => o.exerciseId === v.exerciseId && o.equipmentId === v.equipmentId);
      if (siblings.length > 1 && !v.variantName) problems.push(`variant ${v.id} needs a name: its exercise/equipment pair has several variants`);
    }
    return problems;
  }
}

function must<T>(x: T | undefined, kind: string, id: string): T {
  if (!x) throw new Error(`Unknown ${kind}: ${id}`);
  return x;
}

export const catalogue = new Catalogue();
