/**
 * Stillness / handling monitor for arming (adapter layer, next to the
 * windowed rep detector). It turns raw DeviceMotion rows into two edge-
 * triggered events for the session state machine:
 *   - `stable`   the phone has been still for `stableSec`; atSec = when the
 *                still period began (so reps starting after it are kept);
 *   - `handling` strong rotation began (the phone is being picked up, turned,
 *                strapped). A guided weight stack does not rotate; hands do.
 *
 * Deliberately simple magnitudes (RMS of |user acceleration| and |rotation
 * rate| over short windows). It does not touch the rep-detection engine.
 * Thresholds are NOT validated on a real phone strapped to a stack yet
 * (hardware-validation-pending); they are configuration.
 */

import { COL, SampleRow } from '../recording/schema';
import { SessionEvent } from './machine';

export interface StillnessOptions {
  /** How long the phone must stay still to count as placed, s. */
  stableSec: number;
  /** Max RMS of user acceleration magnitude while still, m/s². */
  stillAccelRms: number;
  /** Max RMS of rotation-rate magnitude while still, °/s. */
  stillRotationRms: number;
  /** Window for handling detection, s. */
  handlingWindowSec: number;
  /** RMS rotation rate above which the phone is being handled, °/s. */
  handlingRotationRms: number;
}

export const DEFAULT_STILLNESS_OPTIONS: StillnessOptions = {
  stableSec: 2,
  stillAccelRms: 0.15,
  stillRotationRms: 4,
  handlingWindowSec: 0.5,
  handlingRotationRms: 30,
};

type Mag = { t: number; acc: number; rot: number };

export class StillnessMonitor {
  readonly opts: StillnessOptions;
  private buf: Mag[] = [];
  private still = false;
  private handling = false;

  constructor(opts: Partial<StillnessOptions> = {}) {
    this.opts = { ...DEFAULT_STILLNESS_OPTIONS, ...opts };
  }

  /** Feed rows in time order; returns the transitions they caused. */
  push(rows: SampleRow[]): SessionEvent[] {
    const out: SessionEvent[] = [];
    const keep = Math.max(this.opts.stableSec, this.opts.handlingWindowSec);
    for (const r of rows) {
      const t = r[COL.t];
      const acc = Math.hypot(r[COL.acc_x], r[COL.acc_y], r[COL.acc_z]);
      const rot = Math.hypot(r[COL.rr_alpha], r[COL.rr_beta], r[COL.rr_gamma]);
      this.buf.push({ t, acc: Number.isFinite(acc) ? acc : 0, rot: Number.isFinite(rot) ? rot : 0 });
      while (this.buf.length && this.buf[0].t < t - keep) this.buf.shift();

      // Handling: strong rotation over a short window (edge-triggered).
      const hw = this.window(t - this.opts.handlingWindowSec);
      const handlingNow = hw.length > 1 && rms(hw.map((m) => m.rot)) > this.opts.handlingRotationRms;
      if (handlingNow && !this.handling) out.push({ type: 'handling', atSec: hw[0].t });
      this.handling = handlingNow;

      // Stillness: the whole stableSec window is quiet (edge-triggered).
      const sw = this.window(t - this.opts.stableSec);
      const covered = sw.length > 1 && sw[sw.length - 1].t - sw[0].t >= this.opts.stableSec * 0.9;
      const stillNow = covered && rms(sw.map((m) => m.acc)) <= this.opts.stillAccelRms && rms(sw.map((m) => m.rot)) <= this.opts.stillRotationRms;
      if (stillNow && !this.still) out.push({ type: 'stable', atSec: sw[0].t });
      if (!covered) continue;
      this.still = stillNow;
    }
    return out;
  }

  private window(fromT: number): Mag[] {
    let i = this.buf.length;
    while (i > 0 && this.buf[i - 1].t >= fromT) i--;
    return this.buf.slice(i);
  }
}

function rms(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / Math.max(1, xs.length));
}
