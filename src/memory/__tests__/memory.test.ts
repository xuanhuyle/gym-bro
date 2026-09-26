import { catalogue } from '../../catalogue/catalogue';
import { emptyWeightBook, rememberWeight } from '../../catalogue/weightMemory';
import { createSession, RepEvent, sessionReducer, SessionState } from '../../session/machine';
import { makeSelection, newSessionRecord } from '../../session/record';
import { DEFAULT_DETECTOR_OPTIONS } from '../../session/windowedDetector';
import { fmtOneLine, fmtRests, fmtReps } from '../format';
import { buildHistory, compareEntries, entryFromSession, TrainingEntry } from '../history';
import { compareSessions, comparePeriods, previousComparable, machineMemory, muscleMemory, recentVariants, regionMemory, resumeWeight, variantMemory } from '../queries';

const V = {
  pulldownWide: 'lat_pulldown.machine.wide_overhand',
  pulldownClose: 'lat_pulldown.machine.close_neutral',
  rowMachine: 'seated_row.machine.neutral',
  rowCable: 'seated_row.cable.close_neutral',
  curlCable: 'biceps_curl.cable.straight_bar',
  legPress: 'leg_press.machine.standard',
  reverseFly: 'reverse_fly.pec_deck',
  chestFly: 'chest_fly.pec_deck',
};

let n = 0;
function entry(variantId: string, date: string, loadKg: number | null, reps: number[], restsSec: (number | null)[] = [], regionId?: string): TrainingEntry {
  const v = catalogue.variant(variantId);
  const ex = catalogue.exercise(v.exerciseId);
  return {
    id: `s${String(++n).padStart(3, '0')}`,
    date,
    variantId,
    exerciseId: v.exerciseId,
    equipmentId: v.equipmentId,
    regionId: regionId ?? ex.bodyRegionIds[0],
    loadKg,
    reps,
    restsSec,
    source: 'detected',
    labels: { region: '', exercise: ex.name, equipment: catalogue.equipment(v.equipmentId).name, variant: v.variantName },
  };
}

const NOW = new Date('2026-09-26T12:00:00Z');

// A small, realistic history (deliberately given out of order).
const H = buildHistoryFromEntries([
  entry(V.pulldownWide, '2026-09-19T18:00:00Z', 40, [12, 11, 10], [65, 72]),
  entry(V.rowCable, '2026-09-19T18:20:00Z', 50, [10, 10, 9], [80, 80]),
  entry(V.pulldownWide, '2026-09-12T18:00:00Z', 37.5, [12, 12, 11], [60, 60]),
  entry(V.pulldownClose, '2026-09-16T18:00:00Z', 45, [10, 10, 10], [70, 70]),
  entry(V.legPress, '2026-09-24T18:00:00Z', 120, [12, 12, 12], [90, 90]),
  entry(V.curlCable, '2026-09-25T18:00:00Z', 20, [12, 10, 8], [60, 60]),
  entry(V.pulldownWide, '2026-08-01T18:00:00Z', 35, [12, 12, 12], [60, 60]),
]);

function buildHistoryFromEntries(es: TrainingEntry[]) {
  return [...es].sort(compareEntries);
}

describe('exercise variant memory', () => {
  it('retrieves the most recent performance of the exact variant', () => {
    const m = variantMemory(H, V.pulldownWide, NOW);
    expect(m.last?.date).toBe('2026-09-19T18:00:00Z');
    expect(m.last?.loadKg).toBe(40);
    expect(m.last?.reps).toEqual([12, 11, 10]);
    expect(m.last?.restsSec).toEqual([65, 72]);
    expect(fmtOneLine(m.last!)).toBe('40 kg · 12/11/10');
    expect(fmtReps(m.last!.reps)).toBe('12 · 11 · 10');
    expect(fmtRests(m.last!.restsSec)).toBe('1:05 · 1:12');
  });

  it('finds the previous comparable session, skipping other grips and machines in between', () => {
    const m = variantMemory(H, V.pulldownWide, NOW);
    expect(m.previous?.date).toBe('2026-09-12T18:00:00Z'); // not the close-grip session of 16 Sep
    expect(m.previous?.loadKg).toBe(37.5);
    expect(m.change?.comparable).toBe(true);
    if (m.change?.comparable) {
      expect(m.change.diff.loadDeltaKg).toBe(2.5);
      expect(m.change.diff.totalRepsDelta).toBe(-2);
      expect(m.change.diff.repsDeltaBySet).toEqual([0, -1, -1]);
      expect(m.change.diff.meanRestDeltaSec).toBeCloseTo(8.5);
    }
    expect(m.sessionsTotal).toBe(3);
    expect(m.sessionsRecent).toBe(2); // 1 Aug is outside the last 30 days
    expect(m.recentLoadsKg.map((x) => x.kg)).toEqual([37.5, 40]);
  });

  it('for any given session, finds the comparable one just before it', () => {
    const mid = H.find((e) => e.date === '2026-09-12T18:00:00Z')!;
    const r = previousComparable(H, mid.id)!;
    expect(r.previous?.date).toBe('2026-08-01T18:00:00Z');
    expect(r.change?.comparable && r.change.diff.loadDeltaKg).toBe(2.5);
    const first = H.find((e) => e.date === '2026-08-01T18:00:00Z')!;
    expect(previousComparable(H, first.id)).toMatchObject({ previous: null, change: null });
    expect(previousComparable(H, 'missing')).toBeNull();
  });

  it('a variant done once has no previous and no comparison', () => {
    const m = variantMemory(H, V.legPress, NOW);
    expect(m.last?.loadKg).toBe(120);
    expect(m.previous).toBeNull();
    expect(m.change).toBeNull();
  });
});

