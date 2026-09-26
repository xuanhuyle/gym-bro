# PRODUCT.md — thesis and roadmap

## Thesis
**Gym Bro is a memory layer for strength training.** It remembers what the user did on every exercise and
machine — load, reps, sets, rests and frequency — and brings that history back when the user needs it.
Automatic capture makes the memory reliable; exercise-to-muscle mapping lets that memory aggregate into
body-region and muscle-level history.

## The user pain
> "When I return to an exercise, machine or body region, I don't reliably remember what I did previously."

- What weight did I use last time? How many reps? How many sets? How long did I rest?
- When did I last do this exercise? Use this machine? Train this body region?
- Am I doing more / less / better than before?

The moment we optimise for: **a user walks up to a machine and thinks "what was I doing on this thing?"** —
Gym Bro answers in a few seconds, in context, without opening an analytics screen.

## Hierarchy of value
1. **REMEMBER** — what did I do before? (last load, reps per set, rests, date; per variant, machine, region)
2. **RESUME** — continue immediately from where I left off (reopen recent exercises, weight pre-filled
   from memory, the previous performance visible before starting).
3. **COMPARE** — how does today differ from the previous comparable session / period?
4. **UNDERSTAND** — how is my training evolving by exercise, machine, body region and muscle?
5. **BENCHMARK** — later: progression compared with relevant cohorts.

Supporting capabilities (means, not the product):
- **Automatic capture** (phone on the weight stack → reps, sets, rests) makes the memory complete and
  reliable without manual logging. It is an enabling technology, not the value proposition.
- **Catalogue + deterministic muscle mapping** (ExerciseVariant → PRIMARY/SECONDARY muscles) lets the
  memory aggregate from exercise level to muscle and body-region level.
- **User corrections** keep the memory truthful when capture is wrong; they are stored separately from
  detector output, and memory prefers them.

## Memory principles
- **Comparable means the same ExerciseVariant** (exercise × machine × variant). Loads and performance are
  never compared across different machines or mechanically different variants.
- **Facts, not scores.** Frequencies, sets, reps, loads, rests, dates. No synthetic fitness, progress,
  hypertrophy or "body-region" scores; no invented activation percentages. PRIMARY and SECONDARY muscle
  exposure are always kept separate.
- **Fallbacks are labelled.** If memory has to borrow (e.g. the weight from another grip on the same machine),
  the UI says so instead of presenting it as "last time".
- **Contextual, not buried.** History appears where the decision is made (choosing region, machine, variant,
  weight), not only in dashboards.
- **Local first.** History lives on the phone; no backend or account for now.

## What the user sees today
- Home: "Continue where you left off" — recent exercise variants with their last performance; one tap reopens
  the setup with region, exercise, machine, variant and weight already chosen.
- Setup: as soon as a region is chosen → when it was last trained and 7/30-day sessions and sets; a machine →
  what was last done on it; a variant → **LAST TIME** (date, kg, reps per set, rests) and **PREVIOUS** with the
  change; the weight field pre-filled from memory with "Last time: 40 kg · 12/11/10" beside it.
- Review after a session: compared with the previous session of the same variant.

## Longitudinal analysis (direction, not yet built as UI)
Central primitive: **compare a selected period or session with the previous comparable period or session**
(last session vs previous; last 30 days vs previous 30; last 8 weeks vs previous 8).
- Body region: training frequency, sets, exercise mix, recency.
- Muscle: direct (PRIMARY) frequency and sets, contributing (SECONDARY) sets, change over time.
- ExerciseVariant: load, reps, sets, rest, performance progression.
The pure query layer (`src/memory/`) already provides the building blocks (variant/machine/region/muscle
memory, session diff, period-vs-previous-period counts).

## Capture interaction: one exercise
The user provides the semantic context; the phone captures the temporal workout data.

1. Choose **body region** → catalogue shows the relevant **exercises** (memory: when the region was last trained).
2. Choose the exercise → catalogue shows the compatible **machines/equipment** (memory: last use of the machine).
3. Choose the machine and, where relevant, the **variant** (memory: each grip's last performance).
4. **No START button.** As soon as the exercise variant is resolved (picked, or the only one), the exercise is
   **ARMED**: acquisition starts with the phone still in the user's hand. Tapping a recent exercise on Home arms
   it directly. The armed screen shows LAST TIME / PREVIOUS, the muscles (primary / secondary), and the
   **weight** resumed from memory — editable while armed, correctable afterwards.
5. The user straps the iPhone to the moving top plate. This **placement motion is ignored**. When the phone has
   been still on the stack for a moment the session is **READY**.
6. Set 1 starts by itself on a coherent sequence of valid reps; **all of them, including the first, are
   back-filled** into Set 1. (If stillness is never detected, a longer coherent run still starts Set 1.)
   Picking the phone up again before Set 1 re-arms. "Change exercise" discards an armed recording.
7. Set 1 → when valid reps stop, the app enters **REST** by itself; the rest is timed from the end of the
   last valid rep (not from when the app confirmed the set was over).
8. A coherent new sequence of reps (not one bump) ends the rest and starts Set 2, whose first rep counts.
9. Set 3 ends → the exercise is automatically **COMPLETE and SAVED**. No user action between choosing the
   exercise and automatic completion.

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

## Roadmap after Gate 0 (only if capture works)
- Gate 1: robustness — several machines, users, tempos, phone mounts; user-correction loop in daily use;
  decide whether the phone-on-stack approach is viable as a product (mounting UX!) or only as a validation
  tool before dedicated sensors.
- Gate 2: mapping — grow the catalogue (machines actually used in gyms), sub-muscles, validate mappings with a
  coach/physio; per-muscle volume from sets × reps × load.
- Gate 3: understand — period-vs-previous-period comparisons per variant, body region and muscle (direct vs
  contributing), exercise mix and recency; still facts, no opaque scores.
- Later: benchmark against relevant cohorts (needs a backend and consent), cadence/ROM quality, wearables.
