/**
 * Render tests of the screens with storage and sensors mocked. They check the
 * UI wiring (analysis shown, truth saved, comparison, stop/save flow), not the
 * real sensors or file system — those need the phone.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { generateWorkout } from '../../analysis/synthetic';
import { emptyContext, Recording, RECORDING_FORMAT, RECORDING_SCHEMA_VERSION, SAMPLE_COLUMNS } from '../../recording/schema';

jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
// The chart itself is not under test here.
jest.mock('react-native-svg', () => {
  const C = () => null;
  return { __esModule: true, default: C, Circle: C, Line: C, Polyline: C, Rect: C, Text: C };
});

const mockStore = {
  loadRecording: jest.fn(),
  updateMeta: jest.fn(),
  deleteRecording: jest.fn(),
  shareRecordingJson: jest.fn(),
  shareSamplesCsv: jest.fn(),
  listRecordings: jest.fn(),
  importRecording: jest.fn(),
  createRecording: jest.fn(),
  appendSamples: jest.fn(),
  newRecordingId: jest.fn(() => 'rec-1'),
  loadSession: jest.fn(() => null),
  loadHistory: jest.fn(() => []),
  saveSession: jest.fn(),
};
jest.mock('../../storage/recordingStore', () => mockStore);

const mockStream = { stop: jest.fn(), drain: jest.fn(() => [[0, 0, 0, 0, 0, 0, -9.8, 0, 0, 0, 0, 0, 0]]), reportedIntervalMs: () => 10, originSec: () => 100, latest: () => null };
jest.mock('../../sensors/motionSource', () => ({
  REQUESTED_INTERVAL_MS: 10,
  checkMotionAvailability: jest.fn(async () => ({ available: true, permission: 'granted' })),
  startMotionStream: jest.fn(() => mockStream),
}));

function syntheticRecording(): Recording {
  const { samples } = generateWorkout({ seed: 3, sets: [{ reps: 10 }, { reps: 12 }, { reps: 15 }], restsSec: [20, 20], userAccelSign: -1 });
  return {
    format: RECORDING_FORMAT,
    schemaVersion: RECORDING_SCHEMA_VERSION,
    id: 'rec-1',
    createdAt: '2026-09-26T10:00:00.000Z',
    startedAt: '2026-09-26T10:00:00.000Z',
    stoppedAt: '2026-09-26T10:03:00.000Z',
    context: { ...emptyContext(), bodyRegion: 'Back', exercise: 'Lat Pulldown', loadKg: 35 },
    device: { platform: 'ios', osVersion: '26.0', modelName: 'iPhone', appVersion: '0.1.0', expoSdk: '57.0.0' },
    sensor: { api: 'test', requestedIntervalMs: 10, reportedIntervalMs: 10, timestampOriginSec: 0, columns: [...SAMPLE_COLUMNS] },
    events: [],
    userReported: null,
    sampleCount: samples.length,
    samples,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('DetailScreen', () => {
  it('shows detected counts, saves the actual counts and shows the comparison', async () => {
    const { DetailScreen } = require('../screens/DetailScreen');
    mockStore.loadRecording.mockReturnValue(syntheticRecording());
    await render(<DetailScreen id="rec-1" onBack={jest.fn()} />);
    expect(await screen.findByText('10 / 12 / 15', {}, { timeout: 10000 })).toBeTruthy();

    await fireEvent.press(screen.getByText('Copy detected counts (then correct them)'));
    await fireEvent.press(screen.getByText('Save'));
    expect(mockStore.updateMeta).toHaveBeenCalledWith('rec-1', expect.objectContaining({ userReported: expect.objectContaining({ sets: [{ reps: 10 }, { reps: 12 }, { reps: 15 }] }) }));
    expect(await screen.findByText('Comparison: exact match ✓')).toBeTruthy();
  }, 30000);
});

describe('RecordingScreen', () => {
  it('creates the files, streams samples and finalises on STOP', async () => {
    const { RecordingScreen } = require('../screens/RecordingScreen');
    const onDone = jest.fn();
    await render(<RecordingScreen context={{ ...emptyContext(), exercise: 'Lat Pulldown' }} onDone={onDone} />);
    expect(await screen.findByText('recording')).toBeTruthy();
    expect(mockStore.createRecording).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-1', stoppedAt: null }));
    await fireEvent.press(screen.getByText('STOP'));
    expect(mockStream.stop).toHaveBeenCalled();
    expect(mockStore.appendSamples).toHaveBeenCalled();
    expect(mockStore.updateMeta).toHaveBeenCalledWith('rec-1', expect.objectContaining({ stoppedAt: expect.any(String), sensor: expect.objectContaining({ timestampOriginSec: 100 }) }));
    expect(onDone).toHaveBeenCalledWith('rec-1');
  });
});

describe('HomeScreen', () => {
  it('lists recordings and flags interrupted ones', async () => {
    const { HomeScreen } = require('../screens/HomeScreen');
    const rec = syntheticRecording();
    const { samples: _s, ...meta } = rec;
    mockStore.listRecordings.mockReturnValue([{ meta: { ...meta, stoppedAt: null }, interrupted: true, sizeBytes: 2e6 }]);
    await render(<HomeScreen onNew={jest.fn()} onOpen={jest.fn()} />);
    expect(screen.getByText('Pull → Back → Lat Pulldown → 35 kg')).toBeTruthy();
    expect(screen.getByText(/Interrupted/)).toBeTruthy();
  });
});

describe('ExerciseSetupScreen (no START button: choosing the variant arms)', () => {
  it('walks region → exercise → machine → variant and arms automatically on the variant', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    const onArm = jest.fn();
    await render(<ExerciseSetupScreen onArm={onArm} onCancel={jest.fn()} />);
    expect(screen.queryByText('START EXERCISE')).toBeNull();
    expect(screen.queryByText('Lat Pulldown')).toBeNull();
    await fireEvent.press(screen.getByText('Back'));
    await fireEvent.press(screen.getByText('Lat Pulldown'));
    // Only one compatible machine: selected automatically; three grips → not armed yet.
    expect(screen.getByText('Lat pulldown machine')).toBeTruthy();
    expect(onArm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Wide overhand grip'));
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(onArm).toHaveBeenCalledWith({ regionId: 'back', variantId: 'lat_pulldown.machine.wide_overhand' });
  });

  it('arms as soon as the exercise is unambiguous (single machine and variant)', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    const onArm = jest.fn();
    await render(<ExerciseSetupScreen onArm={onArm} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('Legs'));
    await fireEvent.press(screen.getByText('Leg Extension'));
    expect(onArm).toHaveBeenCalledWith({ regionId: 'legs', variantId: 'leg_extension.machine' });
  });
});

describe('ExerciseSessionScreen', () => {
  afterEach(() => {
    jest.useRealTimers();
    mockStream.drain.mockImplementation(() => [[0, 0, 0, 0, 0, 0, -9.8, 0, 0, 0, 0, 0, 0]]);
  });

  it('runs Set → Rest → Set → Rest → Set → SAVED from the sensor stream without any button, persisting along the way', async () => {
    const { act } = require('@testing-library/react-native');
    const { ExerciseSessionScreen } = require('../screens/ExerciseSessionScreen');
    const { catalogue } = require('../../catalogue/catalogue');
    const { makeSelection, contextFromSelection } = require('../../session/record');
    // Starts in the user's hand, carried and strapped to the stack (placement), then 3 sets.
    const { samples } = generateWorkout({
      seed: 3,
      sets: [{ reps: 10 }, { reps: 12 }, { reps: 15 }],
      restsSec: [20, 20],
      leadInSec: 16,
      leadOutSec: 40,
      userAccelSign: -1,
      placement: { handSec: 4, moveSec: 3, angleDeg: 90 },
    });
    let i = 0;
    let clock = 0;
    mockStream.drain.mockImplementation(() => {
      clock += 2;
      const out = [];
      while (i < samples.length && samples[i][0] < clock) out.push(samples[i++]);
      return out;
    });
    jest.useFakeTimers();
    const selection = makeSelection(catalogue, 'back', 'lat_pulldown.machine.wide_overhand');
    await render(<ExerciseSessionScreen selection={selection} loadKg={35} context={contextFromSelection(catalogue, selection, 35)} onExit={jest.fn()} />);
    await act(async () => {});
    expect(screen.getByText('LAT PULLDOWN')).toBeTruthy();
    // Armed on arrival: no START button anywhere, weight resumed and editable.
    expect(screen.getByText('ARMED')).toBeTruthy();
    expect(screen.queryByText('START EXERCISE')).toBeNull();
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('35');
    let sawReady = false;
    let sawRest = false;
    for (let k = 0; k < 150 && !screen.queryByText('SAVED ✓'); k++) {
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      if (screen.queryByText('READY')) sawReady = true;
      if (screen.queryAllByText('REST').length) sawRest = true;
    }
    expect(sawReady).toBe(true);
    expect(sawRest).toBe(true);
    expect(screen.getByText('35 kg')).toBeTruthy();
    expect(screen.getByText('SAVED ✓')).toBeTruthy();
    expect(screen.getByText('SET 3')).toBeTruthy();
    const saves = mockStore.saveSession.mock.calls.map((c: unknown[]) => c[0] as { status: string; state: { sets: { reps: unknown[] }[] } });
    // Provisional state was persisted before completion (a crash would keep Set 1 and Set 2).
    expect(saves.some((r) => r.status === 'in-progress' && r.state.sets.length === 2)).toBe(true);
    const final = saves[saves.length - 1];
    expect(final.status).toBe('complete');
    expect(final.state.sets.map((x) => x.reps.length)).toEqual([10, 12, 15]);
    // The raw recording was finalised too.
    expect(mockStore.updateMeta).toHaveBeenCalledWith('rec-1', expect.objectContaining({ stoppedAt: expect.any(String) }));
  }, 60000);
});

describe('training memory in the UX', () => {
  const { catalogue } = require('../../catalogue/catalogue');
  const mk = (id: string, variantId: string, date: string, loadKg: number, reps: number[], restsSec: number[]) => {
    const v = catalogue.variant(variantId);
    return {
      id,
      date,
      variantId,
      exerciseId: v.exerciseId,
      equipmentId: v.equipmentId,
      regionId: 'back',
      loadKg,
      reps,
      restsSec,
      source: 'detected' as const,
      labels: { region: 'Back', exercise: catalogue.exercise(v.exerciseId).name, equipment: catalogue.equipment(v.equipmentId).name, variant: v.variantName },
    };
  };
  const NOW = new Date('2026-09-26T12:00:00');
  const history = [
    mk('a', 'lat_pulldown.machine.wide_overhand', '2026-09-12T18:00:00', 37.5, [12, 12, 11], [60, 60]),
    mk('b', 'lat_pulldown.machine.close_neutral', '2026-09-16T18:00:00', 45, [10, 10, 10], [70, 70]),
    mk('c', 'lat_pulldown.machine.wide_overhand', '2026-09-19T18:00:00', 40, [12, 11, 10], [65, 72]),
  ];

  async function renderArmed(variantId: string, hist: typeof history, extra: Record<string, unknown> = {}) {
    const { act } = require('@testing-library/react-native');
    const { ExerciseSessionScreen } = require('../screens/ExerciseSessionScreen');
    const { emptyWeightBook } = require('../../catalogue/weightMemory');
    const { resumeWeight } = require('../../memory/queries');
    const { makeSelection, contextFromSelection } = require('../../session/record');
    const selection = makeSelection(catalogue, 'back', variantId);
    const resume = resumeWeight(hist, emptyWeightBook(), catalogue.variant(variantId));
    const loadKg = resume?.kg ?? null;
    await render(
      <ExerciseSessionScreen selection={selection} loadKg={loadKg} context={contextFromSelection(catalogue, selection, loadKg)} resume={resume} history={hist} now={NOW} onExit={jest.fn()} {...extra} />,
    );
    await act(async () => {});
  }

  it('selection shows region recency, the machine\'s last use and each grip\'s last performance before arming', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    await render(<ExerciseSetupScreen history={history} now={NOW} onArm={jest.fn()} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('Back'));
    expect(screen.getByText(/Back last trained 19 Sep/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Lat Pulldown'));
    expect(screen.getByText(/Last on this machine: Lat Pulldown · Wide overhand grip — 19 Sep/)).toBeTruthy();
    expect(screen.getByText('Wide overhand grip — 19 Sep · 40 kg · 12/11/10')).toBeTruthy();
    expect(screen.getByText('Close neutral grip — 16 Sep · 45 kg · 10/10/10')).toBeTruthy();
  });

  it('armed screen: LAST TIME, PREVIOUS and the exact-variant weight, before the first rep', async () => {
    await renderArmed('lat_pulldown.machine.wide_overhand', history);
    expect(screen.getByText('ARMED')).toBeTruthy();
    expect(screen.getByText(/LAST TIME — 19 Sep/)).toBeTruthy();
    expect(screen.getByText('12 · 11 · 10 reps')).toBeTruthy();
    expect(screen.getByText('Rest: 1:05 · 1:12')).toBeTruthy();
    expect(screen.getByText(/PREVIOUS — 12 Sep/)).toBeTruthy();
    expect(screen.getByText(/\+2\.5 kg/)).toBeTruthy();
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('40');
    expect(screen.getByText(/Last time: 40 kg · 12\/11\/10/)).toBeTruthy();
    expect(screen.getByText(/Primary: Latissimus dorsi/)).toBeTruthy();
  });

  it('a weight from another grip is shown as a fallback, never as "last time"', async () => {
    await renderArmed('lat_pulldown.machine.underhand', history);
    expect(screen.getByText(/No previous session with this exercise, machine and variant/)).toBeTruthy();
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('40');
    expect(screen.getByText(/Not this variant — pre-filled from Wide overhand grip/)).toBeTruthy();
    expect(screen.queryByText(/^Last time:/)).toBeNull();
  });

  it('with no history, arming still works and says so; the weight can be set while armed', async () => {
    const onWeightChange = jest.fn();
    await renderArmed('lat_pulldown.machine.wide_overhand', [], { onWeightChange });
    expect(screen.getByText(/No previous weight/)).toBeTruthy();
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '42.5');
    expect(onWeightChange).toHaveBeenLastCalledWith(42.5);
    const saves = mockStore.saveSession.mock.calls.map((c: unknown[]) => c[0] as { loadKg: number | null });
    expect(saves[saves.length - 1].loadKg).toBe(42.5);
    expect(mockStore.updateMeta).toHaveBeenCalledWith('rec-1', expect.objectContaining({ context: expect.objectContaining({ loadKg: 42.5 }) }));
  });

  it('"Change exercise" before Set 1 discards the armed recording', async () => {
    const onChangeExercise = jest.fn();
    await renderArmed('lat_pulldown.machine.wide_overhand', history, { onChangeExercise });
    await fireEvent.press(screen.getByText('Change exercise'));
    expect(mockStream.stop).toHaveBeenCalled();
    expect(mockStore.deleteRecording).toHaveBeenCalledWith('rec-1');
    expect(onChangeExercise).toHaveBeenCalled();
  });

  it('Home offers one-tap reopen of recent exercises with their last performance', async () => {
    const { HomeScreen } = require('../screens/HomeScreen');
    mockStore.listRecordings.mockReturnValue([]);
    const onResume = jest.fn();
    await render(<HomeScreen history={history} onResume={onResume} onNew={jest.fn()} onOpen={jest.fn()} />);
    expect(screen.getByText('Continue where you left off')).toBeTruthy();
    expect(screen.getByText(/19 Sep · 40 kg · 12\/11\/10/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Lat Pulldown · Wide overhand grip'));
    expect(onResume).toHaveBeenCalledWith({ regionId: 'back', variantId: 'lat_pulldown.machine.wide_overhand' });
  });

  it('with no history, selection says so', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    await render(<ExerciseSetupScreen history={[]} now={NOW} onArm={jest.fn()} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('Legs'));
    expect(screen.getByText('Legs: not trained yet.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Leg Curl'));
    // Two machines → user picks one; its single variant arms immediately.
    await fireEvent.press(screen.getByText('Seated leg curl machine'));
    expect(screen.getByText('First time on this machine.')).toBeTruthy();
  });
});
