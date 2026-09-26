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
| `src/ui/__tests__/screens.test.tsx` | Screens render with mocked storage/sensors: detail shows detection, truth is saved, comparison shown; recording start→STOP saves and finalises; list flags interrupted recordings |

The synthetic generator (`src/analysis/synthetic.ts`) models a guided stack (minimum-jerk reps, fatigue
slow-down, 8% sway), random mount orientation, CoreMotion-like noise (0.03 m/s²) and drifting bias, 100 Hz
with jitter and optional dropouts, and rest-period disturbances: handling the phone (translation + 15–40°
rotation), knocks (short 6–12 Hz bursts) and nudging the stack (1–4 cm).

### Synthetic stress results (algorithm g0-1, 2026-09-26; not part of CI)
- Normal tempo (concentric 0.6–1.8 s, eccentric 1–2×, travel 20–60 cm, 1–4 sets of 2–20 reps, rests
  12–60 s, disturbances, dropouts): **298/300 exact**, worst rest error 1.6 s.
- Hard sweep incl. slow tempo (concentric up to 2.8 s, eccentric up to 5.6 s) and short travel (15 cm):
  **188/200 exact**. All failures have concentric ≥ 2 s and/or travel ≤ 18 cm → see STATUS.md limitations.

## 2. Real-device protocol (the Gate 0 experiment)
Record every run in the results table below. The founder performs; Claude analyses the exported JSON.

### T0 — Quick home check (optional, 3 minutes, no machine)
Phone flat on a hardback book. Start → 10 s still → lift book+phone straight up ~30 cm and back down,
5 times, slowly → 10 s still → Stop. Then "Export JSON". Checks: install, permission, sample rate, file
export, and whether the up/down direction is decided from the data. (Hand motion is not a guided stack;
the counts here matter less.)

### T1 — Controlled machine workout (acceptance test)
1. Attach the phone to the top plate of the stack (see attachment instructions in STATUS.md / the chat).
   With a light weight, do 1 slow full rep to check nothing hits the frame or pulley.
2. New recording → fill in context (pattern, region, exercise, variant, load, machine, how attached) → Start.
3. Stand still ~10 s.
4. Set 1: 10 reps at a normal controlled tempo (≈1 s up, ≈2 s down). Count them yourself.
5. Rest ~20 s (time it on another device if you can). About halfway, **touch or tap the phone** firmly.
6. Set 2: 12 reps. Rest ~20 s; about halfway, **bump/lean on the machine** or grab the bar without lifting.
7. Set 3: 15 reps.
8. Stay still ~10 s, then walk over and press STOP.
9. On the result screen: enter what you actually did (sets/reps, measured rests if any, notes on the noise
   you created and anything unusual, e.g. a partial rep) → Save → Export JSON → send it back.

### T2 — Repeatability and variants (after T1 is analysed)
- T2a: repeat T1 exactly.
- T2b: different rep scheme you choose on the spot (e.g. 8 / 5 / 14) — the algorithm must not care.
- T2c: slow tempo (≈2–3 s up, 3–4 s down) — known weak spot, we need real data on it.
- T2d: phone attached in a different orientation (e.g. rotated 90°, screen facing another way).

### T3 — Another machine (e.g. chest press or leg extension), protocol T1.

## 3. Results log
| Date | Test | Machine / load / mount | Actual reps | Detected | Actual rests (s) | Detected rests (s) | Rate Hz | Notes |
|---|---|---|---|---|---|---|---|---|
| — | — | no real recording yet | — | — | — | — | — | waiting for the founder's first recording |
