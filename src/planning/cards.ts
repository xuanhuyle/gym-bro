/**
 * Exercise cards: the second card level. Once a SessionProposal is accepted,
 * each PlannedExercise is rendered as an ExerciseCard. Principal action:
 * "this is the exercise I am doing now" (arms capture). Editable deltas:
 * machine (if different/unavailable) and load. No today/later decision here —
 * that belongs to the session proposal. Built from memory; muscles, region and
 * split are derived. No ranking here (deferred decision layer).
 */

import { Catalogue } from '../catalogue/catalogue';
import { WeightBook } from '../catalogue/weightMemory';
import { TrainingEntry } from '../memory/history';
import { ResumeWeight, resumeWeight, variantMemory } from '../memory/queries';
import { DEFAULT_PRESCRIPTION, Prescription } from './prescription';
import { SessionProposal } from './workout';

export interface ExerciseCard {
  variantId: string;
  exercise: string;
  machine: string;
  variant: string | null;
  /** Load to pre-fill, with its provenance (exact history / labelled fallback / none). */
  load: ResumeWeight;
  last: TrainingEntry | null;
  previous: TrainingEntry | null;
  prescription: Prescription;
}

export function buildExerciseCard(history: TrainingEntry[], cat: Catalogue, book: WeightBook | null, variantId: string, now: Date, prescription: Prescription = DEFAULT_PRESCRIPTION): ExerciseCard {
  const v = cat.variant(variantId);
  const m = variantMemory(history, variantId, now);
  return {
    variantId,
    exercise: cat.exercise(v.exerciseId).name,
    machine: cat.equipment(v.equipmentId).name,
    variant: v.variantName,
    load: resumeWeight(history, book, v),
    last: m.last,
    previous: m.previous,
    prescription,
  };
}

/** Accepted proposal → its exercises as cards (order preserved; the user may still do them in any order). */
export function exerciseCardsFor(proposal: SessionProposal, history: TrainingEntry[], cat: Catalogue, book: WeightBook | null, now: Date): ExerciseCard[] {
  return proposal.exercises.map((p) => buildExerciseCard(history, cat, book, p.variantId, now, p.prescription));
}