describe('comparability', () => {
  it('never compares loads across different machines, even for the same exercise', () => {
    const rowMachine = entry(V.rowMachine, '2026-09-20T18:00:00Z', 60, [10, 10, 10]);
    const rowCable = H.find((e) => e.variantId === V.rowCable)!;
    const c = compareSessions(rowCable, rowMachine);
    expect(c.comparable).toBe(false);
    // …and variant memory for the cable row ignores the machine row entirely.
    const m = variantMemory([...H, rowMachine].sort(compareEntries), V.rowCable, NOW);
    expect(m.previous).toBeNull();
    expect(m.change).toBeNull();
  });

  it('never compares different variants on the same machine', () => {
    const wide = H.find((e) => e.variantId === V.pulldownWide)!;
    const close = H.find((e) => e.variantId === V.pulldownClose)!;
    expect(compareSessions(close, wide)).toEqual({ comparable: false, reason: expect.any(String) });
  });

  it('never uses another machine for the pre-filled weight', () => {
    const r = resumeWeight(H, null, catalogue.variant(V.rowMachine));
    expect(r).toBeNull(); // cable-row history exists but is a different machine
  });
});

describe('resume: weight restored from memory', () => {
  it('restores the last load of the exact variant from completed history', () => {
    const r = resumeWeight(H, null, catalogue.variant(V.pulldownWide));
    expect(r).toMatchObject({ kg: 40, kind: 'history' });
  });

  it('exact completed history wins over a weight chosen for an unfinished session', () => {
    const book = rememberWeight(emptyWeightBook(), catalogue.variant(V.pulldownWide), 42.5, '2026-09-25T10:00:00Z');
    expect(resumeWeight(H, book, catalogue.variant(V.pulldownWide))).toMatchObject({ kg: 40, kind: 'history' });
  });

  it('without completed history, uses the weight chosen last time for the same variant, labelled as such', () => {
    const book = rememberWeight(emptyWeightBook(), catalogue.variant(V.legPress), 100, '2026-09-25T10:00:00Z');
    expect(resumeWeight([], book, catalogue.variant(V.legPress))).toEqual({ kg: 100, kind: 'chosen-not-completed', at: '2026-09-25T10:00:00Z' });
  });

  it('falls back to another variant of the same exercise on the same machine, flagged as a fallback', () => {
    const history = H.filter((e) => e.variantId !== V.pulldownWide);
    const r = resumeWeight(history, null, catalogue.variant(V.pulldownWide));
    expect(r?.kind).toBe('fallback-other-variant');
    expect(r?.kg).toBe(45);
    if (r?.kind === 'fallback-other-variant') expect(r.entry.variantId).toBe(V.pulldownClose);
  });
});

describe('machine memory', () => {
  it('answers "what did I do last time on this machine?"', () => {
    const m = machineMemory(H, 'lat_pulldown_machine');
    expect(m.last?.variantId).toBe(V.pulldownWide);
    expect(m.last?.date).toBe('2026-09-19T18:00:00Z');
    expect(m.recent.map((e) => e.date)).toEqual(['2026-09-19T18:00:00Z', '2026-09-16T18:00:00Z', '2026-09-12T18:00:00Z', '2026-08-01T18:00:00Z']);
    expect(m.variants.map((v) => [v.variantId, v.sessions])).toEqual([
      [V.pulldownWide, 3],
      [V.pulldownClose, 1],
    ]);
  });

  it('a shared machine lists the different exercises done on it', () => {
    const m = machineMemory(H, 'cable_station');
    expect(m.variants.map((v) => v.variantId)).toEqual([V.curlCable, V.rowCable]);
  });

  it('an unused machine has no memory', () => {
    expect(machineMemory(H, 'hip_abduction_machine')).toEqual({ equipmentId: 'hip_abduction_machine', last: null, recent: [], variants: [] });
  });
});

