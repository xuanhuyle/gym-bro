/**
 * Workout analysis engine: timestamped DeviceMotion samples → reps → sets → rest.
 *
 * Pure and deterministic. Runs identically on the phone (live or saved
 * recordings), in Node (scripts/analyze.ts) and in tests (synthetic data).
 *
 * Physical model: the phone is rigidly attached to a selectorized weight
 * stack, which can only translate along its vertical guide rods. So:
 *  - "vertical" is taken from the gravity vector reported by sensor fusion,
 *    which makes the analysis independent of how the phone is mounted;
 *  - a repetition is one up-and-down excursion of the stack;
 *  - genuine stack motion is mostly vertical and has little rotation, which
 *    is how handling/bumping the phone is told apart from repetitions.
 *
 * Nothing here knows the expected rep or set counts.
 */

import { COL, SampleRow } from '../recording/schema';
import { bandpass, cumtrapz, highpass, lowpass, median, movingRms, percentile, std } from './dsp';
import { zigzag } from './zigzag';

export const ALGORITHM_VERSION = 'g0-1';

export interface AnalysisConfig {
  /** Uniform resampling rate for analysis, Hz. */
  fs: number;
  /** Timestamp gap that is reported as a data-quality problem, s. */
  gapWarnSec: number;
  /** Band-pass applied to vertical acceleration before integration, Hz. */
  accelHighPassHz: number;
  accelLowPassHz: number;
  /** High-pass used on position only when no still period is available to anchor it, Hz. */
  integrationHighPassHz: number;
  /** High-pass on velocity to decay integration offsets, Hz (0 = off). */
  velocityHighPassHz: number;
  /** Smallest displacement swing (m, of the filtered estimate) ever considered. */
  minSwingM: number;
  /** Swing threshold relative to the typical (90th percentile) swing. */
  relSwingThreshold: number;
  minRepSec: number;
  maxRepSec: number;
  /** Fraction of linear-acceleration energy that must be vertical during a rep. */
  minVerticality: number;
  /**
   * Rotation limit during a rep, deg/s RMS: max(rotationFloorDegS, rotationRelFactor × median over
   * candidates). The guided stack does not rotate, handling the phone does; the relative term
   * tolerates a mount that wobbles consistently.
   */
  rotationFloorDegS: number;
  rotationRelFactor: number;
  /** Rep boundaries are where the stack is within this fraction of the swing from the bottom. */
  repBoundaryFraction: number;
  /** Rep amplitude must be at least this fraction of the median accepted amplitude. */
  minRelAmplitude: number;
  /** Gap between reps that starts a new set, s: max(minSetGapSec, setGapRepFactor × median rep duration). */
  minSetGapSec: number;
  setGapRepFactor: number;
  /** Groups with fewer accepted reps are treated as noise. */
  minRepsPerSet: number;
  /** Cadence is flagged reliable only with at least this many reps and CV below maxCadenceCv. */
  minRepsForCadence: number;
  maxCadenceCv: number;
  /**
   * Up/down convention. 'auto' votes from the data and falls back to
   * priorVerticalSign when the vote is not decisive (winner < signDecisiveRatio × loser).
   * iOS prior: CoreMotion reports userAcceleration opposite to the physical
   * acceleration (at rest face-up the raw accelerometer reads z = -1 g), which
   * makes our raw "up" projection negative → -1. NOT YET VERIFIED ON A DEVICE.
   */
  verticalSign: 'auto' | 1 | -1;
  priorVerticalSign: 1 | -1;
  signDecisiveRatio: number;
  /** Activity detection (used for up/down sign voting and debug display). */
  activityWindowSec: number;
  minActivityRms: number;
  maxActivityRms: number;
  quietBeforeOnsetSec: number;
  /** A still period at least this long anchors the displacement estimate to zero (stack at bottom), s. */
  anchorQuietSec: number;
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  fs: 50,
  gapWarnSec: 0.25,
  accelHighPassHz: 0.1,
  accelLowPassHz: 5,
  integrationHighPassHz: 0.08,
  velocityHighPassHz: 0.03,
  minSwingM: 0.015,
  relSwingThreshold: 0.35,
  minRepSec: 0.5,
  maxRepSec: 15,
  minVerticality: 0.5,
  rotationFloorDegS: 15,
  rotationRelFactor: 3,
  repBoundaryFraction: 0.05,
  minRelAmplitude: 0.4,
  minSetGapSec: 6,
  setGapRepFactor: 2,
  minRepsPerSet: 2,
  minRepsForCadence: 3,
  maxCadenceCv: 0.35,
  verticalSign: 'auto',
  priorVerticalSign: -1,
  signDecisiveRatio: 2,
  activityWindowSec: 1,
  minActivityRms: 0.05,
  maxActivityRms: 0.15,
  quietBeforeOnsetSec: 2,
  anchorQuietSec: 6,
};

