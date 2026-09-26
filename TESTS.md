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
| `src/catalogue/__tests__/catalogue.test.ts` | Ontology: split vs kinematic movement pattern distinct; one exercise → several machines; one machine → several exercises; one muscle → many exercises with roles kept; no objective/recommendation statements in the ontology; primary region derivation. Seed data integrity; region → exercises (incl. multi-region); exercise → compatible machines; variants per exercise+machine; variant → primary/secondary muscles; same machine different mapping (pec deck fly vs reverse fly); same machine different variant (curl bar vs rope); extending by data only; bad data reported |
| `src/catalogue/__tests__/weightMemory.test.ts` | Last weight per variant, persistence round trip, fallback to same exercise+machine (flagged not exact), invalid input |
| `src/memory/__tests__/context.test.ts` | Remembered context restores last machine + variant + load; first use → none; switching machine restores THAT machine's load/history; never-used machine carries no kg over; same grip kept across two lat-pulldown machines with separate history; incompatible machine refused; compatible machines listed with their own last session |
| `src/planning/__tests__/planning.test.ts` | Objective and region priority are separate fields; only the two confirmed objectives; profile validation; **region priority is not a filter** (focus + rest = whole ontology); a workout spans more than the targeted region; default prescription 3 sets with final set intended to failure (intent), drives set count, other structures representable, stored on new session records; region derived when not browsed; suggestion split derived (user never supplies PPL); flexible plan progress (any order, other machine counts); implicit workouts grouped with derived split. **Two card levels**: today/later decided on the SessionProposal only (planned exercises carry no decision); accepted proposal → one ExerciseCard per PlannedExercise with remembered context and its own prescription; old names (`WorkoutSuggestion`, `suggestionSplit/Progress`) are aliases. **Objective → prescription**: `prescriptionFor` takes the objective only and returns the default structure for every objective (no rep ranges/RIR/rests invented); region priority does not change it. **One Exercise per proposal**: exact duplicate, same exercise on two machines and same exercise with two grips are rejected (no silent dedupe; progress on an invalid proposal throws); two exercises on the same machine are valid; switching machine/grip at the gym still completes the planned exercise; valid proposals behave as before |
| `src/session/__tests__/machine.test.ts` | Scripted rep events. ARMED: placement reps before stillness never count; stillness → READY; coherent sequence → Set 1 with first rep back-filled; late-released placement reps dropped; handling in READY re-arms; without stillness a longer coherent run starts Set 1 (first rep included); stillness/handling ignored mid-workout; ARMED reload → full session. Plus: 10 reps → inactivity → REST only after confirmation; rest measured from last rep end (not confirmation); REST → coherent sequence → Set 2 with its first rep; isolated movement (and two far-apart bumps) never start a set; revoked rest; 3 sets → COMPLETE with correct sets/reps/rests; final-set longer confirmation; late reps ignored; 5-set configuration; manual finish; rest timeout; serialise/reload mid-rest continues identically; duplicate reps; config validation; reducer purity |
| `src/session/__tests__/stillness.test.ts` | Stillness/handling monitor on synthetic placement (hand-held tremor → carried/rotated 90° → strapped → still): no stillness while hand-held, handling during placement, `stable` reported from when the phone became still; stack reps are not handling; ideal still phone |
| `src/session/__tests__/replay.test.ts` | Synthetic 100 Hz recordings through the live path (stillness monitor + windowed engine + state machine, 2 s chunks, starting ARMED): hand-held → placed → still → 10/12/15: for 10 seeds placement never counts, READY precedes Set 1, Set 1 starts at its first rep, COMPLETE; exact counts in ≥ 8/10 (currently 9/10); noisy 10/12/15 × 6 seeds → exact sets, rests ±1.5 s, COMPLETE; 8/5/14 with 35/60 s rests; handling/knocks only → no set |
| `src/memory/__tests__/memory.test.ts` | Exact variant → most recent performance (kg, reps, rests, formatting); previous comparable session skipping other grips/machines; previous comparable for any given session; loads never compared across machines or variants (incl. no weight pre-fill from another machine); resume weight from exact history, over an unfinished-session weight, labelled unfinished/fallback cases; machine memory (last use, recent, variants; shared cable station; unused machine); body-region last trained and sessions/sets over 7 and 30 days; two-region exercise; muscle PRIMARY vs SECONDARY exposure kept separate; empty history everywhere; deterministic chronological ordering with ties; recent variants; period vs previous period; history from saved sessions (detected vs corrected source, rest alignment, interrupted excluded) |
| `src/ui/__tests__/screens.test.tsx` | Screens with mocked storage/sensors: review screen shows detection, saves truth, comparison; raw recorder start→STOP; history list; **setup** region→exercise→(auto machine)→variant **arms automatically** (no START button), and arms at once when exercise+machine+variant are unambiguous; **live session screen** fed with a synthetic stream that starts with phone placement goes ARMED → READY → SET 1 → REST → … → SAVED without any button, persisting provisional state; **memory in the UX**: region recency, machine and per-grip recall during selection; armed screen shows LAST TIME / PREVIOUS / change / muscles and the exact-variant weight; fallback weight labelled (never "Last time"); weight set while armed is persisted; "Change exercise" discards the armed recording; Home one-tap reopen; empty-history states |

