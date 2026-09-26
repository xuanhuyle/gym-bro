/**
 * Minimal deterministic DSP toolkit. Offline (whole-signal) processing only,
 * so zero-phase filtering is used to keep event timing unbiased.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** 2nd-order Butterworth (Q = 1/sqrt 2) via bilinear transform with pre-warping. */
export function butter2(kind: 'low' | 'high', cutoffHz: number, fs: number): Biquad {
  if (!(cutoffHz > 0 && cutoffHz < fs / 2)) throw new Error(`cutoff ${cutoffHz} Hz invalid for fs ${fs}`);
  const k = Math.tan((Math.PI * cutoffHz) / fs);
  const q = Math.SQRT1_2;
  const norm = 1 / (1 + k / q + k * k);
  const a1 = 2 * (k * k - 1) * norm;
  const a2 = (1 - k / q + k * k) * norm;
  if (kind === 'low') {
    const b0 = k * k * norm;
    return { b0, b1: 2 * b0, b2: b0, a1, a2 };
  }
  return { b0: norm, b1: -2 * norm, b2: norm, a1, a2 };
}

/** Single forward pass, initial state set as if the input had been constant at x[0] forever. */
function lfilter(c: Biquad, x: Float64Array): Float64Array {
  const y = new Float64Array(x.length);
  if (x.length === 0) return y;
  // Steady-state for constant input x0: y0 = x0 * DC gain.
  const dc = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
  let x1 = x[0],
    x2 = x[0],
    y1 = x[0] * dc,
    y2 = x[0] * dc;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

/**
 * Zero-phase filtering (forward + backward) with odd reflection padding at
 * both ends to suppress edge transients.
 */
export function filtfilt(c: Biquad, x: ArrayLike<number>, padLen?: number): Float64Array {
  const n = x.length;
  if (n === 0) return new Float64Array(0);
  const pad = Math.min(padLen ?? 3 * 50, n - 1);
  const ext = new Float64Array(n + 2 * pad);
  const first = x[0];
  const last = x[n - 1];
  for (let i = 0; i < pad; i++) ext[i] = 2 * first - x[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * last - x[n - 2 - i];
  const fwd = lfilter(c, ext);
  fwd.reverse();
  const bwd = lfilter(c, fwd);
  bwd.reverse();
  return bwd.slice(pad, pad + n);
}

export function lowpass(x: ArrayLike<number>, cutoffHz: number, fs: number): Float64Array {
  return filtfilt(butter2('low', cutoffHz, fs), x, Math.round(fs * 3));
}

export function highpass(x: ArrayLike<number>, cutoffHz: number, fs: number): Float64Array {
  // Long padding: high-pass edge transients last ~1/cutoff seconds.
  return filtfilt(butter2('high', cutoffHz, fs), x, Math.round(fs / cutoffHz));
}

export function bandpass(x: ArrayLike<number>, lowHz: number, highHz: number, fs: number): Float64Array {
  return lowpass(highpass(x, lowHz, fs), highHz, fs);
}

/** Cumulative trapezoidal integral with uniform step dt, starting at 0. */
export function cumtrapz(x: ArrayLike<number>, dt: number): Float64Array {
  const y = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + 0.5 * (x[i] + x[i - 1]) * dt;
  return y;
}

/** Centered moving RMS over a window of `win` samples. */
export function movingRms(x: ArrayLike<number>, win: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const half = Math.max(1, Math.floor(win / 2));
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i] * x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = Math.sqrt((cs[b] - cs[a]) / (b - a));
  }
  return out;
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (arr.length === 0) return NaN;
  const pos = (arr.length - 1) * Math.min(1, Math.max(0, p / 100));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}

export function median(values: ArrayLike<number>): number {
  return percentile(values, 50);
}

export function mean(values: ArrayLike<number>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) {
      s += values[i];
      n++;
    }
  }
  return n ? s / n : NaN;
}

export function std(values: ArrayLike<number>): number {
  const m = mean(values);
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) {
      s += (values[i] - m) ** 2;
      n++;
    }
  }
  return n > 1 ? Math.sqrt(s / (n - 1)) : 0;
}
