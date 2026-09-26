/**
 * Training history: the normalised, chronological list of completed exercise
 * sessions that every memory query works on. Pure TS (no React / Expo).
 *
 * Source of truth per session:
 *  - WHAT was done (exercise variant, machine, load) = the session record;
 *  - HOW MUCH was done (reps per set, rests) = the user's correction when
 *    present, otherwise the automatic capture. `source` says which, so the UI
 *    never presents detector output as if the user had confirmed it.
 * Only COMPLETE sessions are history; interrupted ones are not memory.
 */

import { UserReported } from '../recording/schema';
import { summarize } from '../session/machine';
import { ExerciseSessionRecord } from '../session/record';

export interface TrainingEntry {
  /** Session / recording id. */
  id: string;
  /** Session start, ISO 8601. */
  date: string;
  variantId: string;
  exerciseId: string;
  equipmentId: string;
  /** Region the user picked when starting (the exercise may belong to several). */
  regionId: string;
  loadKg: number | null;
  /** Reps per set, in order. */
  reps: number[];
  /** Rest after each set except the last (null = unknown). */
  restsSec: (number | null)[];
  source: 'detected' | 'corrected';
  /** Labels as they were at the time (catalogue may change later). */
  labels: ExerciseSessionRecord['selection']['labels'];
}

export interface HistoryInput {
  session: ExerciseSessionRecord;
  userReported: UserReported | null;
}

export function entryFromSession({ session, userReported }: HistoryInput): TrainingEntry | null {
  if (session.status !== 'complete') return null;
  const detected = summarize(session.state, session.state.watermarkSec);
  const detectedReps = detected.sets.map((s) => s.reps);
  const detectedRests = detected.rests.filter((r) => !r.ongoing).map((r) => r.durationSec);
  const corrected = !!userReported && userReported.sets.length > 0;
  const reps = corrected ? userReported!.sets.map((s) => s.reps) : detectedReps;
  let restsSec: (number | null)[];
  if (corrected) {
    // A user-entered rest wins; a detected rest is only reused when the set structure is unchanged.
    const sameStructure = userReported!.sets.length === detectedReps.length;
    restsSec = reps.slice(1).map((_, i) => userReported!.restsSec[i] ?? (sameStructure ? detectedRests[i] ?? null : null));
  } else restsSec = detectedRests;
  const sel = session.selection;
  return {
    id: session.id,
    date: session.createdAt,
    variantId: sel.variantId,
    exerciseId: sel.exerciseId,
    equipmentId: sel.equipmentId,
    regionId: sel.regionId,
    loadKg: userReported?.loadKg != null ? userReported.loadKg : session.loadKg,
    reps,
    restsSec,
    source: corrected ? 'corrected' : 'detected',
    labels: sel.labels,
  };
}

/** Deterministic chronological order: oldest first; ties broken by id. */
export function compareEntries(a: TrainingEntry, b: TrainingEntry): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildHistory(inputs: HistoryInput[]): TrainingEntry[] {
  return inputs
    .map(entryFromSession)
    .filter((e): e is TrainingEntry => e != null)
    .sort(compareEntries);
}

export const setCount = (e: TrainingEntry) => e.reps.length;
export const totalReps = (e: TrainingEntry) => e.reps.reduce((a, b) => a + b, 0);
