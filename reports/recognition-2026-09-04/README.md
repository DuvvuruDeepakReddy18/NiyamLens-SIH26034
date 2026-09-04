# Fresh local OCR: four difficult real packages

Run date: 4 September 2026. This is a small engineering experiment, **not a real-world accuracy estimate, SIH win probability, or legal-compliance certification**.

## Additional frozen eight-photo whole-image baseline

`critical-baseline-raw-passes.jsonl` retains 24 additional fresh recognitions: every one of the 8 exact paths in `datasets/critical-fields.v1.json`, with 3 whole-image passes each. The original image SHA-256 values were verified against the frozen manifest before recognition. No selected crop, manual rotation, copied declaration, or expected answer was supplied to OCR.

This mode approximates the current default browser workflow with Sharp: upload-stage maximum dimension 2200, contrast 112%, JPEG quality 90; then maximum-dimension-2400 standard contrast 112% sparse, grayscale contrast 132% block, and grayscale/inverted contrast 145% sparse passes. Tesseract uses the bundled English fast model and DPI 300, matching the runner parameter. This is **not a byte-identical Canvas/JPEG/browser rendering reproduction**. The earlier four-photo experiments start directly from the photographs instead and must not be reported as this complete default workflow.

Processing across the 24 passes took 32,784 ms, excluding model initialization and upload-stage preparation. Every result retains `sampleId`, `sourcePath`, `imageSha256`, provenance, variant, unmodified `rawText`, and separate parser output. The eight photographs remain a purposefully selected, previously used development corpus with provisional AI visual annotations, not a holdout or human-adjudicated compliance dataset.

The manifest's eligible provisional value denominators are MRP 3, net quantity 5, packing date 2; excluded fields must not be counted as correct negatives. Independent critical-field scoring is performed separately. A concrete error remains visible in this raw baseline: CF-003 grayscale reads `PACKED ON: 02/08/2020`, which is a valid date but the wrong year versus the photograph's 2026. A valid parser result is not proof of accurate recognition.

Reproduce this mode with `node tools/ocr-experiments.mjs --critical-baseline`.

## Outcome

Focused rescanning helps some declarations, but neither heavier models nor stronger contrast makes these photographs reliably readable. Retain raw alternative readings, require visual confirmation of critical fields, and request a sharper/new-angle photograph when glare or curvature removes evidence. A model-only upgrade is not supported by this sample.

| Photograph and visually checked target | Existing-style whole-image passes | Useful local change | Still unresolved |
| --- | --- | --- | --- |
| Amul, `8901262260121/6.jpg`: 500 mL; MRP 22.00 | Original sparse, contrast sparse, and grayscale block miss both targets | Officer-selected color crop + block segmentation reads `MRP: 22.00` | Quantity becomes `500 nm`/`500 rn`. Red-channel processing loses the decimal and reads `MRP: 2200`. |
| True Story jaggery, `8906014888868/5.jpg`: packed 02/08/2026; use by 01/08/2027; MRP 90.00; USP 0.18/g | Whole-image versions miss these exact targets; full grayscale does read the separate consumer email | Color crop reads both date strings; red-channel crop reads `90.00` | Labels and values are separated/misordered. Color crop says `30.00`, not `90.00`; USP unit is misread. Correct visible date digits do not establish correct field association. |
| Britannia, `8901063017252/20.jpg`: feedback@britindia.com; 1-800-4254449; 1-800-30004530 | Full grayscale reads both telephone digit sequences, with a period replacing one separator | Crop + local contrast equalization (CLAHE) reads both phone strings with expected separators | Consumer email is not recovered. Plain color crop is empty; crop alone is not always an improvement. |
| Kinley, `8901764082405/6.jpg`: indiahelpline@coca-cola.com; 1800-208-2653 | Both target channels misread | CLAHE produces a closer email-like string, but not the actual email | Neither target recovered exactly in retained runs. Curved/soft-focus evidence needs recapture. MRP on cap/neck is not scored on this image. |

The consumer phone checks in the raw JSON use literal separator patterns: a period in `1.800-30004530` makes that check false even though the digits are correct. These boolean probes must not be aggregated into a claim of field accuracy. Conversely, merely seeing `90.00` somewhere does not mean the extraction correctly associated it with MRP.

## Retained experiment records

