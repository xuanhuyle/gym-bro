# CLAUDE.md — durable engineering rules

Read PRODUCT.md (why), STATUS.md (where we are) and TESTS.md (how we know) before changing anything.

## What this is
**Gym Bro is a memory layer for strength training**: it remembers what the user did on every exercise and
machine (load, reps, sets, rests, frequency) and brings it back when they return — REMEMBER → RESUME →
COMPARE → UNDERSTAND → (later) BENCHMARK. See PRODUCT.md.

Automatic capture is the *enabling technology*, not the product: an iPhone app (React Native + Expo SDK 57 +
TypeScript) records the phone's motion while it is strapped to a selectorized weight stack and derives reps →
sets → rests (Gate 0, still hardware-validation-pending). Judge features by whether they make the training
memory more reliable or more useful at the moment of need ("what was I doing on this machine?").
The founder works on Windows with a physical iPhone and **no Mac**: the app must keep running in
**Expo Go** (no custom native code) unless we deliberately move to an EAS development build.

## Architecture (keep these boundaries)
```
src/sensors/      acquisition only: expo-sensors DeviceMotion → SampleRow (raw, timestamped). No analysis.
src/recording/    schema.ts: the recording format (JSON/CSV). Pure TS. The contract between all layers.
src/analysis/     pure, deterministic TS rep/set engine for a guided weight stack. No React Native / Expo imports.
src/catalogue/    pure data + queries: BodyRegion, Exercise, Equipment, ExerciseVariant, Muscle, contributions
                  (PRIMARY/SECONDARY only, no percentages); last-used weight per variant.
src/session/      pure exercise-session state machine (READY → ACTIVE_SET ⇄ REST → COMPLETE) fed by rep
                  events + watermark ticks; windowed adapter running the unchanged analysis engine live;
                  replay driver; persisted session record.
src/memory/       pure training-memory layer: history entries from completed sessions (+ user corrections),
                  queries for variant / machine / body-region / muscle memory, resume weight, session and
                  period comparisons, formatting. No React.
src/storage/      expo-file-system persistence (recording, session, weights, settings), export, import.
src/ui/           screens + components; recorder.ts = recording lifecycle glue. App.tsx = route state machine.
scripts/          Node CLIs: `npm run analyze -- file.json` (offline + live-session replay + HTML report), `npm run synth`.
recordings/       real recordings returned from the phone (raw data is precious: commit it).
```
- The analysis engine takes `SampleRow[]` only. Live, imported and synthetic data go through the same function.
- The session state machine takes rep events only (from live detection, replay, simulation or scripted
  tests). Never put signal processing in it, and never put set/rest rules in the analysis engine.
- Algorithm output (session state, analysis) and user corrections (`userReported` in the recording meta)
  are stored separately. Never overwrite detector output with corrections.
- Catalogue choices come from `src/catalogue/data.ts`; UI never hard-codes exercises or muscles.
- Recall shown in the UI comes from `src/memory/` queries (pure, tested), never ad-hoc in components.

## Product rules (memory layer)
- Do not treat rep counting as the whole product; capture work must serve the memory.
- Loads/performance are compared only within the same ExerciseVariant (exercise × machine × variant).
  Never compare kilograms across machines or mechanically different variants.
- Memory uses the user's corrected counts when present, else detected counts, and says which (`source`).
  Only COMPLETE sessions are history.
- Facts, not scores: no fitness/progress/hypertrophy/region scores, no activation percentages; keep
  PRIMARY (direct) and SECONDARY (contributing) muscle exposure separate.
- Fallbacks are labelled (e.g. a weight borrowed from another grip is not "last time").
- History is contextual: surface it where the decision is made (setup, weight field, review), not only in
  dashboards. Keep the live recording UI minimal.
- Longitudinal analysis = "this session/period vs the previous comparable one". Build on `src/memory/`.
- Raw samples are stored exactly as the sensor reports them (except t re-based to 0). Never store only
  derived data: the point is to re-run improved algorithms on old recordings.
- Changing a column's meaning = bump `RECORDING_SCHEMA_VERSION` and keep reading old versions.
  Same for `SESSION_SCHEMA_VERSION` (session record) and the catalogue `version`.
- Any change to the analysis behaviour: bump `ALGORITHM_VERSION` in `src/analysis/analyze.ts`.

## Honesty rules
- Never hard-code expected counts (e.g. 10/12/15) or tune on the test scheme. Tests use many schemes.
- Never change a valid test to make an incorrect implementation pass.
- Synthetic data validates logic only. Do not claim sensor accuracy or "works on iPhone" without a real recording.
- Live automatic set segmentation is HARDWARE-VALIDATION-PENDING until a real weight-stack recording confirms it.
- Do not tune DSP thresholds against synthetic data; wait for real recordings.
- When real recordings disagree with synthetic assumptions, trust the recording and update the generator.

## Commands
```
npm run check                 # typecheck + all Jest tests (run before every commit)
npm run analyze -- recordings/x.json [--truth 10,12,15 --rests 20,20]   # offline + live-session replay; writes x.report.html
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
