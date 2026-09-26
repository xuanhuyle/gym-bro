import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { emptyContext, ExerciseContext } from './src/recording/schema';
import { readSettings, writeSettings } from './src/storage/recordingStore';
import { colors } from './src/ui/components/common';
import { DetailScreen } from './src/ui/screens/DetailScreen';
import { HomeScreen } from './src/ui/screens/HomeScreen';
import { RecordingScreen } from './src/ui/screens/RecordingScreen';
import { SetupScreen } from './src/ui/screens/SetupScreen';

// Four screens, so a plain state machine instead of a navigation library.
type Route = { name: 'home' } | { name: 'setup' } | { name: 'recording'; context: ExerciseContext } | { name: 'detail'; id: string };

function loadLastContext(): ExerciseContext {
  try {
    return readSettings({ lastContext: emptyContext() }).lastContext;
  } catch {
    return emptyContext();
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [lastContext, setLastContext] = useState<ExerciseContext>(loadLastContext);

  let screen: React.ReactNode;
  switch (route.name) {
    case 'home':
      screen = <HomeScreen onNew={() => setRoute({ name: 'setup' })} onOpen={(id) => setRoute({ name: 'detail', id })} />;
      break;
    case 'setup':
      screen = (
        <SetupScreen
          initial={lastContext}
          onCancel={() => setRoute({ name: 'home' })}
          onStart={(context) => {
            setLastContext(context);
            try {
              writeSettings({ lastContext: context });
            } catch {
              /* convenience only */
            }
            setRoute({ name: 'recording', context });
          }}
        />
      );
      break;
    case 'recording':
      screen = <RecordingScreen context={route.context} onDone={(id) => setRoute(id ? { name: 'detail', id } : { name: 'home' })} />;
      break;
    case 'detail':
      screen = <DetailScreen id={route.id} onBack={() => setRoute({ name: 'home' })} />;
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
