/**
 * Training-memory queries: "what did I do before?" for an exercise variant, a
 * machine, a body region or a muscle, plus the comparison primitive
 * (a session / period vs the previous comparable one).
 *
 * Pure and deterministic: every query takes the history (from buildHistory)
 * and, where time windows matter, an explicit `now`.
 *
 * Comparability rule: load and performance are only compared between sessions
 * of the SAME ExerciseVariant (which fixes exercise, machine and variant).
 * Kilograms on different machines or mechanically different variants are
 * never compared. Region and muscle memory are factual counts only — no scores.
 */

import { Catalogue } from '../catalogue/catalogue';
import { WeightBook } from '../catalogue/weightMemory';
import { compareEntries, setCount, totalReps, TrainingEntry } from './history';

const DAY_MS = 86_400_000;

function within(e: TrainingEntry, now: Date, days: number): boolean {
  const t = Date.parse(e.date);
  return t <= now.getTime() && t > now.getTime() - days * DAY_MS;
}

/** Newest first (reverse of the chronological history), deterministic. */
function newestFirst(entries: TrainingEntry[]): TrainingEntry[] {
  return [...entries].sort((a, b) => compareEntries(b, a));
}

// ---------------- exercise variant ----------------

export interface SessionDiff {
  /** Later minus earlier. null when either load is unknown. */
  loadDeltaKg: number | null;
  setCountDelta: number;
  totalRepsDelta: number;
  /** Per set index present in both. */
  repsDeltaBySet: number[];
  /** Mean known rest, later minus earlier; null if either has no known rest. */
  meanRestDeltaSec: number | null;
}

export type Comparison = { comparable: true; earlier: TrainingEntry; later: TrainingEntry; diff: SessionDiff } | { comparable: false; reason: string };

