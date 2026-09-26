/**
 * Local persistence of recordings with expo-file-system (SDK 57 File/Directory API).
 *
 * Layout under <documents>/recordings/:
 *   <id>.meta.json    RecordingMeta (context, device, events, user-reported truth)
 *   <id>.samples.csv  raw rows, APPENDED every couple of seconds while recording,
 *                     so a crash or kill loses at most the last flush.
 *
 * A recording whose meta has stoppedAt == null was interrupted; its samples
 * are still usable and it is shown as such.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {
  csvHeader,
  parseRecordingJson,
  parseSamplesCsv,
  Recording,
  RecordingMeta,
  recordingToJson,
  sampleRowToCsv,
  SampleRow,
  contextLabel,
} from '../recording/schema';

const root = () => {
  const d = new Directory(Paths.document, 'recordings');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};
const metaFile = (id: string) => new File(root(), `${id}.meta.json`);
const samplesFile = (id: string) => new File(root(), `${id}.samples.csv`);
const settingsFile = () => new File(Paths.document, 'settings.json');

export function newRecordingId(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function createRecording(meta: RecordingMeta): void {
  const m = metaFile(meta.id);
  m.create({ overwrite: true });
  m.write(JSON.stringify(meta, null, 2));
  const s = samplesFile(meta.id);
  s.create({ overwrite: true });
  s.write(csvHeader() + '\n');
}

export function appendSamples(id: string, rows: SampleRow[]): void {
  if (!rows.length) return;
  samplesFile(id).write(rows.map(sampleRowToCsv).join('\n') + '\n', { append: true });
}

export function readMeta(id: string): RecordingMeta {
  return JSON.parse(metaFile(id).textSync()) as RecordingMeta;
}

export function updateMeta(id: string, patch: Partial<RecordingMeta>): RecordingMeta {
  const next = { ...readMeta(id), ...patch };
  metaFile(id).write(JSON.stringify(next, null, 2));
  return next;
}

export interface RecordingListItem {
  meta: RecordingMeta;
  interrupted: boolean;
  sizeBytes: number;
}

export function listRecordings(): RecordingListItem[] {
  const items: RecordingListItem[] = [];
  for (const entry of root().list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(entry.textSync()) as RecordingMeta;
      const s = samplesFile(meta.id);
      items.push({ meta, interrupted: meta.stoppedAt == null, sizeBytes: s.exists ? s.size : 0 });
    } catch {
      // Unreadable meta: skip rather than break the list.
    }
  }
  return items.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
}

export function loadRecording(id: string): Recording {
  const meta = readMeta(id);
  const f = samplesFile(id);
  const { samples } = f.exists ? parseSamplesCsv(f.textSync()) : { samples: [] as SampleRow[] };
  return { ...meta, samples, sampleCount: samples.length };
}

export function deleteRecording(id: string): void {
  for (const f of [metaFile(id), samplesFile(id)]) if (f.exists) f.delete();
}

function exportName(meta: RecordingMeta, ext: string): string {
  const label = contextLabel(meta.context).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `gymbro-${meta.id}${label ? '-' + label : ''}.${ext}`;
}

/** Full recording (metadata + samples) as one JSON file, then the iOS share sheet. */
export async function shareRecordingJson(id: string): Promise<void> {
  const rec = loadRecording(id);
  const out = new File(Paths.cache, exportName(rec, 'json'));
  out.create({ overwrite: true });
  out.write(recordingToJson(rec));
  await Sharing.shareAsync(out.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export recording' });
}

/** Raw samples only, as CSV (metadata is in the JSON export). */
export async function shareSamplesCsv(id: string): Promise<void> {
  const meta = readMeta(id);
  const out = new File(Paths.cache, exportName(meta, 'csv'));
  if (out.exists) out.delete();
  samplesFile(id).copySync(out);
  await Sharing.shareAsync(out.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export samples CSV' });
}

/** Import a previously exported recording JSON (e.g. to replay it with a newer algorithm). */
export async function importRecording(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'public.json', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const rec = parseRecordingJson(await new File(res.assets[0].uri).text());
  let id = rec.id;
  if (metaFile(id).exists) id = `${id}-import-${Date.now()}`;
  const { samples, ...meta } = rec;
  createRecording({ ...meta, id, sampleCount: samples.length });
  appendSamples(id, samples);
  return id;
}

// ---- tiny settings store (remember the last exercise context) ----

export function readSettings<T extends object>(fallback: T): T {
  try {
    const f = settingsFile();
    return f.exists ? { ...fallback, ...JSON.parse(f.textSync()) } : fallback;
  } catch {
    return fallback;
  }
}

export function writeSettings(value: object): void {
  const f = settingsFile();
  if (!f.exists) f.create();
  f.write(JSON.stringify(value));
}
