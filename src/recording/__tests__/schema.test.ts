import {
  COL,
  Recording,
  RECORDING_FORMAT,
  RECORDING_SCHEMA_VERSION,
  SAMPLE_COLUMNS,
  emptyContext,
  parseRecordingJson,
  parseSamplesCsv,
  recordingToJson,
  samplesToCsv,
} from '../schema';

function makeRecording(): Recording {
  const samples = Array.from({ length: 5 }, (_, i) => SAMPLE_COLUMNS.map((_, j) => (j === 0 ? i * 0.01 : i + j / 1000)));
  samples[2][COL.acc_x] = NaN;
  return {
    format: RECORDING_FORMAT,
    schemaVersion: RECORDING_SCHEMA_VERSION,
    id: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    stoppedAt: '2026-01-01T00:01:01.000Z',
    context: { ...emptyContext(), exercise: 'Lat Pulldown', loadKg: 35 },
    device: { platform: 'ios', osVersion: '26', modelName: 'iPhone', appVersion: '1.0.0', expoSdk: '57' },
    sensor: { api: 'test', requestedIntervalMs: 10, reportedIntervalMs: 10, timestampOriginSec: 1234.5, columns: [...SAMPLE_COLUMNS] },
    events: [{ wallMs: 1, type: 'start' }],
    userReported: { sets: [{ reps: 10 }], restsSec: [], notes: '', updatedAt: 'x' },
    sampleCount: 5,
    samples,
  };
}

describe('recording JSON', () => {
  it('round-trips metadata and samples (NaN preserved)', () => {
    const rec = makeRecording();
    const back = parseRecordingJson(recordingToJson(rec));
    expect(back.context).toEqual(rec.context);
    expect(back.userReported).toEqual(rec.userReported);
    expect(back.samples).toHaveLength(5);
    expect(Number.isNaN(back.samples[2][COL.acc_x])).toBe(true);
    expect(back.samples[4][COL.accg_z]).toBeCloseTo(rec.samples[4][COL.accg_z], 5);
  });

  it('maps columns by name, so column order in a file does not matter', () => {
    const rec = makeRecording();
    const obj = JSON.parse(recordingToJson(rec));
    obj.sensor.columns = [...SAMPLE_COLUMNS].reverse();
    obj.samples = obj.samples.map((r: unknown[]) => [...r].reverse());
    const back = parseRecordingJson(JSON.stringify(obj));
    expect(back.samples[4][COL.t]).toBeCloseTo(0.04, 6);
  });

  it('rejects files that are not recordings or come from a newer schema', () => {
    expect(() => parseRecordingJson('{"hello":1}')).toThrow(/format/);
    const obj = JSON.parse(recordingToJson(makeRecording()));
    obj.schemaVersion = RECORDING_SCHEMA_VERSION + 1;
    expect(() => parseRecordingJson(JSON.stringify(obj))).toThrow(/schemaVersion/);
  });
});

describe('samples CSV', () => {
  it('round-trips and skips malformed lines', () => {
    const rec = makeRecording();
    const csv = samplesToCsv(rec.samples) + 'garbage,line\n\n';
    const { samples, skippedLines } = parseSamplesCsv(csv);
    expect(samples).toHaveLength(5);
    expect(skippedLines).toBe(1);
    expect(samples[3][COL.rr_gamma]).toBeCloseTo(rec.samples[3][COL.rr_gamma], 5);
  });
});
