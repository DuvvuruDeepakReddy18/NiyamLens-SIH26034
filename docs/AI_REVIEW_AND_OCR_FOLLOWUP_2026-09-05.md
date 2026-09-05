# OCR fix and AI photo review — 5 September 2026

## Outcome

One confirmed false-date parsing defect is fixed locally. All 24 reserved photos have been reviewed as **one AI visual reference**, not as Arif's and Tharun's independent work. OCR recognition remains weak. This follow-up does not establish winner-readiness or replace real participant testing.

No GitHub push, Vercel deployment, database migration, account change or test-membership reactivation occurred. Earlier uncommitted work was retained.

## Confirmed defect and fix

A real Chrome experiment using four fixed overlapping crops produced a clipped `02/08/2` date fragment. The parser could backtrack and accept `02/08` as February 2008. That incorrect value also passed the review-suggestion filter.

`src/lib/labelParser.mjs` now rejects date prefixes followed by another separator/component, including incomplete years and extra components. It retains invalid evidence without repairing characters. Complete day/month/year and month/year values still parse. A trailing separator remains unresolved, even if it could be punctuation.

Three regression tests in `tests/clipped-date-regression.test.mjs` cover clipped dates, valid dates, mapped suggestions and preservation of conflicting evidence. Two failed before the fix; all passed afterward. Replay of all eight retained crop observations removed the wrong-valid date without modifying raw observations. The crop strategy was **not** added to the app.

## Recognition measurements

These runs use the same eight previously used development photos and ten AI-provisional readable references. They are not a blind benchmark or general accuracy estimate. No reference-specific crops, catalogue lookups or typed corrections were used.

| Run | Direct raw recovery | Recovery with all available layout suggestions selected by automation | Wrong-valid readable fields in derived result |
|---|---:|---:|---:|
| Fresh built app, default Paddle | 1/10 | 5/10 | 0/10 |
| Experimental detector limit 1536 | 1/10 | 5/10 | 0/10 |
| Experimental four fixed crops, before parser fix | 3/10 | 4/10 | 1/10 |
| Retained crop observations replayed after fix | Not re-recognized | 4/10 | 0/10 |

Higher resolution did not improve the target score. Generic cropping gained some direct quantity readings but cut declaration/date context. Neither experiment justifies replacing the default. The initial experimental reports omitted parser/layout-helper hashes; the replay records this limitation. The runner now hashes those dependencies for future runs.

The fresh app's derived recovery is MRP **1/3**, quantity **3/5**, and packing date **1/2**. Five eligible fields remain unresolved. Zero wrong-valid results in ten development slots is not a safety guarantee. Automated layout selection is not officer verification.

Evidence:

- [Fresh eight-photo built-app Chrome run](../reports/readiness-2026-09-05/paddle-review-browser-2026-09-05T07-21-08-764Z.json)
- [1536 detector experiment](../reports/readiness-2026-09-05/paddle-resolution-det1536-2026-09-05T07-05-53-663Z.json)
- [Fixed-crop experiment, including its failure](../reports/readiness-2026-09-05/paddle-resolution-quad960-2026-09-05T07-12-32-012Z.json)
- [Post-fix replay of retained observations](../reports/readiness-2026-09-05/parser-replay-2026-09-05T07-22-26-064Z.json)

## Completed AI photo reference

See the [shareable 24-photo review and verification command](../reports/ai-reference-2026-09-05/README.md), [labels](../reports/ai-reference-2026-09-05/labels.json) and [freeze record](../reports/ai-reference-2026-09-05/freeze.json).

All 24 original JPEG byte lengths and SHA-256 hashes match the canonical selection. All strictly decode. Each of 72 target slots has visible evidence or a reason for withholding its value:

| Target | Readable | Not visible in this photo | Illegible |
|---|---:|---:|---:|
| MRP | 1 | 21 | 2 |
| Package quantity | 3 | 20 | 1 |
| Packed/manufactured date | 1 | 23 | 0 |
| Total | 5 | 64 | 3 |

These counts describe the photos, not OCR success. Nutrition-only and ingredient-only panels dominate. Serving mass, ingredient percentages, camera timestamps and catalogue values were not substituted for declarations. One quantity uses informal package-mass wording and is not a legal-sufficiency finding. One photo has a visible barcode/manifest discrepancy; it was flagged rather than silently corrected.

Three initial JPEG views showed artifacts in the viewing tool. Strict decoding and recorded PNG viewing derivatives revealed the complete frames. The original photographs were not repaired or replaced. Notes were corrected before freezing the labels.

The validator enforces the exact 24 IDs, source hashes, AI-only format and null withheld values. Its `--freeze` option checks frozen answers as well as selection drift. Eight tests cover these controls. A digest detects drift; it is not a signature or proof of correct transcription.

No OCR was run on these 24 in this follow-up, and they were not used for tuning. They are now AI-exposed. This single review must never be presented as two human exports, human agreement or independent human ground truth. The original human review kits remain unchanged.

## Verification and release status

- Full regression suite: **600 tests passed**, none failed or skipped. The complete 598-test run passed, then the final full run included two additional freeze tests; the eight AI-validator tests also passed separately.
- `npm run build`: passed in local-only mode. App entry: `index-CN0rkZpu.js`. Existing optional OCR/OpenCV bundle-size warnings remain.
- Fresh built-app Chrome execution: **8/8 upload → Paddle OCR → mapped suggestion selection → append → persisted draft workflows passed**. Original image bytes and raw history were retained; fields stayed unconfirmed. Four displayed source-frame previews matched actual OCR input pixels. No typed corrections, field confirmations, page errors or non-local requests occurred. This verifies workflow integrity, not OCR accuracy.
- No new hosted acceptance or deployment claim. Earlier RC5/RC6 boundaries remain in [the previous handoff](OCR_AND_FIELD_VALIDATION_2026-09-05.md).

## Still required

OCR is not fully fixed. New, diverse declaration-focused photographs and independently labelled values are needed before another accuracy claim. Physical-package timing requires people performing the entire inspection, including corrections and failed attempts. Legal applicability and report adjudication require a qualified practitioner. AI photo transcription cannot complete those tasks.
