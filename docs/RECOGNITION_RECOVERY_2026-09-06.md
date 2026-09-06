# Recognition recovery — 6 September 2026

Status: version 0.4.7 implemented and locally tested; hosting publication is recorded separately below. This is engineering evidence, not a promise of winning SIH or a claim of independently measured accuracy.

## Changes

- The MRP, net-quantity and pack-date guidance cards can request one **new close-up photograph**. It gets its own evidence hash and a capture-purpose audit event. Earlier photographs and readings remain; the request supplies no OCR answer.
- Guided recapture cannot replace evidence, accept several files as one close-up, or bypass the four-image limit. Cancellation, decode failure and audit failure cannot publish a late image.
- Dark-stamp recovery offers upright, 90°, 180° and 270° orientations. Exact PNG previews match the pixels sent to local OCR; boxes map back through the rotation and crop once. No hidden characters or missing headings are reconstructed.
- A selected declaration region has direct faint-text and dark-stamp retry controls. These are preview-first, optional readings. Existing contradictions and unconfirmed review states remain.
- The compound MRP/USP table investigation requires three complete batch/date/use-by anchor rows and a unique geometric column. It is a read-only review aid, not a replacement transcript or automatic compliance finding. A damaged USP denominator is not repaired into a unit.

## Why another scan is not always enough

Some failures are missing detections; others are damaged characters, missing source pixels, ambiguous field boundaries or mismatched table rows. A new crop can improve the number of pixels allocated to small print, but it cannot restore clipped print. A fresh close-up must include the declaration heading, complete number and unit/date. Existing conflicting readings require explicit review; a later scan does not erase them.

## New-photo test protocol

The new Open Food Facts engineering set contains eight photos from six previously unused product codes, selected visually from 21 retained originals before OCR. One AI provisionally labelled six readable critical fields: one MRP, two quantities and three packing/manufacturing dates. The other 18 slots are excluded as not visible, illegible or ambiguous. Exclusions are not counted as correct negatives.

The exact reference file was frozen before recognition on these photos. It is a case-enriched exploratory sample, **not a representative sample, independent human ground truth or a human holdout**. No field correction, suggestion checkbox or expected-answer input is permitted in the first primary-button run. Every failure must be retained. Once inspected, these photos become development examples.

Reference: `datasets/recapture-discovery-2026-09-06-retry1/critical-fields.json`.

Reference SHA-256: `97f683e7974a7539fc784ade3c8b684b0e61d378965b682891824f247b2d9b7c`.

Acquisition and screening preserve source URLs, image SHA-256 hashes, exclusions and unsuccessful attempts. Public images are attributed to Open Food Facts contributors under CC BY-SA; the database has its separate ODbL terms. Source images remain local and excluded from the hosting build. No external OCR provider receives them.

## Team verification

1. Upload a complete real panel. Use **Read label fields**, then compare each candidate against its source. Leave incorrect or uncertain fields unconfirmed.
2. Choose **Add MRP close-up photo** (or quantity/date). Pick a genuinely clearer photograph. Check that the original thumbnail and hash remain and that the new image occupies a separate slot.
3. Read the new panel or select a complete declaration region. If needed, use **Recover this selected stamp**, choose its orientation, and inspect the exact input and raw preview before appending.
4. Dismiss a preview and verify the working transcript did not change. Append a real reading and verify earlier raw passes remain. Any contradictory values must remain visible.
5. At four images, close-up additions must be disabled rather than replacing the first image. Do not delete evidence just to make a test pass.
6. For a compound MRP/USP table, inspect the full source row and supporting anchors in the optional preview. Its diagnostic candidate is not an accepted field or a calibrated measurement.

## Measured results — successes and failures retained

