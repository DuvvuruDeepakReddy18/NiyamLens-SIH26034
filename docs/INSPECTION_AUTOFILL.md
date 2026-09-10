# Extraction autofill and temporary challenge visibility

After Read label fields, browser OCR, connected OCR, an accepted crop/alternative reading, raw-pass selection or a working-transcript edit:

- Supported product name, profile, commodity class, quantity/unit, best-before/use-by context and checksum-valid barcode candidates populate automatically.
- Context suggestions are labelled as unverified. Generic default classifications are not presented as detected evidence.
- Manual context edits, including intentional blanks, are protected and retained with drafts. Quantity and unit are protected together. Use detected quantity + unit explicitly restores the detected pair.
- Missing/conflicting new readings clear only values owned by automatic extraction; they do not erase manual entries.
- Verification rows show the extracted value and a generated working-transcript source note. Where available, the note names the suggested photo/panel. OCR region matching is heuristic, not evidence of physical verification.
- Choose Confirmed on label only after comparison. No confirmation checkbox, absence declaration, purchase context or physical surface is inferred.
- A new OCR reading resets verification states while retaining officer-written notes. An actual image change retains the existing stricter evidence-invalidation behavior.

The generated source note is a UI suggestion until the officer edits or reviews that field. Saved officer notes remain separate in field-review metadata, labelled with their source. Prefilled notes do not make a field pass before explicit confirmation.

## Physical geometry

OCR cannot infer millimetres/centimetres from an ordinary photo, package quantity or variable-size barcode. Enter measured flat width/height to calculate area automatically, or supply a measured direct area. Cylinder inputs calculate an estimate, not a legally verified principal display panel. Clearing a required dimension clears its stale calculated area. A known scale and same-photo glyph measurements still need explicit verification. OCR line boxes are not substituted for glyph size.

## Blind challenge: hidden, not deleted

`src/lib/features.mjs` currently sets `BLIND_CHALLENGE_ENABLED = false`.
The navigation entry, System & trust shortcut, page and active timer/lock are hidden. Challenge implementation and previously stored state remain. Normal inspections are not scored as blind challenges. Restored drafts retain their original challenge association as provenance, without claiming a completed blind run while this feature is hidden.

To restore the feature later, set the flag to true and rebuild. Review any old unfinished challenge before using it as validation evidence; elapsed wall time is not a new blind trial.

## Verification

Run `node --test tests/inspection-autofill.test.mjs tests/challenge-visibility.test.mjs` for focused checks, then `npm test` and `npm run build`.

For isolated browser verification, serve the local app on `127.0.0.1:4202`, then run `node tools/qa-inspection-autofill.mjs`. It uses the existing real Amul photo and actual local Paddle inference twice. Its custom title, quantity, notes and dimensions are workflow fixtures—not new recognition ground truth or a physical-measurement study. It does not touch hosted accounts or cases.

## Current-inspection Command view

Recent inspections is hidden from Command view; saved records remain accessible through Inspection history. The replacement charts use only the active package, including an unsealed working draft. The studio stays mounted while navigating, so a running OCR job and unsaved field edits are not discarded when opening Command view.

- Evidence distribution has six labelled colors: green = officer verified; blue = detected/unverified; red = conflicting readings; amber = unreadable/incomplete; gray = not detected/captured; purple = explicitly confirmed absent.
- Each of the 14 tracked fields is counted exactly once. These are evidence states, not compliance verdicts or accuracy estimates. Not all 14 fields apply to every package.
- Select a legend category to filter the accompanying accessible field table. Review this field returns to the source verification control, including an already-verified field. Competing observations and unresolved historical disagreements remain visible.
- Captured-panel coverage shows officer-assigned photo purposes, not proof of complete declarations. Located-field bars use heuristic OCR source matching, explicitly labelled as such.
- Rule-check outcomes use the current transcript, context and measurement evidence. Expand the explanations to see why a check needs review. No graph certifies the package.
- Starting another package clears the current graphs. Restoring a draft reconnects its own evidence. Reloading shows the retained draft, clearly marked as needing restoration before editing.

## OCR coverage improvements and limits

Read label fields runs real local Paddle inference on the captured photographs, then may perform up to **two** additional OCR reads of unresolved MRP, quantity or packing-date regions around literal detected headings. Every retry uses the current source image binding and keeps its original text, crop and audit history. An unavailable optional retry does not discard the primary reading; cancellation stops publication. New conflicting readings are not silently substituted for older ones.

