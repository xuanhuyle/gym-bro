/**
 * Synthetic DeviceMotion recordings of a weight-stack workout, for tests and
 * for exercising the pipeline without a phone. Physically modelled, seeded,
 * deterministic. This validates the *logic* of the pipeline; it says nothing
 * about how well a real iPhone on a real machine will perform.
 */

import { SampleRow } from '../recording/schema';

export type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3]; // rows

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

function randomUnit(rnd: () => number): Vec3 {
  const v: Vec3 = [gauss(rnd), gauss(rnd), gauss(rnd)];
  const m = Math.hypot(...v) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

function axisAngle(axis: Vec3, ang: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}

/** v_device = R^T v_world, where R maps device → world. */
function toDevice(R: Mat3, v: Vec3): Vec3 {
  return [
    R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
    R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
    R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
  ];
}

export function randomRotation(rnd: () => number): Mat3 {
  return axisAngle(randomUnit(rnd), rnd() * 2 * Math.PI);
}

export type DisturbanceKind = 'handling' | 'bump' | 'stack-nudge';

export interface SyntheticSetSpec {
  reps: number;
  /** Mean concentric (up) duration, s. */
  upSec?: number;
  downSec?: number;
  pauseTopSec?: number;
  pauseBottomSec?: number;
  /** Stack travel, m. */
  amplitudeM?: number;
}

export interface SyntheticSpec {
  seed: number;
  sets: SyntheticSetSpec[];
  /** Rest after each set except the last, s. */
  restsSec: number[];
  leadInSec?: number;
  leadOutSec?: number;
  rateHz?: number;
  jitterMs?: number;
  /** Probability per second of a dropped chunk of samples (0.1–0.4 s). */
  dropoutRate?: number;
  accelNoise?: number;
  gyroNoiseDegS?: number;
  accelBias?: number;
  /** Horizontal sway as a fraction of vertical acceleration. */
  swayFraction?: number;
  /** Random rest-period disturbances. */
  disturbances?: { kind: DisturbanceKind; count: number }[];
  /** +1: reported user acceleration = physical acceleration; -1: negated. */
  userAccelSign?: 1 | -1;
  /** Fixed mount orientation; random if omitted. */
  orientation?: Mat3;
  /** Rep-to-rep variability (fraction). */
  variability?: number;
  /**
   * Recording starts with the phone in the user's hand (tilted, hand tremor),
   * then it is carried/rotated onto the stack and strapped (strong rotation,
   * jerks), then it is still. Models arming right after context selection.
   */
  placement?: { handSec: number; moveSec: number; angleDeg: number };
}

export interface SyntheticTruth {
  sets: { reps: number; startSec: number; endSec: number }[];
  restsSec: number[];
  disturbances: { kind: DisturbanceKind; startSec: number; durationSec: number }[];
}

interface Move {
  t0: number;
  T: number;
  A: number; // signed displacement, m
}

interface Disturbance {
  kind: DisturbanceKind;
  t0: number;
  T: number;
  dir: Vec3; // world translation direction
  amp: number; // m/s^2 (or m for stack-nudge)
  freq: number;
  axis: Vec3; // device-frame rotation axis
  angle: number; // peak rotation, rad
}

/** Minimum-jerk profile: displacement 0→A over T. Returns acceleration. */
function minJerkAccel(A: number, T: number, tau: number): number {
  if (tau <= 0 || tau >= 1) return 0;
  return (A / (T * T)) * (60 * tau - 180 * tau * tau + 120 * tau * tau * tau);
}

export function generateWorkout(spec: SyntheticSpec): { samples: SampleRow[]; truth: SyntheticTruth } {
  const rnd = mulberry32(spec.seed);
  const rate = spec.rateHz ?? 100;
  const jitter = (spec.jitterMs ?? 1) / 1000;
  const noise = spec.accelNoise ?? 0.03;
  const gyroNoise = spec.gyroNoiseDegS ?? 0.3;
  const bias0 = spec.accelBias ?? 0.03;
  const sway = spec.swayFraction ?? 0.08;
  const sign = spec.userAccelSign ?? 1;
  const vari = spec.variability ?? 0.12;
  const R0 = spec.orientation ?? randomRotation(rnd);
  const vary = () => 1 + vari * (2 * rnd() - 1);

  // ---- stack motion timeline ----
  const moves: Move[] = [];
  const truthSets: SyntheticTruth['sets'] = [];
  let t = spec.leadInSec ?? 8;
  const pl = spec.placement;
  const placementEnd = pl ? pl.handSec + pl.moveSec : 0;
  if (pl && placementEnd + 2 > t) throw new Error('leadInSec must leave the phone still after placement');
  const restWindows: [number, number][] = [[placementEnd + 1, t - 1]];
  // Draw placement randomness only when used, so existing seeds keep generating identical data.
  const plAxis: Vec3 = pl ? randomUnit(rnd) : [0, 0, 1];
  const plDir: Vec3 = pl ? randomUnit(rnd) : [0, 0, 1];
  const plTheta0 = pl ? (pl.angleDeg * Math.PI) / 180 : 0;
  spec.sets.forEach((s, si) => {
    const up = s.upSec ?? 1.2;
    const down = s.downSec ?? 1.6;
    const pTop = s.pauseTopSec ?? 0.3;
    const pBot = s.pauseBottomSec ?? 0.4;
    const amp = s.amplitudeM ?? 0.4;
    const start = t;
    for (let r = 0; r < s.reps; r++) {
      const fatigue = 1 + 0.25 * (r / Math.max(1, s.reps - 1)) ** 2;
      const A = amp * (1 + 0.5 * vari * (2 * rnd() - 1));
      const Tu = up * vary() * fatigue;
      const Td = down * vary();
      moves.push({ t0: t, T: Tu, A });
      t += Tu + pTop * vary();
      moves.push({ t0: t, T: Td, A: -A });
      t += Td;
      if (r < s.reps - 1) t += pBot * vary();
    }
    truthSets.push({ reps: s.reps, startSec: start, endSec: t });
    if (si < spec.sets.length - 1) {
      const rest = spec.restsSec[si] ?? 20;
      restWindows.push([t + 1.5, t + rest - 1.5]);
      t += rest;
    }
  });
  const lead = spec.leadOutSec ?? 6;
  restWindows.push([t + 1, t + lead - 1]);
  const total = t + lead;

  // ---- disturbances, placed inside rest windows ----
  const dists: Disturbance[] = [];
  for (const d of spec.disturbances ?? []) {
    for (let k = 0; k < d.count; k++) {
      const usable = restWindows.filter(([a, b]) => b - a > 3);
      if (!usable.length) break;
      const [a, b] = usable[Math.floor(rnd() * usable.length)];
      const T = d.kind === 'handling' ? 1.5 + 1.5 * rnd() : d.kind === 'bump' ? 0.1 + 0.15 * rnd() : 0.4 + 0.3 * rnd();
      const t0 = a + rnd() * Math.max(0, b - a - T);
      dists.push({
        kind: d.kind,
        t0,
        T,
        dir: d.kind === 'stack-nudge' ? [0, 0, 1] : randomUnit(rnd),
        amp: d.kind === 'handling' ? 1.5 + 2 * rnd() : d.kind === 'bump' ? 3 + 4 * rnd() : 0.01 + 0.03 * rnd(),
        freq: d.kind === 'handling' ? 1 + 2 * rnd() : 6 + 6 * rnd(),
        axis: randomUnit(rnd),
        angle: d.kind === 'handling' ? ((15 + 25 * rnd()) * Math.PI) / 180 : d.kind === 'bump' ? ((1 + 3 * rnd()) * Math.PI) / 180 : 0,
      });
    }
  }
  dists.sort((a, b) => a.t0 - b.t0);

  const swayDir = rnd() * 2 * Math.PI;
  const G = 9.80665;
  const samples: SampleRow[] = [];
  let bias: Vec3 = [bias0 * gauss(rnd), bias0 * gauss(rnd), bias0 * gauss(rnd)];
  let mi = 0;
  let dropUntil = -1;
  const dropP = (spec.dropoutRate ?? 0) / rate;
  const dt = 1 / rate;
  for (let k = 0; ; k++) {
    const ts = k * dt + (k > 0 ? jitter * (2 * rnd() - 1) : 0);
    if (ts > total) break;
    if (ts < dropUntil) continue;
    if (dropP > 0 && rnd() < dropP) {
      dropUntil = ts + 0.1 + 0.3 * rnd();
      continue;
    }
    // Stack vertical acceleration.
    while (mi < moves.length && moves[mi].t0 + moves[mi].T < ts) mi++;
    let az = 0;
    for (let j = mi; j < moves.length && moves[j].t0 <= ts; j++) az += minJerkAccel(moves[j].A, moves[j].T, (ts - moves[j].t0) / moves[j].T);
    const aw: Vec3 = [sway * az * Math.cos(swayDir), sway * az * Math.sin(swayDir), az];
    // Disturbances.
    let R = R0;
    let rr: Vec3 = [0, 0, 0];
    if (pl && ts < placementEnd) {
      const inHand = ts < pl.handSec;
      const tau = inHand ? 0 : (ts - pl.handSec) / pl.moveSec;
      const theta = plTheta0 * (1 - (3 * tau * tau - 2 * tau * tau * tau));
      R = mul(R0, axisAngle(plAxis, theta));
      const rate = inHand ? 0 : ((-plTheta0 * 6 * tau * (1 - tau)) / pl.moveSec) * (180 / Math.PI);
      rr = [plAxis[0] * rate + 5 * gauss(rnd), plAxis[1] * rate + 5 * gauss(rnd), plAxis[2] * rate + 5 * gauss(rnd)];
      const tremor = 0.3;
      const carry = inHand ? 0 : 2.5 * Math.sin(Math.PI * tau) * Math.sin(2 * Math.PI * 1.5 * (ts - pl.handSec));
      const tug = !inHand && tau > 0.6 && Math.sin(2 * Math.PI * 4 * ts) > 0.9 ? 4 : 0;
      for (let q = 0; q < 3; q++) aw[q] += tremor * gauss(rnd) + (carry + tug) * plDir[q];
    }
    for (const d of dists) {
      if (ts < d.t0 || ts > d.t0 + d.T) continue;
      const tau = (ts - d.t0) / d.T;
      const win = Math.sin(Math.PI * tau) ** 2;
      if (d.kind === 'stack-nudge') {
        aw[2] += minJerkAccel(d.amp, d.T / 2, tau * 2) + minJerkAccel(-d.amp, d.T / 2, tau * 2 - 1);
      } else {
        const s = d.amp * win * Math.sin(2 * Math.PI * d.freq * (ts - d.t0));
        for (let q = 0; q < 3; q++) aw[q] += s * d.dir[q];
      }
      if (d.angle > 0) {
        const ang = d.angle * Math.sin(Math.PI * tau) ** 2;
        R = mul(R0, axisAngle(d.axis, ang));
        const rate = ((d.angle * Math.PI * Math.sin(2 * Math.PI * tau)) / d.T) * (180 / Math.PI);
        rr = [d.axis[0] * rate, d.axis[1] * rate, d.axis[2] * rate];
      }
    }
    bias = [bias[0] + 0.0005 * gauss(rnd), bias[1] + 0.0005 * gauss(rnd), bias[2] + 0.0005 * gauss(rnd)];
    const ad = toDevice(R, aw);
    const gd = toDevice(R, [0, 0, -G]);
    const acc: Vec3 = [0, 1, 2].map((q) => sign * ad[q] + bias[q] + noise * gauss(rnd)) as Vec3;
    samples.push([
      ts,
      acc[0],
      acc[1],
      acc[2],
      acc[0] + gd[0],
      acc[1] + gd[1],
      acc[2] + gd[2],
      rr[2] + gyroNoise * gauss(rnd),
      rr[1] + gyroNoise * gauss(rnd),
      rr[0] + gyroNoise * gauss(rnd),
      0,
      0,
      0,
    ]);
  }

  return {
    samples,
    truth: {
      sets: truthSets,
      restsSec: truthSets.slice(1).map((s, i) => s.startSec - truthSets[i].endSec),
      disturbances: dists.map((d) => ({ kind: d.kind, startSec: d.t0, durationSec: d.T })),
    },
  };
}
