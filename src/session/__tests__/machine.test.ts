/**
 * Session state machine tests with scripted rep events (no signal processing):
 * they pin down the product rules for Set → Rest → Set → … → Complete.
 */
import { createSession, DEFAULT_SESSION_CONFIG, RepEvent, restoreSession, serializeSession, SessionEvent, sessionReducer, SessionState, summarize } from '../machine';

const REP_DUR = 2.5;
const PERIOD = 3; // rep every 3 s → 0.5 s gap between reps
const rep = (startSec: number, dur = REP_DUR): RepEvent => ({ startSec, peakSec: startSec + dur * 0.45, endSec: startSec + dur });

function run(s: SessionState, events: SessionEvent[]): SessionState {
  return events.reduce(sessionReducer, s);
}
/** n reps from t0, each followed by a watermark tick as a live detector would send. */
function setOf(t0: number, n: number): SessionEvent[] {
  const ev: SessionEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = rep(t0 + i * PERIOD);
    ev.push({ type: 'rep', rep: r }, { type: 'tick', watermarkSec: r.endSec });
  }
  return ev;
}
const lastEnd = (t0: number, n: number) => t0 + (n - 1) * PERIOD + REP_DUR;
const tick = (w: number): SessionEvent => ({ type: 'tick', watermarkSec: w });
const reps = (s: SessionState) => s.sets.map((x) => x.reps.length);

describe('Set 1 → REST', () => {
  it('starts in READY, becomes ACTIVE_SET with the reps, and enters REST only after the inactivity confirmation', () => {
    let s = createSession();
    expect(s.phase).toBe('READY');
    s = run(s, setOf(10, 10));
    expect(s.phase).toBe('ACTIVE_SET');
    expect(reps(s)).toEqual([10]);
    const end = lastEnd(10, 10);
    s = run(s, [tick(end + DEFAULT_SESSION_CONFIG.setEndConfirmSec - 0.1)]);
    expect(s.phase).toBe('ACTIVE_SET');
    s = run(s, [tick(end + DEFAULT_SESSION_CONFIG.setEndConfirmSec)]);
    expect(s.phase).toBe('REST');
    expect(s.sets[0].closed).toBe(true);
  });

  it('times the rest from the end of the last valid rep, not from the confirmation', () => {
    const end = lastEnd(10, 10);
    const confirmAt = end + DEFAULT_SESSION_CONFIG.setEndConfirmSec;
    const s = run(createSession(), [...setOf(10, 10), tick(confirmAt)]);
    expect(s.rests).toEqual([{ afterSet: 0, startSec: end, endSec: null }]);
    expect(s.sets[0].endSec).toBe(end);
    expect(s.sets[0].closedAtSec).toBe(confirmAt);
    // Live timer 47 s after the last rep shows 47 s, although REST was confirmed 10 s after it.
    expect(summarize(s, end + 47).rests[0]).toEqual({ afterSet: 0, durationSec: 47, ongoing: true });
  });
});

describe('REST → Set 2', () => {
  const set1End = lastEnd(10, 10);
  const inRest = () => run(createSession(), [...setOf(10, 10), tick(set1End + 10)]);

  it('a coherent sequence starts Set 2 and its first rep belongs to Set 2', () => {
    const t2 = set1End + 47;
    let s = run(inRest(), [{ type: 'rep', rep: rep(t2) }]);
    expect(s.phase).toBe('REST'); // one movement is not yet a set
    s = run(s, [{ type: 'rep', rep: rep(t2 + PERIOD) }]);
    expect(s.phase).toBe('ACTIVE_SET');
    expect(reps(s)).toEqual([10, 2]);
    expect(s.sets[1].reps[0].startSec).toBe(t2);
    expect(s.rests[0]).toEqual({ afterSet: 0, startSec: set1End, endSec: t2 });
    expect(summarize(s, t2 + 100).rests[0].durationSec).toBe(47);
  });

  it('an isolated movement during rest does not start a set and does not count', () => {
    let s = run(inRest(), [{ type: 'rep', rep: rep(set1End + 20) }, tick(set1End + 40), tick(set1End + 120)]);
    expect(s.phase).toBe('REST');
    expect(s.sets).toHaveLength(1);
    // The real set 2 starts later: the bump is dropped, not merged.
    const t2 = set1End + 60;
    s = run(s, setOf(t2, 12));
    expect(reps(s)).toEqual([10, 12]);
    expect(s.sets[1].startSec).toBe(t2);
    expect(s.rests[0].endSec).toBe(t2);
    expect(s.ignored.filter((i) => i.reason === 'isolated').flatMap((i) => i.reps)).toHaveLength(1);
  });

  it('two bumps far apart are still not a coherent sequence', () => {
    const s = run(inRest(), [{ type: 'rep', rep: rep(set1End + 15) }, { type: 'rep', rep: rep(set1End + 30) }, tick(set1End + 40)]);
    expect(s.phase).toBe('REST');
    expect(s.sets).toHaveLength(1);
  });

  it('a slow rep that arrives after REST was confirmed but continues the set reopens it', () => {
    const cfg = { maxRepGapSec: 6, setEndConfirmSec: 6 };
    let s = run(createSession(cfg), [...setOf(0, 5), tick(lastEnd(0, 5) + 6)]);
    expect(s.phase).toBe('REST');
    s = run(s, [{ type: 'rep', rep: rep(lastEnd(0, 5) + 5, 4) }]);
    expect(s.phase).toBe('ACTIVE_SET');
    expect(reps(s)).toEqual([6]);
    expect(s.rests).toEqual([]);
  });
});

