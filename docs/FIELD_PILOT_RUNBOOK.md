# Prospective real-photo pilot: collection → freeze → raw OCR → officer review

**Implemented tooling; corpus not collected.** The committed template has zero photos and zero ground-truth labels. Existing development photographs, the eight-photo critical baseline, the six-photo abstention checkset, and synthetic test images must not be presented as unseen-label validation.

This lane measures exact MRP, net-quantity and packed/manufactured-date extraction on 20–30 previously unused SKUs, then measures the separate burden/outcome of officer review. It is not a legal-verdict or typography benchmark. The larger [field-validation protocol](FIELD_VALIDATION_PROTOCOL.md) remains the standard for a representative study.

## 1. Collect before viewing OCR

Keep all real photos, labeler notes, exported evidence and output reports under the gitignored `.niyamlens-private/field-pilot/` directory. Do not put this folder under `public/`, attach private evidence to an issue, or commit it to GitHub. Use coded reviewer/operator IDs rather than emails/names. Crop out unrelated personal information before defining the original pilot source; after import, preserve those exact source bytes unchanged.

Collect 20–30 **different products/SKUs**. Use exact barcode digits as `productKey` whenever present; otherwise use a stable lowercase SKU identifier and manually check prior use. A new camera angle, package from another shop, or renamed file is not a new SKU. Include flat cartons, pouches, curved/glossy bottles, glare, small print, blur/skew and regional-language labels. Record scripts/conditions even when OCR will fail. Do not replace difficult examples after seeing predictions.

Choose one photograph per SKU for this first photo-level pilot. Other package panels may be captured privately for a later separately versioned workflow study, but they do not provide missing-photo ground truth for this scorer. A field outside this specific photograph is `not_visible`, not a legal violation.

Photos must be static JPEG/PNG/WebP, at least 300×300 pixels, at most 15 MiB and 40 megapixels. The CLI checks file type, decodability, dimensions and exact SHA256. It does not prove that an image is a genuine camera photograph or that capture rights are valid; a responsible collector must attest those facts.

## 2. Initialize and import source photos

Run commands from the repository root, after creating `.niyamlens-private/field-pilot/` and its `photos/` subdirectory in Explorer. All outputs are **create-only**; keep each version instead of overwriting it.

```powershell
node tools/field-pilot.mjs init --dataset-id team-field-pilot-v1 --owner lead-01 --output .niyamlens-private/field-pilot/draft.json
node tools/field-pilot.mjs import --manifest .niyamlens-private/field-pilot/draft.json --input .niyamlens-private/field-pilot/intake.json --output .niyamlens-private/field-pilot/imported.json
```

Copy the structure from `datasets/field-pilot-intake.example.json` into your private `intake.json`. Replace every placeholder and the null UTC capture timestamp, then add one record per photo. `capturedAt` looks like `2026-09-05T09:30:00Z`; enter the actual time in UTC, not this example. Do not supply `sha256`, OCR text or ground truth at import: the CLI reads/hashes original image files, and labels are collected separately. Additional imports create new draft files until there are 20–30 distinct SKUs.

The exclusion check rejects known prior product codes and exact image hashes from both critical manifests, the full original development manifest, all locally present development/candidate photographs, and redacted `datasets/field-smoke-*.json` markers recording newly used exploratory SKUs/hashes. A renamed development photo is still excluded. It cannot detect an unrecorded SKU alias or unseen prior human/model exposure. Add any other historical corpus with repeatable `--exclude path/to/manifest.json` on import, validate, freeze, record and score. Extra manifests may use `samples[].productKey/productCode/sha256` or `products[].code`.

### Photos in a separate Desktop folder

Original photos can stay outside the repository in the user-approved `C:/Users/duvvu/Desktop/SIH/<new-folder>/`. Use `--photo-root` independently of the repository/exclusion root. Then intake `sourcePath` is relative to that photo folder (for example `FIELD-001.jpg`, not its absolute path). Repeat the same `--photo-root` for import, validate, freeze, record and score. Symlinks/relative paths cannot resolve a source outside this chosen folder. Do **not** set `--root` to the photo folder: `--root` identifies the repository containing the historical exclusion manifests.

