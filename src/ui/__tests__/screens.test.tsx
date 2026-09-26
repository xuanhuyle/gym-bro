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

describe('ExerciseSetupScreen', () => {
  it('walks region → exercise → machine → variant, shows muscles, pre-fills the last weight and starts', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    const { rememberWeight, emptyWeightBook } = require('../../catalogue/weightMemory');
    const { catalogue } = require('../../catalogue/catalogue');
    const weights = rememberWeight(emptyWeightBook(), catalogue.variant('lat_pulldown.machine.wide_overhand'), 35, '2026-09-01T10:00:00Z');
    const onStart = jest.fn();
    await render(<ExerciseSetupScreen weights={weights} onStart={onStart} onCancel={jest.fn()} />);
    expect(screen.queryByText('Lat Pulldown')).toBeNull();
    await fireEvent.press(screen.getByText('Back'));
    await fireEvent.press(screen.getByText('Lat Pulldown'));
    // Only one compatible machine: selected automatically.
    expect(screen.getByText('Lat pulldown machine')).toBeTruthy();
    await fireEvent.press(screen.getByText('Wide overhand grip'));
    expect(screen.getByText('Latissimus dorsi')).toBeTruthy();
    expect(screen.getByText(/Teres major/)).toBeTruthy();
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('35');
    await fireEvent.press(screen.getByText('+2.5'));
    await fireEvent.press(screen.getByText('START EXERCISE'));
    expect(onStart).toHaveBeenCalledWith({ regionId: 'back', variantId: 'lat_pulldown.machine.wide_overhand', loadKg: 37.5 });
  });

  it('cannot start before a weight is set', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    const { emptyWeightBook } = require('../../catalogue/weightMemory');
    const onStart = jest.fn();
    await render(<ExerciseSetupScreen weights={emptyWeightBook()} onStart={onStart} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('Legs'));
    await fireEvent.press(screen.getByText('Leg Extension'));
    expect(screen.getByText('Quadriceps')).toBeTruthy();
    await fireEvent.press(screen.getByText('START EXERCISE'));
    expect(onStart).not.toHaveBeenCalled();
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
    const { samples } = generateWorkout({ seed: 3, sets: [{ reps: 10 }, { reps: 12 }, { reps: 15 }], restsSec: [20, 20], leadOutSec: 40, userAccelSign: -1 });
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
    expect(screen.getByText('35 kg')).toBeTruthy();
    let sawRest = false;
    for (let k = 0; k < 150 && !screen.queryByText('SAVED ✓'); k++) {
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      if (screen.queryAllByText('REST').length) sawRest = true;
    }
    expect(sawRest).toBe(true);
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

  it('before starting, shows region recency, LAST TIME, PREVIOUS and resumes the exact-variant weight', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    const { emptyWeightBook } = require('../../catalogue/weightMemory');
    const onStart = jest.fn();
    await render(<ExerciseSetupScreen weights={emptyWeightBook()} history={history} now={NOW} onStart={onStart} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('Back'));
    expect(screen.getByText(/Back last trained 19 Sep/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Lat Pulldown'));
    // Machine chosen automatically; before a grip is chosen, the machine's last use is recalled.
    expect(screen.getByText(/Last on this machine: Lat Pulldown · Wide overhand grip — 19 Sep/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Wide overhand grip'));
    expect(screen.getByText(/LAST TIME — 19 Sep/)).toBeTruthy();
    expect(screen.getByText('12 · 11 · 10 reps')).toBeTruthy();
    expect(screen.getByText('Rest: 1:05 · 1:12')).toBeTruthy();
    expect(screen.getByText(/PREVIOUS — 12 Sep/)).toBeTruthy();
    expect(screen.getByText(/\+2\.5 kg/)).toBeTruthy();
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('40');
    expect(screen.getByText(/Last time: 40 kg · 12\/11\/10/)).toBeTruthy();
    await fireEvent.press(screen.getByText('START EXERCISE'));
    expect(onStart).toHaveBeenCalledWith({ regionId: 'back', variantId: 'lat_pulldown.machine.wide_overhand', loadKg: 40 });
  });

  it('a weight from another grip is shown as a fallback, never as "last time"', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    const { emptyWeightBook } = require('../../catalogue/weightMemory');
    await render(<ExerciseSetupScreen weights={emptyWeightBook()} history={history} now={NOW} onStart={jest.fn()} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('Back'));
    await fireEvent.press(screen.getByText('Lat Pulldown'));
    await fireEvent.press(screen.getByText('Underhand (supinated) grip'));
    expect(screen.getByText(/No previous session with this exercise, machine and variant/)).toBeTruthy();
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('40');
    expect(screen.getByText(/Not this variant — pre-filled from Wide overhand grip/)).toBeTruthy();
    expect(screen.queryByText(/^Last time:/)).toBeNull();
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

  it('with no history, setup and home still work and say so', async () => {
    const { ExerciseSetupScreen } = require('../screens/ExerciseSetupScreen');
    const { emptyWeightBook } = require('../../catalogue/weightMemory');
    await render(<ExerciseSetupScreen weights={emptyWeightBook()} history={[]} now={NOW} onStart={jest.fn()} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('Legs'));
    expect(screen.getByText('Legs: not trained yet.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Leg Extension'));
    expect(screen.getByText('First time on this machine.')).toBeTruthy();
    expect(screen.getByText(/No previous weight/)).toBeTruthy();
  });
});
