/**
 * Starting scope from body-region priorities: a SCOPE REDUCER for onboarding
 * and a preference signal — never a filter. The whole ontology remains
 * eligible; priority regions only come first. No ranking science here: the
 * recommendation layer (not built yet) will combine objective, priorities,
 * PPL balance, history, recency and user choice.
 */

import { Catalogue } from '../catalogue/catalogue';
import { Exercise } from '../catalogue/types';
import { UserProfile } from '../profile/profile';

export interface StartingScope {
  /** Exercises in the user's priority regions (in priority order), to start with. */
  focus: Exercise[];
  /** Everything else in the ontology — still eligible. */
  rest: Exercise[];
}

export function startingScope(cat: Catalogue, profile: Pick<UserProfile, 'regionPriorities'>): StartingScope {
  const focus: Exercise[] = [];
  for (const p of profile.regionPriorities) {
    for (const e of cat.exercisesForRegion(p.regionId)) if (!focus.includes(e)) focus.push(e);
  }
  const rest = cat.exercises().filter((e) => !focus.includes(e));
  return { focus, rest };
}