```powershell
node tools/field-pilot.mjs import --manifest .niyamlens-private/field-pilot/draft.json --input .niyamlens-private/field-pilot/intake.json --photo-root "C:/Users/duvvu/Desktop/SIH/<new-folder>" --output .niyamlens-private/field-pilot/imported.json
node tools/field-pilot.mjs validate --manifest .niyamlens-private/field-pilot/imported.json --photo-root "C:/Users/duvvu/Desktop/SIH/<new-folder>"
```

Replace `<new-folder>` with the actual authorized source folder. Downloaded/licensed public photographs must use `captureRights: "licensed-for-evaluation"` and an actual source/license/attribution record in `rightsNote`. If the camera capture date is unknown, set `capturedAt: null` and supply `acquiredAt` with the actual UTC download/acquisition timestamp. The latter is explicitly **not** a camera capture date. Human review must follow capture/acquisition. Availability does not establish unseen status or independent ground truth; never guess those facts. Photo sampling/permissions must be documented before collecting labels.

## 3. Independent ground truth and pre-registered modes

Give reviewers the source photos, not OCR outputs or catalogue quantities. Each reviewer labels independently using `datasets/field-pilot-review.example.json`. The `pending` defaults are intentionally invalid: an unreviewed template cannot be frozen.

For each sample, set `groundTruth` to `{ "reviews": [REVIEW_A, REVIEW_B], "adjudication": null }` in a new private `labelled.json`. Keep both initial readings. Reviewer IDs must be different. Both attest `ocrOutputsConsulted: false` and `independentPhotoReview: true`, and record the actual UTC review time after capture and before freeze.

Each of the three fields must use exactly one of these labels:

| Status | `value` | `metricEligible` | Meaning |
| --- | --- | --- | --- |
| `readable` | Exact printed value as a string | `true` | The complete value and requested declaration identity are supported in this photograph. |
| `not_visible` | `null` | `false` | Declaration value is not in this photograph; not proof of package-level absence. |
| `illegible` | `null` | `false` | Relevant text is present but the complete value cannot be read. |
| `ambiguous_field` | `null` | `false` | Digits are visible but their meaning as this declaration is uncertain. |

MRP labels contain the amount, e.g. `22.00`; quantity contains value and unit, e.g. `500 ml`; dates preserve printed separators and year length, e.g. `19/10/25`. These are format examples only, not labels for any new photo. Unit-sale/retail price, nutritional per-100-g numbers, an expiry date, a barcode and catalogue values are not interchangeable with the requested declarations.

If the first two reviewers disagree, a **third different human** supplies `groundTruth.adjudication` with the same reviewer object structure plus a nonempty `reason`. Preserve both original reviews, even after adjudication. A trained Legal Metrology reviewer is appropriate when the disagreement concerns declaration meaning. The CLI validates structures and distinct codes, not real-world identity, independence or credentials.

Before freeze, populate the manifest's `modes` array. Each mode has `{ "id", "engine", "version", "configuration", "manualRoi" }`. Record exact OCR/model version (prefer artifact digest), preprocessing, language, whether the whole photo or a manual region is used, and fixed selection policy. Use a separate mode for whole-image OCR versus officer-selected crops. Do not pick the best repeated attempt after seeing ground truth. Save full raw attempts independently, including errors. Maximum eight pre-registered modes; no new mode IDs can be introduced after freeze.

```powershell
node tools/field-pilot.mjs validate --manifest .niyamlens-private/field-pilot/labelled.json
node tools/field-pilot.mjs freeze --manifest .niyamlens-private/field-pilot/labelled.json --by lead-01 --output .niyamlens-private/field-pilot/frozen.json
```

Freeze requires 20–30 unique SKUs, complete independent annotations/adjudications and registered modes. It seals the original photo identities, sampling plan, annotations, modes and development-exclusion inventory. The seal hashes sorted-key canonical JSON; pretty-printing or CRLF/LF differences do not change its meaning. Exclusion JSON files use `canonical-json-sha256` (semantic JSON content); photographs use `original-image-bytes-sha256` (exact bytes). Any changed image, label, configuration or semantic inventory is rejected. Hashes are integrity checks, **not signatures or independent attestation**. Do not edit/reseal a frozen version to improve its score.

