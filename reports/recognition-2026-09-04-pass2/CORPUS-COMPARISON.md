# Existing Tesseract versus multilingual RapidOCR: eight-photo diagnostic

4 September 2026. This is a local **development-corpus comparison**, not an accuracy promise for arbitrary labels or a browser deployment acceptance test. All eight original image SHA-256 hashes were verified. The ten readable critical labels are provisional AI visual annotations requiring human review; no legal verdict labels exist.

## Critical fields

Both systems use the same current `extractDeclarations` implementation and the frozen manifest's exact, valid, conflict-free matching criterion. No field selection, spelling correction, digit substitution or manual transcription was performed.

| Pipeline | MRP | Net quantity | Packed/manufactured date | Total |
| --- | ---: | ---: | ---: | ---: |
| Tesseract's three passes, actual production merge helper | 0/3 | 0/5 | 0/2 | **0/10** |
| RapidOCR default PP-OCRv6 small, original raw transcript | 1/3 | 0/5 | 0/2 | **1/10** |

Tesseract was not scored using a field-by-field best-pass oracle: `mergeOcrPassTexts` was called in recorded `standard`, `full-gray`, `reverse-sparse` order. Its output is explicitly **system-derived**, not untouched raw OCR. The prior input rendering used a Sharp approximation of browser preparation, not an exact Chrome end-to-end capture. RapidOCR used the whole original photograph. These preparation differences prevent attributing the entire result to model weights alone.

Recorded native CPU inference totals were 32,784 ms for all Tesseract passes and 30,811 ms for all RapidOCR photos, excluding initialization. These are development-machine timings under actual load, not browser/phone promises. The separate literal-token diagnostic found six of ten expected tokens in RapidOCR; token presence does not establish declaration association.

## Other extracted outputs — presence counts, NOT accuracy

Counts below mean “photos for which the parser returned a nonempty value,” out of eight. No reference labels exist for these fields. Wrong text, incomplete values, and the product-name fallback can count. This is **not** precision, recall, correctness, or evidence of compliant declarations.

| Parser field | Tesseract merged | RapidOCR default |
| --- | ---: | ---: |
| Product/generic name, including fallback | 8 | 8 |
| Best-before/use-by | 2 | 3 |
| Manufacturer/packer/importer | 1 | 1 |
| Consumer-care channel | 1 | 3 |
| Consumer-care address | 1 | 1 |
| Email | 1 | 4 |
| Consumer-care phone | 0 | 2 |
| Country of origin | 1 | 1 |
| Unit sale price | 0 | 0 |
| FSSAI licence | 0 | 1 |
| Labelled barcode/GTIN | 0 | 0 |

The limitations are visible in the actual results, not theoretical: RapidOCR's CF-003 best-before field becomes `90.00 USP`, its CF-004 product fallback becomes a phone number, and CF-005 email begins `stomercare@...`. Both systems' CF-007 manufacturer value is only `MANUFACTURED BY`. Product-name output on every photo therefore does not mean eight correct names. Unit-sale-price *evidence* is detected on one photo by each system, but neither has a resolved nonempty value; the table does not count mere heading evidence as a value.

All per-photo values, evidence, conflicts and candidates are retained in `corpus-comparison.json` so the team can inspect these failure modes instead of presenting coverage percentages as accuracy.

## Conservative layout proposals — not automatically applied

The current `reviewableDeclarationProposals(reconstructOcrReadingOrder(...))` pipeline was independently rerun on all eight RapidOCR outputs. It returned exactly **one** unaccepted suggestion:

- CF-003: `PACKED ON:` plus `02/08/2026`, from original OCR source indices 7 and 6, with both original polygons retained.
- It matches one provisional reference, has `requiresOfficerReview: true` and `eligibleForAutomaticVerdict: false`.
- **Zero proposals were applied; zero officer reviews were performed.** The automatic strict result remains **1/10**, not 2/10.

Do not automatically substitute the complete geometry-reordered transcript: generic same-row reconstruction can join unrelated columns. The useful output is an evidence-linked suggestion for a person to verify, not permission to silently repair OCR or report a higher automatic score.

## Reproduce / provenance

Run `node reports/recognition-2026-09-04-pass2/compare-corpus.mjs` from the repository root with a fresh output filename/directory; the existing output intentionally refuses overwriting. The harness performs no OCR inference, network request or application mutation. It reuses existing untouched raw outputs, verifies images and source hashes, calls actual production helpers, and records derived provenance explicitly. It also checks that parser/helper sources did not change during the comparison.

`corpus-comparison.json` contains source hashes, both transcript forms, all per-photo extraction results and the unapplied proposal with source boxes. `RESULTS.md` documents the separate negative English-model experiment: none of its four configurations improved strict field extraction.
