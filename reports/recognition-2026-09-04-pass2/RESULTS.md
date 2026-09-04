# English-model and generic image-strategy comparison

4 September 2026. **Decision: do not replace the current recognizer with this English model on the evidence obtained.** It yielded no new correct declaration field and no newly recovered eligible value token. This is a negative development experiment, not proof that every modern OCR engine fails or that the application is ready for unattended inspection.

## Actual execution and frozen comparison

The four configurations in `PLAN.md` were fixed before the new run. Each attempted all eight unchanged, SHA-256-verified photographs from `datasets/critical-fields.v1.json`. All **32 configuration/photo rows**, comprising **56 recognitions**, completed with **zero errors**. New inference time totaled **213,022 ms**, excluding model initialization/imports/downloads.

All inputs stayed local. The inference harness blocked Python socket connections and disabled ONNX Runtime telemetry. No photos were uploaded. No transcript correction, answer dictionary, hand-selected ROI, label-dependent orientation choice, or fifth configuration was introduced after seeing results.

The English recognizer is the official **en_PP-OCRv5_rec_mobile**, used with the already installed PP-OCRv6 small detector and mobile 0/180-degree line classifier. RapidOCR supports mixed model versions. Contrary to the initial hypothesis, the previous default PP-OCRv6 small recognizer is multilingual, not a Chinese-only model; simply setting its language flag to English would reuse the same weights. See the [official usage guide](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/usage/) and [mixed-version model API](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/how_to_use_ppocrv5/).

The new runs **and the prior default run** were rescored together using the same current parser, which remained unchanged during scoring. Source hashes are retained in `scoring-provenance.json`; notably:

- `labelParser.mjs`: `b4e4d243023e18ed3fc88429a3ef1abe8c132c899c669113463e37d56f57ec99`
- Frozen manifest: `4f869df89f6246e774189a7522e2798f5ab680b83e887eb8ddeae6c08fd977ad`

| Configuration, all eight photos | Correct associated fields | Literal expected tokens present | Total inference time |
| --- | ---: | ---: | ---: |
| Prior multilingual PP-OCRv6 small default | **1/10** | **6/10** | 30,811 ms |
| English PP-OCRv5, original/default scale | 1/10 | 5/10 | 31,560 ms |
| English PP-OCRv5, larger detector/input limits | 1/10 | 5/10 | 53,334 ms |
| English PP-OCRv5, fixed overlapping 2×2 grid | 1/10 | 5/10 | 98,432 ms |
| English PP-OCRv5, whole-image 90° clockwise rotation | 1/10 | 3/10 | 29,696 ms |

Every extraction result is **MRP 1/3, quantity 0/5, packing/manufacture date 0/2**. Only CF-001's MRP `22.00` becomes a valid, conflict-free, exact associated declaration. Token presence is deliberately a separate diagnostic: finding a number in OCR does not associate it with a heading, rule, or physical package declaration. No best-of-field oracle or per-photo winning configuration was scored.

The grid mode retains its four raw subpasses and joins their strings in fixed tile order, without text editing or deduplication. Larger input/detector limits were `Global.max_side_len=3200` and `Det.limit_side_len=960`; other modes retained 2000/736 and default thresholds. These are native Windows CPU timings under the actual machine load, not phone/browser service-level promises or an isolated model-weight benchmark.

## What changed in recognition

The original, high-resolution and grid English modes all retain the same five eligible tokens: CF-001 MRP `22.00`, CF-003 MRP `90.00`, CF-004 quantity `910 g`, and CF-006/007 quantity `1 l`.

The previous model's sixth token was CF-003 packed date **`02/08/2026`**. English original/high-resolution/rotation output **`02-08-2026`** instead; the grid additionally produces partial/mixed-separator variants. Its date digits are recognizable, but the frozen scoring policy explicitly preserves printed date separators. We did not change that policy to make the new model look better. This discrepancy still does not solve packed-versus-use-by association.

Unresolved cases remain substantial:

- CF-001 `500 ml` continues to be read as `500m` or `500.m`.
- CF-002 stamped MRP `27` remains corrupted (`MRPT9OR`, `MRP9R`, or `MRP299R` variants); no product-code lookup fills it in.
- CF-005's eligible quantity and packing date are not recovered by these generic crops or rotation.
- Headings and values on several images remain separated/interleaved. More recognized text does not itself fix the declaration parser.
- CF-008 retailer price/product-description values remain excluded from package-declaration denominators.

These eight previously used development photos have provisional AI visual annotations requiring independent human review. This is not an unseen-product holdout, a representative accuracy estimate, a legal verdict benchmark, or evidence of SIH winning probability.

## Stable model path and browser compatibility

Only **7,872,351 bytes** of new model data were downloaded, below the 120 MB cap. The file is at `reports/recognition-2026-09-04-pass2/models/en_PP-OCRv5_rec_mobile.onnx` and is ignored by Git. It came from the official version-pinned RapidOCR registry URL:

[Official model asset](https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx)

SHA-256: `c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8`.

Actual local model/session inspection established:

- Input `x`: float tensor `[N, 3, dynamic-height, dynamic-width]`; configured recognition shape `[3,48,320]`, with width adjusted by batch aspect ratio.
- Output `fetch_name_0`: float tensor `[N,T,438]`. Installed postprocessing is CTC argmax over axis 2, duplicate collapse and blank removal.
- `custom_metadata_map['character'].splitlines()` contains **436 dictionary entries**, with **neither blank nor space**. The decoder prepends blank and appends space, giving 438 classes. Do not accidentally add an empty entry by splitting the trailing newline incorrectly.
- Input normalization in the installed recognizer is channel-first `(pixel/255 - 0.5)/0.5`, with right-side zero padding. Its image loader supplies **BGR** pixels. Browser color order, resize behavior and padding must agree before interpreting a model comparison.

This makes an ONNX/browser package structurally plausible, **not verified**. No custom tar, `inference.yml`, WASM/WebGPU test or browser integration was created. Given no measured benefit here, there is no evidence-based reason to ship this English-model replacement now. The raw model and explicit checksum remain available for a later controlled compatibility test without another download. A separate local CPU companion would likewise add installation/security/maintenance costs without improving the current measured field result.

## Artifacts and reproduction

- `PLAN.md`: fixed configurations declared before inference.
- `run-experiment.py`: offline inference harness using the existing isolated Python environment; verifies every source/model hash and refuses output overwrites.
- `english-strategies-raw.json` / `.jsonl`: complete untouched outputs, confidence values, raw subpass boxes, mapped source-coordinate boxes, transforms, errors, model/runtime configuration and timings.
- `paired-extraction-score.json`: strict actual-parser results for the new four modes plus previous default, 40 matched rows, all eight image hashes verified.
- `token-diagnostic.mjs` / `.json`: transparent literal-token diagnostic, separate from declaration accuracy.
- `score-experiment.mjs` and `scoring-provenance.json`: paired scorer and stable parser/source hashes.

From the repository root, with the previous isolated environment and the verified model present:

```powershell
& 'C:\Users\duvvu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' reports/recognition-2026-09-04-pass2/run-experiment.py
node reports/recognition-2026-09-04-pass2/score-experiment.mjs
node reports/recognition-2026-09-04-pass2/token-diagnostic.mjs
```

Existing output filenames intentionally cause a refusal; use a fresh experiment copy/directory for a true rerun instead of replacing historical raw evidence. Installed-package permissions required approved elevated local Python execution in this sandbox. No application source, package dependencies, cloud resources, or historical experiment outputs were modified.
