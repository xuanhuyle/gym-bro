# STATUS.md — what is implemented, tested, blocked, next

_Last updated: 2026-09-26 · analysis `g0-1` (unchanged) · recording schema v1 · session schema v1 · catalogue `cat-1` · Expo SDK 57_

## Implemented
- **Exercise catalogue** (`src/catalogue/`): 5 body regions, 13 Push/Pull/Legs exercises, 14 stack machines,
  24 exercise variants, 22 muscles; PRIMARY/SECONDARY contributions per variant; integrity validator.
  Last-used weight per variant (falls back to same exercise + machine, other variant).
- **Setup flow**: Body region → Exercise → Machine → Variant (only when there are several) → muscle
  preview → weight (pre-filled, ±2.5 kg) → START EXERCISE. Remembers the last selection.
- **Continuous exercise session** (`src/session/`):
  - pure state machine READY → ACTIVE_SET → REST → … → COMPLETE driven by rep events + watermark ticks;
    rest timed from the last valid rep's end; new set only after a coherent sequence (≥ 2 reps with gaps
    ≤ 6 s), whose first rep belongs to the new set; isolated movements ignored and logged; rest revoked if a
    slow rep proves the set had not ended; final set needs 20 s confirmation (completion is irreversible);
    `targetSets` configurable (default 3); manual finish; auto-complete after a 15-min rest;
  - windowed live detector: re-runs the **unchanged** analysis engine on the last 90 s every 2 s, releases
    reps 2.5 s after they end (none before 20 s of history), de-duplicates by rep span, locks the up/down
    direction at the first decisive vote;
  - replay driver (same code path) for recordings and synthetic data; persisted session record
    (`<id>.session.json`, selection + muscles + weight + state), saved after every meaningful change.
- **Live session screen**: exercise, kg, per-set reps, live REST timer, SAVED; "Finish exercise now" safety
  valve; raw 100 Hz recording underneath exactly as before.
- **Review screen**: live session result (sets, rests, muscles, why it ended) + offline re-analysis + debug
  chart + ground-truth/correction editor (stored separately in `userReported`) + comparisons + export.
- **Export JSON** now also embeds the live session result (`liveSession`); import restores it.
- **CLI** `npm run analyze`: offline analysis + phone's live result (if present) + live-session replay, vs truth.
- **Developer mode** (switch on Home): the previous free-text raw recorder with manual STOP, and import.
- Unchanged: sensor acquisition, recording format, analysis engine and its thresholds, debug view.

## Tested
- `npm run check`: typecheck + **88 Jest tests** pass (all 40 previous tests kept; see TESTS.md).
- iOS JS bundle builds (`expo export --platform ios`).
- Founder: the app runs on a real iPhone and records DeviceMotion at ~100 Hz (acquisition only, no stack).

## NOT yet validated (hardware-validation-pending)
- Rep counting, set segmentation, rest timing and automatic completion **on a real weight stack**.
- The live (windowed) detector is less accurate than offline analysis of the whole recording on synthetic
  data: 86/100 randomised normal-tempo workouts exact live vs 99% offline (errors: ±1 rep at set edges; a
  rest disturbance occasionally counted into the next set). Not tuned, by design, until real data exists.
- The iOS up/down sign prior (−1) and the real noise floor of a strapped phone.

## Known UX consequences of the current parameters (to revisit with real data)
- Counts appear ~3–5 s after each rep (settle delay + 2 s processing cadence).
- REST appears ~13–15 s after the last rep (10 s confirmation + latency) with the timer already running
  from the last rep; SAVED appears ~23–25 s after the last rep of Set 3.
- A set must have ≥ 2 reps; a 1-rep "set" is treated as an isolated movement.
- Start of the session: nothing is released during the first 20 s of recording (reps are released late, not lost).
- An interrupted session (app killed) keeps its provisional sets but cannot be resumed; start a new one.

## Blocked on the founder (physical action)
The first real weight-stack session — protocol **T1-session** in TESTS.md.

## Next
1. Analyse the T1-session export: phone live result vs offline vs replay vs truth (`npm run analyze`).
2. Only then adjust detector/session parameters (settle delay, set-end confirmation, coherence rule) and,
   if needed, the analysis engine — against real recordings kept in `recordings/` as fixtures.
3. T2/T3: repeatability, tempos, mount orientation, second machine.
