# NiyamLens 0.4.2 — implementation and acceptance handoff

4 September 2026. Local working tree on `codex/managed-cloud-release`. **Not committed, pushed or deployed in this pass.** Rule pack remains RC5; no claim of departmental approval or guaranteed SIH success.

## What actually changed

- Added the official PaddleOCR JS 0.4.2 / PP-OCRv6 small engine as an **optional** local alternative. Tesseract remains available. No photograph upload or secret/API key is required for either local engine.
- Local pinned model archives, worker and matching ONNX Runtime Web 1.24.3 assets are bundled under `public/ocr/paddle-v1/`. Approximately 68 MB additional assets; lazy loading, single-threaded WASM. Mobile performance and first-use offline availability are not established.
- Whole-panel and officer-selected original-resolution Paddle crops produce a preview. Appending is explicit, preserves earlier raw OCR and manual corrections, records model/run/crop provenance and resets confirmations. There is no manufactured inspection-wide confidence percentage.
- Narrow geometric heading/value proposals retain exact strings and original box mappings. They are unchecked by default, require officer review, and remain separate from raw OCR. Broad row reordering is not automatically adopted.
- Quantity headings accept common printed punctuation and volume abbreviations. A standalone quantity heading immediately followed by one complete numeric/unit line can be parsed without changing evidence. Serving qualifiers, intervening text/panel markers, corrupted units and composites are not skipped or repaired. This adjacent-line rule does not apply to dates.
- Literal tax qualifiers preceding MRP are parsed; arbitrary parenthesized content is not skipped. `Pkd. by` no longer becomes a false packing-date candidate; handling instructions about “contents” no longer become quantity declarations.
- A real crop exposed a further title-guessing bug (`500ml` was guessed as the product name). The fallback now inspects only an eligible first label line, not quantities or phone numbers found after declaration headings. Explicit generic-name headings still work; an inferred title/brand still requires physical verification.
- Crop and alternative appends now await their audit before publishing. Cancellation, unmount and failed audits preserve earlier evidence. Draft restoration is blocked during processing and invalidates earlier queued audit work.
- Highlight unions no longer mix different OCR coordinate frames. Physical millimetre estimates were removed from OCR-line cards; physical glyph measurement remains an explicit calibration task.
- Service-worker quota/read/open failures no longer conceal valid network responses. Optional model assets stay lazy. Cache version is v10.

## Automated verification

- `npm test`: **311 passed, 0 failed** (including 10,000 malformed-input cases within an adversarial test).
- `npm run build`: passed. SDK/OpenCV browser-externalization and large optional-chunk warnings remain visible; they are not hidden or presented as performance certification.
- New coverage includes exact/raw output bounds, crop mapping, worker cancellation/deadlines, immutable appends, proposal provenance, delayed-audit publication races, restored drafts, cross-frame regions and cache failures.
- `npm audit --json`: the independent final check reported zero vulnerabilities. An earlier install summary reported two high advisories without details; the later audit could not reproduce them. No audit finding was suppressed and no forced major upgrade was run.

Unit/source-handler tests and mocked provider/database contracts are not live cloud acceptance or recognition-accuracy proof.

## Actual Chrome verification

Production build at `http://127.0.0.1:5182/`, Chrome. Photo: `datasets/openfoodfacts-india/real-labels/8901262260121/6.jpg`.

Original SHA-256: `9d2187d0603d8781814e24320b452d596dc826a50ba29f0a7643f6d43b0c619b`.

Observed with real UI clicks/file chooser, not injected OCR results:

1. Uploaded the original photo and observed its matching digest.
2. Cancelled local Paddle initialization: image retained, editable controls restored, no transcript or confidence manufactured.
3. Retried actual inference: 56 unedited text lines, including `MRP:22.00` and `500mL`. Full-page reading order interleaved unrelated text after `Net Content:`, so quantity stayed unresolved.
4. Appended the raw result explicitly, reloaded and restored it from the local draft.
5. Selected the physical quantity/MRP crop with two on-image clicks; actual Paddle result:

   ```text
   Net Content:
   500ml
   MRP:22.00
   linclusive all taxes
   ```

   The erroneous tax wording is deliberately retained. No corrected characters or values were typed.