Test changes (documented, none weakened):
- The screen tests' storage mock gained `loadSession`/`saveSession`, later `loadHistory` (new dependencies of
  the review screen). The free-text setup screen was renamed `DebugSetupScreen` (developer mode), unchanged.
- START removal (product requirement): setup-screen tests that pressed START EXERCISE or checked the weight on
  the setup screen were rewritten to assert automatic arming and the armed screen (memory + weight), with
  equal or stricter assertions. The full live-screen test now also starts with a synthetic phone placement.
- Ontology correction (`split` vs kinematic `movementPattern`): the catalogue test "covers Push, Pull and Legs"
  now reads `split` (same assertion), and the extension test's added exercise declares both fields.
- The armed-screen UI tests gained a machine-switch + plan assertion; no assertion was removed.
- Planning rename (`WorkoutSuggestion` → `SessionProposal`): old names kept as aliases, so the existing planning
  tests run unchanged; new tests added alongside.
- The noise-only replay test asserts "no set started, not in a workout phase" instead of the old initial phase
  name READY, because the product flow now starts ARMED.

The synthetic generator (`src/analysis/synthetic.ts`) models a guided stack (minimum-jerk reps, fatigue
slow-down, 8% sway), random mount orientation, CoreMotion-like noise (0.03 m/s²) and drifting bias, 100 Hz
with jitter and optional dropouts, and rest-period disturbances: handling the phone (translation + 15–40°
rotation), knocks (short 6–12 Hz bursts) and nudging the stack (1–4 cm); optionally a phone **placement** at the
start (hand-held tremor and tilt → carried and rotated onto the stack with tugs → still). Placement randomness is
drawn only when used, so existing seeds generate identical data.

### Synthetic stress results (not part of CI)
Offline engine `g0-1` on whole recordings (2026-09-26):
- Normal tempo (concentric 0.6–1.8 s, eccentric 1–2×, travel 20–60 cm, 1–4 sets of 2–20 reps, rests
  12–60 s, disturbances, dropouts): **298/300 exact**, worst rest error 1.6 s.
- Hard sweep incl. slow tempo and short travel: **188/200 exact**.

Live session path (stillness monitor + windowed engine + state machine, starting ARMED; same 100 normal-tempo
workouts, targetSets = true count):
- **84/100 exact** and COMPLETE without placement; **85/100** when every recording starts with a realistic
  hand-held → strapped placement (60–140° rotation, carry, tugs). Errors: ±1 rep at set edges, rare set merges
  after ~13 s rests, and a rep lost when Set 1 begins 1–2 s after the phone settles. Not tuned on purpose.
- 10/12/15 with placement, seeds 1–10: arming requirements hold for all 10 (placement never counted, READY
  before Set 1, Set 1 starts at its first rep, COMPLETE); exact counts 9/10.
- Tried and reverted: releasing a rep only when two consecutive polls agree (41/100) — made things worse.

## 2. Real-device protocol
Record every run in the results table below. The founder performs; Claude analyses the exported JSON.

### T0 — Acquisition check — DONE (founder, 2026-09): app runs on iPhone, DeviceMotion ≈ 100 Hz.

### T1-session — First real weight-stack session (the next test)
(Also the first real entry in the training memory: afterwards, choosing the same variant must show it as LAST TIME.)
1. Prepare straps on the top plate (strong straps, screen reachable, nothing touching the frame; one slow
   light rep to check), then take the phone in your hand.
2. New exercise → choose region, exercise, machine, variant. The app shows **ARMED** by itself (no START
   button). Check LAST TIME / weight on that screen and fix the weight if needed. Then strap the phone to the
   top plate — this handling must not count. Wait for **READY** (phone still ~2 s). Do not touch it again
   until SAVED. Note if READY never appeared.
3. Stand still ~10 s.
4. Set 1: 10 reps at a normal controlled tempo (≈1 s up, ≈2 s down). Count them yourself.
5. Rest ~30 s (stopwatch on another device, from your last rep). Halfway: **tap the phone** once.
6. Set 2: 12 reps. Rest ~30 s; halfway: **bump/lean on the machine** once.
7. Set 3: 15 reps. Then stand still and watch: the app should show SAVED within ~25 s.
   If it has not after 60 s, press "Finish exercise now" and note it.
8. Write down what the screen showed during each rest (e.g. "REST appeared at 00:14") and anything odd.
9. Review & correct: enter the real counts and rests → Save → Export JSON → send it back.
10. Memory check: go back Home → "Continue where you left off" should list the exercise; tap it → it arms at
    once and shows LAST TIME with your (corrected) counts and the weight pre-filled. Then tap "Change exercise"
    (discards that armed recording). Note if anything is wrong.

### T2 — Repeatability and variants (after T1-session is analysed)
- T2a: repeat T1-session. T2b: a scheme you pick on the spot (e.g. 8 / 5 / 14). T2c: slow tempo
  (≈2–3 s up, 3–4 s down). T2d: phone strapped in a different orientation.

### T3 — Another machine (e.g. chest press or leg extension), protocol T1-session.

## 3. Results log
| Date | Test | Machine / load / mount | Actual reps | Detected | Actual rests (s) | Detected rests (s) | Rate Hz | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-09 | T0 | no stack (acquisition only) | — | — | — | — | ≈100 | founder confirmed the app runs and records on iPhone |
| — | T1-session | — | — | — | — | — | — | waiting for the first weight-stack session |
