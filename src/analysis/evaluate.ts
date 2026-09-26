/** Compare detected sets/reps/rests with what the user reports actually happened. */

import { AnalysisResult } from './analyze';

export interface TruthInput {
  sets: { reps: number }[];
  restsSec?: (number | null)[];
}

export interface Evaluation {
  exact: boolean;
  truthSets: number;
  detectedSets: number;
  truthReps: number[];
  detectedReps: number[];
  truthTotal: number;
  detectedTotal: number;
  /** Sum over aligned sets of |detected − truth|, plus reps of unmatched sets. */
  totalAbsRepError: number;
  truthRestsSec: (number | null)[];
  detectedRestsSec: number[];
  /** Detected − truth per rest, when both exist. */
  restErrorsSec: (number | null)[];
}

export function evaluate(res: AnalysisResult, truth: TruthInput): Evaluation {
  return evaluateCounts(
    res.sets.map((s) => s.repCount),
    res.rests.map((r) => r.durationSec),
    truth,
  );
}

/** Same comparison for any detector output expressed as reps per set and rest durations. */
export function evaluateCounts(detectedReps: number[], detRests: number[], truth: TruthInput): Evaluation {
  const truthReps = truth.sets.map((s) => s.reps);
  const n = Math.max(truthReps.length, detectedReps.length);
  let err = 0;
  for (let i = 0; i < n; i++) err += Math.abs((detectedReps[i] ?? 0) - (truthReps[i] ?? 0));
  const truthRests = truth.restsSec ?? [];
  const restErrors = truthRests.map((t, i) => (t != null && detRests[i] != null ? detRests[i] - t : null));
  return {
    exact: truthReps.length === detectedReps.length && truthReps.every((r, i) => r === detectedReps[i]),
    truthSets: truthReps.length,
    detectedSets: detectedReps.length,
    truthReps,
    detectedReps,
    truthTotal: truthReps.reduce((a, b) => a + b, 0),
    detectedTotal: detectedReps.reduce((a, b) => a + b, 0),
    totalAbsRepError: err,
    truthRestsSec: truthRests,
    detectedRestsSec: detRests,
    restErrorsSec: restErrors,
  };
}
