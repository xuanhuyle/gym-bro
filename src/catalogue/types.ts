/**
 * Exercise catalogue domain types. Pure data, no UI.
 *
 * The semantic object is the ExerciseVariant: an Exercise performed on a
 * compatible Equipment and, where relevant, with a variant (grip, foot
 * position…). Muscle contributions belong to the variant — neither the
 * exercise nor the machine alone determines them (e.g. the pec deck is used
 * both for chest flies and for rear-delt reverse flies).
 */

import type { MovementPattern } from '../recording/schema';
export type { MovementPattern };

export interface BodyRegion {
  id: string;
  name: string;
}

export interface Muscle {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  name: string;
  /** Has a selectorized weight stack the phone can be strapped to. */
  hasWeightStack: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  movementPattern: MovementPattern;
  /** Regions where the user can find this exercise. */
  bodyRegionIds: string[];
}

/** Deliberately qualitative: no activation percentages. */
export type ContributionRole = 'primary' | 'secondary';

export interface ExerciseMuscleContribution {
  muscleId: string;
  role: ContributionRole;
}

export interface ExerciseVariant {
  id: string;
  exerciseId: string;
  equipmentId: string;
  /** e.g. "Wide overhand grip"; null when the exercise/equipment pair has a single standard form. */
  variantName: string | null;
  contributions: ExerciseMuscleContribution[];
}

export interface CatalogueData {
  version: string;
  bodyRegions: BodyRegion[];
  muscles: Muscle[];
  equipment: Equipment[];
  exercises: Exercise[];
  variants: ExerciseVariant[];
}
