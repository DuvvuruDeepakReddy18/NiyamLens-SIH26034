# NiyamLens 0.4.1 — real-label hardening and acceptance

4 September 2026 · SIH26034 · local implementation, not a production release.

Final software gate: **239/239 automated tests passed**, zero skipped/failed/cancelled; `npm run build` passed (1,678 modules). Thirteen new operation-race regressions exercise the actual current App function closures with delayed audit hashing and mocked image preparation; they are not substitutes for React/browser tests. `git diff --check` found no whitespace errors.

## Readiness verdict

**Improved inspection assistance; not yet a reliably automatic real-label reader or a guaranteed competition winner.** The local code and real-photo workflow improved. Difficult quantity/date recognition, independent field validation, regulatory review and hosted acceptance remain release gates. No GitHub push, production deployment, credentials, or cloud configuration was changed in this work.

## Implemented in this increment

| Change | Behaviour / verification |
| --- | --- |
| Focus OCR | Officer selects two opposite corners around a complete declaration. Three local passes use a padded original-resolution crop when geometry permits. Crop word boxes map back to the analysis image. The original photograph/hash is never replaced. |
| Preview before append | Merged crop reading and all unedited passes are visible. Nothing enters the working transcript until **Append crop OCR to evidence**. Existing text/corrections and conflicting readings remain. |
| Partial-evidence honesty | Appending a crop invalidates field/placement/measurement confirmations. It does not invent an inspection-wide OCR score. Image-quality and recognition scores are explicitly heuristics, not accuracy probabilities. |
| Cancellation and deadlines | Capture, image operations, local OCR and connected OCR are bounded/cancellable. Late workers are disposed. Aborted or superseded operations cannot publish late audit completions; new-record identity/audit is staged until successful capture. |
| Strict raw-output limits | Oversized raw text is rejected rather than truncated. Text, passes, words and geometry have bounded validation. Repeated runs have distinct pass IDs; conflicting price/quantity/date readings are not silently merged away. |
| Provider confidence | Zero is preserved in averages. Missing provider confidence remains unavailable. Connected OCR bounds image decode, authorization/provider work and response sizes. These provider checks were mocked, not a live Google Vision acceptance. |
| Cloud evidence contract | Bounded raw OCR passes and provider/model/strategy metadata survive client/server normalization as **client-reported** provenance. Invalid histories fail before image upload. Live storage/retrieval still requires acceptance testing. |
| Reproducible benchmark | A frozen eight-photo manifest, hash checks and a strict raw-OCR field scorer expose exact denominators, wrong numeric readings and excluded labels. Heavy-model and alternative-engine experiments remain separate from the shipped browser engine. |

## Actual Chrome acceptance

Test origin: `http://localhost:5180/`, separate from the existing `127.0.0.1:5180` browser store so the older draft/history stayed intact. Browser: Chrome, not simulated DOM screenshots.

1. Uploaded the actual `datasets/openfoodfacts-india/real-labels/8901262260121/6.jpg` photograph through Chrome's file chooser. The chooser initially timed out; a fresh tab and direct visible-button interaction succeeded.
2. Confirmed the original SHA-256 remained `9d2187d0603d8781814e24320b452d596dc826a50ba29f0a7643f6d43b0c619b`.
3. Started browser OCR and cancelled it. Controls became available again; the image remained and the previously empty transcript stayed empty. No completed OCR score was claimed.
4. Selected a crop around the MRP/quantity block. Ran the three real local passes. The working transcript remained empty until append.
5. The gray block pass read `MRP: 22.00`. Other passes included `MRP :® 22.00` and `MEP: 22.00`. Quantity remained wrong: `500 nm`, `500 mr`, `500 rn`. No correct text was typed or substituted.
6. Appended crop readings. The canonical MRP field showed `22.00`, while pass disagreement and quantity problems remained visible. The assessment remained **manual review: 19 review checks, 0 flags, 0 passes**, with no inspection-wide OCR score. Recovering a displayed price is not equivalent to an automatically verified field.
7. Sealed the uncorrected record as **`NLM-20260904-003748f0-785f-44bf-83a9-5e1e45f2af19`**.
8. Reloaded Chrome, opened history and reopened the record. The photograph/hash, matching working/original transcripts and internally verified local audit chain remained available. This verifies local persistence, not a cloud backup.

Development hot reloads interrupted early crop attempts while code was being edited. Those attempts were restored from the draft and rerun; they are not counted as completed acceptance runs. Automated tests subsequently cover additional cancellation fixes and unavailable-score wording. DOCX download/visual acceptance and every mobile/browser combination were not repeated here.

## Recognition experiment results — retain the failures

Frozen corpus: eight photographs / six product codes; **10 readable provisional references**: MRP 3, quantity 5, packing date 2. Labels were AI-visual, require human review, and come from a reused development corpus—not a product-level holdout or statutory ground truth.

| Experiment | Strict correctly associated, valid critical fields | Limitations |
| --- | --- | --- |
| Tesseract whole-image baseline | 0/10 for each of three variants; production text-merge diagnostic also 0/10 | Sharp approximation of browser preprocessing, not byte-identical Chrome E2E. Exact photograph hashes verified. |
| RapidOCR whole-image, offline CPU | 1/10 | Eight successful runs; 30.8 seconds total inference. Six expected value tokens appear somewhere, but token presence is not correct field association. Not integrated. |
| Conservative spatial association experiment | 1/10, unchanged | Zero accepted joins; ambiguous/rotated/stacked layouts abstained. Not integrated or represented as an improvement. |
| Focused Chrome scan above | One displayed MRP recovered; quantity still wrong | Officer-selected crop on a previously inspected development photo. Not a held-out accuracy rate. |

The official heavier Tesseract English model did not add critical-field probe wins on paired crop experiments and was about 2.47× slower with its working portable core. It is **not shipped**. Experimental Python dependencies/model binaries are local and Git-ignored; no new production OCR dependency was added.

Details: [experiment report](README.md), [RapidOCR evaluation](RAPIDOCR-EVALUATION.md), [baseline scores](critical-baseline-field-scores.json), [spatial negative result](rapidocr-spatial-association-v1.json). Earlier hardening evidence remains in [the prior handoff](../fixes-2026-09-04/READINESS.md).

## Team verification

From the repository directory:

```powershell
npm test
npm run build
npm run dev
```

In Chrome: upload a new photograph → cancel one scan → **Focus OCR** → select two corners including heading/value/unit → **Scan selected region** → inspect all raw passes → **Append crop OCR to evidence** → verify fields against the actual package → finalize → reload → reopen history. Do not count manually corrected text as OCR success. Photograph every relevant panel; unreadable/missing panels remain review.

Before a stronger readiness claim: obtain independently reviewed real labels and untouched product-level evaluation; improve critical-value recognition/association on that evaluation; verify applicable legal interpretations with a qualified reviewer; test actual hosted sign-in, private uploads, role isolation, recovery and backup restoration. A local test/build pass does not substitute for those gates.