Literal standalone common-name, country-of-origin, manufacturer and best-before headings can now associate bounded adjacent text lines. Association stops at other headings, blank blocks or panel markers. Raw OCR is unchanged. Verification controls now include all 14 tracked fields, including licence and GTIN. Printed instructions such as “see cap/neck” can generate recapture guidance, not invented price/date values.

Actual browser checks on the known development photos found:

| Photo | Observed usable readings | Important limitation |
| --- | --- | --- |
| Amul | Name `Amul`, MRP `22.00`, net quantity `500 ml` | Other tracked details remain unresolved; the working transcript contains recognition errors. |
| Kinley | Product name, quantity `1 l`, best-before `TWELVE MONTHS`, manufacturer | The photographed label points to cap/neck for MRP/date, which are outside the photo. Contact/licence/barcode were not successfully extracted. |

Both are previously used development photographs, not a blind evaluation. Neither run triggered an automatic retry: its eligible fields were already resolved or had no valid local heading. Bounded retry behavior, failure/cancellation handling and raw-history retention are covered by regression tests; these two photos do **not** establish its recognition benefit. Human verification and physical measurements are still required. OCR is not 100% accurate.

Final local validation on 2026-09-10: **786/786 regression tests pass**, production build succeeds (existing OCR bundle-size warnings remain). The isolated Chrome workflow check is `node tools/qa-current-inspection.mjs` with the app on `127.0.0.1:4203`; output is in `reports/current-inspection-2026-09-10/browser-verification.json` and `ocr-observations.json`. It checks real OCR during navigation, live counts, explicit confirmation, injected conflict handling, unchanged raw text, draft isolation/reload and desktop/mobile overflow. Its confirmation and manually injected conflict are software fixtures, not officer adjudication. No hosted accounts or cases are touched.

The initial autofill/current-inspection release was pushed as `30587b99b70a06538bc1cb85221da41de0b53b5b`, passed GitHub CI, and deployed to production as `dpl_5aKnkBotPtVB2K3QfzehAFPA5Exh` on 2026-09-10. Anonymous smoke checks confirmed public homepage access, backend readiness and denied anonymous case access. No authenticated production cases were changed for validation.

## Why this result, actual scores and workflow counts

Command view now also includes:

- A field selector explaining retained evidence, actual field-linked rule checks and reasons, validation, reported OCR score, field-check decision and remaining human review. Fields with no applicable check yet say NOT ASSESSED; no invented Rule 6 PASS is supplied.
- Declaration-presence bars for six core declarations. A full bar means a usable reading exists in the current transcript—not 100% accuracy or proof of legal completeness. Verification status remains explicit.
- Engine-score bars on a zero-based 0–100 scale. These use the **minimum retained reported score** across observations matching the exact current value and its source line. Hard-coded parser confidence constants are excluded. Missing/nonfinite/unknown-provenance scores, conflicting values and corrections unsupported by retained OCR show Unavailable, not zero or an invented percentage.
- Clearly labelled display bands (high ≥90, needs review 70–<90, low <70). These are uncalibrated triage thresholds; they do not change the rules, waive review or establish recognition accuracy. Genuine reported zero is preserved as zero.
- Six actual stage counts: captured photos, photos with recorded OCR text, usable current fields, officer-verified fields, evaluated checks and recorded verdicts. Photos, fields, checks and records have different units; this is deliberately not a percentage-conversion funnel. An unsealed inspection has zero final records; a sealed MANUAL REVIEW case is not counted as PASS.
- Expandable OCR verification/error-handling guidance. Uncertainty remains visible, while a genuinely verified violation elsewhere may still yield an overall FLAG.

Validation for this extension: 793 local tests passed, build succeeded, and isolated Chrome used real Amul and Kinley photos to check actual scores/unavailable values, correction-score invalidation, explanation drill-down, draft restoration and mobile overflow. Report: `reports/decision-insights-2026-09-10/browser-verification.json`. No blind-accuracy or human-review claim is made. The local suite contains one unrelated uncommitted developer-watcher test; GitHub CI runs the committed suite.

Deployment checklist: source changes reviewed, no database migration/authentication change, blind challenge flag unchanged, local tests/build/browser smoke passed. Rollback target for this extension is the preceding verified production deployment `dpl_5aKnkBotPtVB2K3QfzehAFPA5Exh`. Roll back if the authenticated application fails to load, private-case access becomes public, or current-package data/score isolation fails. Public health and authentication-denial checks are smoke tests, not sustained production-load or authenticated multi-account validation.
