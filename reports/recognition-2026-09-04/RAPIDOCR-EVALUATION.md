# RapidOCR: real-photo local inference comparison

4 September 2026. **Experimental evidence, not a production integration.**

## Decision

The modern detector/recognizer recovers materially more visible text, but swapping the OCR engine alone does **not** solve this application. With the current declaration extractor, RapidOCR correctly associates only **1 of 10** eligible price/quantity/packing-date values. The three existing-style Tesseract passes each associate **0 of 10**, scored separately. Do not market these small development counts as real-world accuracy.

Six of the ten expected value tokens appear in RapidOCR's unmodified output, but five fail field association. That is a useful engineering diagnosis, **not 6/10 declaration accuracy**. Layout-aware association and safe visual review are prerequisites to a meaningful integration.

## What actually ran

- Python 3.12.14, RapidOCR **3.9.2**, ONNX Runtime **1.29.0**, CPU defaults, Windows. All eight exact source paths in `datasets/critical-fields.v1.json` were hashed and matched before inference.
- Original whole photographs; no supplied answer strings, correction dictionary, manual crop, manual rotation, or per-product threshold. RapidOCR's own default detection, crop-orientation classifier, resizing, and recognition remain enabled.
- The package's three bundled ONNX models total **31,749,509 bytes**. Models and configuration hashes/values are recorded with the raw session. No additional model download occurred during inference.
- Python socket connections were blocked and ONNX Runtime telemetry disabled before model creation. Images were read locally; none were submitted to an external OCR service.
- **8/8 recognitions completed, 0 errors.** Model initialization: **350 ms**, measured after Python imports. Inference: **30,811 ms** total, mean **3,851 ms/photo**, range **3,176–4,628 ms**. This excludes dependency download, Python imports, browser rendering, network, and application workflow overhead.
- Environment installation succeeded from public PyPI into the ignored `rapidocr-env/` experiment directory; application dependencies were not modified. Principal wheels total approximately 108 MB, plus small support packages, below the 200 MB download ceiling. Expanded installed directory measured **283,773,024 bytes / 3,477 files** including dependencies and bytecode.

Official implementation/install references: [RapidOCR installation](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/install/) and [RapidOCR usage](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/usage/).

## Frozen scoring

The manifest SHA-256 at inference was `4f869df89f6246e774189a7522e2798f5ab680b83e887eb8ddeae6c08fd977ad`. It has eight previously used development photographs across six product codes, with **provisional AI visual labels requiring independent human review**. This is not an unseen-product holdout, random sample, or legal-verdict corpus.

The shared scorer reruns the real `extractDeclarations` on unedited transcripts. Correctness requires one valid, non-conflicting field candidate with the frozen normalized value. Numeric digits and date separators are preserved; quantity unit spelling/case alone can normalize. Unreadable, unshown, and ambiguous-field values are excluded, never counted as correct negatives.

| Whole-image mode | MRP | Quantity | Packing/manufacture date | Total | Inference across eight photos |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tesseract standard sparse pass | 0/3 | 0/5 | 0/2 | 0/10 | 8,937 ms |
| Tesseract grayscale block pass | 0/3 | 0/5 | 0/2 | 0/10 | 13,370 ms |
| Tesseract reverse sparse pass | 0/3 | 0/5 | 0/2 | 0/10 | 10,477 ms |
| RapidOCR default whole-image pass | **1/3** | **0/5** | **0/2** | **1/10** | **30,811 ms** |

These are **per-pass** comparisons. They do not establish the result of the application's three-pass merge/selection. Tesseract inputs use a Sharp approximation to browser preprocessing, while RapidOCR receives original files and applies its own defaults; timings and counts compare these workflows, not an isolated change of model weights. No browser/mobile performance claim follows.

### Exact failure diagnosis

The following token-presence observations were made from retained output; they are not additional extraction predictions or corrections.

