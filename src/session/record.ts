/**
 * The persisted exercise session: what the user chose (semantic context from
 * the catalogue) + the session state machine output (algorithm result).
 *
 * User corrections are NOT stored here: they live in the recording's
 * `userReported` field, so algorithm output and corrections stay separate.
 */

import { Catalogue } from '../catalogue/catalogue';
import { ALGORITHM_VERSION } from '../analysis/analyze';
import { DEFAULT_PRESCRIPTION, Prescription } from '../planning/prescription';
import { ExerciseContext } from '../recording/schema';
import { SessionState } from './machine';
import { WindowedDetectorOptions } from './windowedDetector';

export const SESSION_FORMAT = 'gymbro.session';
export const SESSION_SCHEMA_VERSION = 1;

export interface ExerciseSelection {
  catalogueVersion: string;
  regionId: string;
  exerciseId: string;
  equipmentId: string;
  variantId: string;
  /** Snapshot of names at the time, so old sessions stay readable if the catalogue changes. */
  labels: { region: string; exercise: string; equipment: string; variant: string | null };
  muscles: { primary: string[]; secondary: string[] };
}

export interface ExerciseSessionRecord {
  format: typeof SESSION_FORMAT;
  schemaVersion: number;
  /** Same id as the raw recording of this exercise. */
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'in-progress' | 'complete';
  selection: ExerciseSelection;
  loadKg: number | null;
  /** Intended structure (optional, additive; absent in older records = the 3-set default). Intent, not outcome. */
  prescription?: Prescription;
  detector: {
    kind: 'windowed-offline-engine';
    algorithmVersion: string;
    options: WindowedDetectorOptions;
    /** Automatic segmentation on a real weight stack has not been validated yet. */
    validation: 'hardware-validation-pending';
  };
  state: SessionState;
}

/** `regionId` = where the user browsed from; null when started from a card/suggestion (derived from the exercise). */
export function makeSelection(cat: Catalogue, regionId: string | null, variantId: string): ExerciseSelection {
  const sel = cat.selection(regionId, variantId);
  return {
    catalogueVersion: cat.version,
    regionId: sel.region.id,
    exerciseId: sel.exercise.id,
    equipmentId: sel.equipment.id,
    variantId,
    labels: { region: sel.region.name, exercise: sel.exercise.name, equipment: sel.equipment.name, variant: sel.variant.variantName },
    muscles: { primary: sel.muscles.primary.map((m) => m.name), secondary: sel.muscles.secondary.map((m) => m.name) },
  };
}

/** Recording context (labels + ids) derived from a catalogue selection. */
export function contextFromSelection(cat: Catalogue, sel: ExerciseSelection, loadKg: number | null): ExerciseContext {
  return {
    movementPattern: cat.exercise(sel.exerciseId).split, // recording field holds the training split (legacy name)
    bodyRegion: sel.labels.region,
    exercise: sel.labels.exercise,
    variant: sel.labels.variant ?? '',
    loadKg,
    machine: sel.labels.equipment,
    notes: '',
    catalogue: { version: sel.catalogueVersion, regionId: sel.regionId, exerciseId: sel.exerciseId, equipmentId: sel.equipmentId, variantId: sel.variantId },
  };
}

export function newSessionRecord(
  id: string,
  selection: ExerciseSelection,
  loadKg: number | null,
  detectorOptions: WindowedDetectorOptions,
  state: SessionState,
  now: string,
  prescription: Prescription = DEFAULT_PRESCRIPTION,
): ExerciseSessionRecord {
  return {
    prescription,
    format: SESSION_FORMAT,
    schemaVersion: SESSION_SCHEMA_VERSION,
    id,
    createdAt: now,
    updatedAt: now,
    status: 'in-progress',
    selection,
    loadKg,
    detector: { kind: 'windowed-offline-engine', algorithmVersion: ALGORITHM_VERSION, options: detectorOptions, validation: 'hardware-validation-pending' },
    state,
  };
}

export function parseSessionRecord(text: string): ExerciseSessionRecord {
  const o = JSON.parse(text);
  if (!o || o.format !== SESSION_FORMAT) throw new Error('Not a gym-bro session file');
  if (typeof o.schemaVersion !== 'number' || o.schemaVersion > SESSION_SCHEMA_VERSION) throw new Error(`Unsupported session schemaVersion ${o.schemaVersion}`);
  return o as ExerciseSessionRecord;
}
