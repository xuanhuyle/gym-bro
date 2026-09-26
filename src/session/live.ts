/**
 * Couples the adapters (windowed rep detector + stillness monitor) with the
 * session state machine. Used by the live screen and by replay, so both run
 * exactly the same logic. Product flow: the session starts ARMED.
 */

import { SampleRow } from '../recording/schema';
import { createSession, SessionConfig, SessionEvent, sessionReducer, SessionState } from './machine';
import { StillnessMonitor, StillnessOptions } from './stillness';
import { WindowedDetectorOptions, WindowedRepDetector } from './windowedDetector';

/** Changes worth persisting (phase, sets, reps, rests, pending, completion). */
export function sessionSignature(s: SessionState): string {
  return JSON.stringify([s.phase, s.sets.map((x) => [x.reps.length, x.closed]), s.rests.map((r) => r.endSec), s.pending.length, s.ignored.length, s.completion?.reason ?? null]);
}

const eventTime = (e: SessionEvent): number =>
  e.type === 'rep' ? e.rep.startSec : e.type === 'tick' ? e.watermarkSec : e.atSec;

export class LiveSession {
  readonly detector: WindowedRepDetector;
  readonly stillness: StillnessMonitor;
  state: SessionState;

  constructor(opts: { session?: Partial<SessionConfig>; detector?: Partial<WindowedDetectorOptions>; stillness?: Partial<StillnessOptions>; state?: SessionState } = {}) {
    this.detector = new WindowedRepDetector(opts.detector);
    this.stillness = new StillnessMonitor(opts.stillness);
    this.state = opts.state ?? createSession({ startArmed: true, ...opts.session });
  }

  /** Feed newly recorded samples; returns true when something worth persisting changed. */
  ingest(rows: SampleRow[], final = false): boolean {
    const before = sessionSignature(this.state);
    const events: SessionEvent[] = this.stillness.push(rows);
    this.detector.push(rows);
    const { reps, watermarkSec } = this.detector.poll(final);
    for (const rep of reps) events.push({ type: 'rep', rep });
    // Apply in time order (stable sort keeps rep order for equal times).
    events.sort((a, b) => eventTime(a) - eventTime(b));
    for (const e of events) this.state = sessionReducer(this.state, e);
    this.state = sessionReducer(this.state, { type: 'tick', watermarkSec });
    // Once the phone is still on the stack, placement motion must not shape the
    // rep engine's window statistics: analyse only from the still moment on.
    const since = this.state.stableSinceSec;
    if (since != null && since > 0 && this.state.phase !== 'ARMED') this.detector.ignoreBefore(since);
    return sessionSignature(this.state) !== before;
  }

  finish(atSec: number): void {
    this.state = sessionReducer(this.state, { type: 'finish', atSec });
  }
}
