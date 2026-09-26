# CLAUDE.md — durable engineering rules

Read PRODUCT.md (why), STATUS.md (where we are) and TESTS.md (how we know) before changing anything.

## What this is
Gate 0 of a strength-training app: an iPhone app (React Native + Expo SDK 57 + TypeScript) that records
the phone's motion while it is strapped to a selectorized weight stack, then counts reps → sets → rest.
The founder works on Windows with a physical iPhone and **no Mac**: the app must keep running in
**Expo Go** (no custom native code) unless we deliberately move to an EAS development build.

## Architecture (keep these boundaries)
```
src/sensors/      acquisition only: expo-sensors DeviceMotion → SampleRow (raw, timestamped). No analysis.
src/recording/    schema.ts: the recording format (JSON/CSV). Pure TS. The contract between all layers.
src/analysis/     pure, deterministic TS. No React Native / Expo imports. Runs on phone, Node and Jest.
src/storage/      expo-file-system persistence, export (share sheet), import.
src/ui/           screens + components. App.tsx is a 4-route state machine (no navigation library).
scripts/          Node CLIs: `npm run analyze -- file.json` (replay + HTML debug report), `npm run synth`.
recordings/       real recordings returned from the phone (raw data is precious: commit it).
```
- The analysis engine takes `SampleRow[]` only. Live, imported and synthetic data go through the same function.
- Raw samples are stored exactly as the sensor reports them (except t re-based to 0). Never store only
  derived data: the point is to re-run improved algorithms on old recordings.
- Changing a column's meaning = bump `RECORDING_SCHEMA_VERSION` and keep reading old versions.
- Any change to the analysis behaviour: bump `ALGORITHM_VERSION` in `src/analysis/analyze.ts`.

## Honesty rules
- Never hard-code expected counts (e.g. 10/12/15) or tune on the test scheme. Tests use many schemes.
- Never change a valid test to make an incorrect implementation pass.
- Synthetic data validates logic only. Do not claim sensor accuracy or "works on iPhone" without a real recording.
- When real recordings disagree with synthetic assumptions, trust the recording and update the generator.

## Commands
```
npm run check                 # typecheck + all Jest tests (run before every commit)
npm run analyze -- recordings/x.json [--truth 10,12,15 --rests 20,20]   # writes x.report.html
npm run synth -- out.json --noisy --reps 8,12 --seed 3
npm start                     # dev server for Expo Go (founder runs this on Windows)
```
To look at an HTML report from this container: render it with Playwright's Chromium
(`/opt/pw-browsers`, global `playwright` package) to PNG and read the image.

## Expo notes (SDK 57)
- Expo changes every SDK: check the installed package's `.d.ts` and native source in `node_modules`
  (e.g. `expo-sensors/ios/DeviceMotionModule.swift`) before using an API. They are authoritative.
- In this cloud container docs.expo.dev, expo.dev and api.expo.dev are blocked. Read docs source at
  `https://raw.githubusercontent.com/expo/expo/main/docs/pages/versions/v57.0.0/sdk/<name>.mdx`.
  Install SDK-matched packages with `EXPO_OFFLINE=1 npx expo install <pkg>` (uses bundledNativeModules.json).
- Only libraries bundled in Expo Go may be used. Adding native code forces an EAS development build
  (needs a paid Apple Developer account) — a product decision, not a routine one.
- SDK 57 Expo Go on a physical iPhone requires the same Expo account to be signed in on the CLI
  (`npx expo login`) and in Expo Go.
- DeviceMotion on iOS: `acceleration` = CoreMotion userAcceleration × g (m/s²), `accelerationIncludingGravity`
  = (user + gravity) × g, `rotationRate` in deg/s with alpha=z, beta=y, gamma=x, timestamps = CoreMotion
  seconds. The reported `interval` is in seconds on iOS despite the TS doc saying ms.
- iOS stops delivering sensor events when the app is backgrounded or the screen locks: keep-awake is on
  while recording; background/foreground events are logged in the recording.