function meanRest(e: TrainingEntry): number | null {
  const known = e.restsSec.filter((r): r is number => r != null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

/** Compares two sessions only if they are the same exercise variant (same exercise, machine and variant). */
export function compareSessions(earlier: TrainingEntry, later: TrainingEntry): Comparison {
  if (earlier.variantId !== later.variantId) {
    return { comparable: false, reason: 'Different exercise variant or machine — loads are not comparable.' };
  }
  const [a, b] = compareEntries(earlier, later) <= 0 ? [earlier, later] : [later, earlier];
  const n = Math.min(a.reps.length, b.reps.length);
  const ra = meanRest(a);
  const rb = meanRest(b);
  return {
    comparable: true,
    earlier: a,
    later: b,
    diff: {
      loadDeltaKg: a.loadKg != null && b.loadKg != null ? b.loadKg - a.loadKg : null,
      setCountDelta: setCount(b) - setCount(a),
      totalRepsDelta: totalReps(b) - totalReps(a),
      repsDeltaBySet: Array.from({ length: n }, (_, i) => b.reps[i] - a.reps[i]),
      meanRestDeltaSec: ra != null && rb != null ? rb - ra : null,
    },
  };
}

export interface VariantMemory {
  variantId: string;
  last: TrainingEntry | null;
  /** The comparable session before `last` (same variant), if any. */
  previous: TrainingEntry | null;
  /** last vs previous, when both exist. */
  change: Comparison | null;
  sessionsTotal: number;
  sessionsRecent: number;
  recentDays: number;
  /** Chronological loads of the recent comparable sessions (for a simple progression line). */
  recentLoadsKg: { date: string; kg: number }[];
}

export function variantMemory(history: TrainingEntry[], variantId: string, now: Date, recentDays = 30): VariantMemory {
  const same = history.filter((e) => e.variantId === variantId).sort(compareEntries);
  const last = same[same.length - 1] ?? null;
  const previous = same.length >= 2 ? same[same.length - 2] : null;
  const recent = same.filter((e) => within(e, now, recentDays));
  return {
    variantId,
    last,
    previous,
    change: last && previous ? compareSessions(previous, last) : null,
    sessionsTotal: same.length,
    sessionsRecent: recent.length,
    recentDays,
    recentLoadsKg: recent.filter((e) => e.loadKg != null).map((e) => ({ date: e.date, kg: e.loadKg! })),
  };
}

// ---------------- resume: weight to pre-fill ----------------

export type ResumeWeight =
  | { kg: number; kind: 'history'; entry: TrainingEntry }
  | { kg: number; kind: 'chosen-not-completed'; at: string }
  | { kg: number; kind: 'fallback-other-variant'; entry: TrainingEntry }
  | null;

/**
 * Weight to pre-fill, as a memory feature. Priority:
 *  1. last COMPLETED session of this exact variant;
 *  2. only if there is no completed session: the weight chosen for this exact
 *     variant in a session that did not complete (weight book) — labelled as such;
 *  3. FALLBACK: last completed session of the same exercise on the same machine
 *     with another variant — must be shown as a fallback, never as "last time".
 */
export function resumeWeight(history: TrainingEntry[], book: WeightBook | null, variant: { id: string; exerciseId: string; equipmentId: string }): ResumeWeight {
  const exact = history.filter((e) => e.variantId === variant.id && e.loadKg != null).sort(compareEntries);
  const lastExact = exact[exact.length - 1];
  const booked = book?.byVariant[variant.id];
  if (lastExact) return { kg: lastExact.loadKg!, kind: 'history', entry: lastExact };
  if (booked) return { kg: booked.kg, kind: 'chosen-not-completed', at: booked.at };
  const sibling = history
    .filter((e) => e.exerciseId === variant.exerciseId && e.equipmentId === variant.equipmentId && e.variantId !== variant.id && e.loadKg != null)
    .sort(compareEntries);
  const s = sibling[sibling.length - 1];
  return s ? { kg: s.loadKg!, kind: 'fallback-other-variant', entry: s } : null;
}

// ---------------- machine ----------------

export interface MachineMemory {
  equipmentId: string;
  last: TrainingEntry | null;
  /** Most recent sessions on this machine, newest first (any exercise/variant). */
  recent: TrainingEntry[];
  /** Distinct variants done on this machine, most recent first, with their last session. */
  variants: { variantId: string; last: TrainingEntry; sessions: number }[];
}

export function machineMemory(history: TrainingEntry[], equipmentId: string, recentLimit = 5): MachineMemory {
  const on = newestFirst(history.filter((e) => e.equipmentId === equipmentId));
  const variants: MachineMemory['variants'] = [];
  for (const e of on) {
    const v = variants.find((x) => x.variantId === e.variantId);
    if (v) v.sessions++;
    else variants.push({ variantId: e.variantId, last: e, sessions: 1 });
  }
  return { equipmentId, last: on[0] ?? null, recent: on.slice(0, recentLimit), variants };
}

// ---------------- body region ----------------

export interface ExposureWindow {
  days: number;
  sessions: number;
  sets: number;
}

export interface RegionMemory {
  regionId: string;
  lastTrained: string | null;
  windows: ExposureWindow[];
  /** Exercises that trained this region recently, most recent first. */
  recentExercises: { exerciseId: string; variantId: string; lastDate: string; sessions: number }[];
}

/** An entry trains a region when its exercise belongs to that region in the catalogue. */
export function regionMemory(history: TrainingEntry[], cat: Catalogue, regionId: string, now: Date, windowsDays = [7, 30]): RegionMemory {
  const inRegion = history.filter((e) => cat.exercise(e.exerciseId).bodyRegionIds.includes(regionId) && Date.parse(e.date) <= now.getTime());
  const nf = newestFirst(inRegion);
  const maxDays = Math.max(...windowsDays);
  const recentExercises: RegionMemory['recentExercises'] = [];
  for (const e of nf.filter((x) => within(x, now, maxDays))) {
    const r = recentExercises.find((x) => x.variantId === e.variantId);
    if (r) r.sessions++;
    else recentExercises.push({ exerciseId: e.exerciseId, variantId: e.variantId, lastDate: e.date, sessions: 1 });
  }
  return {
    regionId,
    lastTrained: nf[0]?.date ?? null,
    windows: windowsDays.map((days) => {
      const w = inRegion.filter((e) => within(e, now, days));
      return { days, sessions: w.length, sets: w.reduce((a, e) => a + setCount(e), 0) };
    }),
    recentExercises,
  };
}

// ---------------- muscle ----------------

export interface MuscleRoleExposure {
  lastDate: string | null;
  windows: ExposureWindow[];
  /** Variants responsible for this exposure within the largest window, most recent first. */
  variants: { variantId: string; exerciseId: string; sessions: number; sets: number }[];
}

export interface MuscleMemory {
  muscleId: string;
  /** Sessions where the muscle is a PRIMARY (direct) mover. */
  direct: MuscleRoleExposure;
  /** Sessions where it is SECONDARY (contributing). Never merged with direct. */
  contributing: MuscleRoleExposure;
}

export function muscleMemory(history: TrainingEntry[], cat: Catalogue, muscleId: string, now: Date, windowsDays = [7, 30]): MuscleMemory {
  const role = (e: TrainingEntry) => cat.variant(e.variantId).contributions.find((c) => c.muscleId === muscleId)?.role ?? null;
  const past = history.filter((e) => Date.parse(e.date) <= now.getTime());
  const exposure = (r: 'primary' | 'secondary'): MuscleRoleExposure => {
    const es = newestFirst(past.filter((e) => role(e) === r));
    const maxDays = Math.max(...windowsDays);
    const variants: MuscleRoleExposure['variants'] = [];
    for (const e of es.filter((x) => within(x, now, maxDays))) {
      const v = variants.find((x) => x.variantId === e.variantId);
      if (v) {
        v.sessions++;
        v.sets += setCount(e);
      } else variants.push({ variantId: e.variantId, exerciseId: e.exerciseId, sessions: 1, sets: setCount(e) });
    }
    return {
      lastDate: es[0]?.date ?? null,
      windows: windowsDays.map((days) => {
        const w = es.filter((e) => within(e, now, days));
        return { days, sessions: w.length, sets: w.reduce((a, e) => a + setCount(e), 0) };
      }),
      variants,
    };
  };
  return { muscleId, direct: exposure('primary'), contributing: exposure('secondary') };
}

// ---------------- recent variants (quick reopen) ----------------

/** Distinct exercise variants, most recently done first. */
export function recentVariants(history: TrainingEntry[], limit = 5): TrainingEntry[] {
  const seen = new Set<string>();
  const out: TrainingEntry[] = [];
  for (const e of newestFirst(history)) {
    if (seen.has(e.variantId)) continue;
    seen.add(e.variantId);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------- period comparison primitive ----------------

export interface PeriodStats {
  from: string;
  to: string;
  sessions: number;
  sets: number;
  reps: number;
  lastDate: string | null;
}

/**
 * The central longitudinal primitive: a period vs the previous period of the
 * same length, over the entries selected by `filter` (a variant, a region, a
 * muscle…). Counts only; load is deliberately not aggregated across entries,
 * because the filter may mix non-comparable variants.
 */
export function comparePeriods(history: TrainingEntry[], filter: (e: TrainingEntry) => boolean, now: Date, days: number): { current: PeriodStats; previous: PeriodStats } {
  const stats = (endMs: number): PeriodStats => {
    const startMs = endMs - days * DAY_MS;
    const es = history.filter((e) => filter(e) && Date.parse(e.date) > startMs && Date.parse(e.date) <= endMs).sort(compareEntries);
    return {
      from: new Date(startMs).toISOString(),
      to: new Date(endMs).toISOString(),
      sessions: es.length,
      sets: es.reduce((a, e) => a + setCount(e), 0),
      reps: es.reduce((a, e) => a + totalReps(e), 0),
      lastDate: es[es.length - 1]?.date ?? null,
    };
  };
  return { current: stats(now.getTime()), previous: stats(now.getTime() - days * DAY_MS) };
}

/** For a given session: the comparable session immediately before it (same variant), and the diff. */
export function previousComparable(history: TrainingEntry[], entryId: string): { entry: TrainingEntry; previous: TrainingEntry | null; change: Comparison | null } | null {
  const entry = history.find((e) => e.id === entryId);
  if (!entry) return null;
  const earlier = history.filter((e) => e.variantId === entry.variantId && compareEntries(e, entry) < 0).sort(compareEntries);
  const previous = earlier[earlier.length - 1] ?? null;
  return { entry, previous, change: previous ? compareSessions(previous, entry) : null };
}
