/**
 * Exercise prescription: the INTENDED structure of an exercise.
 * Current product default: 3 sets, the final set intended to failure (AMRAP).
 *
 * This records intent only. The app must never claim that failure was
 * achieved because movement stopped. Other structures (more sets, no
 * failure set, …) are representable; objective-specific rules are an open
 * product question and are deliberately not encoded here.
 */

export interface Prescription {
  sets: number;
  /** Intent for the last set. 'to-failure' = as many reps as possible (AMRAP). */
  finalSetIntent: 'to-failure' | 'normal';
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
