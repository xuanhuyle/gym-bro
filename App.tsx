import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { catalogue } from './src/catalogue/catalogue';
import { rememberWeight } from './src/catalogue/weightMemory';
import { emptyContext, ExerciseContext } from './src/recording/schema';
import { contextFromSelection, ExerciseSelection, makeSelection } from './src/session/record';
import { TrainingEntry } from './src/memory/history';
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
  | { name: 'setup'; initial?: { regionId: string; variantId: string } }
  | { name: 'session'; selection: ExerciseSelection; loadKg: number; context: ExerciseContext }
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

  let screen: React.ReactNode;
  switch (route.name) {
    case 'home':
      screen = (
        <HomeScreen
          history={safeHistory()}
          onResume={(initial) => setRoute({ name: 'setup', initial })}
          onNew={() => setRoute({ name: 'setup' })}
          onOpen={(id) => setRoute({ name: 'detail', id })}
          devMode={settings.devMode}
          onDevMode={(devMode) => setSettings({ devMode })}
          onRawRecording={() => setRoute({ name: 'debugSetup' })}
        />
      );
      break;
    case 'setup':
      screen = (
        <ExerciseSetupScreen
          weights={loadWeightBook()}
          history={safeHistory()}
          initial={route.initial ?? (settings.lastSelection && safeVariant(settings.lastSelection.variantId) ? settings.lastSelection : null)}
          onCancel={() => setRoute({ name: 'home' })}
          onStart={({ regionId, variantId, loadKg }) => {
            try {
              saveWeightBook(rememberWeight(loadWeightBook(), catalogue.variant(variantId), loadKg, new Date().toISOString()));
            } catch {
              /* convenience only */
            }
            setSettings({ lastSelection: { regionId, variantId } });
            const selection = makeSelection(catalogue, regionId, variantId);
            setRoute({ name: 'session', selection, loadKg, context: contextFromSelection(catalogue, selection, loadKg) });
          }}
        />
      );
      break;
    case 'session':
      screen = (
        <ExerciseSessionScreen selection={route.selection} loadKg={route.loadKg} context={route.context} onExit={(id) => setRoute(id ? { name: 'detail', id } : { name: 'home' })} />
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

function safeVariant(id: string): boolean {
  try {
    catalogue.variant(id);
    return true;
  } catch {
    return false;
  }
}
