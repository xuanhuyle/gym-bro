/**
 * Domain-model invariants for profile, scope, prescription, suggestions and
 * implicit workouts. No recommendation science is tested (none is built).
 */
import { catalogue } from '../../catalogue/catalogue';
import { TrainingEntry } from '../../memory/history';
import { emptyProfile, OBJECTIVES, UserProfile, validateProfile } from '../../profile/profile';
import { createSession } from '../../session/machine';
import { makeSelection, newSessionRecord } from '../../session/record';
import { DEFAULT_DETECTOR_OPTIONS } from '../../session/windowedDetector';
import { DEFAULT_PRESCRIPTION, describePrescription, sessionConfigFor } from '../prescription';
import { startingScope } from '../scope';
import { dominantSplit, groupWorkouts, planExercise, suggestionProgress, suggestionSplit, WorkoutSuggestion } from '../workout';

const armsFirst: UserProfile = { ...emptyProfile(), objective: 'get-bigger', regionPriorities: [{ regionId: 'arms', since: '2026-09-01' }] };

function entry(id: string, variantId: string, date: string, reps: number[] = [10, 10, 10]): TrainingEntry {
  const v = catalogue.variant(variantId);
  return {
    id,
    date,
    variantId,
    exerciseId: v.exerciseId,
    equipmentId: v.equipmentId,
    regionId: catalogue.primaryRegionId(v.exerciseId),
    loadKg: 20,
    reps,
    restsSec: reps.slice(1).map(() => 60),
    source: 'detected',
    labels: { region: '', exercise: '', equipment: '', variant: v.variantName },
  };
}

describe('profile: objective and body-region priority are separate concepts', () => {
  it('are independent fields that can each be set without the other', () => {
    const onlyObjective: UserProfile = { ...emptyProfile(), objective: 'keep-in-shape' };
    const onlyPriority: UserProfile = { ...emptyProfile(), regionPriorities: [{ regionId: 'back', since: 'x' }] };
    expect(onlyObjective.regionPriorities).toEqual([]);
    expect(onlyPriority.objective).toBeNull();
    expect(Object.keys(emptyProfile())).toEqual(expect.arrayContaining(['objective', 'regionPriorities']));
  });

  it('confirms only the two initial objectives', () => {
    expect(OBJECTIVES.map((o) => o.id)).toEqual(['get-bigger', 'keep-in-shape']);
  });

  it('validates confirmed onboarding fields and region ids', () => {
    const regions = catalogue.bodyRegions().map((r) => r.id);
    expect(validateProfile({ ...armsFirst, birthYear: 1990, heightCm: 180, bodyWeightKg: 80 }, regions, 2026)).toEqual([]);
    const bad = validateProfile({ ...armsFirst, birthYear: 1800, regionPriorities: [{ regionId: 'wings', since: 'x' }, { regionId: 'wings', since: 'y' }] }, regions, 2026);
    expect(bad).toEqual(expect.arrayContaining(['birth year out of range', 'unknown region wings', 'duplicate region priority']));
  });
});

describe('body-region priority narrows the start but never filters the ontology', () => {
  it('priority regions come first; every other exercise remains eligible', () => {
    const scope = startingScope(catalogue, armsFirst);
    expect(scope.focus.map((e) => e.id)).toEqual(['biceps_curl', 'triceps_pushdown']);
    expect(scope.rest.map((e) => e.id)).toEqual(expect.arrayContaining(['lat_pulldown', 'leg_press', 'chest_press']));
    expect([...scope.focus, ...scope.rest].map((e) => e.id).sort()).toEqual(catalogue.exercises().map((e) => e.id).sort());
  });

  it('no priority → everything is still eligible', () => {
    const scope = startingScope(catalogue, emptyProfile());
    expect(scope.focus).toEqual([]);
    expect(scope.rest).toHaveLength(catalogue.exercises().length);
  });

  it('a workout can span more than the targeted region', () => {
    const history = [
      entry('a', 'biceps_curl.cable.straight_bar', '2026-09-20T18:00:00Z'),
      entry('b', 'lat_pulldown.machine.wide_overhand', '2026-09-20T18:15:00Z'),
      entry('c', 'seated_row.cable.close_neutral', '2026-09-20T18:30:00Z'),
    ];
    const [w] = groupWorkouts(history, catalogue);
    expect(w.entries).toHaveLength(3);
    expect(w.regionIds).toEqual(['arms', 'back']);
    expect(w.split).toBe('Pull');
  });
});