describe('body-region memory', () => {
  it('last trained date', () => {
    expect(regionMemory(H, catalogue, 'back', NOW).lastTrained).toBe('2026-09-19T18:20:00Z');
    expect(regionMemory(H, catalogue, 'legs', NOW).lastTrained).toBe('2026-09-24T18:00:00Z');
    expect(regionMemory(H, catalogue, 'chest', NOW).lastTrained).toBeNull();
  });

  it('sessions and sets over the last 7 and 30 days', () => {
    const back = regionMemory(H, catalogue, 'back', NOW);
    // 7 days (after 19 Sep 12:00): pulldown 19 Sep + row 19 Sep. 30 days: + 12 Sep + 16 Sep. 1 Aug excluded.
    expect(back.windows).toEqual([
      { days: 7, sessions: 2, sets: 6 },
      { days: 30, sessions: 4, sets: 12 },
    ]);
    expect(back.recentExercises.map((x) => [x.variantId, x.sessions])).toEqual([
      [V.rowCable, 1],
      [V.pulldownWide, 2],
      [V.pulldownClose, 1],
    ]);
  });

  it('an exercise listed under two regions counts for both (from the catalogue)', () => {
    const h = [entry(V.reverseFly, '2026-09-25T10:00:00Z', 30, [15, 15, 15])];
    expect(regionMemory(h, catalogue, 'shoulders', NOW).lastTrained).toBe('2026-09-25T10:00:00Z');
    expect(regionMemory(h, catalogue, 'back', NOW).lastTrained).toBe('2026-09-25T10:00:00Z');
  });
});

describe('muscle memory', () => {
  it('keeps PRIMARY (direct) and SECONDARY (contributing) exposure separate', () => {
    const biceps = muscleMemory(H, catalogue, 'biceps', NOW);
    // Direct: the biceps curl (25 Sep). Contributing: pulldowns and cable row.
    expect(biceps.direct.lastDate).toBe('2026-09-25T18:00:00Z');
    expect(biceps.direct.windows).toEqual([
      { days: 7, sessions: 1, sets: 3 },
      { days: 30, sessions: 1, sets: 3 },
    ]);
    expect(biceps.direct.variants.map((v) => v.variantId)).toEqual([V.curlCable]);
    expect(biceps.contributing.lastDate).toBe('2026-09-19T18:20:00Z');
    expect(biceps.contributing.windows[1]).toEqual({ days: 30, sessions: 4, sets: 12 });
    expect(biceps.contributing.variants.map((v) => v.variantId)).not.toContain(V.curlCable);
  });

  it('a muscle never trained has empty exposure', () => {
    const m = muscleMemory(H, catalogue, 'gluteus_medius', NOW);
    expect(m.direct.lastDate).toBeNull();
    expect(m.contributing.lastDate).toBeNull();
    expect(m.direct.windows.every((w) => w.sessions === 0 && w.sets === 0)).toBe(true);
  });
});

describe('empty history', () => {
  it('every query answers cleanly', () => {
    expect(variantMemory([], V.pulldownWide, NOW)).toMatchObject({ last: null, previous: null, change: null, sessionsTotal: 0, sessionsRecent: 0, recentLoadsKg: [] });
    expect(machineMemory([], 'lat_pulldown_machine').last).toBeNull();
    expect(regionMemory([], catalogue, 'back', NOW)).toEqual({
      regionId: 'back',
      lastTrained: null,
      windows: [
        { days: 7, sessions: 0, sets: 0 },
        { days: 30, sessions: 0, sets: 0 },
      ],
      recentExercises: [],
    });
    expect(muscleMemory([], catalogue, 'latissimus', NOW).direct.lastDate).toBeNull();
    expect(resumeWeight([], null, catalogue.variant(V.pulldownWide))).toBeNull();
    expect(recentVariants([])).toEqual([]);
    expect(buildHistory([])).toEqual([]);
  });
});

