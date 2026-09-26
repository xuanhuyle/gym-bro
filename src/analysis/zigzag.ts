export interface TurningPoint {
  index: number;
  kind: 'peak' | 'trough';
  value: number;
  /** False only for the final point, which is where the data ends rather than a confirmed reversal. */
  confirmed: boolean;
}

/**
 * Hysteresis ("zig-zag") extrema detector. Returns alternating peaks and
 * troughs such that every consecutive pair differs by at least `threshold`.
 * Movements smaller than the threshold are ignored, which is what makes it
 * robust to small wobbles within a repetition.
 */
export function zigzag(x: ArrayLike<number>, threshold: number): TurningPoint[] {
  const n = x.length;
  const out: TurningPoint[] = [];
  if (n < 2 || !(threshold > 0)) return out;

  // Establish initial direction.
  let hiIdx = 0;
  let loIdx = 0;
  let dir: 0 | 1 | -1 = 0;
  let i = 1;
  for (; i < n && dir === 0; i++) {
    if (x[i] > x[hiIdx]) hiIdx = i;
    if (x[i] < x[loIdx]) loIdx = i;
    if (x[hiIdx] - x[loIdx] >= threshold) {
      if (hiIdx > loIdx) {
        out.push({ index: loIdx, kind: 'trough', value: x[loIdx], confirmed: true });
        dir = 1; // rising, tracking a peak candidate
      } else {
        out.push({ index: hiIdx, kind: 'peak', value: x[hiIdx], confirmed: true });
        dir = -1;
      }
    }
  }
  if (dir === 0) return out;

  let ext = dir === 1 ? hiIdx : loIdx;
  for (; i < n; i++) {
    if (dir === 1) {
      if (x[i] > x[ext]) ext = i;
      else if (x[ext] - x[i] >= threshold) {
        out.push({ index: ext, kind: 'peak', value: x[ext], confirmed: true });
        dir = -1;
        ext = i;
      }
    } else {
      if (x[i] < x[ext]) ext = i;
      else if (x[i] - x[ext] >= threshold) {
        out.push({ index: ext, kind: 'trough', value: x[ext], confirmed: true });
        dir = 1;
        ext = i;
      }
    }
  }
  // The final pending extremum is not confirmed by a reversal, but it is the
  // true end-point of the last swing if that swing was large enough.
  const lastConfirmed = out[out.length - 1];
  if (Math.abs(x[ext] - lastConfirmed.value) >= threshold) {
    out.push({ index: ext, kind: dir === 1 ? 'peak' : 'trough', value: x[ext], confirmed: false });
  }
  return out;
}
