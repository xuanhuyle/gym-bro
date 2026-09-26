import { zigzag } from '../zigzag';

describe('zigzag', () => {
  it('finds alternating extrema of a sine and ignores sub-threshold wiggles', () => {
    const x = Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100) + 0.05 * Math.sin((2 * Math.PI * i) / 7));
    const tps = zigzag(x, 0.5);
    for (let k = 1; k < tps.length; k++) expect(tps[k].kind).not.toBe(tps[k - 1].kind);
    // 10 full periods → 10 confirmed peaks; the data end may add one unconfirmed point.
    expect(tps.filter((t) => t.kind === 'peak' && t.confirmed)).toHaveLength(10);
    expect(tps.slice(0, -1).every((t) => t.confirmed)).toBe(true);
    for (const t of tps.filter((p) => p.kind === 'peak' && p.confirmed)) expect(t.value).toBeGreaterThan(0.9);
  });

  it('returns nothing for a signal that never moves by the threshold', () => {
    expect(zigzag([0, 0.1, 0, 0.1, 0], 0.5)).toEqual([]);
  });

  it('every consecutive pair differs by at least the threshold', () => {
    const x = Array.from({ length: 2000 }, (_, i) => Math.sin(i / 17) * (1 + Math.sin(i / 300)) + ((i * 7919) % 13) / 100);
    const tps = zigzag(x, 0.3);
    for (let k = 1; k < tps.length; k++) expect(Math.abs(tps[k].value - tps[k - 1].value)).toBeGreaterThanOrEqual(0.3);
  });
});
