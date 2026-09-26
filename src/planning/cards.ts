/**
 * Exercise cards: the compact remembered context the mature product proposes
 * (flashcards). Built from memory; everything else (muscles, region, split) is
 * derived. No ranking here — which cards to show is the (deferred) decision layer.
 */

import { Catalogue } from '../catalogue/catalogue';
import { WeightBook } from '../catalogue/weightMemory';
import { TrainingEntry } from '../memory/history';
import { ResumeWeight, resumeWeight, variantMemory } from '../memory/queries';
import { DEFAULT_PRESCRIPTION, Prescription } from './prescription';

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
