# PRODUCT_DESIGN.md — authoritative product design

This is the single authoritative specification of Gym Bro's product design. PRODUCT.md summarises the thesis
and the validation gates and points here. STATUS.md says what of this is built. When this document and code
disagree, the code is behind (or the decision must be revisited explicitly — never silently).

Sections marked **CONFIRMED** are founder decisions. **OPEN** items are hypotheses/questions: do not turn them
into rules without a decision.

---

## 1. Thesis (CONFIRMED)
**Gym Bro is a memory layer for strength training.** It remembers what the user did on every exercise and
machine — load, reps, sets, rests and frequency — and brings that history back when the user needs it.
Automatic capture makes the memory reliable without manual logging; exercise-to-muscle mapping lets the memory
aggregate into body-region and muscle-level history.

Core pain: *"When I return to an exercise, machine or body region, I don't reliably remember what I did
previously."* The moment to optimise: the user walks up to a machine thinking *"what was I doing on this thing?"*
— Gym Bro answers in seconds, in context.

Value hierarchy: **1. REMEMBER → 2. RESUME → 3. COMPARE → 4. UNDERSTAND → 5. BENCHMARK (later).**

Automatic reps / sets / rests are an **enabling technology**, not the product. Longitudinal value = analysing
differences over time by exercise, machine, body region, muscle — frequency, sets, reps, load, rest,
performance progression. **No synthetic fitness / hypertrophy / progress scores.**

## 2. Interaction principles (CONFIRMED)
1. **The user provides as little context as possible.** *Persistent context is remembered; the user only
   declares what changed.* Context-entry effort must decrease over time, not stay constant.
2. **Never ask again for stable context Gym Bro already knows.**
3. In the mature product the only routinely required contextual action is **"this is the exercise I am
   doing."** For a remembered exercise the only routine adjustments are **machine** (if different) and
   **load** (if different). Everything else (region, muscles, PPL, variant, prescription) is inferred from the
   ontology, prior history, the objective, body-region priorities and session history.
4. **No manual START** and no interaction between sets (§4). "Finish now" / "Change exercise" are escapes,
   never required steps.
5. **Context should compound** (§12): track *context effort per exercise*. If the product keeps asking for body
   region, PPL, machine, variant, muscle… every time, the design has failed.

## 3. First use vs subsequent use (CONFIRMED)
- **First use** is necessarily contextual: body region → exercise → machine → variant → load. That interaction
  creates a *persistent exercise context*.
- Over time Gym Bro learns: exercises used, machines used for them, variants, loads, exercise order, workout
  composition, frequency, PPL rhythm, previous performance.
- **Subsequent use** is radically lighter: exercise **cards** (§6) restore everything; the user touches
  machine/load only if something changed.

## 4. Exercise capture state model (CONFIRMED requirement)
```
CONTEXT_SELECTED → ARMED → STABLE/WAITING → ACTIVE_SET → REST → ACTIVE_SET → REST → ACTIVE_SET → EXERCISE_COMPLETE
```
- Choosing the exercise (card or first-use selection) **arms** acquisition. The user mounts the phone;
  **placement/handling motion is ignored**. When the phone is stable the session waits for exercise motion.
- A coherent rep sequence starts Set 1 automatically. The detector may need 2+ reps to be confident; once
  confirmed, **Rep 1 is included retrospectively**.
- Sets end automatically; **rest is timed from the final rep's timestamp**; the next coherent sequence starts
  the next set. No interaction between sets.
- After the prescribed sets (default 3) are complete and confirmed: **EXERCISE COMPLETE**, persisted
  automatically (no Save), and the user returns to the session / card view.
- Implementation mapping: `ARMED → READY(=STABLE/WAITING) → ACTIVE_SET ⇄ REST → COMPLETE` in
  `src/session/machine.ts`. On-machine behaviour is **hardware-validation-pending** (Gate 0).

## 5. Exercise structure / prescription (CONFIRMED default, extensible)
- Default: **3 sets, final set intended to failure (AMRAP)**.
- The app stores the *intent* ("final set intended to failure"). It must **never claim physiological failure
  was achieved** because movement stopped.
