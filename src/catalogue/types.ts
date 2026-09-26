/**
 * Canonical training ontology: stable FACTS only (splits, regions, muscles,
 * movement patterns, exercises, equipment, exercise variants, contributions).
 * It never encodes recommendations such as "for users who want X and target Y";
 * those belong to a separate decision layer that reads this ontology.
 *
 * Relationships are many-to-many: a muscle is trained by many exercises, an
 * exercise trains several muscles, an exercise runs on several machines, a
 * machine supports several exercises. Pure data, no UI.
 *
 * The semantic object is the ExerciseVariant: an Exercise performed on a
 * compatible Equipment and, where relevant, with a variant (grip, foot
 * position…). Muscle contributions belong to the variant — neither the
 * exercise nor the machine alone determines them (e.g. the pec deck is used
 * both for chest flies and for rear-delt reverse flies).
 */

/**
 * Push / Pull / Legs planning structure (PPL). A fact about the exercise used
 * for weekly balance; never something the user has to declare per workout.
 * ('Other' = accessory work outside PPL, e.g. core.)
 */
export type TrainingSplit = 'Push' | 'Pull' | 'Legs' | 'Other';

/** Kinematic movement pattern (what the joints do), distinct from the training split. */
export type MovementPatternId =
  | 'horizontal_press'
  | 'vertical_press'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'shoulder_horizontal_adduction'
  | 'shoulder_horizontal_abduction'
  | 'shoulder_abduction'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'squat'
  | 'knee_extension'
  | 'knee_flexion'
  | 'hip_abduction'
  | 'hip_hinge'
  | 'ankle_plantar_flexion';

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
  split: TrainingSplit;
  movementPattern: MovementPatternId;
  /**
   * Regions this exercise belongs to (browsing, first-use scoping, region memory).
   * NOT a product hierarchy: mature suggestions work across the whole ontology.
   */
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