- `fast-raw-passes.jsonl`: 40 fresh recognitions, 10 variants on each of 4 original photographs. Processing time across the 40 passes: 47,646 ms, excluding model initialization.
- `best-portable-raw-passes.jsonl`: 24 fresh recognitions, the same 6 baseline/crop variants on each of 4 photographs. Processing time: 71,760 ms, excluding initialization.
- Each JSON row keeps **complete unedited OCR text**, elapsed time, segmentation mode, crop coordinates, literal target probes, and the current parser's separate extracted values.
- Timings are measurements on this Windows/Node machine, not browser/phone service-level guarantees. Runs are sequential within each artifact; earlier exploratory reruns are not independent test images.
- The 24 matching fast passes take 29,072 ms versus 71,760 ms for portable best (approximately 2.47 times as long here). This compares model/core combinations, not an isolated effect of model weights.
- No text replacement, product-specific dictionary, character whitelist, external recognition service, or prior Google Vision transcript was used. Existing dataset images were only read locally.
- ROIs were selected by inspecting the photographs. This simulates an officer drawing a crop; it is not evidence that the software can automatically find that region.

## Heavier English model: do not enable by default

Official source: [Tesseract tessdata_best](https://github.com/tesseract-ocr/tessdata_best) (Apache-2.0).

Downloaded unmodified file: `tessdata-best/eng.traineddata`, 15,400,601 bytes.

SHA-256: `8280AED0782FE27257A68EA10FE7EF324CA0F8D85BD2FD145D1C2B560BCB66BA`.

The installed Tesseract.js 7 automatically selected a SIMD core that aborted on recognition with `missing function: _ZN9tesseract13DotProductSSEEPKfS1_i`. Passing `dotproduct: generic` in initialization did not repair it. Both failed attempts are excluded from successful run counts.

The experiment-only `portable-ocr-worker.cjs` selects the installed, unmodified non-SIMD LSTM core through the existing worker adapter interface. This successfully ran the floating-point weights. It does not modify installed packages or the application. Node's default worker implementation ignores `corePath`; the browser has different loading behavior and would need separate compatibility tests.

**Local-only artifact: do not commit or deploy `tessdata-best/eng.traineddata` (15.4 MB) as part of the application.** It is retained locally for reproducibility; it has not been deleted or copied to production assets.

Across the 24 paired variants, the heavier model adds **no successful literal critical-field probe** compared with the matching fast-model pass. Do not publish or ship the 15 MB model as an accuracy improvement on this evidence. The files remain experiment artifacts; no production model path or package dependency was changed.

## Reproduce

From the repository root:

```powershell
node tools/ocr-experiments.mjs
node tools/ocr-experiments.mjs --base-only --lang-path reports/recognition-2026-09-04/tessdata-best --uncompressed --portable
node tools/ocr-experiments.mjs --case amul --variant roi-color
```

The script prints JSON lines; it does not write or alter transcripts. The official model must exist at the above path for the second command. The default path uses the already bundled English model and requires no network access.

Variants include original sparse, current-style contrast sparse, grayscale block, color/grayscale/red-channel block crops, CLAHE crop, Sauvola/adaptive-Otsu crops, and a smaller crop. Strong adaptive thresholding with default settings substantially increases noise on this sample; it should not silently replace the original input.

## Implementation recommendation

1. Make a deliberate image-region rescan available with original-resolution input, modest padding, visible selected area, and cancellation.
2. Keep the original color crop plus a grayscale alternative. For difficult illumination, a separately labeled local-contrast pass may help, but has not been broadly validated.
3. Show each unedited transcript and retain decimal, date, unit, and contact differences as conflicts. Never choose the numerically convenient answer or overwrite evidence with the visually expected value.
4. Require explicit officer verification of MRP, quantity/unit, relevant date, and contact details against the source image. Any manual correction must be visibly attributed as manual, not successful OCR.
5. Prompt a close, sharp, low-glare, flatter/new-angle capture for unresolved regions. These four photographs do not justify promising that the current engine reads arbitrary real labels unattended.

Image provenance: Open Food Facts contributor photos already present in `datasets/openfoodfacts-india/real-labels.manifest.json`; image license CC BY-SA, database ODbL. Product-specific contributor/source metadata remains in the dataset. Human-visible field observations here are for engineering comparison, not a judgment that the package is legally compliant.
