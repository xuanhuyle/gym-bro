/**
 * Recording lifecycle shared by the exercise-session screen and the raw
 * (developer) recording screen: create the files, stream DeviceMotion,
 * append samples to disk, log app background/foreground, finalise.
 * Non-React glue between the sensor and storage layers.
 */

import { AppState, Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { ExerciseContext, RECORDING_FORMAT, RECORDING_SCHEMA_VERSION, RecordingEvent, RecordingMeta, SampleRow, SAMPLE_COLUMNS } from '../recording/schema';
import { checkMotionAvailability, REQUESTED_INTERVAL_MS, startMotionStream } from '../sensors/motionSource';
import { appendSamples, createRecording, newRecordingId, updateMeta } from '../storage/recordingStore';

export interface ActiveRecorder {
  id: string;
  /** Moves buffered samples to disk and returns them (t on the recording clock). */
  flush(): SampleRow[];
  latest(): SampleRow | null;
  count(): number;
  /** Final flush and mark the recording as stopped. */
  stop(): void;
  /** Stop the sensor stream without finalising (e.g. unexpected unmount). */
  dispose(): void;
}

export class RecorderError extends Error {}

export async function startRecorder(context: ExerciseContext, onWarning: (msg: string) => void): Promise<ActiveRecorder> {
  const avail = await checkMotionAvailability();
  if (!avail.available) throw new RecorderError(`DeviceMotion is not available on this device (permission: ${avail.permission}).`);
  if (avail.permission === 'denied') onWarning('Motion permission denied — data may be empty. Enable Motion & Fitness for Expo Go in iOS Settings.');

  const now = new Date();
  const id = newRecordingId(now);
  const events: RecordingEvent[] = [{ wallMs: now.getTime(), type: 'start' }];
  const meta: RecordingMeta = {
    format: RECORDING_FORMAT,
    schemaVersion: RECORDING_SCHEMA_VERSION,
    id,
    createdAt: now.toISOString(),
    startedAt: now.toISOString(),
    stoppedAt: null,
    context,
    device: {
      platform: Platform.OS,
      osVersion: Device.osVersion ?? null,
      modelName: Device.modelName ?? null,
      appVersion: Constants.expoConfig?.version ?? null,
      expoSdk: Constants.expoConfig?.sdkVersion ?? null,
    },
    sensor: { api: 'expo-sensors DeviceMotion', requestedIntervalMs: REQUESTED_INTERVAL_MS, reportedIntervalMs: null, timestampOriginSec: null, columns: [...SAMPLE_COLUMNS] },
    events,
    userReported: null,
    sampleCount: 0,
  };
  try {
    createRecording(meta);
  } catch (e) {
    throw new RecorderError(`Could not create recording file: ${String(e)}`);
  }
  const stream = startMotionStream(REQUESTED_INTERVAL_MS);
  let count = 0;
  let stopped = false;

  const flush = (): SampleRow[] => {
    const rows = stream.drain();
    try {
      appendSamples(id, rows);
      count += rows.length;
    } catch (e) {
      onWarning(`Saving failed: ${String(e)}`);
    }
    return rows;
  };
  const appSub = AppState.addEventListener('change', (s) => {
    events.push({ wallMs: Date.now(), type: s === 'active' ? 'app-active' : 'app-background', detail: s });
    if (s !== 'active') onWarning('The app left the foreground. iOS pauses sensor data while the app is not visible — there will be a gap.');
    try {
      updateMeta(id, { events });
    } catch {
      /* best effort */
    }
  });

  return {
    id,
    flush,
    latest: () => stream.latest(),
    count: () => count,
    stop: () => {
      if (stopped) return;
      stopped = true;
      appSub.remove();
      stream.stop();
      const rows = stream.drain();
      appendSamples(id, rows);
      count += rows.length;
      events.push({ wallMs: Date.now(), type: 'stop' });
      updateMeta(id, {
        stoppedAt: new Date().toISOString(),
        sampleCount: count,
        events,
        sensor: { ...meta.sensor, reportedIntervalMs: stream.reportedIntervalMs(), timestampOriginSec: stream.originSec() },
      });
    },
    dispose: () => {
      if (stopped) return;
      stopped = true;
      appSub.remove();
      stream.stop();
    },
  };
}
