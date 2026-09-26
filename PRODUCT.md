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

## Gate 0 (current): can an iPhone count a weight-stack workout?
Setup: the user straps their own iPhone to the moving top plate of a selectorized machine and enters the
exercise context (e.g. Pull → Back → Lat Pulldown → Wide Grip → 35 kg). No exercise recognition.
The phone records its motion; the app detects reps, groups them into sets and measures rest.

**Pass criterion (proposed; to be confirmed with the founder after the first real data):**
on controlled workouts (e.g. 10/12/15 reps, ~20 s rests, deliberate noise during rests), across several
recordings and at least 2 machines: exact set count every time, total reps within ±1 per set in ≥ 90% of
sets, rest duration within ±2 s. Anything short of that tells us which layer to fix (sensor, mounting,
algorithm) or whether to change the capture approach.

Explicitly out of scope for Gate 0: external/Bluetooth sensors (Movesense), video, exercise recognition,
backend, accounts, benchmarking/percentiles, recommendations, photos, a full exercise ontology, social.

## Roadmap after Gate 0 (only if counting works)
- Gate 1: robustness — several machines, users, tempos, phone mounts; user-correction loop in daily use;
  decide whether the phone-on-stack approach is viable as a product (mounting UX!) or only as a validation
  tool before dedicated sensors.
- Gate 2: mapping — minimal exercise → muscle model for the machines actually used.
- Gate 3: reporting — per-user history, volume per muscle group, progression, gaps vs. goals.
- Later: cadence/ROM quality metrics, cohorts and percentiles (needs a backend and consent), wearables.
