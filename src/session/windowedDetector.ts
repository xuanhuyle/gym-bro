/**
 * Live rep source built on the EXISTING offline analysis engine, unchanged.
 *
 * The engine needs whole-signal processing (zero-phase filters, still-period
 * anchoring, adaptive thresholds), so live use re-runs it on a trailing window
 * of raw samples and only releases reps that have "settled": their end lies
 * at least `settleSec` before the newest sample. Released reps are never
 * retracted; the session state machine does the set/rest logic.
 *
 * This is integration plumbing, not new signal processing. Its real-machine
 * behaviour is HARDWARE-VALIDATION-PENDING.
 */

import { analyzeSamples, AnalysisConfig, RejectReason } from '../analysis/analyze';
import { COL, SampleRow } from '../recording/schema';
import { RepEvent } from './machine';

export interface WindowedDetectorOptions {
  /** Seconds of history analysed on every poll. */
  windowSec: number;
  /** A rep is released once its end is this far behind the newest sample. */
  settleSec: number;
  /**
   * No reps are released before this much recording exists: the engine's
   * relative checks (rotation vs. median rep, amplitude vs. median) need several
   * reps of context. Early reps are released later, not lost.
   */
  minHistorySec: number;
  analysis: Partial<AnalysisConfig>;
}

export const DEFAULT_DETECTOR_OPTIONS: WindowedDetectorOptions = {
  windowSec: 90,
  settleSec: 2.5,
  minHistorySec: 20,
  analysis: {},
};

/**
 * Candidate rejections that only concern the offline engine's own set grouping.
 * The session machine does grouping itself, so these reps are still valid.
 */
const GROUPING_ONLY: RejectReason[] = ['isolated'];

/** Candidates starting this close to the first analysed sample are cut by the data edge. */
const TRUNCATION_GUARD_SEC = 0.5;

export interface PollResult {
  reps: RepEvent[];
  /** Every rep ending before this time has been released. */
  watermarkSec: number;
}

export class WindowedRepDetector {
  private rows: SampleRow[] = [];
  /** Time span of the last released rep; a later window may re-locate the same rep's peak by ~0.5 s. */
  private lastEmittedEnd = -Infinity;
  private lockedSign: 1 | -1 | null = null;
  private dirty = false;
  private watermark = 0;
  private firstT: number | null = null;
  private boundary: number | null = null;
  private signLockedAt: number | null = null;
  readonly opts: WindowedDetectorOptions;

  constructor(opts: Partial<WindowedDetectorOptions> = {}) {
    this.opts = { ...DEFAULT_DETECTOR_OPTIONS, ...opts, analysis: { ...DEFAULT_DETECTOR_OPTIONS.analysis, ...opts.analysis } };
  }

  /** Rows with t on the recording clock (as produced by the sensor layer). */
  push(rows: SampleRow[]): void {
    if (this.boundary != null) rows = rows.filter((r) => r[COL.t] >= this.boundary!);
    if (!rows.length) return;
    if (this.firstT == null) this.firstT = rows[0][COL.t];
    this.rows.push(...rows);
    const newest = this.rows[this.rows.length - 1][COL.t];
    const cut = newest - this.opts.windowSec;
    let i = 0;
    while (i < this.rows.length && this.rows[i][COL.t] < cut) i++;
    if (i > 0) this.rows = this.rows.slice(i);
    this.dirty = true;
  }

  /**
   * Discard samples before `t` (e.g. phone placement before it was still on the
   * stack) so they never enter the engine's window statistics or direction vote.
   * History for minHistorySec is then counted from `t`; reps are released late, not lost.
   */
  ignoreBefore(t: number): void {
    if (this.boundary != null && t <= this.boundary) return;
    this.boundary = t;
    this.rows = this.rows.filter((r) => r[COL.t] >= t);
    this.firstT = t;
    // A direction voted on data that included placement is not trustworthy: vote again.
    if (this.signLockedAt != null && this.signLockedAt < t) {
      this.lockedSign = null;
      this.signLockedAt = null;
    }
    this.dirty = true;
  }

  /** Up/down direction once decided by a data vote; kept for the rest of the session. */
  get verticalSign(): 1 | -1 | null {
    return this.lockedSign;
  }

  /** @param final true at end of recording: release everything (no settling margin). */
  poll(final = false): PollResult {
    if ((!this.dirty && !final) || this.rows.length < 2) return { reps: [], watermarkSec: this.watermark };
    this.dirty = false;
    const t0 = this.rows[0][COL.t];
    const newest = this.rows[this.rows.length - 1][COL.t];
    if (!final && newest - (this.firstT ?? t0) < this.opts.minHistorySec) {
      this.dirty = true;
      return { reps: [], watermarkSec: this.watermark };
    }
    const cfg: Partial<AnalysisConfig> = { ...this.opts.analysis };
    if (this.lockedSign != null) cfg.verticalSign = this.lockedSign;
    const res = analyzeSamples(this.rows, cfg);
    // The direction decides peaks vs troughs; flipping it between windows would
    // shift every rep by half a cycle, so lock it at the first decisive vote.
    if (this.lockedSign == null && res.signSource === 'vote') {
      this.lockedSign = res.verticalSign;
      this.signLockedAt = newest;
    }

    const watermark = final ? newest : newest - this.opts.settleSec;
    const reps: RepEvent[] = [];
    for (const c of res.candidates) {
      if (!c.rejectReasons.every((r) => GROUPING_ONLY.includes(r))) continue;
      const rep: RepEvent = { startSec: t0 + c.startSec, peakSec: t0 + c.peakSec, endSec: t0 + c.endSec, amplitudeM: c.amplitudeM };
      if (rep.endSec > watermark) continue;
      // A candidate that "starts" at the first analysed sample is truncated by the data edge, not an observed rep.
      if (rep.startSec < t0 + TRUNCATION_GUARD_SEC) continue;
      // Same rep seen again in a later window: its peak falls inside the span already released.
      if (rep.peakSec <= this.lastEmittedEnd) continue;
      reps.push(rep);
      this.lastEmittedEnd = rep.endSec;
    }
    this.watermark = Math.max(this.watermark, watermark);
    return { reps, watermarkSec: this.watermark };
  }
}
