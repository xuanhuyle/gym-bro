# PRODUCT.md — thesis, validation gates, roadmap

**The authoritative product design is [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md)** (confirmed decisions, interaction
principles, state model, ontology vs decision layer, memory, open questions). This file only summarises it and
tracks the validation gates. Do not duplicate design rules here.

## Thesis
**Gym Bro is a memory layer for strength training.** It remembers what the user did on every exercise and
machine — load, reps, sets, rests and frequency — and brings that history back when the user needs it.
Automatic capture makes the memory reliable; exercise-to-muscle mapping lets that memory aggregate into
body-region and muscle-level history.

Pain: *"When I return to an exercise, machine or body region, I don't reliably remember what I did previously."*

Value hierarchy: **REMEMBER → RESUME → COMPARE → UNDERSTAND → BENCHMARK (later)**. Automatic rep / set / rest
capture is the enabling technology, not the product.

Design in one line: *persistent context is remembered; the user only declares what changed* — in the mature
product the routine action is "this is the exercise I am doing", occasionally changing machine or load.

## Gate 0 (current technical validation): can an iPhone capture a weight-stack workout?
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
backend, accounts, benchmarking/percentiles, recommendations, photos, social. (The ontology stays small but
canonical; see PRODUCT_DESIGN.md §10.)

## Roadmap (each step only if the previous one holds)
- **Gate 0 — capture** (now): real weight-stack recordings validate automatic reps / sets / rests and arming.
- **Gate 1 — daily memory loop**: robustness across machines, tempos, mounts; cards restore remembered context;
  cheap machine switch; corrections; measure *context effort per exercise* (target ≈ one action).
- **Gate 2 — onboarding & suggested sessions v1**: confirmed onboarding fields, objective vs region priority,
  PPL-balanced session suggestions as cards (simple, explainable rules; no ML), implicit workouts and
  session-complete summaries.
- **Gate 3 — understand**: period/session vs previous comparable period/session per variant, machine, region
  and muscle (direct vs contributing). Facts, no scores.
- **Later — benchmark**: cohorts/percentiles (needs backend and consent); progression suggestions if decided.
