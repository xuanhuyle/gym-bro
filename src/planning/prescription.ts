/**
 * Exercise prescription: the INTENDED structure of an exercise.
 * Current product default: 3 sets, the final set intended to failure (AMRAP).
 *
 * CONFIRMED: the training OBJECTIVE influences the prescription — what the
 * earlier-set targets mean (the bar to reach per set). Body-region priority
 * does NOT: it scopes initial engagement and biases exercise selection.
 * OPEN: the exact mapping from each objective (Get bigger, Keep in shape) to
 * rep targets, effort targets, rests or progression. None is encoded: until
 * decided, every objective yields the default structure with no per-set targets.
 *
 * This records intent only. The app must never claim that failure was
 * achieved because movement stopped. Other structures are representable.
 */
import { TrainingObjective } from '../profile/profile';

export interface Prescription {
  sets: number;
  /** Intent for the last set. 'to-failure' = as many reps as possible (AMRAP). */
  finalSetIntent: 'to-failure' | 'normal';
  /** Objective this prescription was derived for (optional; absent = not objective-specific). */
  objective?: TrainingObjective | null;
}

export const DEFAULT_PRESCRIPTION: Prescription = { sets: 3, finalSetIntent: 'to-failure' };

/** "3 sets · final set to failure (AMRAP)" — describes the intent, not an outcome. */
export function describePrescription(p: Prescription): string {
  return `${p.sets} set${p.sets === 1 ? '' : 's'}${p.finalSetIntent === 'to-failure' ? ' · final set to failure (AMRAP)' : ''}`;
}

/** Session-machine configuration implied by a prescription (only the set count today). */
export function sessionConfigFor(p: Prescription): { targetSets: number } {
  return { targetSets: p.sets };
}

/**
 * Objective → prescription. The input is the objective ONLY (never a body-region
 * priority). The mapping itself is OPEN: today it returns the default structure
 * for every objective and records which objective it was made for. Do not add
 * rep ranges, RIR, rests or progression rules here without a founder decision.
 */
export function prescriptionFor(objective: TrainingObjective | null): Prescription {
  return { ...DEFAULT_PRESCRIPTION, objective };
}
