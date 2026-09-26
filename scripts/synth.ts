/**
 * Write a synthetic recording file (same format the app exports), e.g. to try
 * the analyzer or the app's import without a phone.
 *
 *   npm run synth -- out.json [--seed 1] [--reps 10,12,15] [--rests 20,20] [--noisy]
 */
import { writeFileSync } from 'fs';
import { generateWorkout } from '../src/analysis/synthetic';
import { emptyContext, Recording, RECORDING_FORMAT, RECORDING_SCHEMA_VERSION, recordingToJson, SAMPLE_COLUMNS } from '../src/recording/schema';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'synthetic.json';
const get = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const seed = Number(get('--seed', '1'));
const reps = get('--reps', '10,12,15').split(',').map(Number);
const rests = get('--rests', reps.slice(1).map(() => '20').join(',')).split(',').filter(Boolean).map(Number);
const noisy = args.includes('--noisy');

const { samples, truth } = generateWorkout({
  seed,
  sets: reps.map((r) => ({ reps: r })),
  restsSec: rests,
  userAccelSign: -1, // matches the expected iOS CoreMotion convention
  disturbances: noisy
    ? [
        { kind: 'handling', count: 2 },
        { kind: 'bump', count: 3 },
        { kind: 'stack-nudge', count: 1 },
      ]
    : [],
});
const now = new Date().toISOString();
const rec: Recording = {
  format: RECORDING_FORMAT,
  schemaVersion: RECORDING_SCHEMA_VERSION,
  id: `synthetic-${seed}`,
  createdAt: now,
  startedAt: now,
  stoppedAt: now,
  context: { ...emptyContext(), bodyRegion: 'Back', exercise: 'Lat Pulldown', variant: 'Wide Grip', loadKg: 35, notes: 'SYNTHETIC — not real sensor data' },
  device: { platform: 'synthetic', osVersion: null, modelName: null, appVersion: null, expoSdk: null },
  sensor: { api: 'synthetic generator', requestedIntervalMs: 10, reportedIntervalMs: 10, timestampOriginSec: 0, columns: [...SAMPLE_COLUMNS] },
  events: [],
  userReported: { sets: truth.sets.map((s) => ({ reps: s.reps })), restsSec: truth.restsSec, notes: 'generator ground truth', updatedAt: now },
  sampleCount: samples.length,
  samples,
};
writeFileSync(out, recordingToJson(rec));
console.log(`wrote ${out}: ${samples.length} samples, truth ${truth.sets.map((s) => s.reps).join('/')}, rests ${truth.restsSec.map((r) => r.toFixed(1)).join('/')}`);