export type RejectReason =
  | 'too-short'
  | 'too-long'
  | 'not-vertical'
  | 'rotating'
  | 'low-amplitude'
  | 'isolated';

export interface RepCandidate {
  id: number;
  startSec: number;
  peakSec: number;
  endSec: number;
  durationSec: number;
  upSec: number;
  downSec: number;
  /** Peak-to-trough of the filtered displacement estimate, m. Relative, not calibrated ROM. */
  amplitudeM: number;
  verticality: number;
  rotationRmsDegS: number;
  accepted: boolean;
  rejectReasons: RejectReason[];
  setIndex: number | null;
}

export interface Cadence {
  repPeriodSec: number | null;
  repsPerMin: number | null;
  upSec: number | null;
  downSec: number | null;
  periodCv: number | null;
  reliable: boolean;
}

export interface DetectedSet {
  index: number;
  repCount: number;
  startSec: number;
  endSec: number;
  repIds: number[];
  cadence: Cadence;
  meanAmplitudeM: number;
}

export interface DetectedRest {
  afterSet: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface AnalysisTrace {
  /** Resampled uniform time axis, s. */
  t: Float64Array;
  /** Vertical (up-positive) linear acceleration, band-passed, m/s^2. */
  verticalAccel: Float64Array;
  /** Horizontal linear acceleration magnitude, band-passed, m/s^2. */
  horizontalAccel: Float64Array;
  /** Estimated relative vertical displacement (filtered double integral), m. */
  position: Float64Array;
  /** Rotation-rate magnitude, deg/s. */
  rotationRate: Float64Array;
  /** Moving RMS of vertical acceleration, m/s^2. */
  activity: Float64Array;
  /** Still periods used as zero-displacement anchors, [startSec, endSec]. */
  quietSec: [number, number][];
}

export interface AnalysisResult {
  algorithmVersion: string;
  config: AnalysisConfig;
  quality: {
    rawSampleCount: number;
    durationSec: number;
    meanRateHz: number;
    gaps: { atSec: number; durationSec: number }[];
    droppedNonMonotonic: number;
    usedFallbackLinearAccel: boolean;
    /** 95th percentile angle between instantaneous and median gravity direction, deg. Large = phone moved on its mount. */
    orientationSpreadDeg: number;
  };
  verticalSign: 1 | -1;
  signSource: 'vote' | 'prior' | 'config';
  signVotes: { up: number; down: number };
  swingThresholdM: number;
  rotationLimitDegS: number;
  candidates: RepCandidate[];
  sets: DetectedSet[];
  rests: DetectedRest[];
  totalReps: number;
  warnings: string[];
  trace: AnalysisTrace;
}

interface Resampled {
  t: Float64Array;
  acc: [Float64Array, Float64Array, Float64Array];
  accg: [Float64Array, Float64Array, Float64Array];
  rr: [Float64Array, Float64Array, Float64Array];
}

function cleanAndSort(samples: SampleRow[]): { rows: SampleRow[]; dropped: number } {
  const rows = samples.filter((r) => Number.isFinite(r[COL.t])).slice();
  rows.sort((a, b) => a[COL.t] - b[COL.t]);
  const out: SampleRow[] = [];
  let dropped = samples.length - rows.length;
  for (const r of rows) {
    if (out.length && r[COL.t] <= out[out.length - 1][COL.t]) {
      dropped++;
      continue;
    }
    out.push(r);
  }
  return { rows: out, dropped };
}

function resample(rows: SampleRow[], fs: number): Resampled {
  const t0 = rows[0][COL.t];
  const t1 = rows[rows.length - 1][COL.t];
  const n = Math.max(1, Math.floor((t1 - t0) * fs) + 1);
  const t = new Float64Array(n);
  const mk = () => [new Float64Array(n), new Float64Array(n), new Float64Array(n)] as [Float64Array, Float64Array, Float64Array];
  const acc = mk();
  const accg = mk();
  const rr = mk();
  const cols: [Float64Array, number][] = [
    [acc[0], COL.acc_x],
    [acc[1], COL.acc_y],
    [acc[2], COL.acc_z],
    [accg[0], COL.accg_x],
    [accg[1], COL.accg_y],
    [accg[2], COL.accg_z],
    [rr[0], COL.rr_alpha],
    [rr[1], COL.rr_beta],
    [rr[2], COL.rr_gamma],
  ];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = t0 + i / fs;
    t[i] = ti - t0;
    while (j < rows.length - 2 && rows[j + 1][COL.t] < ti) j++;
    const a = rows[j];
    const b = rows[Math.min(j + 1, rows.length - 1)];
    const span = b[COL.t] - a[COL.t];
    const w = span > 0 ? Math.min(1, Math.max(0, (ti - a[COL.t]) / span)) : 0;
    for (const [arr, c] of cols) {
      const va = a[c];
      const vb = b[c];
      arr[i] = Number.isFinite(va) && Number.isFinite(vb) ? va + (vb - va) * w : Number.isFinite(va) ? va : vb;
    }
  }
  return { t, acc, accg, rr };
}

