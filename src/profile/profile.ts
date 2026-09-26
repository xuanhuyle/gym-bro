/**
 * User profile from Day-1 onboarding. Pure types + validation; no UI yet.
 *
 * Two concepts that must never be conflated:
 *  - OBJECTIVE governs the overall training strategy (e.g. Get bigger).
 *  - BODY-REGION PRIORITIES narrow the starting search space and bias future
 *    exercise selection. They are a preference signal, NOT a filter: the whole
 *    ontology stays eligible (see planning/scope.ts).
 * Both are kept separate from workout context (what is being done right now).
 *
 * Confirmed onboarding fields: year of birth, height, weight, objective,
 * priority body region(s). Anything else (experience, sessions per week,
 * duration, injuries…) is an OPEN QUESTION — do not add it as required.
 */

/** Deliberately short list; do not expand without a product decision. */
export type TrainingObjective = 'get-bigger' | 'keep-in-shape';

export const OBJECTIVES: { id: TrainingObjective; label: string }[] = [
  { id: 'get-bigger', label: 'Get bigger' },
  { id: 'keep-in-shape', label: 'Keep in shape' },
];

export interface BodyRegionPriority {
  regionId: string;
  /** When the user declared it (priorities can change over time). */
  since: string;
}

export interface UserProfile {
  version: 1;
  birthYear: number | null;
  heightCm: number | null;
  bodyWeightKg: number | null;
  objective: TrainingObjective | null;
  /** Zero, one or several regions; order = the user's order. */
  regionPriorities: BodyRegionPriority[];
}

export function emptyProfile(): UserProfile {
  return { version: 1, birthYear: null, heightCm: null, bodyWeightKg: null, objective: null, regionPriorities: [] };
}

/** Plausibility problems (empty = valid). Unknown region ids are reported, not dropped. */
export function validateProfile(p: UserProfile, knownRegionIds: string[], currentYear: number): string[] {
  const problems: string[] = [];
  if (p.birthYear != null && !(p.birthYear >= currentYear - 110 && p.birthYear <= currentYear - 10)) problems.push('birth year out of range');
  if (p.heightCm != null && !(p.heightCm >= 100 && p.heightCm <= 250)) problems.push('height out of range');
  if (p.bodyWeightKg != null && !(p.bodyWeightKg >= 30 && p.bodyWeightKg <= 300)) problems.push('body weight out of range');
  if (p.objective != null && !OBJECTIVES.some((o) => o.id === p.objective)) problems.push(`unknown objective ${p.objective}`);
  for (const r of p.regionPriorities) if (!knownRegionIds.includes(r.regionId)) problems.push(`unknown region ${r.regionId}`);
  const ids = p.regionPriorities.map((r) => r.regionId);
  if (new Set(ids).size !== ids.length) problems.push('duplicate region priority');
  return problems;
}