| Check | Observed result | What it does not prove |
| --- | --- | --- |
| First primary-button run on eight newly acquired photos | 2 of 6 readable reference fields recovered (both quantities); 7 photos completed, one failed to reach a completed OCR result; other readable misses were MRP/date associations | Not broad reliability; no completed-corpus accuracy percentage. Eighteen excluded slots are not correct negatives |
| Eight known development photos, primary scan | Unchanged: 1/10 raw extracted fields; 6/10 automatic structured candidates; all eight workflows completed | Not a recognizer upgrade or blind accuracy |
| One known sideways stamp, one visually selected region + 90° dark-ink retry | Actual raw output `PKD:19/10/25`; date parsed but remained unconfirmed; no typed correction or selected suggestion | Assisted single-case recovery, not automatic 7/10 or an unseen-case result |
| Known compound MRP/USP table, real Paddle preview | Unverified 90.00 with three source anchors; all three displayed PNGs matched actual worker pixels; `/9` USP remained unresolved | Diagnostic-only: raw-only append deliberately leaves normal MRP extraction unresolved |
| Guided close-up capture, synthetic UI workflow | All three chooser uploads retained old hashes/raw text; four-slot limit enforced; cancellation/audit regressions covered | Not a physical-package study or recognition accuracy |
| Final regression/build | 737/737 tests passed; build passed; all 17 OCR assets matched their release hashes | Unit fixtures and model hashes do not establish field accuracy |

The guided workflow and compound diagnostic fit 1440px, 390px and 320px viewports. Testing found and fixed long-option overflow in the stamp selector and measurement-surface form. Exact canvas-pixel checks passed all four orientations. Independent source review also caught a comma-grouped MRP display rejection; the final view checks numeric equivalence while retaining literal `1,048.50` in the display.

The first new-photo reference and result were not rewritten after seeing failures. Later targeted tests are explicitly follow-up engineering work. The compound display-only comma fix followed the first new-photo run; it did not change the primary parser, model or automatic candidate pipeline.

RD-005 follow-up isolated the apparent timeout: the worker completed successfully with **zero detected text lines**, and the app immediately displayed “Paddle OCR found no readable text. Previous evidence was preserved.” The first benchmark waited only for a success message, so it misleadingly recorded a 180-second wait. The benchmark now records the terminal warning and worker response instead. This fixes the diagnostic, not the missed stamp; the first result remains unchanged and the field still counts as a failure.

Full local evidence:

- First new-photo run: `reports/recapture-2026-09-06/structured-ocr-browser-unfamiliar-2026-09-06T08-20-43-427Z.json`.
- Known-photo primary regression: `reports/root-cause-2026-09-05/structured-ocr-browser-2026-09-06T08-21-38-674Z.json`.
- One-shot stamp recovery: `reports/root-cause-2026-09-06/known-stamp-focus-2026-09-06T08-21-29-522Z.json` (the exact audited two-click crop differs slightly from intended click fractions because of image borders; both are retained).
- Final compound-table UI: `reports/root-cause-2026-09-06/compound-table-ui-2026-09-06T08-26-55-187Z.json`.
- Final guided-capture UI: `reports/guided-recapture-2026-09-06/guided-recapture-2026-09-06T08-20-12-250Z.json`.

Source-image bytes, failed UI attempts and all raw results remain local. The public build excludes datasets, reports, tests and tooling; it does not upload the acquired labels to a remote OCR service.

## Release gates and rollback

No database, account, permission or legal-rule changes are planned. RC7 remains the rule pack; the recognition/review tools do not revise its legal interpretation. Before publication: complete regression/build gates, source-bound browser checks, and desktop/mobile rendering. Keep `dpl_4X9qPWM83qoWa2C3SMm6Z7pmQaXi` (previous app source `a498a5d82e5f1e9630bea51b660dee757da888dd`) as rollback.

Do not promote if CI/build fails, evidence changes without a valid audit, capture/review breaks, the public homepage redirects to hosting authentication, health is not ready or anonymous private-case access is allowed. Preserve queued evidence throughout. Public smoke checks are not authenticated multi-account validation or a physical-package study.

## Still requires real participants

Fresh independent labels, full-workflow physical-package timing and qualified legal/measurement review cannot be substituted by AI-labelled screenshots or synthetic tests. Existing human review kits remain separate; their results have not been invented.