## 4. Run real OCR and record separate officer review

Now run each registered mode on every frozen photo, including difficult cases, using the recorded engine/configuration. The CLI is an evaluator, not an OCR engine. In NiyamLens preserve/export the original pass from OCR history; do not copy the parsed field values, a merged best-of-many transcript, manually repaired text or the working transcript into `rawText`. Retain the source evidence export privately so teammates can audit the supplied pass. Source/text hashes alone cannot prove OCR ran, so report this limitation.

Copy `datasets/field-pilot-observation.example.json` into a private observation file. Enter the exact sample ID, source SHA from `frozen.json`, registered mode ID, actual start/finish timestamps and unchanged single-pass raw text. On engine failure use `rawText: ""` and a nonempty `error`; failure rows count as attempted failures. Missing rows stay missing and suppress complete-corpus accuracy. Never turn a failed pass into a successful row by typing a replacement.

If an officer reviewed it, add a separate `review` object:

```json
{
  "officerId": "officer-01",
  "reviewedAt": "ACTUAL UTC TIME AFTER OCR",
  "reviewSeconds": 0,
  "requiredReview": true,
  "photoCompared": true,
  "reason": "Actual reason for confirmation/correction",
  "workingText": "Exact officer-confirmed or corrected working transcript"
}
```

Enter measured seconds, not the example zero. A reviewer who did not need edits still needs an observation to count as reviewed; use unchanged `workingText`. Prefer officers who did not author reference labels, and keep reference labels hidden during their review. `review: null` means unobserved, not no review needed.

```powershell
node tools/field-pilot.mjs record --manifest .niyamlens-private/field-pilot/frozen.json --input .niyamlens-private/field-pilot/observation-001.json --output .niyamlens-private/field-pilot/runs-001.json
node tools/field-pilot.mjs record --manifest .niyamlens-private/field-pilot/frozen.json --input .niyamlens-private/field-pilot/observation-002.json --runs .niyamlens-private/field-pilot/runs-001.json --output .niyamlens-private/field-pilot/runs-002.json
node tools/field-pilot.mjs score --manifest .niyamlens-private/field-pilot/frozen.json --input .niyamlens-private/field-pilot/runs-002.json --output .niyamlens-private/field-pilot/score-partial.json
```

`record` appends exactly one new sample/mode and computes the raw-text digest without changing text. Duplicate sample/mode rows are rejected. Store further runs as new numbered files. Both raw and assisted transcript outcomes reuse the existing critical-field extractor, so numeric-presence hacks, semantic substitution and contradictory values do not manufacture exact matches.

## 5. Read and act on the results

- **Raw OCR:** exact matches / all readable reference fields, separately for each field and mode. Full-corpus accuracy is `null` when a readable sample lacks a run; attempted-only accuracy is explicitly partial. An entirely unrun registered mode remains visible. Zero readable references means not measurable, never 100%.
- **Officer working transcript:** a separate assisted outcome. Never present its improved numbers as raw OCR accuracy. Missing reviews remain missing.
- **Review burden:** attempted/reviewed/missing observations, observed review-needed rate, changed transcripts, changed extraction values/conflicts/validity by critical field, total/median measured review time. Review timing and necessity are operator-supplied observations, not browser telemetry.
- **Capture coverage and latency:** condition coverage and median start-to-finish OCR time are shown; failure rows remain in timing and coverage. Do not generalize from a handful of regional-script or glare examples.

Use errors to prioritize fixes, but once these results influence tuning, this pilot becomes development data. Collect a new, disjoint version before claiming unseen performance again. No release threshold or winning probability is invented here. The team still needs to supply the real photos, independent labels, actual OCR runs and officer observations; no such field result is committed with these tools.

## Tool regression checks

```powershell
node --test tests/field-pilot.test.mjs tests/critical-field-benchmark.test.mjs
```

These tests use explicit synthetic fixtures, including generated image blocks only for file/decode/hash mechanics. They test provenance separation, tampering, label disagreement, leakage, duplicate denominators, missing attempts/reviews and create-only files—not real-label recognition performance.
