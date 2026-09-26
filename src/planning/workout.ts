/**
 * Session proposals and workouts (data structures + derived facts only).
 *
 * Two card levels — never conflate them:
 *  - SessionProposal (session proposal card): a proposed SESSION of several
 *    exercises, e.g. "PULL · ~45 min: Lat Pulldown, Seated Row, …". The user's
 *    decision is made HERE: today/accept vs later/not now (exact gesture OPEN).
 *  - ExerciseCard (planning/cards.ts): once a proposal is accepted, each
 *    PlannedExercise is shown as an exercise card whose action is "this is the
 *    exercise I am doing now" (arms capture); editable deltas: machine, load.
 *    Exercise cards carry no today/later decision.
 *
 *  - A WorkoutSession is IMPLICIT: it begins when the first exercise is actually
 *    performed; exercises done close together form it. There is no "create
 *    workout" step. Its PPL classification is DERIVED from the exercises.
 *  - The user never supplies the split; it is derived. Accepted plans are not
 *    rigid: any order, skip, replace, add.
 * No recommendation algorithm lives here (deliberately deferred).
 */

import { Catalogue } from '../catalogue/catalogue';
import { TrainingSplit } from '../catalogue/types';
import { compareEntries, setCount, TrainingEntry } from '../memory/history';
import { DEFAULT_PRESCRIPTION, Prescription } from './prescription';

/** One exercise inside a session proposal; rendered as an ExerciseCard once the proposal is accepted. */
export interface PlannedExercise {
  /** The remembered/recommended context; the machine may still change at the gym. */
  variantId: string;
  prescription: Prescription;
}

/** Decision taken on a whole session proposal (not on individual exercises). Interaction OPEN. */
export type ProposalDecision = 'today' | 'later';

/** A proposed session: several planned exercises; the split is derived, never supplied. */
export interface SessionProposal {
  exercises: PlannedExercise[];
  /** today/accept vs later/not now; undefined until the user decides. */
  decision?: ProposalDecision;
}

/** @deprecated former name of SessionProposal. */
export type WorkoutSuggestion = SessionProposal;

export function decideProposal(p: SessionProposal, decision: ProposalDecision): SessionProposal {
  return { ...p, decision };
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

export function proposalSplit(cat: Catalogue, s: SessionProposal): TrainingSplit | null {
  return dominantSplit(cat, s.exercises.map((e) => e.variantId));
}
/** @deprecated use proposalSplit. */
export const suggestionSplit = proposalSplit;

/**
 * Progress of an accepted session proposal given what was actually completed since it started.
 * A planned exercise counts as done when the same EXERCISE was completed (the
 * machine may have changed because the planned one was occupied).
 */
export function proposalProgress(cat: Catalogue, s: SessionProposal, completed: TrainingEntry[]): { done: PlannedExercise[]; remaining: PlannedExercise[]; complete: boolean } {
  const doneExercises = new Set(completed.map((e) => e.exerciseId));
  const done = s.exercises.filter((p) => doneExercises.has(cat.variant(p.variantId).exerciseId));
  const remaining = s.exercises.filter((p) => !done.includes(p));
  return { done, remaining, complete: s.exercises.length > 0 && remaining.length === 0 };
}
/** @deprecated use proposalProgress. */
export const suggestionProgress = proposalProgress;

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
