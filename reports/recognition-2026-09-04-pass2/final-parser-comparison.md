# Final-parser paired comparison — unchanged original OCR outputs

4 September 2026. **The strict frozen-corpus scores did not change.** The new adjacent-line quantity rule is useful for correctly recognized standalone headings followed immediately by complete quantities, but it cannot recover units/digits that these older OCR runs did not recognize, or skip interleaved text to choose a desired value.

## Frozen parser and inputs

All eight original source-image SHA-256 hashes were verified. Every system was rescored with the same parser; parser and input-file hashes were unchanged before versus after scoring.

- Final `src/lib/labelParser.mjs` SHA-256: `5a14b178b62596cb419d0921e31e87735a4ac921518f618b6e852222385d24d6`.
- Manifest SHA-256: `4f869df89f6246e774189a7522e2798f5ab680b83e887eb8ddeae6c08fd977ad`.
- All other source hashes and detailed candidate evidence are in `final-parser-comparison.json`.

The parser permits a standalone net-quantity heading followed **immediately** by one entire supported numeric/unit line; it preserves both lines as evidence. It does not search past other text, repair corrupted units, or apply a generic next-line rule to MRP or dates.

No OCR was rerun. The 24 original Tesseract pass records, eight original RapidOCR records and 32 original English-strategy records were reused unchanged. No hand-written transcript, new browser output, new crop result, accepted layout proposal or model-specific correction was added.

## Results: all eight photos in every pipeline

| Pipeline | MRP | Net quantity | Packed/manufactured date | Total | Change versus prior paired result |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tesseract: actual production merge of the three stored passes | 0/3 | 0/5 | 0/2 | **0/10** | 0 |
| RapidOCR multilingual PP-OCRv6 small, whole original | 1/3 | 0/5 | 0/2 | **1/10** | 0 |
| English PP-OCRv5, whole original | 1/3 | 0/5 | 0/2 | **1/10** | 0 |
| English PP-OCRv5, higher-resolution detector/input | 1/3 | 0/5 | 0/2 | **1/10** | 0 |
| English PP-OCRv5, fixed overlapping 2×2 grid | 1/3 | 0/5 | 0/2 | **1/10** | 0 |
| English PP-OCRv5, whole-image 90° rotation | 1/3 | 0/5 | 0/2 | **1/10** | 0 |

All six pipelines have complete eight-photo coverage and zero recorded failed photos. The only accepted critical value in any Rapid/English pipeline remains **CF-001 MRP `22.00`**, supported by untouched OCR `MRP:22.00`.

The official raw-only strict scorer was used for the five untouched Rapid/English modes. Tesseract was separately marked **system-derived production-pass merge** and evaluated with the same explicit criterion: exactly one valid candidate, `format_valid`, no conflict, and a frozen normalized exact match. No raw-only provenance requirement was bypassed or falsely claimed. The merger uses the recorded standard/full-gray/reverse-sparse order, not a best-answer field selection.

## Interpretation and limits

The independently observed newer Chrome Paddle result is a **different execution** from these older local RapidOCR outputs. It may demonstrate a functioning adjacent-line quantity case, but it must be archived and measured as its own browser mode before being included in an all-eight-photo score. A successful focused Amul example cannot replace historical failed rows or establish general accuracy.

The original photos are a previously used, deliberately selected development corpus, with ten provisional AI-labelled readable values requiring human review. This is not an unseen-product holdout, a representative accuracy estimate, a false-clear benchmark or a legal-compliance validation. The Tesseract input rendering approximated browser preparation using Sharp; it was not an exact Chrome E2E run. No new timing or token-recognition gain is claimed because inference and raw text did not change.

**Decision remains:** do not integrate the English recognizer as an accuracy upgrade based on this experiment. Keep review/abstention safeguards, and measure the actual browser pipeline separately on the unchanged full corpus before publishing a new accuracy claim.

## Reproduction

From the repository root, `node reports/recognition-2026-09-04-pass2/score-final-parser.mjs` performs the paired comparison without network calls, inference or application mutation. Existing output is protected with exclusive creation; use a fresh output path for a later parser revision instead of overwriting this report. Earlier experiments and raw transcripts remain unchanged.
