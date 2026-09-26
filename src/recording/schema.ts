/**
 * Recording format: the durable contract between sensor acquisition, storage,
 * export/import and the analysis engine. Pure TypeScript (no React Native).
 *
 * Changing the meaning of an existing column is a breaking change: bump
 * RECORDING_SCHEMA_VERSION and keep a reader for old versions, because
 * recordings are the raw material we re-analyse as the algorithm improves.
 */

export const RECORDING_FORMAT = 'gymbro.recording';
export const RECORDING_SCHEMA_VERSION = 1;

/**
 * One row per DeviceMotion update, exactly as reported by expo-sensors
 * (iOS: CoreMotion CMDeviceMotion), except `t` which is re-based so the first
 * sample is t=0. See `sensor.timestampOriginSec` for the original origin.
 *
 * - t:                       seconds, native sensor timestamp (monotonic)
 * - acc_x/y/z:               user acceleration, gravity removed, m/s^2
 * - accg_x/y/z:              acceleration including gravity, m/s^2
 * - rr_alpha/beta/gamma:     rotation rate, deg/s (expo naming; on iOS alpha=z, beta=y, gamma=x)
 * - rot_alpha/beta/gamma:    attitude, radians (on iOS yaw, pitch, roll)
 *
 * acc_* may be NaN when the platform does not provide gravity-free acceleration.
 */
export const SAMPLE_COLUMNS = [
  't',
  'acc_x',
  'acc_y',
  'acc_z',
  'accg_x',
  'accg_y',
  'accg_z',
  'rr_alpha',
  'rr_beta',
  'rr_gamma',
  'rot_alpha',
  'rot_beta',
  'rot_gamma',
] as const;

export type SampleColumn = (typeof SAMPLE_COLUMNS)[number];
export type SampleRow = number[]; // same order as SAMPLE_COLUMNS

export const COL: Record<SampleColumn, number> = Object.fromEntries(
  SAMPLE_COLUMNS.map((c, i) => [c, i]),
) as Record<SampleColumn, number>;

export type MovementPattern = 'Push' | 'Pull' | 'Legs' | 'Other';

export interface ExerciseContext {
  movementPattern: MovementPattern;
  bodyRegion: string;
  exercise: string;
  variant: string;
  loadKg: number | null;
  machine: string;
  notes: string;
  /**
   * Catalogue identifiers when the context was chosen from the exercise
   * catalogue (absent for free-text developer recordings). Optional and
   * additive, so schema v1 files remain valid.
   */
  catalogue?: {
    version: string;
    regionId: string;
    exerciseId: string;
    equipmentId: string;
    variantId: string;
  };
}

/** What the user says actually happened. Serves both as ground truth and as the correction of the log. */
export interface UserReported {
  sets: { reps: number }[];
  /** Optional measured rest durations between consecutive sets, seconds. */
  restsSec: (number | null)[];
  /** Corrected load, kg (optional, additive: absent = the recorded load stands). */
  loadKg?: number | null;
  notes: string;
  updatedAt: string;
}

export interface RecordingEvent {
  /** Wall-clock ms since epoch. */
  wallMs: number;
  type: 'start' | 'stop' | 'app-background' | 'app-active' | 'sensor-unavailable' | 'note';
  detail?: string;
}

export interface RecordingMeta {
  format: typeof RECORDING_FORMAT;
  schemaVersion: number;
  id: string;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  context: ExerciseContext;
  device: {
    platform: string;
    osVersion: string | null;
    modelName: string | null;
    appVersion: string | null;
    expoSdk: string | null;
  };
  sensor: {
    api: string;
    requestedIntervalMs: number;
    reportedIntervalMs: number | null;
    /** Raw native timestamp (s) of the first sample; t = raw - origin. */
    timestampOriginSec: number | null;
    columns: readonly string[];
  };
  events: RecordingEvent[];
  userReported: UserReported | null;
  sampleCount: number;
}

