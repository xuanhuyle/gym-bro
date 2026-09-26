/**
 * Stillness / handling monitor on synthetic placement (phone in hand → carried
 * and rotated onto the stack → strapped → still). Synthetic: validates the
 * logic, not real-phone thresholds (hardware-validation-pending).
 */
import { generateWorkout } from '../../analysis/synthetic';
import { COL } from '../../recording/schema';
import { StillnessMonitor } from '../stillness';

function eventsFor(seed: number) {
  const { samples } = generateWorkout({ seed, sets: [{ reps: 5 }], restsSec: [], leadInSec: 15, placement: { handSec: 4, moveSec: 3, angleDeg: 90 } });
  const m = new StillnessMonitor();
  const ev = [];
  for (let i = 0; i < samples.length; i += 200) ev.push(...m.push(samples.slice(i, i + 200)));
  return { ev, samples };
}

describe('StillnessMonitor', () => {
  it.each([1, 2, 3])('seed %i: no stillness while hand-held, handling during placement, stable once strapped', (seed) => {
    const { ev } = eventsFor(seed);
    const stable = ev.filter((e) => e.type === 'stable');
    const handling = ev.filter((e) => e.type === 'handling');
    expect(handling.length).toBeGreaterThan(0);
    for (const h of handling) expect(h.type === 'handling' && h.atSec).toBeLessThan(7.2);
    // The first still period starts after placement (7 s), before the set (15 s).
    expect(stable.length).toBeGreaterThan(0);
    const first = stable[0];
    expect(first.type === 'stable' && first.atSec).toBeGreaterThanOrEqual(6.5);
    expect(first.type === 'stable' && first.atSec).toBeLessThan(9);
  });

  it('stack reps do not count as handling (no rotation)', () => {
    const { ev } = eventsFor(4);
    expect(ev.filter((e) => e.type === 'handling' && e.atSec > 8)).toHaveLength(0);
  });

  it('a perfectly still phone is stable after the configured time, reported from when it became still', () => {
    const rows = Array.from({ length: 400 }, (_, i) => [i / 100, 0, 0, 0, 0, 0, -9.8, 0, 0, 0, 0, 0, 0]);
    const ev = new StillnessMonitor({ stableSec: 2 }).push(rows);
    expect(ev).toEqual([{ type: 'stable', atSec: 0 }]);
    expect(rows[0][COL.t]).toBe(0);
  });
});
