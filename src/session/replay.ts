/**
 * Drive the session state machine from a recorded (or synthetic) sample
 * stream exactly as the live app does: chunks of samples → LiveSession.
 */

import { COL, SampleRow } from '../recording/schema';
import { LiveSession } from './live';
import { SessionConfig, SessionState } from './machine';
import { WindowedDetectorOptions } from './windowedDetector';

export interface ReplayOptions {
  session?: Partial<SessionConfig>;
  detector?: Partial<WindowedDetectorOptions>;
  /** Seconds of samples per ingest (the app flushes every 2 s). */
  chunkSec?: number;
}

export function replaySession(samples: SampleRow[], opts: ReplayOptions = {}): { state: SessionState; live: LiveSession } {
  const chunkSec = opts.chunkSec ?? 2;
  const live = new LiveSession({ session: opts.session, detector: opts.detector });
  const rows = [...samples].sort((a, b) => a[COL.t] - b[COL.t]);
  let i = 0;
  while (i < rows.length && live.state.phase !== 'COMPLETE') {
    const end = rows[i][COL.t] + chunkSec;
    const chunk: SampleRow[] = [];
    while (i < rows.length && rows[i][COL.t] < end) chunk.push(rows[i++]);
    live.ingest(chunk);
  }
  // End of data: release reps still waiting to settle.
  if (live.state.phase !== 'COMPLETE') live.ingest([], true);
  return { state: live.state, live };
}
