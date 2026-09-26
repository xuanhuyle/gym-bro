/**
 * Exercise-session state machine: READY → ACTIVE_SET → REST → ACTIVE_SET → … → COMPLETE.
 *
 * Pure and deterministic (a reducer over plain JSON state), independent of
 * React and of sensor acquisition. It consumes:
 *   - `rep`    a confirmed valid repetition from any source (live detector,
 *              replay of a recording, simulator, scripted tests);
 *   - `tick`   a watermark: "every rep that ENDS before this time has been
 *              delivered". Set-end confirmation is measured on the watermark,
 *              so a slow detector cannot make the machine declare REST early;
 *   - `finish` the user ends the exercise manually.
 * All times are seconds on the recording's clock.
 *
 * Rules
 *  - Reps whose gap to the previous rep is ≤ maxRepGapSec belong to the same set.
 *  - A set ends when no rep has ended for setEndConfirmSec (watermark time).
 *    The rest is timed from the END of the last valid rep, not from confirmation.
 *  - From READY/REST a new set needs a coherent sequence: minRepsToStartSet
 *    reps with gaps ≤ maxRepGapSec. Once confirmed, all those reps (including
 *    the first) belong to the new set and the rest ends at the first rep's start.
 *    A lone movement is kept only as an "ignored" record.
 *  - If a rep arrives that clearly continues the set that was just closed
 *    (gap ≤ maxRepGapSec, nothing pending), the REST is revoked and the set reopened.
 *  - After targetSets sets (final set confirmed with completeConfirmSec) the
 *    session is COMPLETE. A very long rest (maxRestSec) also completes it.
 */

export interface RepEvent {
  startSec: number;
  peakSec: number;
  endSec: number;
  /** Relative amplitude from the detector, informational only. */
  amplitudeM?: number;
}

export interface SessionConfig {
  /** Sets after which the exercise completes automatically. Default product flow: 3. */
  targetSets: number;
  minRepsToStartSet: number;
  maxRepGapSec: number;
  setEndConfirmSec: number;
  /** Longer confirmation for the final set, because completion is irreversible. */
  completeConfirmSec: number;
  /** Complete automatically if a rest lasts this long (null = never). */
  maxRestSec: number | null;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  targetSets: 3,
  minRepsToStartSet: 2,
  maxRepGapSec: 6,
  setEndConfirmSec: 10,
  completeConfirmSec: 20,
  maxRestSec: 900,
};

export type SessionPhase = 'READY' | 'ACTIVE_SET' | 'REST' | 'COMPLETE';

export interface SessionSet {
  index: number;
  reps: RepEvent[];
  /** Start of the first rep. */
  startSec: number;
  /** End of the last valid rep (provisional while the set is active). */
  endSec: number;
  closed: boolean;
  /** Watermark time when the end was confirmed (later than endSec). */
  closedAtSec: number | null;
}

export interface SessionRest {
  afterSet: number;
  /** = end of the last rep of set `afterSet`. */
  startSec: number;
  /** = start of the first rep of the next set; null while resting. */
  endSec: number | null;
}

export type CompletionReason = 'target-sets' | 'rest-timeout' | 'manual';

export interface SessionState {
  version: 1;
  config: SessionConfig;
  phase: SessionPhase;
  sets: SessionSet[];
  rests: SessionRest[];
  /** Reps seen in READY/REST that do not (yet) form a coherent sequence. */
  pending: RepEvent[];
  ignored: { reps: RepEvent[]; reason: 'isolated' | 'late' | 'duplicate'; atSec: number }[];
  watermarkSec: number;
  completion: { atSec: number; reason: CompletionReason } | null;
  log: { atSec: number; event: string; detail?: string }[];
}

export type SessionEvent = { type: 'rep'; rep: RepEvent } | { type: 'tick'; watermarkSec: number } | { type: 'finish'; atSec: number };

