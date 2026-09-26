/**
 * Couples the windowed rep detector with the session state machine. Used by
 * the live screen and by replay, so both run exactly the same logic.
 */

import { SampleRow } from '../recording/schema';
import { createSession, SessionConfig, sessionReducer, SessionState } from './machine';
import { WindowedDetectorOptions, WindowedRepDetector } from './windowedDetector';

/** Changes worth persisting (phase, sets, reps, rests, pending, completion). */
export function sessionSignature(s: SessionState): string {
  return JSON.stringify([s.phase, s.sets.map((x) => [x.reps.length, x.closed]), s.rests.map((r) => r.endSec), s.pending.length, s.ignored.length, s.completion?.reason ?? null]);
}

export class LiveSession {
  readonly detector: WindowedRepDetector;
  state: SessionState;

  constructor(opts: { session?: Partial<SessionConfig>; detector?: Partial<WindowedDetectorOptions>; state?: SessionState } = {}) {
    this.detector = new WindowedRepDetector(opts.detector);
    this.state = opts.state ?? createSession(opts.session);
  }

  /** Feed newly recorded samples; returns true when something worth persisting changed. */
  ingest(rows: SampleRow[], final = false): boolean {
    const before = sessionSignature(this.state);
    this.detector.push(rows);
    const { reps, watermarkSec } = this.detector.poll(final);
    for (const rep of reps) this.state = sessionReducer(this.state, { type: 'rep', rep });
    this.state = sessionReducer(this.state, { type: 'tick', watermarkSec });
    return sessionSignature(this.state) !== before;
  }

  finish(atSec: number): void {
    this.state = sessionReducer(this.state, { type: 'finish', atSec });
  }
}