interface Lobe {
  sign: 1 | -1;
  peak: number;
  len: number;
  stackLike: number;
}

function voteDirection(
  aUp: Float64Array,
  aHor: Float64Array,
  rot: Float64Array,
  activity: Float64Array,
  thr: number,
  fs: number,
  cfg: AnalysisConfig,
): { up: number; down: number } {
  const n = aUp.length;
  const quietN = Math.round(cfg.quietBeforeOnsetSec * fs);
  // Active regions separated by at least quietN still samples.
  const regions: [number, number][] = [];
  let quietRun = quietN;
  let start = -1;
  let lastActive = -1;
  for (let i = 0; i < n; i++) {
    if (activity[i] >= thr) {
      if (start < 0 || quietRun >= quietN) {
        if (start >= 0) regions.push([start, lastActive]);
        start = i;
      }
      lastActive = i;
      quietRun = 0;
    } else quietRun++;
  }
  if (start >= 0) regions.push([start, lastActive]);

  let up = 0;
  let down = 0;
  const pad = Math.round(0.5 * fs);
  for (const [r0, r1] of regions) {
    const a = Math.max(0, r0 - pad);
    const b = Math.min(n - 1, r1 + pad);
    const lobes: Lobe[] = [];
    let cur: Lobe | null = null;
    for (let i = a; i <= b; i++) {
      const sg: 1 | -1 = aUp[i] >= 0 ? 1 : -1;
      if (!cur || cur.sign !== sg) {
        if (cur) lobes.push(cur);
        cur = { sign: sg, peak: 0, len: 0, stackLike: 0 };
      }
      cur.len++;
      cur.peak = Math.max(cur.peak, Math.abs(aUp[i]));
      if (Math.abs(aUp[i]) >= 2 * aHor[i] && rot[i] <= cfg.rotationFloorDegS) cur.stackLike++;
    }
    if (cur) lobes.push(cur);
    const minLen = Math.round(0.15 * fs);
    const candidates = lobes.filter((l) => l.len >= minLen && l.stackLike >= 0.6 * l.len);
    const P = candidates.reduce((m, l) => Math.max(m, l.peak), 0);
    // Significance is relative to noise, not to the strongest lobe: a slow
    // descent has much weaker lobes than the lift, but it still ends the set.
    const sig = candidates.filter((l) => l.peak >= Math.max(2 * thr, 0.1 * P));
    if (!sig.length) continue;
    const w = (r1 - r0) / fs / 2;
    for (const l of [sig[0], sig[sig.length - 1]]) {
      if (l.sign > 0) up += w;
      else down += w;
    }
  }
  return { up, down };
}

/** Index ranges [start, end] (inclusive) where activity stays below `thr` for at least `minLen` samples. */
function findQuietIntervals(activity: ArrayLike<number>, thr: number, minLen: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= activity.length; i++) {
    const q = i < activity.length && activity[i] < thr;
    if (q && s < 0) s = i;
    if (!q && s >= 0) {
      if (i - s >= minLen) out.push([s, i - 1]);
      s = -1;
    }
  }
  return out;
}

