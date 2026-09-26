/** Compact, deterministic formatting of memory facts for the UI. */

import { TrainingEntry } from './history';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "19 Sep" (local time); adds the year when it differs from `now`. */
export function fmtDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "today", "yesterday", "5 days ago", "3 weeks ago". */
export function fmtAgo(iso: string, now: Date = new Date()): string {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(new Date(iso))) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export const fmtKg = (kg: number | null) => (kg == null ? '— kg' : `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`);

/** "12 · 11 · 10" */
export const fmtReps = (reps: number[]) => (reps.length ? reps.join(' · ') : '—');

/** "1:05" */
export function fmtRest(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '?';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtRests = (rests: (number | null)[]) => (rests.length ? rests.map(fmtRest).join(' · ') : '—');

export const fmtSigned = (n: number, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Number.isInteger(n) ? n : Number(n.toFixed(1)))}${unit}`;

/** "40 kg · 12/11/10" — the one-line recall next to the weight field. */
export const fmtOneLine = (e: TrainingEntry) => `${fmtKg(e.loadKg)} · ${e.reps.join('/') || '—'}`;