describe('prescription: 3 sets, final set INTENDED to failure', () => {
  it('is the default, drives the set count, and describes intent (not outcome)', () => {
    expect(DEFAULT_PRESCRIPTION).toEqual({ sets: 3, finalSetIntent: 'to-failure' });
    expect(describePrescription(DEFAULT_PRESCRIPTION)).toBe('3 sets · final set to failure (AMRAP)');
    expect(createSession(sessionConfigFor(DEFAULT_PRESCRIPTION)).config.targetSets).toBe(3);
  });

  it('other structures are representable', () => {
    const five = { sets: 5, finalSetIntent: 'normal' as const };
    expect(describePrescription(five)).toBe('5 sets');
    expect(createSession(sessionConfigFor(five)).config.targetSets).toBe(5);
  });

  it('new session records store the prescription as intent', () => {
    const r = newSessionRecord('x', makeSelection(catalogue, null, 'leg_press.machine.standard'), 100, DEFAULT_DETECTOR_OPTIONS, createSession(), 'now');
    expect(r.prescription).toEqual(DEFAULT_PRESCRIPTION);
    expect(r.selection.regionId).toBe('legs'); // derived: no region had to be browsed
  });
});

describe('suggestions and implicit workouts: the user never supplies PPL', () => {
  const pull: WorkoutSuggestion = {
    exercises: [planExercise('lat_pulldown.machine.wide_overhand'), planExercise('seated_row.machine.neutral'), planExercise('reverse_fly.pec_deck'), planExercise('biceps_curl.cable.straight_bar')],
  };

  it('the split of a suggestion is derived from its exercises', () => {
    expect(Object.keys(pull)).toEqual(['exercises']);
    expect(suggestionSplit(catalogue, pull)).toBe('Pull');
    expect(dominantSplit(catalogue, ['leg_press.machine.standard', 'leg_curl.seated', 'chest_press.machine'])).toBe('Legs');
    expect(dominantSplit(catalogue, [])).toBeNull();
  });

  it('plans are flexible: any order, a different machine for the same exercise still counts', () => {
    const doneOutOfOrder = [entry('1', 'biceps_curl.cable.straight_bar', 't1'), entry('2', 'seated_row.cable.close_neutral', 't2')];
    const p = suggestionProgress(catalogue, pull, doneOutOfOrder);
    expect(p.done.map((x) => x.variantId)).toEqual(['seated_row.machine.neutral', 'biceps_curl.cable.straight_bar']);
    expect(p.remaining.map((x) => x.variantId)).toEqual(['lat_pulldown.machine.wide_overhand', 'reverse_fly.pec_deck']);
    expect(p.complete).toBe(false);
    const all = [...doneOutOfOrder, entry('3', 'lat_pulldown.machine.wide_overhand', 't3'), entry('4', 'reverse_fly.pec_deck', 't4')];
    expect(suggestionProgress(catalogue, pull, all).complete).toBe(true);
  });

  it('workouts form implicitly from exercises done close together (provisional gap)', () => {
    const history = [
      entry('a', 'chest_press.machine', '2026-09-18T18:00:00Z'),
      entry('b', 'shoulder_press.machine.pronated', '2026-09-18T18:20:00Z'),
      entry('c', 'leg_press.machine.standard', '2026-09-20T09:00:00Z'),
    ];
    const ws = groupWorkouts(history, catalogue);
    expect(ws.map((w) => [w.split, w.entries.length, w.sets])).toEqual([
      ['Push', 2, 6],
      ['Legs', 1, 3],
    ]);
  });
});
