# Why label extraction plateaued — and the actual fix

5 September 2026 · application 0.4.6 · evaluation rules remain RC7.

## Diagnosis

The previous **1/10** number measured exact critical-field extraction from the serialized raw transcript. It was not character-recognition accuracy. The previous **6/10** result depended on selecting layout suggestions in an optional review workflow. Earlier work improved review tools without connecting those source-bound associations to the primary scan.

On the eight already-used development photos, five additional correct values and their headings were already present in Paddle output. Unrelated columns were interleaved, or values appeared before their headings. The parser supports some adjacent heading/newline/value forms; it cannot safely infer arbitrary two-dimensional relationships from flattened text. Reading the same image again did not fix that handoff.

A separate confirmed defect affected classic Tesseract: the merged-transcript noise filter could drop short numeric observations such as `1L`, `5g` and `27`. Fuzzy de-duplication could also hide a damaged reading behind a cleaner-looking numeric alternative.

The remaining development failures are not one generic OCR problem:

| Target | Observed failure | Appropriate handling |
| --- | --- | --- |
| CF-002 MRP | Baseline detector omitted the overprinted stamp | Optional sensitive detection recovered raw `ASV03AE/MRP27` from unchanged pixels in a controlled experiment; retain noise and review the result |
| CF-003 MRP | Correct amount is present, but combined MRP/USP headings and staggered table rows are ambiguous | Do not assign the nearest number arbitrarily; select a complete declaration close-up or enter an explicitly reviewed correction |
| CF-004 quantity | `910 g` is visible, but the heading itself is physically clipped to `NTENTS…` | Recapture the whole heading/value/unit; no invented `CONTENTS` repair |
| CF-005 packed date | Sideways stamp is not recovered completely in the ordinary orientation | Explicit orientation/dark-stamp retry or a correctly oriented close-up; do not turn malformed fragments into dates |

The detector experiment compared two fixed configurations across all eight originals: baseline `0.3 / 0.6`, sensitive `0.2 / 0.4`. All 16 observations completed in actual Chrome with matching input-pixel hashes. More boxes also produced more noise. Both thresholds changed together, so this does not isolate their individual effects or establish general accuracy.

## Implemented changes

1. **Read label fields** is the primary scan. It runs the real local Paddle model and computes conservative source-geometry associations automatically. No supplied expected answers, model-generated corrections or suggestion checkboxes are involved.
2. Every association remains a **machine candidate**. Its exact source fragments and positions enter the audit record. `candidateRows` is separate from `reviewedRows`; no person is claimed to have accepted it. Field, classification and measurement confirmations remain unset.
3. Original OCR strings and raw passes remain separate from derived working text. Each source fragment occurs once in the new working reading. Existing observations, corrections and contradictions survive a retry.
4. Publication is atomic after successful audit recording. Cancellation, unmounting, stale source bindings and failures cannot publish a late reading over previous evidence.
5. **Retry faint stamp detection** is an optional preview-first mode. Its allowlisted thresholds and detector profile are recorded. It is not a higher-confidence default.
6. Classic browser OCR retains short numeric observations and only collapses exact duplicate numeric lines. Damaged readings are not silently repaired or discarded.

## Measured result and limits

The first post-fix full-app Chrome run completed all eight development photos: **6/10 automatic structured candidates**, versus **1/10** from unchanged serialized raw OCR. By field: MRP 1/3, quantity 4/5, packed/manufactured date 1/2. No typed corrections, selected suggestion checkboxes or field confirmations were used. This changes the primary workflow, not the recognizer's character output.

Six additional pre-existing negative-case photos completed with zero valid critical-field candidates across 18 excluded/ambiguous slots. Their readable-positive denominator is zero, so no accuracy percentage is calculated. They test false association, not positive recognition ability.

These are small, exposed development/check sets with AI-provisional references. They are **not blind accuracy, a physical-package timing study, legal approval, hosted multi-account validation, or a guarantee of winning SIH**. The fixed default still leaves four readable target fields unresolved. The software must expose that limitation rather than manufacture a clean result.

