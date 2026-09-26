import { butter2, cumtrapz, filtfilt, highpass, lowpass, median, movingRms, percentile } from '../dsp';

const fs = 50;
const sine = (f: number, n: number, amp = 1) => Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / fs));
const rms = (x: ArrayLike<number>, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};

describe('butterworth filters', () => {
  it('low-pass passes DC and high-pass blocks it', () => {
    const dc = new Float64Array(500).fill(3);
    expect(lowpass(dc, 2, fs)[250]).toBeCloseTo(3, 6);
    expect(Math.abs(highpass(dc, 0.5, fs)[250])).toBeLessThan(1e-6);
  });

  it('zero-phase filtering gives -6 dB (0.5 amplitude) at the cutoff', () => {
    const x = sine(2, 5000);
    const y = filtfilt(butter2('low', 2, fs), x);
    expect(rms(y, 1000, 4000) / rms(x, 1000, 4000)).toBeCloseTo(0.5, 1);
  });

  it('passes the band and rejects far stop-band', () => {
    expect(rms(lowpass(sine(0.5, 5000), 5, fs), 1000, 4000) / rms(sine(0.5, 5000), 1000, 4000)).toBeGreaterThan(0.99);
    expect(rms(lowpass(sine(20, 5000), 2, fs), 1000, 4000)).toBeLessThan(0.01);
  });

  it('is zero-phase: a pulse peak stays where it was', () => {
    const x = new Float64Array(1000);
    for (let i = 0; i < 1000; i++) x[i] = Math.exp(-(((i - 500) / 20) ** 2));
    const y = lowpass(x, 3, fs);
    let arg = 0;
    for (let i = 0; i < 1000; i++) if (y[i] > y[arg]) arg = i;
    expect(Math.abs(arg - 500)).toBeLessThanOrEqual(1);
  });
});

describe('helpers', () => {
  it('cumtrapz integrates a constant into a ramp', () => {
    const y = cumtrapz(new Float64Array(101).fill(2), 0.1);
    expect(y[100]).toBeCloseTo(20, 9);
  });
  it('percentile / median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(percentile([0, 10], 25)).toBeCloseTo(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
  it('movingRms of a constant is its magnitude', () => {
    expect(movingRms(new Float64Array(50).fill(-2), 10)[25]).toBeCloseTo(2);
  });
});