6. Appended crop output without erasing the earlier incomplete reading. After reload, old/new quantity evidence remained conflicting; the system did not silently clear it.
7. Sealed case `NLM-20260904-e117c58f-53af-466a-9aa4-6c9c61faaff3`; its report showed **manual review**, 19 reviews, no flags/passes, and a verified local chain with nine events. This chain is internal consistency, not independent authenticity.
8. JSON export was clicked, but the completed download file was not found at the expected Downloads path. **Download completion is not verified.** The sealed local record remains available.
9. A clean crop-only run repeated the four-line reading. After the final parser/title fix and draft restore, Chrome showed exactly **two detected signals: MRP `22.00` and quantity `500 ml`**, with product name not detected. Case `NLM-20260904-11b880ad-a871-45c5-98b0-a2525e694219` saved with 18 manual reviews and a verified five-event local chain. Its context title retained an obsolete `500ml` automatic suggestion from the pre-fix draft despite an attempted UI clear; the sealed record was not rewritten. The new extractor no longer generates that suggestion. No OCR text or critical numeric value was edited.

These are repeated, known-photo, officer-selected checks—not a representative blind trial or field-accuracy percentage.

The final title-only extraction fix followed frozen critical-field rescoring. Final `extraction.mjs` SHA-256 is `93b6d61fc7f8893bed90127bbef2187aa9dafd57fad0b06350c43c54b15e97cd`; numeric/date parser SHA-256 remains `5a14b178b62596cb419d0921e31e87735a4ac921518f618b6e852222385d24d6`. Historical scored transcripts and recorded source hashes were not overwritten.

## What the frozen experiments say

See `final-parser-comparison.md` and its hash-bound JSON. Under the same final parser, unchanged stored outputs for all eight photos still score:

- Actual production merge of three prior Tesseract passes: **0/10** critical fields.
- Prior RapidOCR multilingual whole-photo output: **1/10**.
- Four predeclared English-model configurations: **1/10 each**, 32 photo/configuration runs, no inference errors.

The English model is not integrated. More recovered tokens/candidates are not field accuracy. A single reviewable packing-date proposal was found in the offline geometry experiment; it was not automatically applied. Actual Chrome Paddle is a different execution and has not yet been run across the entire frozen corpus; its Amul success must not replace failed historical rows.

The additional six-product check set contains no confidently readable positive critical-field labels. It tests ambiguous/missing-view handling, not positive recall. All labels are provisional AI visual annotations requiring human review, not independent ground truth.

## Team verification steps

1. Install dependencies, run `node tools/prepare-paddle-assets.mjs`, `npm test`, `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 5182`.
2. Upload a real package. Confirm the hash and panel purpose. Do not paste a known-correct transcript.
3. Click **Try Paddle OCR · local**. Cancel once, retry, and inspect the preview. The editor must stay unchanged until **Append raw Paddle OCR** is clicked.
4. For tiny declarations, click **Focus OCR**, select opposite corners including heading/value/unit, then **Try Paddle on selected region**. Compare every raw character with the photo.
5. Preserve disagreements. If a layout suggestion appears, compare both highlighted fragments before choosing it; it must never appear in the original raw transcript.
6. Save, reload, reopen history, inspect the image and local audit chain. Review remains expected for incomplete panels or unresolved fields.
7. Try a new, previously unseen package and record failures as well as successes. Collect full-panel phone photos and independent labels before making any accuracy claim.

## Remaining release gates

This is a materially stronger **officer-assisted prototype**, not yet a winner-ready autonomous checker. Next gates are representative unseen-package browser testing, measured false-clear/false-flag rates, independent legal/rule validation, target-phone performance and real configured Supabase/Auth/Storage/connected-OCR acceptance. No new live cloud verification, deployment, cross-user test, physical typography validation or complete export-download acceptance is claimed here.
