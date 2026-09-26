/**
 * Workouts and suggested sessions (data structures + derived facts only).
 *
 *  - A WorkoutSession is IMPLICIT: it begins when the first exercise is actually
 *    performed; exercises done close together form it. There is no "create
 *    workout" step. Its PPL classification is DERIVED from the exercises.
 *  - A WorkoutSuggestion is a proposed list of exercise cards. The user never
 *    supplies the split; it is derived. Plans are not rigid: exercises can be
 *    done in any order, skipped, replaced or added.
 * No recommendation algorithm lives here (deliberately deferred).
 */

import { Catalogue } from '../catalogue/catalogue';
import { TrainingSplit } from '../catalogue/types';
import { compareEntries, setCount, TrainingEntry } from '../memory/history';
import { DEFAULT_PRESCRIPTION, Prescription } from './prescription';

export interface PlannedExercise {
  /** The remembered/recommended context; the machine may still change at the gym. */
  variantId: string;
  prescription: Prescription;
}

export interface WorkoutSuggestion {
  exercises: PlannedExercise[];
}

export function planExercise(variantId: string, prescription: Prescription = DEFAULT_PRESCRIPTION): PlannedExercise {
  return { variantId, prescription };
}

/** Dominant split of a set of exercise variants (most frequent; ties → catalogue split order). */
export function dominantSplit(cat: Catalogue, variantIds: string[]): TrainingSplit | null {
  if (!variantIds.length) return null;
  const order: TrainingSplit[] = ['Push', 'Pull', 'Legs', 'Other'];
  const counts = new Map<TrainingSplit, number>();
  for (const id of variantIds) {
    const split = cat.exercise(cat.variant(id).exerciseId).split;
    counts.set(split, (counts.get(split) ?? 0) + 1);
  }
  return order.reduce<TrainingSplit | null>((best, s) => ((counts.get(s) ?? 0) > (best ? counts.get(best) ?? 0 : 0) ? s : best), null);
}

export function suggestionSplit(cat: Catalogue, s: WorkoutSuggestion): TrainingSplit | null {
  return dominantSplit(cat, s.exercises.map((e) => e.variantId));
}

/**
 * Progress of a suggestion given what was actually completed since it started.
 * A planned exercise counts as done when the same EXERCISE was completed (the
 * machine may have changed because the planned one was occupied).
 */
export function suggestionProgress(cat: Catalogue, s: WorkoutSuggestion, completed: TrainingEntry[]): { done: PlannedExercise[]; remaining: PlannedExercise[]; complete: boolean } {
  const doneExercises = new Set(completed.map((e) => e.exerciseId));
  const done = s.exercises.filter((p) => doneExercises.has(cat.variant(p.variantId).exerciseId));
  const remaining = s.exercises.filter((p) => !done.includes(p));
  return { done, remaining, complete: s.exercises.length > 0 && remaining.length === 0 };
}

export interface WorkoutSession {
  startedAt: string;
  endedAt: string;
  entries: TrainingEntry[];
  split: TrainingSplit | null;
  /** Regions touched, derived from the catalogue (may exceed any targeted region). */
  regionIds: string[];
  sets: number;
}

/**
 * Group completed exercises into implicit workouts: a gap longer than
 * `maxGapMin` between consecutive exercises starts a new workout. The gap
 * value is PROVISIONAL (the inactivity timeout is an open product question).
 */
export function groupWorkouts(history: TrainingEntry[], cat: Catalogue, maxGapMin = 90): WorkoutSession[] {
  const sorted = [...history].sort(compareEntries);
  const groups: TrainingEntry[][] = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && Date.parse(e.date) - Date.parse(g[g.length - 1].date) <= maxGapMin * 60_000) g.push(e);
    else groups.push([e]);
  }
  return groups.map((entries) => {
    const regionIds: string[] = [];
    for (const e of entries) for (const r of cat.exercise(e.exerciseId).bodyRegionIds) if (!regionIds.includes(r)) regionIds.push(r);
    return {
      startedAt: entries[0].date,
      endedAt: entries[entries.length - 1].date,
      entries,
      split: dominantSplit(cat, entries.map((e) => e.variantId)),
      regionIds,
      sets: entries.reduce((a, e) => a + setCount(e), 0),
    };
  });
}
