/**
 * RESUME: the remembered context of an exercise, so the user only declares
 * what changed ("never ask again for stable context Gym Bro already knows").
 *
 * For an exercise the user has done before, everything is restored from
 * memory: machine, variant, load. The routine adjustments are the machine
 * (e.g. it is occupied) and the load. Switching machine switches to THAT
 * machine's history; kilograms from another machine are never carried over as
 * if comparable (the ExerciseVariant is the comparability key).
 */

import { Catalogue } from '../catalogue/catalogue';
import { Equipment, ExerciseVariant } from '../catalogue/types';
import { WeightBook } from '../catalogue/weightMemory';
import { compareEntries, TrainingEntry } from './history';
import { resumeWeight, ResumeWeight } from './queries';

export interface RememberedContext {
  exerciseId: string;
  equipmentId: string;
  variantId: string;
  /** Where the load came from (exact variant history, labelled fallback, or nothing). */
  resume: ResumeWeight;
  /** Last completed session of this exact variant (the comparable history), if any. */
  lastComparable: TrainingEntry | null;
}

function lastOfVariant(history: TrainingEntry[], variantId: string): TrainingEntry | null {
  const es = history.filter((e) => e.variantId === variantId).sort(compareEntries);
  return es[es.length - 1] ?? null;
}

function contextFor(history: TrainingEntry[], book: WeightBook | null, v: ExerciseVariant): RememberedContext {
  return {
    exerciseId: v.exerciseId,
    equipmentId: v.equipmentId,
    variantId: v.id,
    resume: resumeWeight(history, book, v),
    lastComparable: lastOfVariant(history, v.id),
  };
}

/**
 * Context for an exercise: the machine + variant used most recently for it, with
 * its load. null when the exercise was never done (first use: the user chooses).
 */
export function rememberedContext(history: TrainingEntry[], cat: Catalogue, book: WeightBook | null, exerciseId: string): RememberedContext | null {
  const es = history.filter((e) => e.exerciseId === exerciseId).sort(compareEntries);
  const last = es[es.length - 1];
  if (!last) return null;
  return contextFor(history, book, cat.variant(last.variantId));
}

/** Machines compatible with the exercise, with each one's own last session (for the machine picker). */
export function compatibleMachines(history: TrainingEntry[], cat: Catalogue, exerciseId: string): { equipment: Equipment; last: TrainingEntry | null }[] {
  return cat.equipmentForExercise(exerciseId).map((equipment) => {
    const es = history.filter((e) => e.exerciseId === exerciseId && e.equipmentId === equipment.id).sort(compareEntries);
    return { equipment, last: es[es.length - 1] ?? null };
  });
}

/**
 * Switch the same exercise to another machine. Variant on the new machine:
 * same variant name if it exists there, else the one most recently used there,
 * else the catalogue's first. The load and "last time" come only from that
 * machine's history.
 */
export function switchMachine(history: TrainingEntry[], cat: Catalogue, book: WeightBook | null, from: { exerciseId: string; variantId: string }, equipmentId: string): RememberedContext {
  const options = cat.variantsFor(from.exerciseId, equipmentId);
  if (!options.length) throw new Error(`${equipmentId} is not compatible with ${from.exerciseId}`);
  const currentName = cat.variant(from.variantId).variantName;
  const sameName = currentName != null ? options.find((v) => v.variantName === currentName) : undefined;
  const usedHere = history.filter((e) => e.exerciseId === from.exerciseId && e.equipmentId === equipmentId).sort(compareEntries);
  const recent = usedHere.length ? options.find((v) => v.id === usedHere[usedHere.length - 1].variantId) : undefined;
  return contextFor(history, book, sameName ?? recent ?? options[0]);
}
