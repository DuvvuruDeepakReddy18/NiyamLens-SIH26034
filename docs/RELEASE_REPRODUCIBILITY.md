# Release reproducibility and validation boundaries

The automated release gate is deliberately separate from real-photo recognition testing. A green CI result is not a legal-accuracy certificate or a claim of success on arbitrary packages.

## Clean checkout

Use Node 22 and the committed `package-lock.json`:

```sh
npm ci --no-audit --no-fund
node tools/verify-ocr-assets.mjs
npm test
node --test .github/scripts/audit-production.test.mjs
npm run build
node tools/verify-ocr-assets.mjs dist/ocr/paddle-v1
node .github/scripts/audit-production.mjs
```

`npm ci` needs the package registry or a complete package cache. The dependency audit needs the registry. Unit/integration tests and OCR asset hash verification do not require a cloud project, API keys, Python, the ignored experiment environments or real package photographs. PostgreSQL policy tests run with PGlite; they do **not** prove deployed Supabase Auth/Storage configuration.

The new Paddle asset gate checks all 17 manifest-listed artifacts (68,186,300 bytes), required model/runtime/licence presence, exact SHA-256, SDK/runtime version alignment and expected same-origin paths. It does not download replacements or silently skip missing models. The post-build check proves those bytes reached `dist`. Actual browser inference must be tested separately. Asset checks verify consistency against the committed manifest, not independent authorship or all model-training licences.

The full static output includes additional SDK-generated chunks; the 68 MB number describes the manifest-listed Paddle assets, **not** the application's initial network transfer or total deployment size. Cold-device speed, offline first-use and memory limits still require device testing.

Preserve pinned asset and frozen benchmark bytes across checkout using repository `.gitattributes`. Automatic LF/CRLF conversion can otherwise break a correct file's recorded digest on Windows. Do not regenerate manifests merely to conceal an unexpected mismatch.

## Exact-photo verification — separate and strict

The source photos under `datasets/openfoodfacts-india/real-labels/` and `candidates/` are intentionally Git-ignored. The repository retains provisional labels and raw results, not an implicit promise that a clean checkout contains the original photographs.

With the exact original files present:

```sh
node tools/verify-critical-images.mjs
```

This checks all 14 frozen source images against the two manifests. A missing, changed or transformed image fails the command. There is no successful “skip missing images” mode. A current public-data re-download may differ from the frozen original; keep it as a new sample/version rather than rewriting the old hash. Retain the source attribution and applicable image licence when obtaining or sharing these photos.

This verifies photo identity only. It does not run OCR, prove that an old transcript came from those bytes, adjudicate labels or supply legal verdicts. To rescore retained unedited OCR outputs, use `tools/score-critical-fields.mjs --input <raw-file> --manifest <manifest-file> --verify-images`; the output preserves errors, missing-run denominators and ambiguous/excluded labels.

The eight-photo development corpus has ten provisional readable critical fields: 3 MRP, 5 quantity and 2 packing dates. The six-photo product-code-disjoint checkset has **zero** eligible positive critical fields; it can exercise abstention/coverage errors but cannot establish recognition accuracy. Neither is an independently human-adjudicated holdout. CI validates their contracts; it does not run or claim a missing real-photo benchmark.

## Local verification performed in this release pass

- Source and built Paddle assets: 17/17 SHA-256 checks passed in each location.
- Original image identity: 8/8 development and 6/6 abstention-checkset hashes passed.
- Automated regression suite and Vite production build passed; final release test counts belong in the release handoff because additional parallel fixes can add tests.
- Build warnings: large optional OCR chunks and OpenCV's browser-externalized Node modules remain. A successful build alone does not settle browser/device compatibility.

Live cloud cross-account access, real provider calls, independent legal review and blind positive-recognition validation remain separate acceptance work. Never label those as passed based on mocks, PGlite or asset hash tests.
