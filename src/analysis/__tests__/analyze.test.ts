/**
 * Tests of the analysis pipeline against physically-modelled synthetic data.
 * They check the logic (counting, grouping, rest timing, orientation
 * independence, robustness to noise). They do NOT show that a real iPhone on a
 * real machine works — only a real recording can show that.
 *
 * No expected count is ever given to the algorithm; scenarios deliberately
 * use many different rep schemes, not just the planned 10/12/15.
 */

import { analyzeSamples } from '../analyze';
import { evaluate } from '../evaluate';
import { generateWorkout, mulberry32, randomRotation, SyntheticSpec } from '../synthetic';
import { COL, parseRecordingJson, Recording, recordingToJson, RECORDING_FORMAT, RECORDING_SCHEMA_VERSION, emptyContext, SAMPLE_COLUMNS } from '../../recording/schema';

const noisyRests: SyntheticSpec['disturbances'] = [
  { kind: 'handling', count: 2 },
  { kind: 'bump', count: 3 },
  { kind: 'stack-nudge', count: 1 },
];

function run(spec: SyntheticSpec, overrides = {}) {
  const { samples, truth } = generateWorkout(spec);
  const res = analyzeSamples(samples, { priorVerticalSign: spec.userAccelSign ?? 1, ...overrides });
  return { res, truth, ev: evaluate(res, { sets: truth.sets, restsSec: truth.restsSec }) };
}

describe('acceptance-test shaped workout (3 sets, ~20 s rests, noise during rests)', () => {
  const cases: [number, 1 | -1][] = [
    [1, 1],
    [2, -1],
    [3, 1],
    [4, -1],
    [5, 1],
    [6, -1],
  ];
  it.each(cases)('seed %i, accel sign %i: exact reps and sets, rests within 1.5 s', (seed, sign) => {
    const { res, ev } = run({
      seed,
      sets: [{ reps: 10 }, { reps: 12 }, { reps: 15 }],
      restsSec: [20, 20],
      userAccelSign: sign,
      disturbances: noisyRests,
    });
    expect(ev.detectedReps).toEqual(ev.truthReps);
    for (const e of ev.restErrorsSec) expect(Math.abs(e!)).toBeLessThan(1.5);
    // Direction must come from the data here, not from the prior.
    expect(res.signSource).toBe('vote');
    expect(res.verticalSign).toBe(sign);
  });
});

describe('other rep schemes (the algorithm has no knowledge of the counts)', () => {
  const schemes: number[][] = [[3, 7], [20], [5, 5, 5, 5], [8, 14, 6], [2, 25], [12, 9, 11, 4, 16]];
  it.each(schemes.map((s, i) => [s.join('/'), s, 100 + i] as const))('%s', (_label, reps, seed) => {
    const rnd = mulberry32(seed);
    const { ev } = run({
      seed,
      sets: reps.map((r) => ({ reps: r })),
      restsSec: reps.slice(1).map(() => 15 + rnd() * 40),
      userAccelSign: rnd() < 0.5 ? 1 : -1,
      disturbances: noisyRests,
    });
    expect(ev.detectedReps).toEqual(ev.truthReps);
    for (const e of ev.restErrorsSec) expect(Math.abs(e!)).toBeLessThan(1.5);
  });
});

describe('mount orientation independence', () => {
  it('gives the same result for 8 different phone orientations', () => {
    const rnd = mulberry32(42);
    const results = Array.from({ length: 8 }, () => {
      const { ev } = run({ seed: 7, sets: [{ reps: 9 }, { reps: 13 }], restsSec: [25], orientation: randomRotation(rnd) });
      return ev.detectedReps;
    });
    for (const r of results) expect(r).toEqual([9, 13]);
  });
});

describe('randomised workouts at normal tempo (statistical quality bar)', () => {
  // Concentric 0.6–1.8 s, eccentric 1–2× that, travel 20–60 cm, 1–4 sets of
  // 2–20 reps, rests 12–60 s, random disturbances in rests, sample dropouts in
  // 30% of recordings, random orientation and sign convention.
  it('≥ 95% of 100 recordings exactly right; rests within 2 s when counts are right', () => {
    let exact = 0;
    let worstRest = 0;
    for (let seed = 1000; seed < 1100; seed++) {
      const rnd = mulberry32(seed);
      const tempo = 0.6 + rnd() * 1.2;
      const amp = 0.2 + rnd() * 0.4;
      const sign: 1 | -1 = rnd() < 0.5 ? 1 : -1;
      const sets = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({
        reps: 2 + Math.floor(rnd() * 19),
        upSec: tempo,
        downSec: tempo * (1 + rnd()),
        pauseTopSec: rnd() * 0.6,
        pauseBottomSec: rnd() * 0.8,
        amplitudeM: amp * (0.9 + 0.2 * rnd()),
      }));
      const restsSec = sets.slice(1).map(() => 12 + rnd() * 48);
      const { ev } = run({
        seed,
        sets,
        restsSec,
        userAccelSign: sign,
        dropoutRate: rnd() < 0.3 ? 0.05 : 0,
        jitterMs: 3,
        disturbances: [
          { kind: 'handling', count: Math.floor(rnd() * 3) },
          { kind: 'bump', count: Math.floor(rnd() * 4) },
          { kind: 'stack-nudge', count: Math.floor(rnd() * 2) },
        ],
      });
      if (ev.exact) {
        exact++;
        for (const e of ev.restErrorsSec) worstRest = Math.max(worstRest, Math.abs(e!));
      }
    }
    expect(exact).toBeGreaterThanOrEqual(95);
    expect(worstRest).toBeLessThan(2);
  });
});