export interface Recording extends RecordingMeta {
  samples: SampleRow[];
  /**
   * Export only: the phone's live exercise-session result (a
   * `gymbro.session` record, see src/session/record.ts), so the live result can
   * be compared with replays of the same raw data. Optional and additive.
   */
  liveSession?: unknown;
}

export function emptyContext(): ExerciseContext {
  return {
    movementPattern: 'Pull',
    bodyRegion: '',
    exercise: '',
    variant: '',
    loadKg: null,
    machine: '',
    notes: '',
  };
}

export function contextLabel(c: ExerciseContext): string {
  const parts = [c.movementPattern, c.bodyRegion, c.exercise, c.variant].filter((p) => p && p.trim());
  const load = c.loadKg != null ? `${c.loadKg} kg` : null;
  return [...parts, load].filter(Boolean).join(' → ');
}

// ---------- serialisation ----------

/** Round to limit export size without losing sensor precision (~1e-5 m/s^2 is far below sensor noise). */
function fmt(v: number, digits: number): string {
  if (!Number.isFinite(v)) return 'NaN';
  return String(Number(v.toFixed(digits)));
}

export function sampleRowToCsv(row: SampleRow): string {
  return row.map((v, i) => fmt(v, i === 0 ? 6 : 5)).join(',');
}

export function csvHeader(): string {
  return SAMPLE_COLUMNS.join(',');
}

export function samplesToCsv(samples: SampleRow[]): string {
  return [csvHeader(), ...samples.map(sampleRowToCsv)].join('\n') + '\n';
}

/** Parses CSV text produced by samplesToCsv / the recorder. Ignores blank and malformed lines. */
export function parseSamplesCsv(text: string): { samples: SampleRow[]; skippedLines: number } {
  const lines = text.split(/\r?\n/);
  const samples: SampleRow[] = [];
  let skipped = 0;
  let header: string[] | null = null;
  let map: number[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!header) {
      header = line.split(',').map((h) => h.trim());
      map = SAMPLE_COLUMNS.map((c) => header!.indexOf(c));
      if (map[0] < 0) throw new Error('CSV has no "t" column');
      continue;
    }
    const cells = line.split(',');
    const row = map!.map((j) => (j >= 0 && j < cells.length ? Number(cells[j]) : NaN));
    if (!Number.isFinite(row[0])) {
      skipped++;
      continue;
    }
    samples.push(row);
  }
  return { samples, skippedLines: skipped };
}

export function recordingToJson(rec: Recording): string {
  const { samples, ...meta } = rec;
  // One sample per line keeps big files diff-able and streamable.
  const head = JSON.stringify({ ...meta, sampleCount: samples.length }, null, 2);
  const rows = samples.map((r) => '[' + r.map((v, i) => (Number.isFinite(v) ? fmt(v, i === 0 ? 6 : 5) : 'null')).join(',') + ']');
  return head.slice(0, -2) + ',\n  "samples": [\n' + rows.join(',\n') + '\n  ]\n}\n';
}

export function parseRecordingJson(text: string): Recording {
  const obj = JSON.parse(text);
  if (!obj || obj.format !== RECORDING_FORMAT) throw new Error('Not a gym-bro recording (missing format marker)');
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion > RECORDING_SCHEMA_VERSION) {
    throw new Error(`Unsupported recording schemaVersion ${obj.schemaVersion}`);
  }
  if (!Array.isArray(obj.samples)) throw new Error('Recording has no samples array');
  const cols: string[] = obj.sensor?.columns ?? [...SAMPLE_COLUMNS];
  const map = SAMPLE_COLUMNS.map((c) => cols.indexOf(c));
  const samples: SampleRow[] = obj.samples.map((r: (number | null)[]) =>
    map.map((j) => (j >= 0 && r[j] != null ? Number(r[j]) : NaN)),
  );
  return {
    ...obj,
    sensor: { ...obj.sensor, columns: [...SAMPLE_COLUMNS] },
    events: obj.events ?? [],
    userReported: obj.userReported ?? null,
    samples,
    sampleCount: samples.length,
  } as Recording;
}
