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
import { evaluate, evaluateCounts, TruthInput } from '../src/analysis/evaluate';
import { summarize } from '../src/session/machine';
import { parseSessionRecord } from '../src/session/record';
import { replaySession } from '../src/session/replay';
import { formatEvaluation, formatSummary, htmlReport } from '../src/analysis/report';
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
  let phoneSession: string | null = null;
  if (file.endsWith('.csv')) {
    samples = parseSamplesCsv(text).samples;
  } else {
    const rec = parseRecordingJson(text);
    samples = rec.samples;
    platform = rec.device.platform;
    title = `${contextLabel(rec.context) || rec.id} — ${rec.startedAt ?? rec.createdAt}`;
    if (rec.liveSession) {
      try {
        const ps = parseSessionRecord(JSON.stringify(rec.liveSession));
        const sum = summarize(ps.state, ps.state.watermarkSec);
        phoneSession = `phone live session (${ps.status}, ${ps.state.completion?.reason ?? 'not completed'}): ${sum.sets.map((x) => x.reps).join(' / ') || '—'} reps; rests ${sum.rests.filter((r) => !r.ongoing).map((r) => r.durationSec.toFixed(1)).join(' / ') || '—'} s`;
      } catch (e) {
        phoneSession = `phone live session: unreadable (${String(e)})`;
      }
    }
    if (rec.userReported?.sets.length) truth = { sets: rec.userReported.sets, restsSec: rec.userReported.restsSec };
  }
  if (truthArg) truth = { sets: truthArg.split(',').map((r) => ({ reps: Number(r) })), restsSec: [] };
  if (truth && restsArg) truth.restsSec = restsArg.split(',').map((r) => (r === '?' ? null : Number(r)));

  const res = analyzeSamples(samples, config);
  // Same code path as the phone's live session (windowed detector + state machine), on the same raw data.
  const replay = replaySession(samples, { detector: { analysis: config } }).state;
  const rs = summarize(replay, replay.watermarkSec);
  const replayLines = [
    `live-session replay (${replay.phase}${replay.completion ? ', ' + replay.completion.reason : ''}): ${rs.sets.map((x) => x.reps).join(' / ') || '—'} reps; rests ${rs.rests.filter((r) => !r.ongoing).map((r) => r.durationSec.toFixed(1)).join(' / ') || '—'} s; ignored movements ${replay.ignored.filter((i) => i.reason === 'isolated').length}`,
  ];
  if (truth) replayLines.push(...formatEvaluation(evaluateCounts(rs.sets.map((x) => x.reps), rs.rests.filter((r) => !r.ongoing).map((r) => r.durationSec), truth)).map((l) => '  ' + l));
  if (phoneSession) replayLines.unshift(phoneSession);
  const summary = `${title}\nplatform ${platform}\n` + formatSummary(res, truth ? evaluate(res, truth) : null) + '\n\n' + replayLines.join('\n');
  console.log(summary + '\n');
  const out = file.replace(/\.(json|csv)$/i, '') + '.report.html';
  writeFileSync(out, htmlReport(title, res, summary));
  console.log(`report: ${out}\n`);
}