describe('noise and data problems', () => {
  it('detects no sets when the phone is only handled and knocked', () => {
    const { samples } = generateWorkout({
      seed: 9,
      sets: [],
      restsSec: [],
      leadInSec: 60,
      disturbances: [
        { kind: 'handling', count: 4 },
        { kind: 'bump', count: 6 },
        { kind: 'stack-nudge', count: 2 },
      ],
    });
    const res = analyzeSamples(samples);
    expect(res.sets).toHaveLength(0);
  });

  it('reports timestamp gaps and still counts correctly', () => {
    const { res, ev } = run({ seed: 11, sets: [{ reps: 8 }, { reps: 8 }], restsSec: [20], dropoutRate: 0.1 });
    expect(res.quality.gaps.length).toBeGreaterThan(0);
    expect(res.warnings.join(' ')).toMatch(/gap/);
    expect(ev.detectedReps).toEqual([8, 8]);
  });

  it('falls back to deriving linear acceleration when the platform gives none', () => {
    const { samples } = generateWorkout({ seed: 12, sets: [{ reps: 10 }, { reps: 6 }], restsSec: [20] });
    for (const r of samples) {
      r[COL.acc_x] = NaN;
      r[COL.acc_y] = NaN;
      r[COL.acc_z] = NaN;
    }
    const res = analyzeSamples(samples, { priorVerticalSign: 1 });
    expect(res.quality.usedFallbackLinearAccel).toBe(true);
    expect(res.sets.map((s) => s.repCount)).toEqual([10, 6]);
  });

  it('handles unsorted and duplicate timestamps', () => {
    const { samples } = generateWorkout({ seed: 13, sets: [{ reps: 7 }], restsSec: [] });
    const shuffled = [...samples].reverse();
    shuffled.push([...samples[100]]);
    const res = analyzeSamples(shuffled, { priorVerticalSign: 1 });
    expect(res.quality.droppedNonMonotonic).toBe(1);
    expect(res.sets.map((s) => s.repCount)).toEqual([7]);
  });

  it('does not crash on tiny recordings', () => {
    expect(analyzeSamples([]).sets).toEqual([]);
    const res = analyzeSamples([[0, 0, 0, 0, 0, 0, -9.8, 0, 0, 0, 0, 0, 0]]);
    expect(res.warnings[0]).toMatch(/too short/);
  });
});

describe('direction (up/down) handling', () => {
  it('respects an explicit verticalSign', () => {
    const { res } = run({ seed: 21, sets: [{ reps: 6 }], restsSec: [], userAccelSign: 1 }, { verticalSign: -1 });
    expect(res.verticalSign).toBe(-1);
  });

  it('falls back to the prior when there is no evidence', () => {
    const { samples } = generateWorkout({ seed: 22, sets: [], restsSec: [], leadInSec: 20 });
    const res = analyzeSamples(samples, { priorVerticalSign: -1 });
    expect(res.signSource).toBe('prior');
    expect(res.verticalSign).toBe(-1);
  });
});

describe('cadence', () => {
  it('reports rep period close to the generated tempo and marks steady sets reliable', () => {
    const { res } = run({
      seed: 31,
      sets: [{ reps: 12, upSec: 1, downSec: 1.5, pauseTopSec: 0.2, pauseBottomSec: 0.3 }],
      restsSec: [],
      variability: 0.05,
    });
    const c = res.sets[0].cadence;
    // Generated period ≈ 1 + 0.2 + 1.5 + 0.3 = 3.0 s (plus mild fatigue slow-down).
    expect(c.repPeriodSec!).toBeGreaterThan(2.8);
    expect(c.repPeriodSec!).toBeLessThan(3.4);
    expect(c.reliable).toBe(true);
    expect(c.downSec!).toBeGreaterThan(c.upSec!);
  });
});

describe('replay', () => {
  it('produces identical results after export → import of the recording file', () => {
    const { samples } = generateWorkout({ seed: 41, sets: [{ reps: 10 }, { reps: 12 }], restsSec: [20], disturbances: noisyRests });
    const rec: Recording = {
      format: RECORDING_FORMAT,
      schemaVersion: RECORDING_SCHEMA_VERSION,
      id: 'x',
      createdAt: '',
      startedAt: null,
      stoppedAt: null,
      context: emptyContext(),
      device: { platform: 'test', osVersion: null, modelName: null, appVersion: null, expoSdk: null },
      sensor: { api: 'synthetic', requestedIntervalMs: 10, reportedIntervalMs: 10, timestampOriginSec: 0, columns: [...SAMPLE_COLUMNS] },
      events: [],
      userReported: null,
      sampleCount: samples.length,
      samples,
    };
    const a = analyzeSamples(samples, { priorVerticalSign: 1 });
    const b = analyzeSamples(parseRecordingJson(recordingToJson(rec)).samples, { priorVerticalSign: 1 });
    expect(b.sets.map((s) => s.repCount)).toEqual(a.sets.map((s) => s.repCount));
    b.rests.forEach((r, i) => expect(r.durationSec).toBeCloseTo(a.rests[i].durationSec, 1));
  });
});
