/**
 * Last-used weight per exercise variant. Pure logic over a plain JSON object
 * so it can be persisted anywhere (see storage) and tested without a device.
 */

export interface WeightEntry {
  kg: number;
  /** ISO time of use. */
  at: string;
  exerciseId: string;
  equipmentId: string;
}

export interface WeightBook {
  version: 1;
  byVariant: Record<string, WeightEntry>;
}

export function emptyWeightBook(): WeightBook {
  return { version: 1, byVariant: {} };
}

export function rememberWeight(book: WeightBook, variant: { id: string; exerciseId: string; equipmentId: string }, kg: number, at: string): WeightBook {
  if (!Number.isFinite(kg) || kg < 0) return book;
  return { ...book, byVariant: { ...book.byVariant, [variant.id]: { kg, at, exerciseId: variant.exerciseId, equipmentId: variant.equipmentId } } };
}

/**
 * Most recent weight for this exact variant; otherwise the most recent weight
 * for the same exercise on the same machine (e.g. another grip); otherwise null.
 */
export function lastWeight(book: WeightBook, variant: { id: string; exerciseId: string; equipmentId: string }): { kg: number; exact: boolean } | null {
  const exact = book.byVariant[variant.id];
  if (exact) return { kg: exact.kg, exact: true };
  const same = Object.values(book.byVariant)
    .filter((e) => e.exerciseId === variant.exerciseId && e.equipmentId === variant.equipmentId)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return same ? { kg: same.kg, exact: false } : null;
}

export function parseWeightBook(text: string | null): WeightBook {
  if (!text) return emptyWeightBook();
  try {
    const o = JSON.parse(text);
    return o && o.version === 1 && o.byVariant && typeof o.byVariant === 'object' ? (o as WeightBook) : emptyWeightBook();
  } catch {
    return emptyWeightBook();
  }
}