- The model must allow other structures later (`Prescription` in `src/planning/prescription.ts`).
- OPEN: objective-specific prescription rules.

## 6. Mature session interaction: exercise cards (CONFIRMED concept, OPEN gesture)
- Subsequent sessions are proposed as **cards** of remembered or recommended exercises; the user should not
  browse the catalogue repeatedly. Example (Home):
  ```
  Suggested today: PULL
  [ Lat Pulldown ]  Technogym · 40 kg · Last: 12 / 11 / 9
  [ Seated Row ]    Matrix · 45 kg · Last: 11 / 10 / 9
  [ Biceps Curl ]   Cable · 20 kg · Last: 12 / 12 / 10
  ```
- The user classifies cards roughly as **today/selected** vs **later/not now**. Concept: *Gym Bro proposes
  compact remembered contexts; the user selects what they are actually doing.*
- A selected card restores: last machine, last load, last performance, previous comparable performance,
  default prescription. The user normally adjusts only `Machine [▾]` and `Weight [– 40 kg +]`.
- OPEN: the exact swipe/gesture. Do not build a Tinder-like gesture system before usability testing.

## 7. Machine availability (CONFIRMED)
- Changing machine must be **cheap** (the suggested one may be occupied).
- Switching to another compatible machine switches to **that machine's history**. Kilograms from the original
  machine must **not** be presented as comparable.

## 8. Suggested sessions, sequencing, workouts (CONFIRMED principles)
- Gym Bro eventually proposes a set of exercise cards for the next session, combining: objective, body-region
  priorities, PPL balance, previous sessions, recency, exercise history, preferences inferred from usage.
  Recommendations are **suggestions, never mandatory**.
- The **week stays broadly balanced around Push / Pull / Legs**. PPL is a planning structure the user never
  declares. Example reasoning: after Push → Pull → Push with no recent Legs, surface a Legs session.
- Accepted session shown together (`TODAY — PULL: 1. Lat Pulldown 2. Seated Row …`); after each exercise,
  mark it done and show **Next**. The plan is **not rigid**: choose another first, skip, replace, add.
- **Workouts are implicit**: no "create workout" step. A workout begins when the first selected exercise is
  actually performed; exercises done together form it; its dominant PPL split is derived.
- **Session completion** is inferred when all selected exercises are complete → compact summary
  (`PULL COMPLETE · 45 min · 4 exercises · 12 sets`). The user may add an exercise, reopen one, or finish
  early. An **inactivity fallback** closes unplanned/interrupted sessions (not the primary UX).
  **"Finish workout" is never mandatory.**
- OPEN: ranking formula; inactivity timeout value; when/how suggestions expand beyond the initial region focus.

## 9. Objective vs targeted body region (CONFIRMED — never conflate)
- **Objective** = overall training strategy. Initial list only: *Get bigger*, *Keep in shape*.
- **Targeted / priority body region(s)** = one or more regions the user wants to prioritise.
- *Objective governs the overall strategy. A targeted region narrows the starting search space and biases
  future exercise selection. It is **not a permanent filter**.* E.g. Get bigger + Arms starts from a manageable
  set of arm exercises, but future workouts are not arms-only; balanced Push/Pull/Legs stays relevant.
- The targeted region is therefore both an **onboarding scope reducer** and a **continuing preference
  signal**, combined with actual history over time.

## 10. Canonical ontology vs decision layer (CONFIRMED)
- **One canonical ontology of stable facts** — never separate ontologies per Objective × Region:
  - TrainingSplit: Push, Pull, Legs (+ Other for accessory work)
  - BodyRegion: Chest, Back, Shoulders, Arms, Legs, Core, …
  - Muscle (canonical muscles / sub-muscles)
  - MovementPattern (kinematic): horizontal press, vertical press, horizontal/vertical pull, knee extension,
    hip hinge, …
  - Exercise; Equipment/Machine
  - **ExerciseVariant** = exercise × compatible equipment × relevant variant
  - ExerciseMuscleContribution = PRIMARY / SECONDARY (no percentages)
