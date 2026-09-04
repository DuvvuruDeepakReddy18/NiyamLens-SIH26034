# Six-photo exploratory local OCR smoke

This runner executes **real Node Tesseract.js OCR on unchanged source images**. It is explicitly separate from the frozen, human-labelled field pilot and from the complete browser preprocessing/guided-crop pipeline. There is no accuracy score, legal verdict, label invention, correction or tuning.

## Selection and privacy

Before running OCR, record a deterministic selection policy and choose at most six distinct new-to-team SKUs. For a 30-photo download, the planned split is the first six in the documented acquisition order for exploratory smoke and the remaining 24 untouched for later human annotation. Do not select six based on which OCR outputs look best. Once used, these six are development-exposed—not held back or unseen.

Keep selection, full raw outputs and downloaded photos in the user-approved external Desktop source directory or `.niyamlens-private/field-pilot/`, not `public/` or GitHub. The console reports only sample IDs, progress/error codes and completion counts; full raw OCR stays in the private artifact.

Selection JSON:

```json
{
  "schemaVersion": 1,
  "kind": "exploratory-field-ocr-selection",
  "isHoldout": false,
  "selectionPolicy": "Deterministic first six downloaded new SKUs in the recorded acquisition order; remaining 24 have not been run through OCR.",
  "samples": [
    {
      "id": "PUBLIC-001",
      "productKey": "EXACT-LOWERCASE-SKU-OR-BARCODE",
      "sourcePath": "photos/CODE-IMAGE.jpg",
      "sha256": "EXACT-SOURCE-IMAGE-SHA256"
    }
  ]
}
```

Replace the placeholders. Every source path is relative to `--photo-root`. No ground-truth values or working transcripts belong in this selection. Product IDs, image hashes, paths and sample IDs must be unique. The public downloader's `images[]` can be mapped from `code`, `localPath` and `sha256`; preserve the downloader's separate source/license/attribution manifest.

## Explicit execution

From the repository root:

```powershell
node tools/run-field-ocr-smoke.mjs --run --photo-root "C:/Users/duvvu/Desktop/SIH/<new-folder>" --input "C:/Users/duvvu/Desktop/SIH/<new-folder>/smoke-selection.json" --output "C:/Users/duvvu/Desktop/SIH/<new-folder>/smoke-raw-v1.json" --timeout-ms 60000
```

The `--run` flag is mandatory. Without it, the CLI refuses to execute. The output file is create-only: rerunning cannot overwrite an existing raw artifact. Original image bytes are read, validated/hashed and supplied unchanged; no derived/corrected image is written. Inputs follow the photo-pilot limits: static JPEG/PNG/WebP, at least 300×300, at most 15 MiB and 40 megapixels.

Fixed recognition settings: installed Tesseract.js 7, installed local core, `eng` language from `public/ocr/lang/eng.traineddata.gz`, LSTM-only, AUTO page segmentation and preservation of interword spaces. `cacheMethod: none` avoids writing a language cache. Local model files are required and hashed; the Node SDK's local-path load is used, not its CDN fallback. The runner does not download anything or use browser/account credentials. It does not measure recognition for non-English scripts; such photos may produce poor or empty output and are not silently excluded.

Each image gets a fresh hidden Node child containing Tesseract's worker thread. A bounded parent timer kills the whole child on initialization or recognition timeout. Default timeout is 60 seconds, configurable from 100 to 120,000 milliseconds. Worker stderr is never echoed and is capped. The child receives only a minimal system/temp/path environment, not cloud/Auth tokens; parent Node arguments such as `--env-file`, `--require` and `--import` are explicitly not inherited. A process error after successful spawn still triggers termination and waits for closure. Failed/unconfirmed termination stops the batch and records remaining samples as unrun. The child and worker terminate after the pass.

## What the raw artifact means

The JSON records exact source and raw-text hashes, untouched `rawText`, `manuallyEdited: false`, model/package versions, fixed parameters, timestamps, elapsed seconds, engine confidence and failure rows. The three extracted suggestions are clearly marked `notGroundTruth: true`. Engine confidence is not correctness or field accuracy. An empty successful transcript is distinct from a timeout/error; every selected photo remains represented. Latency includes file validation and fresh worker initialization, not steady-state browser timing.

After actual execution, add a **redacted** `datasets/field-smoke-YYYY-MM-DD.json` marker containing only `{ "schemaVersion": 1, "samples": [{ "productKey": "...", "sha256": "..." }] }` for these six source images/SKUs. The field-pilot exclusion inventory automatically loads matching marker files. Do not commit raw OCR, review notes, photo paths or personal data. The remaining 24 candidates still require independent human labels before freeze and are not a validated holdout merely because they were reserved.

## Tests are not an OCR result

```powershell
node --test tests/field-ocr-smoke.test.mjs tests/field-pilot.test.mjs
```

Contract tests use mocked recognizers/children and synthetic image blocks to test unchanged bytes/text, bounded workers, privacy, hash mismatch, failure preservation and missing-row handling. They deliberately do not run real OCR or establish real-photo accuracy. The real six-photo command above must be run separately by the authorized operator and its evidence reported honestly.