describe('automatic completion', () => {
  function threeSets(config = {}) {
    const c = { ...DEFAULT_SESSION_CONFIG, ...config };
    let s = createSession(config);
    let t = 10;
    const counts = [10, 12, 15];
    const rests = [47, 72];
    counts.forEach((n, i) => {
      s = run(s, setOf(t, n));
      const end = lastEnd(t, n);
      s = run(s, [tick(end + (i === counts.length - 1 ? c.completeConfirmSec : c.setEndConfirmSec))]);
      t = end + (rests[i] ?? 0);
    });
    return s;
  }

  it('three sets lead to COMPLETE with the right sets, reps and rests', () => {
    const s = threeSets();
    expect(s.phase).toBe('COMPLETE');
    expect(s.completion?.reason).toBe('target-sets');
    const sum = summarize(s, 1e6);
    expect(sum.sets.map((x) => x.reps)).toEqual([10, 12, 15]);
    expect(sum.rests.map((r) => r.durationSec)).toEqual([47, 72]);
    expect(sum.rests.every((r) => !r.ongoing)).toBe(true);
    expect(sum.totalReps).toBe(37);
  });

  it('the final set waits for the longer completion confirmation', () => {
    let s = createSession();
    let t = 0;
    let end3 = 0;
    for (let i = 0; i < 3; i++) {
      s = run(s, setOf(t, 5));
      const end = lastEnd(t, 5);
      if (i < 2) s = run(s, [tick(end + 10)]);
      end3 = end;
      t = end + 30;
    }
    s = run(s, [tick(end3 + DEFAULT_SESSION_CONFIG.setEndConfirmSec)]);
    expect(s.phase).toBe('ACTIVE_SET');
    s = run(s, [tick(end3 + DEFAULT_SESSION_CONFIG.completeConfirmSec)]);
    expect(s.phase).toBe('COMPLETE');
  });

  it('reps after completion are ignored', () => {
    const s = run(threeSets(), setOf(10000, 3));
    expect(reps(s)).toEqual([10, 12, 15]);
    expect(s.ignored.some((i) => i.reason === 'late')).toBe(true);
  });

  it('supports more than three sets through configuration', () => {
    let s = createSession({ targetSets: 5 });
    let t = 0;
    for (let i = 0; i < 5; i++) {
      expect(s.phase).not.toBe('COMPLETE');
      s = run(s, setOf(t, 6 + i));
      const end = lastEnd(t, 6 + i);
      s = run(s, [tick(end + (i === 4 ? 20 : 10))]);
      t = end + 30;
    }
    expect(s.phase).toBe('COMPLETE');
    expect(reps(s)).toEqual([6, 7, 8, 9, 10]);
    expect(s.rests).toHaveLength(4);
  });

  it('manual finish keeps the sets done so far', () => {
    let s = run(createSession(), [...setOf(0, 8), tick(lastEnd(0, 8) + 10)]);
    s = run(s, [{ type: 'finish', atSec: 60 }]);
    expect(s.phase).toBe('COMPLETE');
    expect(s.completion?.reason).toBe('manual');
    expect(reps(s)).toEqual([8]);
    expect(s.rests).toEqual([]); // an unfinished rest is not a rest between sets
  });

  it('a very long rest completes the exercise', () => {
    const end = lastEnd(0, 8);
    const s = run(createSession({ maxRestSec: 300 }), [...setOf(0, 8), tick(end + 10), tick(end + 300)]);
    expect(s.completion?.reason).toBe('rest-timeout');
  });
});

describe('persistence', () => {
  it('provisional sets survive serialise → reload, and the session continues identically', () => {
    const t2 = lastEnd(10, 10) + 40;
    const firstHalf: SessionEvent[] = [...setOf(10, 10), tick(lastEnd(10, 10) + 10), { type: 'rep', rep: rep(t2) }];
    const secondHalf: SessionEvent[] = [...setOf(t2 + PERIOD, 11), tick(lastEnd(t2, 12) + 10), ...setOf(lastEnd(t2, 12) + 60, 15), tick(lastEnd(lastEnd(t2, 12) + 60, 15) + 20)];

    const mid = run(createSession(), firstHalf);
    expect(mid.phase).toBe('REST');
    expect(mid.pending).toHaveLength(1);
    const reloaded = restoreSession(serializeSession(mid));
    expect(reloaded).toEqual(mid);

    const continued = run(reloaded, secondHalf);
    const uninterrupted = run(createSession(), [...firstHalf, ...secondHalf]);
    expect(continued).toEqual(uninterrupted);
    expect(reps(continued)).toEqual([10, 12, 15]);
    expect(continued.phase).toBe('COMPLETE');
  });

  it('rejects files that are not session states', () => {
    expect(() => restoreSession('{"version":2}')).toThrow();
  });
});

describe('input hygiene', () => {
  it('the same rep delivered twice is counted once', () => {
    const r = rep(0);
    const s = run(createSession(), [{ type: 'rep', rep: r }, { type: 'rep', rep: r }, { type: 'rep', rep: rep(3) }]);
    expect(reps(s)).toEqual([2]);
  });
  it('refuses inconsistent configuration', () => {
    expect(() => createSession({ targetSets: 0 })).toThrow();
    expect(() => createSession({ maxRepGapSec: 8, setEndConfirmSec: 5 })).toThrow();
  });
  it('the reducer does not mutate its input', () => {
    const s0 = run(createSession(), setOf(0, 3));
    const copy = JSON.parse(JSON.stringify(s0));
    sessionReducer(s0, { type: 'rep', rep: rep(9) });
    sessionReducer(s0, tick(100));
    expect(s0).toEqual(copy);
  });
});