describe('ordering and recency', () => {
  it('chronological ordering is deterministic whatever the input order; ties broken by id', () => {
    const a = entry(V.legPress, '2026-09-20T10:00:00Z', 100, [10]);
    const b = entry(V.curlCable, '2026-09-20T10:00:00Z', 20, [10]);
    const c = entry(V.pulldownWide, '2026-09-18T10:00:00Z', 40, [10]);
    const orders = [
      [a, b, c],
      [c, b, a],
      [b, a, c],
    ].map((xs) => [...xs].sort(compareEntries).map((e) => e.id));
    expect(orders[0]).toEqual([c.id, a.id, b.id]);
    expect(orders[1]).toEqual(orders[0]);
    expect(orders[2]).toEqual(orders[0]);
  });

  it('recent variants for quick reopen: distinct, newest first', () => {
    expect(recentVariants(H, 3).map((e) => e.variantId)).toEqual([V.curlCable, V.legPress, V.rowCable]);
  });

  it('period comparison: last 30 days vs the previous 30 days (counts only)', () => {
    const p = comparePeriods(H, (e) => e.variantId === V.pulldownWide, NOW, 30);
    expect(p.current).toMatchObject({ sessions: 2, sets: 6, reps: 68, lastDate: '2026-09-19T18:00:00Z' });
    expect(p.previous).toMatchObject({ sessions: 1, sets: 3, reps: 36, lastDate: '2026-08-01T18:00:00Z' });
  });
});

describe('history from saved sessions', () => {
  const rep = (t: number): RepEvent => ({ startSec: t, peakSec: t + 1, endSec: t + 2.5 });
  function completedState(counts: number[]): SessionState {
    let s = createSession({ targetSets: counts.length });
    let t = 0;
    counts.forEach((c, i) => {
      for (let k = 0; k < c; k++) s = sessionReducer(s, { type: 'rep', rep: rep(t + k * 3) });
      const end = t + (c - 1) * 3 + 2.5;
      s = sessionReducer(s, { type: 'tick', watermarkSec: end + (i === counts.length - 1 ? 20 : 10) });
      t = end + 60;
    });
    return s;
  }
  const record = (state: SessionState, status: 'complete' | 'in-progress', createdAt: string) => {
    const r = newSessionRecord(createdAt, makeSelection(catalogue, 'back', V.pulldownWide), 40, DEFAULT_DETECTOR_OPTIONS, state, createdAt);
    return { ...r, status };
  };

  it('uses detected counts when there is no correction, and marks the source', () => {
    const e = entryFromSession({ session: record(completedState([10, 12, 9]), 'complete', '2026-09-19T18:00:00Z'), userReported: null })!;
    expect(e.reps).toEqual([10, 12, 9]);
    expect(e.source).toBe('detected');
    expect(e.restsSec.map((r) => Math.round(r!))).toEqual([60, 60]);
    expect(e.loadKg).toBe(40);
  });

  it('the user correction wins over detection, but rests the user did not enter are kept only if sets line up', () => {
    const state = completedState([10, 12, 9]);
    const same = entryFromSession({ session: record(state, 'complete', 'x'), userReported: { sets: [{ reps: 10 }, { reps: 11 }, { reps: 9 }], restsSec: [null, 75], notes: '', updatedAt: '' } })!;
    expect(same.source).toBe('corrected');
    expect(same.reps).toEqual([10, 11, 9]);
    expect(same.restsSec.map((r) => (r == null ? null : Math.round(r)))).toEqual([60, 75]);
    const different = entryFromSession({ session: record(state, 'complete', 'x'), userReported: { sets: [{ reps: 10 }, { reps: 12 }], restsSec: [], notes: '', updatedAt: '' } })!;
    expect(different.reps).toEqual([10, 12]);
    expect(different.restsSec).toEqual([null]);
  });

  it('a corrected weight replaces the recorded one in memory', () => {
    const e = entryFromSession({
      session: record(completedState([10, 10, 10]), 'complete', 'x'),
      userReported: { sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }], restsSec: [], loadKg: 42.5, notes: '', updatedAt: '' },
    })!;
    expect(e.loadKg).toBe(42.5);
    const kept = entryFromSession({ session: record(completedState([10, 10, 10]), 'complete', 'x'), userReported: { sets: [{ reps: 10 }], restsSec: [], notes: '', updatedAt: '' } })!;
    expect(kept.loadKg).toBe(40);
  });

  it('interrupted sessions are not part of the memory', () => {
    const h = buildHistory([
      { session: record(completedState([10, 10, 10]), 'complete', '2026-09-19T18:00:00Z'), userReported: null },
      { session: record(createSession(), 'in-progress', '2026-09-20T18:00:00Z'), userReported: null },
    ]);
    expect(h).toHaveLength(1);
    expect(h[0].date).toBe('2026-09-19T18:00:00Z');
  });
});
