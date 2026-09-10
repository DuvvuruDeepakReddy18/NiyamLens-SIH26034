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

These changes are local; this verification does not establish that they have been pushed or deployed.
