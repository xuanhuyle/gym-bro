# PRODUCT.md — thesis and roadmap

## Thesis
Strength trainees don't reliably know what they actually did or how it adds up. A product that
**automatically records** training, **maps** it to what was trained and **reports** progress and gaps
can become the default training log — if the capture is effortless and trustworthy.

## Three value layers
1. **Counting** — automatically record what the user did: reps, sets, rest, later cadence/amplitude.
2. **Mapping** — each exercise → Push/Pull/Legs, body region, muscles, sub-muscles.
3. **Reporting** — what was trained, progression, gaps vs. objective, later cohort comparisons/percentiles.

Counting is the foundation: if it is not trustworthy, mapping and reporting have nothing to stand on.

## Interaction model: one exercise
The user provides the semantic context; the phone captures the temporal workout data.

1. Choose **body region** → catalogue shows the relevant **exercises**.
2. Choose the exercise → catalogue shows the compatible **machines/equipment**.
3. Choose the machine and, where relevant, the **variant** (grip, foot position…).
4. The app shows, deterministically from that exercise variant, the **primary** and **secondary** muscles
   (qualitative roles, no invented activation percentages).
5. Set the **weight** — pre-filled with the last weight used for that variant (or the same exercise on the
   same machine).
6. Strap the iPhone to the moving top plate of the stack, press **START EXERCISE** once.
7. Set 1 → when valid reps stop, the app enters **REST** by itself; the rest is timed from the end of the
   last valid rep (not from when the app confirmed the set was over).
8. A coherent new sequence of reps (not one bump) ends the rest and starts Set 2, whose first rep counts.
9. Set 3 ends → the exercise is automatically **COMPLETE and SAVED**. No button between sets.

Live display (glanceable during rests):
```
LAT PULLDOWN
35 kg
SET 1   12 reps
REST    00:47
SET 2   11 reps
REST    01:12
SET 3    9 reps
SAVED ✓
```
Everything is persisted locally throughout (raw samples every 2 s, session state after every meaningful
event), so a crash does not lose Set 1 or Set 2. Three sets is the default; the domain model supports any
number. Afterwards the user can review and correct counts; corrections are stored separately from the
algorithm's output. A manual "Finish exercise now" exists as a safety valve.

Semantic objects: BodyRegion, Exercise, Equipment (machine), ExerciseVariant (exercise × compatible
equipment × variant — the unit that muscle mapping and weight memory attach to), Muscle,
ExerciseMuscleContribution (PRIMARY / SECONDARY).

## Gate 0 (current): can an iPhone count a weight-stack workout?
Setup: the user straps their own iPhone to the moving top plate of a selectorized machine; the exercise is
chosen from the catalogue. No exercise recognition. The phone records its motion; the app detects reps,
groups them into sets and measures rest — now live, as a continuous hands-free session.

Status of evidence: acquisition on a real iPhone at ~100 Hz is confirmed by the founder. Counting and
live set segmentation on a real weight stack are **not yet validated**.

**Pass criterion (proposed; to be confirmed with the founder after the first real data):**
on controlled workouts (e.g. 10/12/15 reps, ~20 s rests, deliberate noise during rests), across several
recordings and at least 2 machines: the live session reaches SAVED by itself with the correct set count
every time, reps within ±1 per set in ≥ 90% of sets, rest duration within ±2 s. Anything short of that
tells us which layer to fix (sensor, mounting, detector, session rules) or whether to change the capture approach.

Explicitly out of scope for Gate 0: external/Bluetooth sensors (Movesense), video, exercise recognition,
backend, accounts, benchmarking/percentiles, recommendations, photos, a full exercise ontology, social.

## Roadmap after Gate 0 (only if counting works)
- Gate 1: robustness — several machines, users, tempos, phone mounts; user-correction loop in daily use;
  decide whether the phone-on-stack approach is viable as a product (mounting UX!) or only as a validation
  tool before dedicated sensors.
- Gate 2: mapping — grow the catalogue (machines actually used in gyms), sub-muscles, validate mappings with a
  coach/physio; per-muscle volume from sets × reps × load.
- Gate 3: reporting — per-user history, volume per muscle group, progression, gaps vs. goals.
- Later: cadence/ROM quality metrics, cohorts and percentiles (needs a backend and consent), wearables.
