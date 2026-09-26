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
