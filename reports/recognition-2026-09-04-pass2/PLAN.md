# Frozen second-pass experiment plan

Declared before running or inspecting the new inference outputs, 4 September 2026.

Question: Does a separate English recognition model and generic scale/orientation handling improve recognition of the eight frozen development photographs?

The installed RapidOCR 3.9.2 default PP-OCRv6 small model is multilingual. Merely changing its `lang_type` to English does not select separate weights. Use the official registered **en_PP-OCRv5_rec_mobile** recognition model instead, while retaining the already-installed PP-OCRv6 small detector and orientation classifier. Mixed model versions are supported by RapidOCR's official API.

Run exactly four predefined configurations across **every one of the eight** source paths from `datasets/critical-fields.v1.json`, verifying their SHA-256 values first:

1. **english-original**: original whole-image input, existing default Global.max_side_len=2000 and Det.limit_side_len=736.
2. **english-highres**: original whole-image input, Global.max_side_len=3200 and Det.limit_side_len=960. Same model/thresholds.
3. **english-grid**: fixed four 60%-width × 60%-height crops anchored at normalized (0,0), (0.4,0), (0,0.4), (0.4,0.4), in that order, default scale. This generic overlapping 2×2 grid is identical for all images; no annotation/location-driven crop selection. Raw crop outputs remain separately recorded and are joined without textual editing for the inspection transcript.
4. **english-rotate90**: whole image rotated 90 degrees clockwise, default scale. Built-in 0/180-degree line classification remains enabled, so text in the opposite horizontal direction is not manually corrected. No outcome-driven rotation selection.

Default confidence/detection thresholds remain unchanged. Every raw returned string, score, box, crop/rotation mapping, timing, model hash and error is retained. The models receive only image pixels, never expected values. No scores are inspected until all four configurations have attempted all eight photographs. No fifth fallback configuration is selected after reading results.

Score both the actual declaration extractor against the frozen 3 MRP + 5 quantity + 2 packing-date labels, and clearly separate literal recognition-token diagnostics. Neither metric is legal accuracy, a holdout claim or guaranteed performance on unseen labels. No App/package/vision integration belongs to this experiment.

Official sources:

- https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/usage/
- https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/how_to_use_ppocrv5/
- Installed `rapidocr/default_models.yaml` from the pinned 3.9.2 wheel: ONNX model URL `https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx`, SHA-256 `c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8`.

All inference stays local. At most 120 MB of additional official model assets may be downloaded; no image upload or cloud change is permitted.
