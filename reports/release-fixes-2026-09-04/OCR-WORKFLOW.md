# OCR reliability fixes: bounded retry and accountable working readings

## Root cause addressed

Whole-panel OCR often detects a declaration heading and nearby value as separate lines, interleaved with another column. Small curved print can also lose a unit (`500m` versus `500ml`). Joining arbitrary neighbouring strings or silently correcting units would produce unsupported declarations. Previously, appending a clearer crop retained the earlier bad candidate and there was no dedicated workflow for choosing which raw readings should form the working transcript.

## Implemented changes

1. `ocrFocusGuidance.mjs` plans at most three retry rectangles per panel from literal unresolved MRP, net-quantity and packed/manufactured-date headings. It uses bounded same-row or directly-below geometry, not expected values. It stops at other sections, rejects nested automatic retries, and withholds cropped/missing headings and composite MRP/USP targets. A same-line invalid value gets a tight crop rather than surrounding paragraphs. No characters, units or dates are changed.
2. `runPaddleOcr` includes `focusGuidance` with each preview. A new OCR run still has to recognize the actual selected pixels; guidance alone contributes no declaration or confidence.
3. `resolvePaddleFocusSuggestion` binds a click to the currently displayed suggestion and current captured panel. A stale image, duplicated ID, reversed/out-of-frame rectangle, or insufficient pixels rejects the retry.
4. `ocrPassSelection.mjs` prepares a working transcript from exact existing pass IDs. It requires an explicit reason and at least one nonempty raw reading for every captured panel with OCR. Panels with no readable OCR are explicitly marked unassessed. All selected pass whitespace/text is preserved. Excluded pass IDs remain in the audit payload, and raw history is never changed.
5. `OcrPassSelection.jsx` shows the photograph, every unedited raw pass, an exact proposed transcript, a reason field and a replacement acknowledgment. Nothing is preselected or confidence-ranked. Only Apply invokes the parent's audited publication flow. The parent must clear prior field/measurement confirmations and confidence, and leave raw evidence untouched.

## Verification

Command: `node --test tests/ocr-focus-guidance.test.mjs tests/ocr-pass-selection.test.mjs tests/paddle-ocr.test.mjs`

**29/29 tests passed locally** when these helper changes were completed: 12 guidance tests, 7 pass-selection tests and 10 Paddle regression tests. Coverage includes lifecycle/cancellation, same-row versus expiry boundaries, retained tall glyph boxes, numerical-token independence, cropped headings and retailer/unit-price counterexamples, stale photos, duplicate IDs, raw byte preservation, empty/missing panels, reason/history quotas, and no heading-to-value borrowing across pass separators.

The optional local diagnostic `node tools/diagnose-focus-guidance.mjs` checks the exact original source image hashes and replays the planner over the eight frozen, unchanged offline raw outputs. It writes a new non-overwriting report. This is **crop-planning diagnosis, not OCR inference or measured accuracy**. It does not require relabelling expected fields.

## What is not solved or claimed

- A suggested rectangle can still miss a distant undetected value or include distracting pixels. The officer must inspect it before retrying; manual crop, rotation or recapture remains available.
- Choosing a crop-only working reading can omit other declarations outside that crop. The UI warns about this. Those fields must remain unverified unless other selected readings or reviewed evidence support them.
- Selecting one reading is an explicit human evidential choice, not proof that OCR is correct or the label is legally compliant. Differing retained readings must remain conflicting.
- The frozen eight-photo corpus previously scored 1/10 provisional critical fields for offline Rapid OCR. These workflow changes alone do not improve that denominator or establish performance on unseen labels.
- Real Chrome integration/recognition, sealing/reporting of the officer selection, and live deployment are separate checks owned by the main release workflow. Do not equate pure helper test success with those checks.