Final source-frozen Chrome reruns confirmed the same result: **14/14 workflows passed** across the eight development and six negative-case photos, including visible machine-history rows, original hashes, exact worker-output-to-raw-pass matching, valid audit chains and unset confirmations. The ordinary full regression suite passed **683/683 tests**. Build and both source/build OCR asset hash checks passed. Existing optional-bundle size/OpenCV build warnings remain.

Existing full-app UI and synthetic functional workflows also passed: upload, geometry/trace controls, desktop/mobile layouts, draft reload, sealing, two reviews and search. Synthetic confirmations in that functional regression are test fixtures, not a real officer study.

The separate fixed **sensitive-detector** app run passed all eight workflows: **2/10 raw extracted fields, 6/10 with automated selection of available layout suggestions**. That selection is test automation, not human review and not the new automatic primary workflow. It gained CF-002's MRP but lost CF-005's quantity association. Do not combine the best fields from different modes to claim 7/10 or a general accuracy improvement.

Local evidence (full failures and observations retained):

- [Final automatic primary run](../reports/root-cause-2026-09-05/structured-ocr-browser-2026-09-05T16-06-07-628Z.json)
- [Final negative-case run](../reports/root-cause-2026-09-05/structured-ocr-browser-checkset-2026-09-05T16-06-21-445Z.json)
- [Optional sensitivity UI run](../reports/readiness-2026-09-05/paddle-review-browser-sensitive-detector-2026-09-05T16-04-27-911Z.json)
- [Independent detector isolation](../reports/readiness-2026-09-05/stamp-detection-probe-2026-09-05T15-44-28-038Z.json)
- [Classic numeric-merge Chrome check](../reports/root-cause-2026-09-05/numeric-merge-browser-2026-09-05T15-42-19-719Z.json)
- [Per-field root-cause audit](../reports/root-cause-2026-09-05/field-failure-audit.json)

## Team verification

1. Start a new disposable inspection. Upload a real label photo; address quality warnings honestly. Include the complete declaration heading, number and unit.
2. Click **Read label fields** and wait for **Label fields ready**. Check candidate values against the original photograph. Do not type the expected answers just to make this test pass.
3. Expand **Machine field associations** and **Original OCR transcript (not edited)**. Confirm the former is machine-derived and the latter is unchanged. Review controls must remain unconfirmed.
4. If a faint stamp is missed, open **More OCR options → Retry faint stamp detection**. Inspect the warning and raw preview; append only after reviewing it. More text is not necessarily more correct text.
5. For a sideways stamp, use the existing explicit dark-stamp/orientation controls or upload an upright close-up. For a cropped heading, retake the photograph.
6. Retrying an existing draft preserves its earlier failures and conflicting readings. Resolve them using the explicit reading-selection/review workflow; a retry is not permission to erase old evidence.
7. Test cancellation during recognition and reload a saved draft. Original hashes, raw passes and unconfirmed review status must survive.

Paddle runs on-device but needs its model assets loaded online first. The verified offline download currently covers **classic Run browser OCR**, not an independently verified Paddle offline pack. Test the chosen engine in airplane mode on the actual presentation device before relying on it.

## Release scope and rollback

No legal-rule interpretation, database migration, membership, account, email provider or external OCR service changes are part of this fix. RC7 remains the evaluation pack because its parser and rules are unchanged.

Release validation includes full regression tests, build, independent source review, real Chrome model execution, original/raw/audit integrity checks and desktop/mobile rendering. Hosting checks are recorded separately; a local passing run is not proof of a deployed authenticated workflow.

Before promotion, retain public deployment `dpl_7fYuBtsKynoBXnZviVAZsPMf6vdW` (RC7 source `3f9ef45250cb4336900f40199018df28decaab9c`) as rollback. Do not promote if CI, managed build configuration, public health, anonymous access denial or a critical capture/review flow fails. Never discard queued evidence to clear a release problem.
