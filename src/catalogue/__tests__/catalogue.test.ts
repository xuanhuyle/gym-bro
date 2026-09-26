import { Catalogue, catalogue } from '../catalogue';
import { CATALOGUE } from '../data';
import { CatalogueData } from '../types';

const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe('seed catalogue', () => {
  it('is referentially valid (every id resolves, every variant has a primary muscle)', () => {
    expect(catalogue.validate()).toEqual([]);
  });

  it('covers Push, Pull and Legs', () => {
    const patterns = new Set(CATALOGUE.exercises.map((e) => e.movementPattern));
    expect(patterns).toEqual(new Set(['Push', 'Pull', 'Legs']));
  });

  it('every region offers at least one exercise', () => {
    for (const r of catalogue.bodyRegions()) expect(catalogue.exercisesForRegion(r.id).length).toBeGreaterThan(0);
  });
});

describe('body region → exercises', () => {
  it('Back lists back exercises only', () => {
    expect(names(catalogue.exercisesForRegion('back'))).toEqual(['Lat Pulldown', 'Seated Row', 'Reverse Fly (rear delt)']);
  });
  it('an exercise can appear under several regions', () => {
    expect(names(catalogue.exercisesForRegion('shoulders'))).toContain('Reverse Fly (rear delt)');
    expect(names(catalogue.exercisesForRegion('back'))).toContain('Reverse Fly (rear delt)');
  });
  it('Legs does not offer upper-body exercises', () => {
    const legs = names(catalogue.exercisesForRegion('legs'));
    expect(legs).toEqual(expect.arrayContaining(['Leg Press', 'Leg Extension', 'Leg Curl']));
    expect(legs).not.toContain('Lat Pulldown');
  });
});

describe('exercise → compatible machines', () => {
  it('Lat Pulldown → lat pulldown machine only', () => {
    expect(catalogue.equipmentForExercise('lat_pulldown').map((m) => m.id)).toEqual(['lat_pulldown_machine']);
  });
  it('Seated Row → row machine and cable station', () => {
    expect(catalogue.equipmentForExercise('seated_row').map((m) => m.id)).toEqual(['seated_row_machine', 'cable_station']);
  });
  it('Leg Curl → seated and lying machines', () => {
    expect(catalogue.equipmentForExercise('leg_curl').map((m) => m.id)).toEqual(['seated_leg_curl_machine', 'lying_leg_curl_machine']);
  });
  it('lists variants per exercise + machine', () => {
    expect(catalogue.variantsFor('lat_pulldown', 'lat_pulldown_machine').map((v) => v.variantName)).toEqual([
      'Wide overhand grip',
      'Close neutral grip',
      'Underhand (supinated) grip',
    ]);
    expect(catalogue.variantsFor('leg_extension', 'leg_extension_machine')).toHaveLength(1);
  });
});

describe('exercise variant → muscles', () => {
  it('Lat Pulldown, wide grip: lats primary; teres major, rhomboids, biceps, brachialis secondary', () => {
    const m = catalogue.musclesForVariant('lat_pulldown.machine.wide_overhand');
    expect(m.primary.map((x) => x.id)).toEqual(['latissimus']);
    expect(m.secondary.map((x) => x.id)).toEqual(expect.arrayContaining(['teres_major', 'rhomboids', 'biceps', 'brachialis']));
    expect(m.secondary.map((x) => x.id)).not.toContain('latissimus');
  });

  it('the machine alone does not determine the mapping: pec deck fly vs reverse fly', () => {
    const fly = catalogue.musclesForVariant('chest_fly.pec_deck');
    const rev = catalogue.musclesForVariant('reverse_fly.pec_deck');
    expect(fly.primary.map((x) => x.id)).toEqual(['pec_major_sternal']);
    expect(rev.primary.map((x) => x.id)).toEqual(['posterior_deltoid']);
  });

  it('the variant changes the mapping on the same machine: curl bar vs rope hammer', () => {
    expect(catalogue.musclesForVariant('biceps_curl.cable.straight_bar').primary.map((x) => x.id)).toEqual(['biceps']);
    expect(catalogue.musclesForVariant('biceps_curl.cable.rope_hammer').primary.map((x) => x.id)).toEqual(['brachialis', 'brachioradialis']);
  });

  it('is deterministic', () => {
    expect(catalogue.musclesForVariant('leg_press.machine.high_wide')).toEqual(catalogue.musclesForVariant('leg_press.machine.high_wide'));
  });

  it('unknown ids fail loudly', () => {
    expect(() => catalogue.musclesForVariant('nope')).toThrow(/Unknown variant/);
  });
});

describe('extending the catalogue', () => {
  it('a new exercise appears by adding data only, and bad data is reported', () => {
    const data: CatalogueData = JSON.parse(JSON.stringify(CATALOGUE));
    data.exercises.push({ id: 'calf_raise', name: 'Calf Raise', movementPattern: 'Legs', bodyRegionIds: ['legs'] });
    data.equipment.push({ id: 'calf_machine', name: 'Seated calf machine', hasWeightStack: true });
    data.variants.push({ id: 'calf_raise.machine', exerciseId: 'calf_raise', equipmentId: 'calf_machine', variantName: null, contributions: [{ muscleId: 'gastrocnemius', role: 'primary' }] });
    const c = new Catalogue(data);
    expect(c.validate()).toEqual([]);
    expect(names(c.exercisesForRegion('legs'))).toContain('Calf Raise');

    data.variants.push({ id: 'broken', exerciseId: 'calf_raise', equipmentId: 'nowhere', variantName: null, contributions: [{ muscleId: 'nope', role: 'secondary' }] });
    const problems = new Catalogue(data).validate();
    expect(problems.join('\n')).toMatch(/unknown equipment nowhere/);
    expect(problems.join('\n')).toMatch(/unknown muscle nope/);
    expect(problems.join('\n')).toMatch(/no primary muscle/);
  });
});