- Example fact: Lat Pulldown → Pull → Back → vertical pull → primary lats → secondary biceps, teres major… →
  compatible with several machines.
- The ontology must **not** encode statements like "Lat Pulldown is for users who want to get bigger and target
  arms". A **separate decision/recommendation layer** (later) ranks candidates using objective, region
  priorities, PPL balance, recent history, previous exercises, machine history, performance history,
  session-duration constraints and user choice.
- Relationships are **many-to-many**: a muscle is trained by many exercises; an exercise trains several
  muscles; an exercise runs on several machines; a machine supports several exercises.
- **ExerciseVariant is the unit of performance comparability.** Lat Pulldown on a Technogym machine with wide
  grip is not automatically comparable in kg with Lat Pulldown on a mechanically different machine. Loads are
  never compared across machines unless comparability is explicitly established.
- BodyRegion → Exercise remains useful for catalogue browsing and first-use scoping only; it is **not** the
  product's principal hierarchy.

## 11. Day-1 onboarding (CONFIRMED fields, OPEN extras)
- A short onboarding before normal use. Confirmed: **year of birth, height, weight, objective, priority body
  region(s)**. Kept separate from workout context.
- OPEN (not requirements): training experience, sessions per week, typical workout duration,
  injuries/constraints.

## 12. Training memory (CONFIRMED)
Every completed exercise strengthens memory:
- **ExerciseVariant**: last date, machine, load, sets, reps, rests, previous comparable session, trend.
- **Machine**: last use, exercises performed, machine-specific performance history.
- **Body region**: last trained, frequency, sets, exercise mix, recent history.
- **Muscle**: direct (PRIMARY) exposure and contributing (SECONDARY) exposure kept separate; frequency, sets,
  recency, change over time.
- Corrections by the user win over detected counts and are marked as such; only complete exercises are memory.
- Core analytical primitive: **current period/session vs previous comparable period/session** (last session vs
  previous; last 30 days vs previous 30; last 8 weeks vs previous 8).

**Context-effort metric** (design KPI): number of user decisions per exercise. Day 1: several (region,
exercise, machine, variant, load). Target after repeated use: **one** (select the exercise), occasionally two
or three (change machine, adjust load).

## 13. Not now (CONFIRMED deferrals — architecture must not block them)
Sophisticated recommendation algorithm, ML ranking, cross-user cohorts, percentile benchmarking, automated
progression advice, medical/physiological recommendations, objective-specific "science", new DSP rules,
automatic exercise recognition, backend/accounts, large analytics dashboards. First we need real usage and
real weight-stack recordings.

## 14. OPEN design questions (need founder decisions)
1. Onboarding fields beyond the confirmed five.
2. Objective-specific prescription rules (sets, rep ranges, rest targets) — if any.
3. Exact card interaction (tap vs swipe; how "later / not now" is captured and used).
4. Recommendation ranking formula and how history, priorities and PPL balance are weighted.
5. Inactivity timeout that closes an implicit workout (code currently uses a provisional 90 min gap).
6. When and how suggestions expand beyond the initial body-region focus.
7. Progression suggestions (whether, when, how) — explicitly not now.
8. How machines are identified at a gym level (brand/model, per gym, user-named?) — today equipment is a
   generic type ("Lat pulldown machine"), so "Technogym vs Matrix" is not yet modelled.
9. Whether and how comparability across machines can ever be "explicitly established".
10. Whether 1-rep sets / drop sets / supersets need modelling.

## 15. Where this lives in the code (see STATUS.md for completeness)
| Concept | Code |
|---|---|
| Ontology (facts) | `src/catalogue/` (TrainingSplit, MovementPatternId, Exercise, Equipment, ExerciseVariant, contributions) |
| Memory (REMEMBER/COMPARE) | `src/memory/history.ts`, `queries.ts` |
| Remembered context, machine switch (RESUME) | `src/memory/context.ts` |
| Profile (objective ≠ region priority) | `src/profile/profile.ts` |
| Prescription, scope, cards, suggestions, implicit workouts | `src/planning/` |
| Capture state machine | `src/session/machine.ts` (+ adapters) |
