# STATUS.md — implemented / design target / validation pending / deferred

_Last updated: 2026-09-26 · analysis `g0-1` (unchanged) · recording schema v1 · session schema v1 · catalogue `cat-2` · Expo SDK 57_

The authoritative design is PRODUCT_DESIGN.md. This file says how much of it exists. Four categories:
**A. implemented today**, **B. product-design target (not built)**, **C. technical validation pending**,
**D. intentionally deferred**.

## A. Implemented today

### A1. Capture infrastructure (enabling technology)
- Sensor acquisition: DeviceMotion 100 Hz, native timestamps, appended to disk every 2 s, keep-awake,
  background events logged. _Founder-confirmed on a real iPhone (~100 Hz)._
- Recording format (meta JSON + raw CSV), JSON export (with the live session result), import, replay.
- Offline analysis engine `g0-1` (`src/analysis/`, unchanged): gravity-referenced vertical axis, anchored double
  integration, rep detection with rejection rules, sets, rests, cadence.
- Capture state machine (`src/session/`): **ARMED → READY → ACTIVE_SET ⇄ REST → COMPLETE** (= design
  CONTEXT_SELECTED → ARMED → STABLE/WAITING → … → EXERCISE_COMPLETE). **No START**: choosing the exercise arms;
  placement ignored; Set 1 starts on a coherent rep sequence with Rep 1 back-filled; rest from the last rep; no
  taps between sets; auto-complete after the prescribed sets; "Finish now" / "Change exercise" as escapes.
  Adapters: windowed detector around the unchanged engine + stillness/handling monitor. Persisted after every
  meaningful change.
- CLI: `npm run analyze` (offline + phone live result + live replay vs truth), `npm run synth`.

### A2. Canonical ontology (`src/catalogue/`, `cat-2`)
- Facts only: TrainingSplit (Push/Pull/Legs/Other), 5 body regions, 22 muscles, **kinematic MovementPattern**
  (vertical pull, horizontal press, knee extension, …), 13 exercises, 14 stack machines, 24 ExerciseVariants,
  PRIMARY/SECONDARY contributions. Many-to-many queries (exercise ↔ machines, machine ↔ exercises,
  muscle ↔ variants with role). Integrity validator.
- Corrected in this iteration: `Exercise.movementPattern` used to hold the PPL split; it is now `split`, and
  `movementPattern` is kinematic (catalogue version bumped). Recordings keep the split under their legacy field
  name (schema v1 unchanged, documented).

### A3. Training memory (REMEMBER / RESUME / COMPARE), local only
- History from COMPLETE sessions; user corrections (reps, rests, weight) win and are marked `source`.
- Queries: variant memory (last, previous comparable, change), resume weight (exact → unfinished-session
  weight, labelled → labelled same-machine fallback; never another machine), machine memory, body-region memory
  (7/30 days), muscle memory (PRIMARY vs SECONDARY separate), session diff, period vs previous period.
- **Remembered context** (`src/memory/context.ts`): last machine + variant + load per exercise;
  **machine switch** to another compatible machine moves to that machine's history (no kg carried over).
- UX: Home cards ("Continue where you left off": machine, last load/performance, previous, plan) → one tap arms
  with everything restored; selection shows region recency, machine recall, per-grip last performance; armed
  screen shows LAST TIME / PREVIOUS, plan, editable weight, **cheap machine switch**, muscles; review compares
  with the previous comparable session.

### A4. Design scaffolding (pure, tested, not yet in the UI)
- `src/profile/`: UserProfile with the confirmed onboarding fields; objective and region priorities separate.
- `src/planning/`: `Prescription` (default 3 sets, final set intended to failure — intent only, stored on new
  session records and driving the set count); `startingScope` (priority regions first, whole ontology still
  eligible); `ExerciseCard`; `WorkoutSuggestion` / `PlannedExercise` with derived split and flexible progress;
  implicit `WorkoutSession` grouping with derived split/regions (provisional 90-min gap).
- Starting an exercise no longer requires a body region (derived from the exercise for cards/suggestions).

## B. Product-design target (documented, not built)
- Day-1 onboarding screens (year of birth, height, weight, objective, priority regions) and profile storage.
- Suggested-session cards ("Suggested today: PULL") driven by objective, priorities, PPL balance and history;
  today vs later classification; the decision/ranking layer itself.
- Session view: TODAY list with ✓ done / Next, skip / replace / add; automatic return to it after EXERCISE
  COMPLETE; SESSION COMPLETE summary (split, duration, exercises, sets); inactivity fallback.
- Machine identity at gym/brand level (e.g. Technogym vs Matrix) — equipment is a generic type today.
- Context-effort measurement per exercise (instrumentation) to verify context compounding.
- UNDERSTAND views: period/session vs previous comparable period/session per variant, machine, region, muscle.

## C. Technical validation pending (Gate 0)
- Rep counting, set segmentation, rest timing and auto-completion **on a real weight stack**.
- Arming on a real phone: stillness thresholds (still = RMS |user accel| ≤ 0.15 m/s² and RMS rotation ≤ 4 °/s
  for 2 s; handling = RMS rotation > 30 °/s over 0.5 s) are synthetic-only assumptions.
- Live detection on synthetic data: 84/100 exact without placement, 85/100 with placement (offline: 99%).
- The engine wants ~6 s of stillness before the first rep; READY asks the user to wait ~5 s.
- iOS up/down sign prior (−1); real noise floor of a strapped phone.
- UX timing with current parameters: counts ~3–5 s after each rep (none before 20 s of clean history after
  READY — released late, not lost); REST shown ~13–15 s after the last rep (timer from the last rep); SAVED
  ~23–25 s after the last rep of Set 3; ≥ 2 reps per set; interrupted sessions cannot be resumed.
- Until validated, memory quality = capture + user corrections.

## D. Intentionally deferred (architecture must not block)
Recommendation algorithm / ML ranking, cohorts and percentiles, progression advice, medical/physiological
recommendations, objective-specific "science", new DSP rules, automatic exercise recognition, backend/accounts,
large dashboards, swipe gesture system (until usability testing).

## Tested
- `npm run check`: typecheck + **171 Jest tests** pass (all previous tests kept; see TESTS.md).
- iOS JS bundle builds (`expo export --platform ios`).
- Founder: app runs on a real iPhone, DeviceMotion ≈ 100 Hz (no stack yet).

## Blocked on the founder (physical action)
The first real weight-stack session — protocol **T1-session** in TESTS.md (also the first test of automatic
arming). Open product questions needing decisions are listed in PRODUCT_DESIGN.md §14.

## Next
1. T1-session: analyse phone live result vs offline vs replay vs truth (`npm run analyze`).
2. Adjust detector/session parameters only against real recordings (kept in `recordings/`).
3. T2/T3: repeatability, tempos, mount orientation, second machine (exercises machine switch + memory).
4. Then Gate 1/2 items from B, starting with the session view and onboarding once the open questions are decided.
