import { catalogue } from '../catalogue';
import { emptyWeightBook, lastWeight, parseWeightBook, rememberWeight } from '../weightMemory';

const wide = catalogue.variant('lat_pulldown.machine.wide_overhand');
const close = catalogue.variant('lat_pulldown.machine.close_neutral');
const legPress = catalogue.variant('leg_press.machine.standard');

describe('last-used weight', () => {
  it('is empty at first', () => {
    expect(lastWeight(emptyWeightBook(), wide)).toBeNull();
  });

  it('remembers the latest weight per exercise variant and survives persistence', () => {
    let book = rememberWeight(emptyWeightBook(), wide, 35, '2026-09-01T10:00:00Z');
    book = rememberWeight(book, wide, 37.5, '2026-09-08T10:00:00Z');
    book = rememberWeight(book, legPress, 80, '2026-09-08T10:05:00Z');
    const reloaded = parseWeightBook(JSON.stringify(book));
    expect(lastWeight(reloaded, wide)).toEqual({ kg: 37.5, exact: true });
    expect(lastWeight(reloaded, legPress)).toEqual({ kg: 80, exact: true });
  });

  it('falls back to the same exercise on the same machine (other grip), flagged as not exact', () => {
    const book = rememberWeight(emptyWeightBook(), wide, 35, '2026-09-01T10:00:00Z');
    expect(lastWeight(book, close)).toEqual({ kg: 35, exact: false });
    expect(lastWeight(book, legPress)).toBeNull();
  });

  it('ignores invalid weights and corrupt files', () => {
    expect(rememberWeight(emptyWeightBook(), wide, NaN, 'x')).toEqual(emptyWeightBook());
    expect(rememberWeight(emptyWeightBook(), wide, -5, 'x')).toEqual(emptyWeightBook());
    expect(parseWeightBook('{not json')).toEqual(emptyWeightBook());
    expect(parseWeightBook(null)).toEqual(emptyWeightBook());
  });
});
