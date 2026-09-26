# STATUS.md — what is implemented, tested, blocked, next

_Last updated: 2026-09-26 · algorithm `g0-1` · recording schema v1 · Expo SDK 57_

## Implemented
- **App (Expo Go, iPhone):** exercise context form (Push/Pull/Legs → region → exercise → variant → kg, machine,
  notes; remembers the last one) → recording screen (100 Hz DeviceMotion, samples appended to disk every 2 s,
  screen kept awake, live rate/motion readout, background events logged) → result screen (detected sets,
  reps, rests, cadence, warnings; "what actually happened" editor that is both ground truth and correction;
  actual-vs-detected comparison; scrollable debug chart of displacement / vertical accel / horizontal accel /
  rotation with sets, accepted and rejected reps; full candidate list; re-run analysis; export JSON/CSV via
  share sheet; delete) → list of recordings (interrupted ones kept and flagged) → import JSON for replay.
- **Recording format** (`src/recording/schema.ts`): meta JSON + raw CSV on device; one-file JSON export
  with all raw samples, context, device, events and user-reported truth.
- **Analysis engine** (`src/analysis/`), pure TS, deterministic:
  1. clean/sort, gap detection, resample to 50 Hz;
  2. vertical = −(gravity direction from sensor fusion) → independent of mount orientation;
  3. band-pass vertical acceleration; double-integrate; velocity and position anchored to 0 during still
     periods ≥ 6 s (stack resting at bottom), gentle velocity high-pass for integration offsets;
  4. up/down direction voted from lift-off and landing of each active period (stack-like lobes only),
     platform prior if undecided (iOS prior −1, from CoreMotion convention — **unverified**);
  5. hysteresis peak detection with adaptive threshold (35% of 90th-pct swing) → rep candidates;
  6. rejection: duration 0.5–15 s, verticality ≥ 0.5, rotation ≤ max(15°/s, 3× median), amplitude ≥ 40% median;
  7. sets = reps separated by > max(6 s, 2× median rep duration); groups < 2 reps rejected as noise;
  8. rest = end of last rep → start of next set's first rep (5%-of-travel boundaries);
  9. cadence per set (median period, reps/min, up/down time), flagged reliable if ≥ 3 reps and CV ≤ 0.35;
     relative amplitude (filtered estimate, **not calibrated ROM**).
- **Tools:** `npm run analyze` (replay any exported file, compare with truth, HTML debug report),
  `npm run synth` (synthetic recordings), synthetic generator for tests.

## Tested
- `npm run check`: typecheck + 40 Jest tests pass (see TESTS.md for coverage).
- iOS JS bundle builds (`expo export --platform ios`, Hermes).
- Synthetic stress: 298/300 exact at normal tempo; 188/200 on a harder sweep incl. slow tempo.

## NOT yet validated
- **Nothing has run on a real iPhone yet.** Sensor rate, noise, the sign convention, file writing/export on
  device and all detection accuracy on real stack motion are unverified until the first recording.

## Blocked on the founder (physical actions)
1. Install Node.js LTS on Windows, create a free Expo account, install Expo Go on the iPhone, run the app.
2. Perform T0 (optional) and T1 from TESTS.md and send back the exported JSON.

## Known limitations / risks (to check against real data)
- **Slow, smooth reps** (concentric ≥ 2 s, eccentric ≥ 4 s) produce accelerations near the sensor noise
  floor; long quiet stretches inside a set can be mistaken for rest. Synthetic failure rate ~15% there.
- **Short travel** (≤ 15–18 cm) reduces margin against noise.
- A **stack nudge in a short rest** can occasionally be counted as a rep and merge two sets.
- A **1-rep set** is treated as noise (minimum 2 reps per set).
- The stack must be still ≥ 6 s before the first and after the last rep for the best displacement estimate.
- Relative amplitude is an attenuated estimate, not range of motion in cm.
- Expo Go requires the app in the foreground; the screen must stay on (handled by keep-awake).
- Mounting: straps/phone must not collide with the machine frame; a loose mount adds rotation (detected
  and shown as "orientation spread" and rotation in the debug view).

## Next
1. Get T1 recording → `npm run analyze` → log results in TESTS.md, verify the iOS sign prior, check real
   noise floor / sample rate / rotation of a mounted phone, and replace synthetic assumptions with measured ones.
2. Adjust the algorithm only against real recordings (keep them in `recordings/` as regression fixtures).
3. T2/T3 for repeatability, tempo, orientation, second machine.