/**
 * Removes drift from an integrated position so that it is zero at the start
 * and end of every quiet interval, interpolating the correction linearly in
 * between (piecewise-linear baseline through the anchor points).
 */
function anchorToQuiet(pos: Float64Array, quiet: [number, number][]): Float64Array {
  const n = pos.length;
  const knots: [number, number][] = [];
  for (const [a, b] of quiet) {
    knots.push([a, pos[a]]);
    if (b > a) knots.push([b, pos[b]]);
  }
  const out = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < knots.length - 1 && knots[k + 1][0] <= i) k++;
    let base: number;
    if (i <= knots[0][0]) base = knots[0][1];
    else if (i >= knots[knots.length - 1][0]) base = knots[knots.length - 1][1];
    else {
      const [i0, v0] = knots[k];
      const [i1, v1] = knots[k + 1];
      base = v0 + ((v1 - v0) * (i - i0)) / (i1 - i0);
    }
    out[i] = pos[i] - base;
  }
  return out;
}

function rmsOver(x: ArrayLike<number>, a: number, b: number): number {
  let s = 0;
  for (let i = a; i <= b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a + 1));
}

/** Analyse a full recording. `samples` rows follow SAMPLE_COLUMNS. */
export function analyzeSamples(samples: SampleRow[], overrides: Partial<AnalysisConfig> = {}): AnalysisResult {
  const cfg: AnalysisConfig = { ...DEFAULT_CONFIG, ...overrides };
  const warnings: string[] = [];
  const { rows, dropped } = cleanAndSort(samples);
  const fs = cfg.fs;

  const emptyTrace: AnalysisTrace = {
    t: new Float64Array(0),
    verticalAccel: new Float64Array(0),
    horizontalAccel: new Float64Array(0),
    position: new Float64Array(0),
    rotationRate: new Float64Array(0),
    activity: new Float64Array(0),
    quietSec: [],
  };
  const durationSec = rows.length > 1 ? rows[rows.length - 1][COL.t] - rows[0][COL.t] : 0;
  const gaps: { atSec: number; durationSec: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const dt = rows[i][COL.t] - rows[i - 1][COL.t];
    if (dt > cfg.gapWarnSec) gaps.push({ atSec: rows[i - 1][COL.t] - rows[0][COL.t], durationSec: dt });
  }
  const baseQuality = {
    rawSampleCount: samples.length,
    durationSec,
    meanRateHz: durationSec > 0 ? (rows.length - 1) / durationSec : 0,
    gaps,
    droppedNonMonotonic: dropped,
    usedFallbackLinearAccel: false,
    orientationSpreadDeg: 0,
  };
  if (rows.length < fs * 3 || durationSec < 3) {
    return {
      algorithmVersion: ALGORITHM_VERSION,
      config: cfg,
      quality: baseQuality,
      verticalSign: cfg.priorVerticalSign,
      signSource: 'prior',
      signVotes: { up: 0, down: 0 },
      swingThresholdM: 0,
      rotationLimitDegS: 0,
      candidates: [],
      sets: [],
      rests: [],
      totalReps: 0,
      warnings: ['Recording too short to analyse (< 3 s).'],
      trace: emptyTrace,
    };
  }
  if (gaps.length) {
    const total = gaps.reduce((s, g) => s + g.durationSec, 0);
    warnings.push(`${gaps.length} timestamp gap(s) > ${cfg.gapWarnSec}s, ${total.toFixed(1)}s total. Data was interpolated across them.`);
  }
  if (baseQuality.meanRateHz < 40) warnings.push(`Low sample rate (${baseQuality.meanRateHz.toFixed(0)} Hz).`);

  const r = resample(rows, fs);
  const n = r.t.length;

  // ---- linear acceleration and gravity in the device frame ----
  let usedFallback = false;
  const lin: Float64Array[] = [0, 1, 2].map((k) => {
    const hasUser = r.acc[k].every(Number.isFinite);
    if (hasUser) return r.acc[k];
    usedFallback = true;
    // Rigid mount: gravity is near-constant in the device frame, so a very low
    // cutoff separates it without eating slow repetitions.
    const g = lowpass(r.accg[k], 0.03, fs);
    return r.accg[k].map((v, i) => v - g[i]);
  });
  // Gravity vector = acceleration-including-gravity minus user acceleration (exact
  // decomposition done by sensor fusion). Smoothed: the mount is rigid.
  const grav = [0, 1, 2].map((k) => lowpass(r.accg[k].map((v, i) => v - lin[k][i]), 0.5, fs));
  const gHat = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(grav[0][i], grav[1][i], grav[2][i]) || 1;
    for (let k = 0; k < 3; k++) gHat[k][i] = grav[k][i] / m;
  }
  // Orientation stability diagnostic.
  const medG = [median(gHat[0]), median(gHat[1]), median(gHat[2])];
  const medNorm = Math.hypot(medG[0], medG[1], medG[2]) || 1;
  const angles = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = (gHat[0][i] * medG[0] + gHat[1][i] * medG[1] + gHat[2][i] * medG[2]) / medNorm;
    angles[i] = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  }
  const orientationSpreadDeg = percentile(angles, 95);
  if (orientationSpreadDeg > 15) {
    warnings.push(`Phone orientation varied by up to ${orientationSpreadDeg.toFixed(0)}° — it may have moved on its mount.`);
  }

  // ---- vertical / horizontal decomposition (up = -gravity direction) ----
  const linBp = lin.map((x) => bandpass(x, cfg.accelHighPassHz, cfg.accelLowPassHz, fs));
  const aUpRaw = new Float64Array(n);
  const aHor = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dot = linBp[0][i] * gHat[0][i] + linBp[1][i] * gHat[1][i] + linBp[2][i] * gHat[2][i];
    aUpRaw[i] = -dot;
    const hx = linBp[0][i] - dot * gHat[0][i];
    const hy = linBp[1][i] - dot * gHat[1][i];
    const hz = linBp[2][i] - dot * gHat[2][i];
    aHor[i] = Math.hypot(hx, hy, hz);
  }
  const rot = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.hypot(r.rr[0][i], r.rr[1][i], r.rr[2][i]);
    rot[i] = Number.isFinite(v) ? v : 0;
  }

  // ---- activity & up/down sign vote ----
  // The stack rests at the bottom of its travel. So the first stack movement
  // after a still period is an upward acceleration (lift-off), and the last one
  // before the next still period is also upward (decelerating the descent).
  // Each active period votes with both ends, weighted by its duration, so a
  // disturbance at one end cannot decide alone. Only lobes that look like stack
  // motion count: long enough (not a knock), mostly vertical and not rotating.
  // This removes any dependence on the platform's acceleration sign convention.
  const activity = movingRms(aUpRaw, Math.round(cfg.activityWindowSec * fs));
  // Noise floor from a low percentile (recordings may be >90% active), and the
  // threshold is capped so a mostly-active recording cannot call reps "still".
  const floor = percentile(activity, 3);
  const actThr = Math.min(cfg.maxActivityRms, Math.max(cfg.minActivityRms, 3 * floor));
  const { up: votesUp, down: votesDown } = voteDirection(aUpRaw, aHor, rot, activity, actThr, fs, cfg);

  // ---- displacement estimate: double integration with drift removal ----
  // Physics: between sets the stack rests at the bottom, so during every long
  // still period both velocity and position are exactly zero. We integrate
  // acceleration → velocity, force velocity to zero at those anchors (removing
  // accelerometer bias drift linearly between them), integrate again and
  // anchor position the same way. Anchors must be long (anchorQuietSec) so a
  // pause at the top of a slow rep is not mistaken for the stack at rest.
  // Without any anchor we fall back to high-pass filtering (less accurate
  // around set boundaries).
  const quiet = findQuietIntervals(activity, actThr, Math.round(cfg.anchorQuietSec * fs));
  let vel = cumtrapz(aUpRaw, 1 / fs);
  if (quiet.length) vel = anchorToQuiet(vel, quiet);
  // Integration offsets (e.g. from sample dropouts mid-rep) are not linear
  // between anchors; a gentle high-pass makes them decay within seconds.
  if (cfg.velocityHighPassHz > 0 || !quiet.length) vel = highpass(vel, cfg.velocityHighPassHz || cfg.integrationHighPassHz, fs);
  let posRaw = cumtrapz(vel, 1 / fs);
  if (quiet.length) posRaw = anchorToQuiet(posRaw, quiet);
  else {
    warnings.push('No still period found to anchor the displacement estimate; used high-pass fallback. Keep the stack still for a few seconds after pressing Start and before pressing Stop.');
    posRaw = highpass(posRaw, cfg.integrationHighPassHz, fs);
  }

  let sign: 1 | -1;
  let signSource: 'vote' | 'prior' | 'config';
  if (cfg.verticalSign !== 'auto') {
    sign = cfg.verticalSign;
    signSource = 'config';
  } else if (Math.max(votesUp, votesDown) > 0 && Math.max(votesUp, votesDown) >= cfg.signDecisiveRatio * Math.min(votesUp, votesDown)) {
    sign = votesUp >= votesDown ? 1 : -1;
    signSource = 'vote';
  } else {
    sign = cfg.priorVerticalSign;
    signSource = 'prior';
    warnings.push('Up/down direction could not be determined from the data; used the platform default.');
  }
  const aUp = sign === 1 ? aUpRaw : aUpRaw.map((v) => -v);
  const pos = sign === 1 ? posRaw : posRaw.map((v) => -v);

  // ---- candidate repetitions ----
  const prelim = zigzag(pos, cfg.minSwingM);
  const swings: number[] = [];
  for (let i = 1; i < prelim.length; i++) swings.push(Math.abs(prelim[i].value - prelim[i - 1].value));
  const typical = swings.length ? percentile(swings, 90) : 0;
  const swingThr = Math.max(cfg.minSwingM, cfg.relSwingThreshold * typical);
  const tps = zigzag(pos, swingThr);

  const candidates: RepCandidate[] = [];
  for (let k = 1; k < tps.length - 1; k++) {
    const p = tps[k];
    if (p.kind !== 'peak') continue;
    const a = tps[k - 1];
    const b = tps[k + 1];
    // A rep cannot extend into a still period: bound the search window by the
    // nearest anchors, then measure the swing from the lowest point inside it.
    let lim0 = a.index;
    let lim1 = b.index;
    for (const [qa, qb] of quiet) {
      if (qb < p.index && qb > lim0) lim0 = qb;
      if (qa > p.index && qa < lim1) lim1 = qa;
    }
    // Walk outwards from the peak to the nearest valley on each side: stop once
    // the signal rises again by more than a quarter of the swing threshold.
    const hyst = 0.25 * swingThr;
    let m0 = p.index;
    for (let i = p.index - 1; i >= lim0; i--) {
      if (pos[i] < pos[m0]) m0 = i;
      else if (pos[i] - pos[m0] > hyst) break;
    }
    let m1 = p.index;
    for (let i = p.index + 1; i <= lim1; i++) {
      if (pos[i] < pos[m1]) m1 = i;
      else if (pos[i] - pos[m1] > hyst) break;
    }
    lim0 = m0;
    lim1 = m1;
    const base0 = pos[m0];
    const base1 = pos[m1];
    const up = p.value - base0;
    const down = p.value - base1;
    // Tight boundaries: where the stack is within repBoundaryFraction of the swing from the bottom.
    let s = p.index;
    while (s > lim0 && pos[s] > base0 + cfg.repBoundaryFraction * up) s--;
    let e = p.index;
    while (e < lim1 && pos[e] > base1 + cfg.repBoundaryFraction * down) e++;
    // Motion-quality features use the rep's core (between the 25% crossings) so
    // that activity just before/after the rep (e.g. touching the phone) does not leak in.
    let cs = p.index;
    while (cs > s && pos[cs] > base0 + 0.25 * up) cs--;
    let ce = p.index;
    while (ce < e && pos[ce] > base1 + 0.25 * down) ce++;
    const vEnergy = rmsOver(aUp, cs, ce) ** 2;
    const hEnergy = rmsOver(aHor, cs, ce) ** 2;
    const c: RepCandidate = {
      id: candidates.length,
      startSec: r.t[s],
      peakSec: r.t[p.index],
      endSec: r.t[e],
      durationSec: (e - s) / fs,
      upSec: (p.index - s) / fs,
      downSec: (e - p.index) / fs,
      amplitudeM: (up + down) / 2,
      verticality: vEnergy + hEnergy > 0 ? vEnergy / (vEnergy + hEnergy) : 0,
      rotationRmsDegS: rmsOver(rot, cs, ce),
      accepted: false,
      rejectReasons: [],
      setIndex: null,
    };
    if (c.durationSec < cfg.minRepSec) c.rejectReasons.push('too-short');
    if (c.durationSec > cfg.maxRepSec) c.rejectReasons.push('too-long');
    if (c.verticality < cfg.minVerticality) c.rejectReasons.push('not-vertical');
    candidates.push(c);
  }
  const shapeOk = candidates.filter((c) => c.rejectReasons.length === 0);
  const medRot = median(shapeOk.map((c) => c.rotationRmsDegS));
  const rotLimit = Math.max(cfg.rotationFloorDegS, cfg.rotationRelFactor * (Number.isFinite(medRot) ? medRot : 0));
  for (const c of shapeOk) if (c.rotationRmsDegS > rotLimit) c.rejectReasons.push('rotating');
  const plausible = candidates.filter((c) => c.rejectReasons.length === 0);
  const medAmp = median(plausible.map((c) => c.amplitudeM));
  for (const c of plausible) {
    if (c.amplitudeM < cfg.minRelAmplitude * medAmp) c.rejectReasons.push('low-amplitude');
  }

  // ---- group into sets ----
  let accepted = candidates.filter((c) => c.rejectReasons.length === 0);
  const medDur = median(accepted.map((c) => c.durationSec));
  const setGap = Math.max(cfg.minSetGapSec, cfg.setGapRepFactor * (Number.isFinite(medDur) ? medDur : 0));
  const groups: RepCandidate[][] = [];
  for (const c of accepted) {
    const g = groups[groups.length - 1];
    if (g && c.startSec - g[g.length - 1].endSec <= setGap) g.push(c);
    else groups.push([c]);
  }
  const sets: DetectedSet[] = [];
  for (const g of groups) {
    if (g.length < cfg.minRepsPerSet) {
      for (const c of g) c.rejectReasons.push('isolated');
      continue;
    }
    const index = sets.length;
    for (const c of g) {
      c.accepted = true;
      c.setIndex = index;
    }
    const peaks = g.map((c) => c.peakSec);
    const periods = peaks.slice(1).map((p, i) => p - peaks[i]);
    const medPeriod = periods.length ? median(periods) : null;
    const cv = periods.length >= 2 && medPeriod ? std(periods) / medPeriod : null;
    const reliable = g.length >= cfg.minRepsForCadence && cv != null && cv <= cfg.maxCadenceCv;
    sets.push({
      index,
      repCount: g.length,
      startSec: g[0].startSec,
      endSec: g[g.length - 1].endSec,
      repIds: g.map((c) => c.id),
      meanAmplitudeM: g.reduce((s, c) => s + c.amplitudeM, 0) / g.length,
      cadence: {
        repPeriodSec: medPeriod,
        repsPerMin: medPeriod ? 60 / medPeriod : null,
        upSec: median(g.map((c) => c.upSec)),
        downSec: median(g.map((c) => c.downSec)),
        periodCv: cv,
        reliable,
      },
    });
  }
  accepted = candidates.filter((c) => c.accepted);
  const rests: DetectedRest[] = sets.slice(1).map((s, i) => ({
    afterSet: i,
    startSec: sets[i].endSec,
    endSec: s.startSec,
    durationSec: s.startSec - sets[i].endSec,
  }));
  if (sets.length === 0) warnings.push('No sets detected.');

  return {
    algorithmVersion: ALGORITHM_VERSION,
    config: cfg,
    quality: { ...baseQuality, usedFallbackLinearAccel: usedFallback, orientationSpreadDeg },
    verticalSign: sign,
    signSource,
    signVotes: { up: votesUp, down: votesDown },
    swingThresholdM: swingThr,
    rotationLimitDegS: rotLimit,
    candidates,
    sets,
    rests,
    totalReps: accepted.length,
    warnings,
    trace: { t: r.t, verticalAccel: aUp, horizontalAccel: aHor, position: pos, rotationRate: rot, activity, quietSec: quiet.map(([a, b]) => [r.t[a], r.t[b]] as [number, number]) },
  };
}