| Photo | Frozen eligible field | Token in untouched RapidOCR text? | Current extractor result |
| --- | --- | --- | --- |
| CF-001 Amul | MRP `22.00` | Yes: `MRP:22.00` | Correct `22.00` |
| CF-001 Amul | Quantity `500 ml` | No: `500m` | Invalid heading-only candidate |
| CF-002 Amul | MRP `27` | No: stamp reads `SV03AE/MRP290R` | No MRP extracted |
| CF-003 jaggery | MRP `90.00` | Yes: `90.00 USP` | Invalid; heading occurs later |
| CF-003 jaggery | Packed `02/08/2026` | Yes | Conflict; value/heading order is interleaved with use-by |
| CF-004 coconut oil | Quantity `910 g` | Yes: `NTENTS at 30°C: 910g` | Not extracted; heading partly misread |
| CF-005 Milky Mist | Quantity `1 l` | No | Invalid candidate |
| CF-005 Milky Mist | Packed `19/10/25` | No | Invalid candidate |
| CF-006 Kinley | Quantity `1 l` | Yes: `1L` | Invalid heading-only candidate; unrelated lines intervene |
| CF-007 Kinley | Quantity `1 l` | Yes: `1l` | Invalid heading-only candidate; unrelated lines intervene |

CF-008 retailer sticker has no eligible package-declaration values. The engine reading retailer `5.00` and product-description `125ML` must not count as MRP/net-quantity success. Likewise, CF-003's `01/08/2027` is use-by, not packing date. All raw lines and polygons remain available to inspect these distinctions.

## Artifacts and reproduction

- `rapidocr-experiment.py`: isolated inference harness; refuses to overwrite prior output files.
- `rapidocr-default-raw.json`: canonical eight raw rows, session, complete engine-returned strings, original-coordinate polygons, confidences, timings, model hashes, default config and dependency versions.
- `rapidocr-default-raw.jsonl`: write-through journal of the same session/rows.
- `rapidocr-versus-baseline-score.json`: shared scorer results for 32 rows / four modes, with all eight source-image hashes independently verified. No unmatched image rows.
- `critical-baseline-raw-passes.jsonl`: separately generated existing-style baseline input, preserved unchanged.

Install/run from the repository root. Use a fresh `--output` basename on rerun:

```powershell
& 'C:\Users\duvvu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m pip install --target reports/recognition-2026-09-04/rapidocr-env --disable-pip-version-check --timeout 20 --retries 1 rapidocr==3.9.2 onnxruntime==1.29.0
& 'C:\Users\duvvu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' reports/recognition-2026-09-04/rapidocr-experiment.py --output reports/recognition-2026-09-04/rapidocr-recheck-raw.json
node tools/score-critical-fields.mjs --input reports/recognition-2026-09-04/rapidocr-default-raw.json --input reports/recognition-2026-09-04/critical-baseline-raw-passes.jsonl --verify-images --output reports/recognition-2026-09-04/rapidocr-recheck-score.json
```

Pip's installed-wheel permissions required elevated local execution in this sandbox. The harness does not change file permissions or application files. For dependency-identical reproduction, use every recorded session dependency version; pinning only the two top-level packages permits later transitive-version drift.

## Deployment feasibility and next gate

**Demonstrated:** native Python CPU recognition on this machine, with bundled weights and no image upload. **Not demonstrated:** browser/WASM/WebGPU inference, Android performance, multilingual coverage, a deployed OCR service, multi-user load, memory peak, cancellation during native inference, or a secure app-to-local-service connection.

The official [PaddleOCR browser SDK](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/cross_platform/browser.en.md) supports client-side OCR, dedicated workers, raw polygons/text/scores, and configurable models/WASM assets. Its documented examples use **PP-OCRv5**, whereas this actual run uses RapidOCR's **PP-OCRv6 small** defaults. These results do not prove that the browser SDK or a different model set will reproduce them. A browser-native option needs its own identical-photo benchmark before integration.

The quickest architecture that could preserve this exact model pipeline is an **optional local CPU companion**, not a silent replacement of the deployed Vercel app. If pursued, require explicit user installation/connection; loopback-only binding; narrow origin allowlist plus per-session authentication; bounded image bytes/pixels and full decode; one bounded worker queue; native-process timeout/cancellation; model hashes; no arbitrary URL/file-path input; and separate raw transcript, polygons and manual corrections. A containerized authenticated backend is another option but changes the privacy, hosting and operational requirements. Neither service was built or deployed by this experiment.

Before deciding to integrate, test a generic **geometry-aware association layer** against preserved polygons and a new, human-reviewed holdout: same-row heading/value association, orientation handling, multiple-date conflicts, and rejecting nearby nutrition/retailer values. Keep uncertainty and officer confirmation; never select a value because it matches these ten answers. Current **1/10 associated values does not clear a reliable-prototype release gate**.
