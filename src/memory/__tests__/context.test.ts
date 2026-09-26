/**
 * RESUME context: remembered machine + variant + load, and cheap machine
 * switching that moves to that machine's own (comparable) history.
 */
import { Catalogue, catalogue } from '../../catalogue/catalogue';
import { CATALOGUE } from '../../catalogue/data';
import { CatalogueData } from '../../catalogue/types';
import { compatibleMachines, rememberedContext, switchMachine } from '../context';
import { compareEntries, TrainingEntry } from '../history';
import { variantMemory } from '../queries';

function entry(cat: Catalogue, id: string, variantId: string, date: string, loadKg: number, reps: number[]): TrainingEntry {
  const v = cat.variant(variantId);
  return {
    id,
    date,
    variantId,
    exerciseId: v.exerciseId,
    equipmentId: v.equipmentId,
    regionId: cat.primaryRegionId(v.exerciseId),
    loadKg,
    reps,
    restsSec: [],
    source: 'detected',
    labels: { region: '', exercise: '', equipment: '', variant: v.variantName },
  };
}

const H = [
  entry(catalogue, 'r1', 'seated_row.machine.neutral', '2026-09-10T18:00:00Z', 60, [10, 10, 9]),
  entry(catalogue, 'r2', 'seated_row.cable.close_neutral', '2026-09-19T18:00:00Z', 50, [12, 11, 10]),
].sort(compareEntries);

describe('remembered exercise context', () => {
  it('restores the last machine, variant and load for the exercise', () => {
    const ctx = rememberedContext(H, catalogue, null, 'seated_row')!;
    expect(ctx.equipmentId).toBe('cable_station');
    expect(ctx.variantId).toBe('seated_row.cable.close_neutral');
    expect(ctx.resume).toMatchObject({ kind: 'history', kg: 50 });
    expect(ctx.lastComparable?.id).toBe('r2');
  });

  it('first use: nothing to restore', () => {
    expect(rememberedContext(H, catalogue, null, 'leg_press')).toBeNull();
  });
});

describe('changing machine changes the comparable-history context', () => {
  it('switching to a machine used before restores THAT machine\'s load and history', () => {
    const ctx = switchMachine(H, catalogue, null, { exerciseId: 'seated_row', variantId: 'seated_row.cable.close_neutral' }, 'seated_row_machine');
    expect(ctx.variantId).toBe('seated_row.machine.neutral');
    expect(ctx.resume).toMatchObject({ kind: 'history', kg: 60 });
    expect(ctx.lastComparable?.id).toBe('r1');
  });

  it('switching to a never-used machine carries NO kilograms over from the original machine', () => {
    const history = H.filter((e) => e.equipmentId === 'cable_station');
    const ctx = switchMachine(history, catalogue, null, { exerciseId: 'seated_row', variantId: 'seated_row.cable.close_neutral' }, 'seated_row_machine');
    expect(ctx.resume).toBeNull();
    expect(ctx.lastComparable).toBeNull();
    expect(variantMemory(history, ctx.variantId, new Date('2026-09-26')).last).toBeNull();
  });

  it('keeps the same variant (e.g. grip) when the other machine offers it, but with separate history', () => {
    // Two different lat pulldown machines (e.g. Technogym vs another brand), both with a wide grip.
    const data: CatalogueData = JSON.parse(JSON.stringify(CATALOGUE));
    data.equipment.push({ id: 'lat_pulldown_other', name: 'Other lat pulldown', hasWeightStack: true });
    data.variants.push({
      id: 'lat_pulldown.other.wide_overhand',
      exerciseId: 'lat_pulldown',
      equipmentId: 'lat_pulldown_other',
      variantName: 'Wide overhand grip',
      contributions: [{ muscleId: 'latissimus', role: 'primary' }],
    });
    const cat = new Catalogue(data);
    expect(cat.validate()).toEqual([]);
    const history = [entry(cat, 'p1', 'lat_pulldown.machine.wide_overhand', '2026-09-19T18:00:00Z', 40, [12, 11, 10])];
    const ctx = switchMachine(history, cat, null, { exerciseId: 'lat_pulldown', variantId: 'lat_pulldown.machine.wide_overhand' }, 'lat_pulldown_other');
    expect(ctx.variantId).toBe('lat_pulldown.other.wide_overhand');
    expect(ctx.resume).toBeNull(); // 40 kg on the first machine is not comparable here
  });

  it('refuses a machine that cannot do the exercise', () => {
    expect(() => switchMachine(H, catalogue, null, { exerciseId: 'seated_row', variantId: 'seated_row.machine.neutral' }, 'leg_press_machine')).toThrow();
  });

  it('lists compatible machines each with its own last session', () => {
    expect(compatibleMachines(H, catalogue, 'seated_row').map((m) => [m.equipment.id, m.last?.id ?? null])).toEqual([
      ['seated_row_machine', 'r1'],
      ['cable_station', 'r2'],
    ]);
  });
});
