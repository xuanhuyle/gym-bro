/**
 * Sensor acquisition layer: expo-sensors DeviceMotion → SampleRow.
 * Knows nothing about workouts; only produces timestamped raw rows.
 *
 * On iOS, DeviceMotion is CoreMotion's CMDeviceMotion (sensor fusion of
 * accelerometer + gyroscope): gravity-free user acceleration, acceleration
 * including gravity, attitude and rotation rate, all with the native
 * monotonic timestamp (seconds). See node_modules/expo-sensors/ios/DeviceMotionModule.swift.
 */

import { DeviceMotion, DeviceMotionMeasurement } from 'expo-sensors';
import { SampleRow } from '../recording/schema';

export const REQUESTED_INTERVAL_MS = 10; // 100 Hz, CoreMotion's practical maximum for device motion

export interface MotionAvailability {
  available: boolean;
  permission: 'granted' | 'denied' | 'undetermined' | 'unknown';
}

export async function checkMotionAvailability(): Promise<MotionAvailability> {
  const available = await DeviceMotion.isAvailableAsync().catch(() => false);
  let permission: MotionAvailability['permission'] = 'unknown';
  try {
    const current = await DeviceMotion.getPermissionsAsync();
    const res = current.granted ? current : await DeviceMotion.requestPermissionsAsync();
    permission = res.status as MotionAvailability['permission'];
  } catch {
    permission = 'unknown';
  }
  return { available, permission };
}

const nz = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Converts one measurement to a row with the RAW native timestamp in column 0 (seconds). */
export function measurementToRow(m: DeviceMotionMeasurement): SampleRow {
  const ag = m.accelerationIncludingGravity;
  const a = m.acceleration;
  const rr = m.rotationRate;
  const rot = m.rotation;
  const t = nz(ag?.timestamp ?? a?.timestamp ?? rot?.timestamp);
  return [
    t,
    nz(a?.x),
    nz(a?.y),
    nz(a?.z),
    nz(ag?.x),
    nz(ag?.y),
    nz(ag?.z),
    nz(rr?.alpha),
    nz(rr?.beta),
    nz(rr?.gamma),
    nz(rot?.alpha),
    nz(rot?.beta),
    nz(rot?.gamma),
  ];
}

export interface MotionStream {
  stop(): void;
  /** Takes all rows received since the last call. */
  drain(): SampleRow[];
  /** Interval reported by the native side, ms (null until first sample). */
  reportedIntervalMs(): number | null;
  /** Raw timestamp of the very first sample (s), used to re-base t to 0. */
  originSec(): number | null;
  /** Latest measurement, for a live display only. */
  latest(): SampleRow | null;
}

export function startMotionStream(intervalMs = REQUESTED_INTERVAL_MS): MotionStream {
  let buffer: SampleRow[] = [];
  let origin: number | null = null;
  let reported: number | null = null;
  let last: SampleRow | null = null;
  DeviceMotion.setUpdateInterval(intervalMs);
  const sub = DeviceMotion.addListener((m) => {
    const row = measurementToRow(m);
    if (!Number.isFinite(row[0])) return;
    if (origin == null) origin = row[0];
    // expo reports `interval` in seconds on iOS (deviceMotionUpdateInterval) despite the docs saying ms.
    if (reported == null && typeof m.interval === 'number') reported = m.interval < 1 ? m.interval * 1000 : m.interval;
    row[0] = row[0] - origin;
    buffer.push(row);
    last = row;
  });
  return {
    stop: () => sub.remove(),
    drain: () => {
      const out = buffer;
      buffer = [];
      return out;
    },
    reportedIntervalMs: () => reported,
    originSec: () => origin,
    latest: () => last,
  };
}
