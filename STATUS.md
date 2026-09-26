# STATUS.md — what is implemented, tested, blocked, next

_Last updated: 2026-09-26 · analysis `g0-1` (unchanged) · recording schema v1 · session schema v1 · catalogue `cat-1` · Expo SDK 57_

Product framing: Gym Bro is a **memory layer for strength training** (PRODUCT.md). Status is reported per
layer: capture infrastructure (enabling) → training memory (the product today) → longitudinal analysis
(next) → hardware validation (the open risk under capture).

## 1. Capture infrastructure (enabling technology)
- **Sensor acquisition**: expo-sensors DeviceMotion at 100 Hz, native timestamps, samples appended to disk every
  2 s, keep-awake, app background events logged. _Founder-confirmed on a real iPhone (~100 Hz)._
- **Recording format**: meta JSON + raw CSV; JSON export (with the live session result embedded), import, replay.
- **Offline analysis engine** (`src/analysis/`, `g0-1`, unchanged): gravity-referenced vertical axis,
  anchored double integration, hysteresis rep detection with rejection rules, set grouping, rests, cadence.
- **Continuous session** (`src/session/`): pure state machine **ARMED → READY → ACTIVE_SET ⇄ REST → COMPLETE**
  (rest timed from the last rep, coherent sequence to start a set, isolated movements ignored, configurable
  set count, auto-complete, manual finish). **No START button**: choosing the exercise variant (or tapping a
  recent exercise on Home) arms acquisition. ARMED ignores placement motion; a still phone → READY; Set 1
  starts on a coherent rep sequence with all its reps back-filled (first included); handling before Set 1
  re-arms; if stillness is never detected, 3 coherent valid reps still start Set 1. Adapters: windowed rep
  detector around the unchanged engine (from READY on it analyses only data after the still moment, so
  placement cannot skew its statistics or up/down vote; candidates truncated at the data edge are skipped)
  and a stillness/handling monitor (RMS of |user acceleration| and |rotation rate|). Replay driver; session
  record persisted after every meaningful change.
- **Catalogue** (`src/catalogue/`): 5 regions, 13 Push/Pull/Legs exercises, 14 stack machines, 24 variants,
  22 muscles, PRIMARY/SECONDARY contributions; the key that makes memory aggregate beyond one exercise.
- **Screens**: selection (auto-arms), live session (ARMED/READY with memory + editable weight + "Change exercise"; then
  SET/REST/SAVED), review with correction editor (now incl. weight), debug chart, developer mode.
- **CLI**: `npm run analyze` (offline + phone live result + live replay vs truth), `npm run synth`.

## 2. Training memory (REMEMBER / RESUME / COMPARE) — implemented, local only
- **History** (`src/memory/history.ts`): completed sessions → chronological entries (deterministic order,
  ties by id); the user's corrected counts win over detected ones, `source` records which; interrupted
  sessions are excluded.
- **Queries** (`src/memory/queries.ts`, pure, tested):
  - variant memory: last session (date, kg, reps per set, rests), previous comparable session, change
    (Δkg, Δreps, Δsets, per-set Δ, Δmean rest), sessions in last 30 days / total, recent loads;
  - resume weight: exact-variant history → weight chosen for an unfinished session of that variant (labelled)
    → labelled fallback from another variant of the same exercise on the same machine; never another machine;
  - machine memory: last use, recent sessions, variants done on it;
  - body-region memory: last trained, sessions and sets in 7 / 30 days, recent exercises (region membership
    from the catalogue, so a two-region exercise counts for both);
  - muscle memory: direct (PRIMARY) and contributing (SECONDARY) exposure kept separate — last date,
    sessions/sets in 7 / 30 days, responsible variants;
  - `previousComparable` (a given session vs the one before it), `recentVariants`, `comparePeriods`.
- **In the UX**:
  - Home: "Continue where you left off" — recent variants with last performance; one tap reopens setup fully
    pre-selected with the weight resumed.
  - Selection: region → last trained + 7/30-day sessions/sets; machine → what was last done on it and each
    grip's last performance. Armed screen: LAST TIME (date, kg, reps, rests, source) and PREVIOUS with the
    change; weight pre-filled from memory with "Last time: 40 kg · 12/11/10" beside it, or a labelled fallback.
  - Review: "Compared with the previous session" (same variant only).
- The weight book (weight chosen when arming / edited while armed) remains the second-priority resume source.
- A corrected weight (review screen) replaces the recorded one in memory.

## 3. Longitudinal analysis (UNDERSTAND) — building blocks only
- Available as pure queries: session diff for the same variant; period vs previous period counts
  (sessions, sets, reps) for any filter (variant, region, muscle); 7/30-day windows for regions and muscles.
- Not built yet (deliberately): screens for period comparisons, exercise-mix and frequency trends, muscle
  change over time. No scores of any kind.

## 4. Hardware validation still pending
- Rep counting, set segmentation, rest timing and automatic completion **on a real weight stack**.
- **Arming on a real phone**: stillness thresholds (still = RMS |user accel| ≤ 0.15 m/s² and RMS rotation
  ≤ 4 °/s for 2 s; handling = RMS rotation > 30 °/s over 0.5 s) are synthetic-only assumptions. Risks: a
  vibrating environment never reaching "still" (fallback: 3 coherent reps), or a wobbly mount rotating enough
  to look like handling before Set 1.
- Live (windowed) detection on synthetic data: 84/100 exact without placement and 85/100 with a realistic
  placement at the start (offline whole-recording analysis: 99%). Not tuned before real data.
- The engine needs ~6 s of stillness before the first rep for its best estimate; the READY screen asks the user
  to wait ~5 s. Starting a set 1–2 s after the phone settles can cost a rep (seen on synthetic data).
- iOS up/down sign prior (−1) and the real noise floor of a strapped phone.
- Known UX timing of current parameters: counts ~3–5 s after each rep (none before 20 s of clean history
  after READY — released late, not lost); REST shown ~13–15 s after the last rep (timer already running from
  the last rep); SAVED ~23–25 s after the last rep of Set 3; ≥ 2 reps per set; interrupted sessions keep
  provisional sets but cannot be resumed.
- Consequence for memory: until validated, the history is only as good as capture + the user's corrections.
  The review screen's correction editor (reps, rests, weight) is the safeguard.

## Tested
- `npm run check`: typecheck + **118 Jest tests** pass (all previous 88 kept; see TESTS.md).
- iOS JS bundle builds (`expo export --platform ios`).
- Founder: app runs on a real iPhone, DeviceMotion ≈ 100 Hz (no stack yet).

## Blocked on the founder (physical action)
The first real weight-stack session — protocol **T1-session** in TESTS.md (now also the first test of automatic
arming: choose the exercise with the phone in hand, strap it, never press START). Afterwards the session appears in
"Continue where you left off" and as LAST TIME the next time the same exercise variant is armed.

## Next
1. Analyse the T1-session export: phone live result vs offline vs replay vs truth (`npm run analyze`).
2. Only then adjust detector/session parameters — against real recordings kept in `recordings/` as fixtures.
3. T2/T3: repeatability, tempos, mount orientation, second machine (also exercises machine/region memory).
4. Memory: a first comparison view (last 30 days vs previous 30) per region/variant once there is real history.
