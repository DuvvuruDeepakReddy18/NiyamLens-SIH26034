# Independent release validation: OCR parsing and report generation

4 September 2026. Tested the local NiyamLens 0.4.2 source, including the final product-title fix. This is an independent rerun of the frozen-output scoring and targeted tests, **not a new OCR inference run, field trial, legal opinion or live-cloud acceptance**.

## Result

- **81 targeted tests passed; 0 failed, skipped or cancelled.**
- Verified the exact SHA-256 of all **eight original source photographs** and rescored **64 unchanged historical OCR records**, with no handwritten corrections or proposed layout edits.
- Historical critical-field scores are unchanged: Tesseract **0/10**; RapidOCR multilingual **1/10**; each of the four English configurations **1/10**.
- The corrected title parser no longer calls the observed `500ml` crop a product name. Replaying that unchanged four-line crop yields quantity `500 ml` and MRP `22.00`, while preserving the wrong OCR tax wording. That is a parser regression check, **not a fresh recognition result**.
- The real DOCX generator produced a **12,157-byte native OOXML document**, and structural/content checks passed. Browser download completion and Word visual rendering are separate, unverified gates in this subtask.

## Tests executed

```powershell
node --test tests/label-formatting.test.mjs tests/rules-adversarial-regression.test.mjs tests/critical-field-benchmark.test.mjs tests/report-document.test.mjs tests/ocr-reading-order.test.mjs
```

| Test group | Passed | What this covers |
| --- | ---: | --- |
| Frozen critical-field scorer | 18 | Exact photo identity, raw-only provenance, no ground-truth cherry-picking, strict denominators, image tampering and malformed inputs |
| Formatting and title extraction | 7 | Dotted headings, literal tax qualifiers, conservative adjacent-line quantity handling, invalid dates, no invented product title |
| Reading order and proposals | 19 | Original strings and source mappings, geometric ambiguity, conflicting declarations, explicit officer acceptance |
| DOCX generator | 11 | Real OOXML, escaped text, raw versus reviewed transcript, image bytes and hashes, explicit omissions and limits, no false certification |
| Adversarial rules | 26 | Invalid/corrupted money and units, calendar checks, conflicts, scope/classification, exemption safety, physical uncertainty, **10,000 malformed inputs** and **100 valid permutations** |
| **Total** | **81** | Targeted tests, not the entire repository test suite |

The first sandboxed test launch failed before executing tests because Windows denied worker spawning (`spawn EPERM`). The approved elevated rerun executed all 81 tests successfully. A Node experimental warning about unavailable `localStorage` occurred during DOCX tests; the pure report generator did not require browser storage.

## Frozen dataset scoring

Eligibility is unchanged: **three readable MRP values, five readable quantities and two readable packing/manufacturing dates**, totalling ten positive references across eight photos. The other fourteen photo/field pairs are excluded, not counted as correct negatives. References are provisional AI visual annotations on a previously used development set and need independent human review.

A correct field requires exactly one valid candidate, `format_valid`, no conflict, and an exact normalized match to the eligible frozen reference. Seeing the right digits somewhere in the raw transcript does not qualify.

| Stored-output pipeline | Photos | Recorded inference failures | MRP | Quantity | Packing date | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract standard, raw | 8 | 0 | 0/3 | 0/5 | 0/2 | 0/10 |
| Tesseract full-gray, raw | 8 | 0 | 0/3 | 0/5 | 0/2 | 0/10 |
| Tesseract reverse-sparse, raw | 8 | 0 | 0/3 | 0/5 | 0/2 | 0/10 |
| Tesseract actual production pass merge | 8 | 0 | 0/3 | 0/5 | 0/2 | 0/10 |
| RapidOCR multilingual, whole image | 8 | 0 | 1/3 | 0/5 | 0/2 | 1/10 |
| English PP-OCRv5, original | 8 | 0 | 1/3 | 0/5 | 0/2 | 1/10 |
| English PP-OCRv5, higher resolution | 8 | 0 | 1/3 | 0/5 | 0/2 | 1/10 |
| English PP-OCRv5, fixed 2×2 grid | 8 | 0 | 1/3 | 0/5 | 0/2 | 1/10 |
| English PP-OCRv5, whole-image 90° rotation | 8 | 0 | 1/3 | 0/5 | 0/2 | 1/10 |

All raw modes have complete eight-photo coverage. The merger is separately identified as system-derived and is never passed off as raw OCR. It uses the recorded standard/full-gray/reverse-sparse order, not best-answer selection. The historical Tesseract rendering used Sharp approximations of browser preprocessing; this rerun does not convert it into exact Chrome acceptance.

**The optional browser Paddle engine and officer-selected crop success are different executions. Neither was added to this denominator or used to replace a failed historical row.** These results do not establish the actual browser Paddle model's full-corpus score. A whole-corpus browser run remains a separate measurement.

## Hash binding and final title fix

Input and tested-source hashes were identical before and after this validation. All hashes and per-photo candidates are in `ocr-validation.json` and `frozen-raw-scores.json`.

- Manifest: `4f869df89f6246e774189a7522e2798f5ab680b83e887eb8ddeae6c08fd977ad`
- Final `labelParser.mjs`: `5a14b178b62596cb419d0921e31e87735a4ac921518f618b6e852222385d24d6`
- Final `extraction.mjs`: `93b6d61fc7f8893bed90127bbef2187aa9dafd57fad0b06350c43c54b15e97cd`
- `reportDocument.mjs`: `0f1dac6e3710a7462b4e9d167270212d6b49acfa88e6e88e2c2b0fa243a30764`

The title heuristic examines an eligible first label line only; it does not search below declaration headings for a product name. Explicit generic-name declarations still work. This corrects future extraction; it does not rewrite the title of an already sealed historical case.

## DOCX generation validation

`synthetic-export-validation.docx` is explicitly synthetic and contains no user case or external image. The production `buildInspectionDocx` function generated it. The validator read the ZIP central directory and inflated actual OOXML members: 24 ZIP entries, native content-type/style/document structures, no renamed HTML or `altChunk` payload.

Confirmed in the generated document XML:

- XML-safe rendering of `<A&B>`.
- Separate original OCR `MRP Rs. 1OO.OO` and reviewed `MRP Rs. 100.00`.
- Manual-review status remains visible.
- Officer-supplied audit history is explicitly not an independently verified server audit.

Artifact SHA-256: `30868df33b415f020f0accd0f3d94ce7f058c33f755fc0b59543462e2751a7f9`.

The eleven generator tests additionally cover embedded original/analysis PNG bytes and hashes, conflicting candidate preservation, rejected hash mismatches, omitted private remote URLs, unsupported or invalid images, bounded dimensions/text, and absent OCR-confidence claims for manual input. This establishes generator behavior, **not browser download completion, Word layout quality, legal admissibility or real-case export acceptance**.

## Reproduction and remaining gates

From the repository root:

```powershell
node reports/release-2026-09-04/validate-ocr.mjs
```

Outputs are created exclusively; the script intentionally refuses to overwrite this validation or any prior raw evidence. Use a new output directory for a future source revision. The eight-photo source files must be present locally for image-hash verification.

No core application source or prior raw OCR report was edited by this validation subtask. New evidence is under `reports/release-2026-09-04/`.

Remaining gates are full-corpus actual browser recognition, representative unseen photos with independent human labels, measured false-clear/false-flag rates, legal/rule review by a qualified stakeholder, target-phone performance and configured live Auth/Storage/cross-user acceptance. Passing parser tests does not remove these gates or guarantee an SIH win.
