/**
 * Replay integration: synthetic 100 Hz recordings → windowed detector (the
 * unchanged offline engine) → session state machine, chunked every 2 s
 * exactly like the live app. Synthetic data checks the plumbing and the
 * rules; it does NOT validate behaviour on a real weight stack.
 */
import { generateWorkout, SyntheticSpec } from '../../analysis/synthetic';

jest.setTimeout(30000);
import { summarize } from '../machine';
import { replaySession } from '../replay';

const noisy: SyntheticSpec['disturbances'] = [
  { kind: 'handling', count: 2 },
  { kind: 'bump', count: 3 },
  { kind: 'stack-nudge', count: 1 },
];

function replay(spec: SyntheticSpec, targetSets = spec.sets.length) {
  const { samples, truth } = generateWorkout({ leadOutSec: 30, ...spec });
  const { state } = replaySession(samples, { session: { targetSets }, detector: { analysis: { priorVerticalSign: spec.userAccelSign ?? 1 } } });
  return { state, truth, sum: summarize(state, Infinity) };
}

describe('live pipeline on synthetic recordings', () => {
  it.each([1, 2, 3, 4, 5, 6])('10/12/15 with noise in rests (seed %i): three sets, rests from last rep, COMPLETE', (seed) => {
    const { state, truth, sum } = replay({ seed, sets: [{ reps: 10 }, { reps: 12 }, { reps: 15 }], restsSec: [20, 20], userAccelSign: seed % 2 ? 1 : -1, disturbances: noisy });
    expect(state.phase).toBe('COMPLETE');
    expect(state.completion?.reason).toBe('target-sets');
    expect(sum.sets.map((s) => s.reps)).toEqual([10, 12, 15]);
    sum.rests.forEach((r, i) => expect(Math.abs(r.durationSec - truth.restsSec[i])).toBeLessThan(1.5));
  });

  it('a different scheme and rest lengths (8 / 5 / 14, 35 s and 60 s)', () => {
    const { state, sum } = replay({ seed: 21, sets: [{ reps: 8 }, { reps: 5 }, { reps: 14 }], restsSec: [35, 60], userAccelSign: -1, disturbances: noisy });
    expect(state.phase).toBe('COMPLETE');
    expect(sum.sets.map((s) => s.reps)).toEqual([8, 5, 14]);
  });

  it('only handling and knocks: no set is ever started', () => {
    const { samples } = generateWorkout({ seed: 9, sets: [], restsSec: [], leadInSec: 90, disturbances: [{ kind: 'handling', count: 3 }, { kind: 'bump', count: 5 }] });
    const { state } = replaySession(samples);
    expect(state.sets).toHaveLength(0);
    // Product flow starts ARMED; with only handling it may end ARMED or READY, never in a workout phase.
    expect(['ARMED', 'READY']).toContain(state.phase);
  });
});

describe('armed start with realistic phone placement (synthetic)', () => {
  // Hand-held (tremor, tilted) → carried/rotated onto the stack → strapped → still → 10/12/15.
  // Arming requirements are asserted for EVERY seed; exact counting is the live
  // path's known accuracy limit, so it is asserted over the group (see TESTS.md).
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const runs = seeds.map((seed) => {
    const spec = {
      seed,
      sets: [{ reps: 10 }, { reps: 12 }, { reps: 15 }],
      restsSec: [30, 30],
      leadInSec: 16,
      leadOutSec: 30,
      userAccelSign: -1 as const,
      placement: { handSec: 4, moveSec: 3, angleDeg: 60 + (seed % 4) * 20 },
    };
    const { samples, truth } = generateWorkout(spec);
    const { state } = replaySession(samples, { detector: { analysis: { priorVerticalSign: -1 } } });
    return { seed, state, truth, placementEnd: spec.placement.handSec + spec.placement.moveSec };
  });

  it.each(seeds)('seed %i: placement never counts, READY before Set 1, Set 1 starts at its first rep, three sets, COMPLETE', (seed) => {
    const { state, truth, placementEnd } = runs.find((r) => r.seed === seed)!;
    expect(state.phase).toBe('COMPLETE');
    expect(state.sets).toHaveLength(3);
    const ready = state.log.find((l) => l.event === 'ready');
    expect(ready).toBeTruthy();
    expect(ready!.atSec).toBeGreaterThanOrEqual(placementEnd - 0.5);
    const allReps = state.sets.flatMap((x) => x.reps);
    expect(allReps.every((r) => r.startSec >= placementEnd)).toBe(true);
    expect(Math.abs(state.sets[0].startSec - truth.sets[0].startSec)).toBeLessThan(1);
  });

  it('exact reps in ≥ 8 of 10 placement sessions (live-path accuracy on synthetic data)', () => {
    const exact = runs.filter((r) => summarize(r.state, Infinity).sets.map((x) => x.reps).join('/') === '10/12/15').length;
    expect(exact).toBeGreaterThanOrEqual(8);
  });
});
