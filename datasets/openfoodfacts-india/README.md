# Open Food Facts India real-label pilot

This folder defines a reproducible field-photo OCR pilot for NiyamLens. It deliberately includes flat cartons, flexible pouches, a curved bottle label, glare, wrinkles, rotation, soft focus, multilingual printing and a retail sticker. Version 2026-09-03.3 contains 17 scored declaration-panel photographs from 10 products, plus unscored front/marketing stress images.

## What is committed

- `real-labels.manifest.json`: selected product/image IDs, roles and pre-declared expected tokens.
- Download and QA scripts in `tools/`.
- `reports/ocr-real-label-benchmark.json`: the most recent unedited browser-OCR result.

The photographs and Google Cloud Vision JSON files are downloaded locally and ignored by Git so the repository stays small. Run:

```powershell
npm run dataset:real:fetch
npm run dev -- --host 127.0.0.1
$env:NIYAMLENS_BROWSER_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run qa:ocr:real
npm run qa:ocr:google-baseline
```

## Interpretation

The expected tokens are visually transcribed from the photographs before running OCR. The QA script uploads each real photograph through the same UI a judge uses, clicks **Run browser OCR**, and reads the resulting text without editing the textarea. Token recall is therefore reproducible evidence of OCR behavior, not a claim of legal-compliance accuracy.

The Google Vision command scores the precomputed annotation files distributed with the source dataset as a reference ceiling. Those annotations are never loaded by the NiyamLens app and are not a fallback for unseen labels.

Open Food Facts is contributor-maintained and does not guarantee the correctness or completeness of product data. Use it for engineering tests, not as authoritative compliance ground truth. Package images are CC BY-SA; the database is ODbL 1.0. Product and image source URLs are retained in the downloaded manifest.

Sources:

- <https://openfoodfacts.github.io/openfoodfacts-server/api/>
- <https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/>
- <https://openfoodfacts.github.io/openfoodfacts-server/api/aws-images-dataset/>
- <https://registry.opendata.aws/openfoodfacts-images/>