export function createSession(config: Partial<SessionConfig> = {}): SessionState {
  const cfg = { ...DEFAULT_SESSION_CONFIG, ...config };
  if (!(cfg.targetSets >= 1)) throw new Error('targetSets must be ≥ 1');
  if (!(cfg.minRepsToStartSet >= 1)) throw new Error('minRepsToStartSet must be ≥ 1');
  if (cfg.setEndConfirmSec < cfg.maxRepGapSec) throw new Error('setEndConfirmSec must be ≥ maxRepGapSec');
  return { version: 1, config: cfg, phase: 'READY', sets: [], rests: [], pending: [], ignored: [], watermarkSec: 0, completion: null, log: [] };
}

const lastOf = <T>(a: T[]): T | undefined => a[a.length - 1];

function lastSeenPeak(s: SessionState): number {
  const setPeak = lastOf(lastOf(s.sets)?.reps ?? [])?.peakSec ?? -Infinity;
  const pendPeak = lastOf(s.pending)?.peakSec ?? -Infinity;
  return Math.max(setPeak, pendPeak);
}

export function sessionReducer(state: SessionState, ev: SessionEvent): SessionState {
  if (state.phase === 'COMPLETE') {
    if (ev.type === 'rep') return { ...state, ignored: [...state.ignored, { reps: [ev.rep], reason: 'late', atSec: ev.rep.endSec }] };
    return state;
  }
  // Work on a structural copy so the reducer stays pure.
  const s: SessionState = {
    ...state,
    sets: state.sets.map((x) => ({ ...x, reps: [...x.reps] })),
    rests: state.rests.map((x) => ({ ...x })),
    pending: [...state.pending],
    ignored: [...state.ignored],
    log: [...state.log],
  };
  switch (ev.type) {
    case 'rep':
      onRep(s, ev.rep);
      break;
    case 'tick':
      s.watermarkSec = Math.max(s.watermarkSec, ev.watermarkSec);
      onTick(s);
      break;
    case 'finish':
      complete(s, Math.max(ev.atSec, s.watermarkSec), 'manual');
      break;
  }
  return s;
}

function onRep(s: SessionState, rep: RepEvent) {
  const cfg = s.config;
  if (rep.peakSec <= lastSeenPeak(s)) {
    s.ignored.push({ reps: [rep], reason: 'duplicate', atSec: rep.endSec });
    return;
  }
  const cur = lastOf(s.sets);
  if (s.phase === 'ACTIVE_SET' && cur) {
    if (rep.startSec - cur.endSec <= cfg.maxRepGapSec) {
      cur.reps.push(rep);
      cur.endSec = rep.endSec;
      return;
    }
    // A rep after a long gap proves the set had ended even if the watermark lagged.
    closeSet(s, cur.endSec + cfg.setEndConfirmSec);
    if ((s.phase as SessionPhase) === 'COMPLETE') {
      s.ignored.push({ reps: [rep], reason: 'late', atSec: rep.endSec });
      return;
    }
  }
  // READY or REST.
  const last = lastOf(s.sets);
  if (s.phase === 'REST' && last && s.pending.length === 0 && rep.startSec - last.endSec <= cfg.maxRepGapSec) {
    // The set had not really ended: revoke the rest.
    s.rests = s.rests.filter((r) => !(r.afterSet === last.index && r.endSec == null));
    last.reps.push(rep);
    last.endSec = rep.endSec;
    last.closed = false;
    last.closedAtSec = null;
    s.phase = 'ACTIVE_SET';
    s.log.push({ atSec: rep.endSec, event: 'rest-revoked', detail: `set ${last.index + 1} continued` });
    return;
  }
  const prev = lastOf(s.pending);
  if (prev && rep.startSec - prev.endSec > cfg.maxRepGapSec) {
    s.ignored.push({ reps: s.pending, reason: 'isolated', atSec: rep.startSec });
    s.log.push({ atSec: rep.startSec, event: 'ignored-isolated', detail: `${s.pending.length} rep(s)` });
    s.pending = [];
  }
  s.pending.push(rep);
  if (s.pending.length >= cfg.minRepsToStartSet) startSet(s);
}

