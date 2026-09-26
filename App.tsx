import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { catalogue } from './src/catalogue/catalogue';
import { rememberWeight } from './src/catalogue/weightMemory';
import { emptyContext, ExerciseContext } from './src/recording/schema';
import { contextFromSelection, ExerciseSelection, makeSelection } from './src/session/record';
import { TrainingEntry } from './src/memory/history';
import { resumeWeight, ResumeWeight } from './src/memory/queries';
import { loadHistory, loadWeightBook, readSettings, saveWeightBook, writeSettings } from './src/storage/recordingStore';
import { colors } from './src/ui/components/common';
import { DebugSetupScreen } from './src/ui/screens/DebugSetupScreen';
import { DetailScreen } from './src/ui/screens/DetailScreen';
import { ExerciseSessionScreen } from './src/ui/screens/ExerciseSessionScreen';
import { ExerciseSetupScreen } from './src/ui/screens/ExerciseSetupScreen';
import { HomeScreen } from './src/ui/screens/HomeScreen';
import { RecordingScreen } from './src/ui/screens/RecordingScreen';

// A handful of screens, so a plain state machine instead of a navigation library.
type Route =
  | { name: 'home' }
  | { name: 'setup' }
  | { name: 'session'; selection: ExerciseSelection; loadKg: number | null; context: ExerciseContext; resume: ResumeWeight; history: TrainingEntry[] }
  | { name: 'detail'; id: string }
  | { name: 'debugSetup' }
  | { name: 'recording'; context: ExerciseContext };

interface Settings {
  lastContext: ExerciseContext;
  lastSelection: { regionId: string; variantId: string } | null;
  devMode: boolean;
}

function loadSettings(): Settings {
  const fallback: Settings = { lastContext: emptyContext(), lastSelection: null, devMode: false };
  try {
    return readSettings(fallback);
  } catch {
    return fallback;
  }
}

function safeHistory(): TrainingEntry[] {
  try {
    return loadHistory();
  } catch {
    return [];
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const setSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettingsState(next);
    try {
      writeSettings(next);
    } catch {
      /* convenience only */
    }
  };

  /** Context is complete → arm: resume the weight from memory and open the live session (no START). */
  const arm = (regionId: string, variantId: string) => {
    const history = safeHistory();
    const variant = catalogue.variant(variantId);
    const resume = resumeWeight(history, loadWeightBook(), variant);
    const loadKg = resume?.kg ?? null;
    if (loadKg != null) rememberLoad(variantId, loadKg);
    setSettings({ lastSelection: { regionId, variantId } });
    const selection = makeSelection(catalogue, regionId, variantId);
    setRoute({ name: 'session', selection, loadKg, context: contextFromSelection(catalogue, selection, loadKg), resume, history });
  };

  let screen: React.ReactNode;
  switch (route.name) {
    case 'home':
      screen = (
        <HomeScreen
          history={safeHistory()}
          onResume={({ regionId, variantId }) => arm(regionId, variantId)}
          onNew={() => setRoute({ name: 'setup' })}
          onOpen={(id) => setRoute({ name: 'detail', id })}
          devMode={settings.devMode}
          onDevMode={(devMode) => setSettings({ devMode })}
          onRawRecording={() => setRoute({ name: 'debugSetup' })}
        />
      );
      break;
    case 'setup':
      screen = <ExerciseSetupScreen history={safeHistory()} onCancel={() => setRoute({ name: 'home' })} onArm={({ regionId, variantId }) => arm(regionId, variantId)} />;
      break;
    case 'session':
      screen = (
        <ExerciseSessionScreen
          selection={route.selection}
          loadKg={route.loadKg}
          context={route.context}
          resume={route.resume}
          history={route.history}
          onWeightChange={(kg) => kg != null && rememberLoad(route.selection.variantId, kg)}
          onChangeExercise={() => setRoute({ name: 'setup' })}
          onExit={(id) => setRoute(id ? { name: 'detail', id } : { name: 'home' })}
        />
      );
      break;
    case 'detail':
      screen = <DetailScreen id={route.id} onBack={() => setRoute({ name: 'home' })} />;
      break;
    case 'debugSetup':
      screen = (
        <DebugSetupScreen
          initial={settings.lastContext}
          onCancel={() => setRoute({ name: 'home' })}
          onStart={(context) => {
            setSettings({ lastContext: context });
            setRoute({ name: 'recording', context });
          }}
        />
      );
      break;
    case 'recording':
      screen = <RecordingScreen context={route.context} onDone={(id) => setRoute(id ? { name: 'detail', id } : { name: 'home' })} />;
      break;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        {screen}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function rememberLoad(variantId: string, kg: number) {
  try {
    saveWeightBook(rememberWeight(loadWeightBook(), catalogue.variant(variantId), kg, new Date().toISOString()));
  } catch {
    /* convenience only */
  }
}
