/**
 * Replay recordings through the analysis pipeline.
 *
 *   npm run analyze -- recordings/foo.json [more files…] [--truth 10,12,15] [--rests 20,20] [--config '{"fs":100}']
 *
 * Prints a summary (and a comparison with the user-reported truth stored in the
 * recording, or --truth/--rests) and writes <file>.report.html next to each input.
 * Accepts exported .json recordings or bare samples .csv files.
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { analyzeSamples, AnalysisConfig } from '../src/analysis/analyze';
import { evaluate, TruthInput } from '../src/analysis/evaluate';
import { formatSummary, htmlReport } from '../src/analysis/report';
import { contextLabel, parseRecordingJson, parseSamplesCsv, SampleRow } from '../src/recording/schema';

const args = process.argv.slice(2);
const files: string[] = [];
let truthArg: string | null = null;
let restsArg: string | null = null;
let config: Partial<AnalysisConfig> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--truth') truthArg = args[++i];
  else if (args[i] === '--rests') restsArg = args[++i];
  else if (args[i] === '--config') config = JSON.parse(args[++i]);
  else files.push(args[i]);
}
if (!files.length) {
  console.error('usage: npm run analyze -- <recording.json|samples.csv> [...] [--truth 10,12,15] [--rests 20,20] [--config JSON]');
  process.exit(1);
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  let samples: SampleRow[];
  let title = basename(file);
  let truth: TruthInput | null = null;
  let platform = 'unknown';
  if (file.endsWith('.csv')) {
    samples = parseSamplesCsv(text).samples;
  } else {
    const rec = parseRecordingJson(text);
    samples = rec.samples;
    platform = rec.device.platform;
    title = `${contextLabel(rec.context) || rec.id} — ${rec.startedAt ?? rec.createdAt}`;
    if (rec.userReported?.sets.length) truth = { sets: rec.userReported.sets, restsSec: rec.userReported.restsSec };
  }
  if (truthArg) truth = { sets: truthArg.split(',').map((r) => ({ reps: Number(r) })), restsSec: [] };
  if (truth && restsArg) truth.restsSec = restsArg.split(',').map((r) => (r === '?' ? null : Number(r)));

  const res = analyzeSamples(samples, config);
  const summary = `${title}\nplatform ${platform}\n` + formatSummary(res, truth ? evaluate(res, truth) : null);
  console.log(summary + '\n');
  const out = file.replace(/\.(json|csv)$/i, '') + '.report.html';
  writeFileSync(out, htmlReport(title, res, summary));
  console.log(`report: ${out}\n`);
}