function startSet(s: SessionState) {
  const reps = s.pending;
  s.pending = [];
  const index = s.sets.length;
  s.sets.push({ index, reps, startSec: reps[0].startSec, endSec: reps[reps.length - 1].endSec, closed: false, closedAtSec: null });
  const open = s.rests.find((r) => r.endSec == null);
  if (open) open.endSec = reps[0].startSec;
  s.phase = 'ACTIVE_SET';
  s.log.push({ atSec: reps[reps.length - 1].endSec, event: 'set-started', detail: `set ${index + 1}` });
}

function closeSet(s: SessionState, atSec: number) {
  const cur = lastOf(s.sets)!;
  cur.closed = true;
  cur.closedAtSec = atSec;
  s.log.push({ atSec, event: 'set-ended', detail: `set ${cur.index + 1}: ${cur.reps.length} reps` });
  if (s.sets.length >= s.config.targetSets) {
    complete(s, atSec, 'target-sets');
    return;
  }
  s.rests.push({ afterSet: cur.index, startSec: cur.endSec, endSec: null });
  s.phase = 'REST';
}

function onTick(s: SessionState) {
  const cfg = s.config;
  const w = s.watermarkSec;
  const cur = lastOf(s.sets);
  if (s.phase === 'ACTIVE_SET' && cur) {
    const isFinal = s.sets.length >= cfg.targetSets;
    if (w - cur.endSec >= (isFinal ? cfg.completeConfirmSec : cfg.setEndConfirmSec)) closeSet(s, w);
    return;
  }
  if (s.phase === 'REST' && cfg.maxRestSec != null) {
    const open = s.rests.find((r) => r.endSec == null);
    if (open && w - open.startSec >= cfg.maxRestSec) complete(s, w, 'rest-timeout');
  }
}

function complete(s: SessionState, atSec: number, reason: CompletionReason) {
  const cur = lastOf(s.sets);
  if (s.phase === 'ACTIVE_SET' && cur && !cur.closed) {
    cur.closed = true;
    cur.closedAtSec = atSec;
  }
  // An unfinished rest is not a rest between two sets.
  s.rests = s.rests.filter((r) => r.endSec != null);
  if (s.pending.length) {
    s.ignored.push({ reps: s.pending, reason: 'isolated', atSec });
    s.pending = [];
  }
  s.phase = 'COMPLETE';
  s.completion = { atSec, reason };
  s.log.push({ atSec, event: 'complete', detail: reason });
}

// ---------- read models ----------

export interface SessionSummary {
  phase: SessionPhase;
  sets: { index: number; reps: number; startSec: number; endSec: number; closed: boolean }[];
  rests: { afterSet: number; durationSec: number; ongoing: boolean }[];
  totalReps: number;
}

/** What the UI shows. `nowSec` (latest sample time) drives the live rest timer. */
export function summarize(s: SessionState, nowSec: number): SessionSummary {
  return {
    phase: s.phase,
    sets: s.sets.map((x) => ({ index: x.index, reps: x.reps.length, startSec: x.startSec, endSec: x.endSec, closed: x.closed })),
    rests: s.rests.map((r) => ({ afterSet: r.afterSet, durationSec: (r.endSec ?? Math.max(nowSec, r.startSec)) - r.startSec, ongoing: r.endSec == null })),
    totalReps: s.sets.reduce((a, x) => a + x.reps.length, 0),
  };
}

// ---------- persistence ----------

export function serializeSession(s: SessionState): string {
  return JSON.stringify(s);
}

export function restoreSession(text: string): SessionState {
  const o = JSON.parse(text);
  if (!o || o.version !== 1 || !Array.isArray(o.sets) || !['READY', 'ACTIVE_SET', 'REST', 'COMPLETE'].includes(o.phase)) {
    throw new Error('Not a valid session state');
  }
  return { ...o, config: { ...DEFAULT_SESSION_CONFIG, ...o.config } } as SessionState;
}
