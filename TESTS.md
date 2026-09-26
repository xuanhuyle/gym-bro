# TESTS.md — test plan and results

Two kinds of evidence, never to be confused:
- **Automated tests on synthetic data** prove the *logic* (counting, grouping, timing, robustness rules).
- **Real recordings on a real machine** are the only evidence that the *iPhone approach* works.

## 1. Automated (run `npm run check`)
| Suite | What it verifies |
|---|---|
| `src/analysis/__tests__/dsp.test.ts` | Butterworth gains (DC, −6 dB at cutoff after zero-phase), stop-band, zero phase shift, integration, stats helpers |
| `src/analysis/__tests__/zigzag.test.ts` | Alternating extrema, hysteresis ignores small wiggles, threshold respected, end point flagged unconfirmed |
| `src/analysis/__tests__/analyze.test.ts` | 10/12/15 with ~20 s rests + handling/bumps/stack nudges, 6 seeds × both acceleration sign conventions: exact reps/sets, rests ±1.5 s, direction decided by data. Six other rep schemes (3/7, 20, 5×4, 8/14/6, 2/25, 12/9/11/4/16). Same result for 8 random phone orientations. 100 randomised normal-tempo workouts: ≥ 95 exact, rests < 2 s. Noise-only recording → 0 sets. Dropouts, missing linear acceleration, unsorted/duplicate timestamps, tiny recordings. Cadence. Export→import replay gives identical results |
| `src/recording/__tests__/schema.test.ts` | JSON/CSV round trips, NaN preserved, columns mapped by name, rejects foreign/newer files |
| `src/catalogue/__tests__/catalogue.test.ts` | Seed data integrity; region → exercises (incl. multi-region); exercise → compatible machines; variants per exercise+machine; variant → primary/secondary muscles; same machine different mapping (pec deck fly vs reverse fly); same machine different variant (curl bar vs rope); extending by data only; bad data reported |
| `src/catalogue/__tests__/weightMemory.test.ts` | Last weight per variant, persistence round trip, fallback to same exercise+machine (flagged not exact), invalid input |
| `src/session/__tests__/machine.test.ts` | Scripted rep events: 10 reps → inactivity → REST only after confirmation; rest measured from last rep end (not confirmation); REST → coherent sequence → Set 2 with its first rep; isolated movement (and two far-apart bumps) never start a set; revoked rest; 3 sets → COMPLETE with correct sets/reps/rests; final-set longer confirmation; late reps ignored; 5-set configuration; manual finish; rest timeout; serialise/reload mid-rest continues identically; duplicate reps; config validation; reducer purity |
| `src/session/__tests__/replay.test.ts` | Synthetic 100 Hz recordings through the live path (windowed engine + state machine, 2 s chunks): noisy 10/12/15 × 6 seeds → exact sets, rests ±1.5 s, COMPLETE; 8/5/14 with 35/60 s rests; handling/knocks only → no set |
| `src/ui/__tests__/screens.test.tsx` | Screens with mocked storage/sensors: review screen shows detection, saves truth, comparison; raw recorder start→STOP; history list; **setup flow** region→exercise→(auto machine)→variant→muscles→pre-filled weight→START; cannot start without weight; **live session screen** fed with a synthetic stream reaches SET 1 → REST → … → SAVED without any button, persisted provisional state after Set 2 and a complete final record |

Test changes in this iteration: the screen tests' storage mock gained `loadSession`/`saveSession` (new
dependencies of the review screen); no assertion was weakened. The free-text setup screen was renamed
`DebugSetupScreen` (developer mode); its behaviour is unchanged.

The synthetic generator (`src/analysis/synthetic.ts`) models a guided stack (minimum-jerk reps, fatigue
slow-down, 8% sway), random mount orientation, CoreMotion-like noise (0.03 m/s²) and drifting bias, 100 Hz
with jitter and optional dropouts, and rest-period disturbances: handling the phone (translation + 15–40°
rotation), knocks (short 6–12 Hz bursts) and nudging the stack (1–4 cm).

### Synthetic stress results (not part of CI)
Offline engine `g0-1` on whole recordings (2026-09-26):
- Normal tempo (concentric 0.6–1.8 s, eccentric 1–2×, travel 20–60 cm, 1–4 sets of 2–20 reps, rests
  12–60 s, disturbances, dropouts): **298/300 exact**, worst rest error 1.6 s.
- Hard sweep incl. slow tempo and short travel: **188/200 exact**.

Live session path (windowed engine + state machine, same 100 normal-tempo workouts, targetSets = true count):
- **86/100 exact** and COMPLETE; errors are ±1 rep at set edges and two merges of sets separated by ~13 s.
  Worst rest error among exact ones 4.0 s. Not tuned on purpose (no DSP tuning before real data).

## 2. Real-device protocol
Record every run in the results table below. The founder performs; Claude analyses the exported JSON.

### T0 — Acquisition check — DONE (founder, 2026-09): app runs on iPhone, DeviceMotion ≈ 100 Hz.

### T1-session — First real weight-stack session (the next test)
1. Attach the phone to the top plate of the stack (strong straps, screen reachable, nothing touching the
   frame; one slow light rep to check).
2. Start exercise → choose region, exercise, machine, variant → check the muscle preview → set the weight
   → **START EXERCISE**. Do not touch the phone again until SAVED.
3. Stand still ~10 s.
4. Set 1: 10 reps at a normal controlled tempo (≈1 s up, ≈2 s down). Count them yourself.
5. Rest ~30 s (stopwatch on another device, from your last rep). Halfway: **tap the phone** once.
6. Set 2: 12 reps. Rest ~30 s; halfway: **bump/lean on the machine** once.
7. Set 3: 15 reps. Then stand still and watch: the app should show SAVED within ~25 s.
   If it has not after 60 s, press "Finish exercise now" and note it.
8. Write down what the screen showed during each rest (e.g. "REST appeared at 00:14") and anything odd.
9. Review & correct: enter the real counts and rests → Save → Export JSON → send it back.

### T2 — Repeatability and variants (after T1-session is analysed)
- T2a: repeat T1-session. T2b: a scheme you pick on the spot (e.g. 8 / 5 / 14). T2c: slow tempo
  (≈2–3 s up, 3–4 s down). T2d: phone strapped in a different orientation.

### T3 — Another machine (e.g. chest press or leg extension), protocol T1-session.

## 3. Results log
| Date | Test | Machine / load / mount | Actual reps | Detected | Actual rests (s) | Detected rests (s) | Rate Hz | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-09 | T0 | no stack (acquisition only) | — | — | — | — | ≈100 | founder confirmed the app runs and records on iPhone |
| — | T1-session | — | — | — | — | — | — | waiting for the first weight-stack session |
