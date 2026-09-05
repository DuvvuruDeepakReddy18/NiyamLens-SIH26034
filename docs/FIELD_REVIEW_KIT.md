# Reserved-photo human review kit

This workflow prepares a portable, offline review interface for the 24 acquisition photos that were not used by the six-row exploratory OCR smoke. It does not inspect, decode, OCR, label, or assign package metadata to those photos. It reads the bytes only to verify a bounded image signature, compute SHA-256, and embed the unchanged bytes in a local HTML file.

The kit is a preparation aid—not a frozen pilot manifest, independently verified label set, or field-accuracy result.

## Create the current kit

Run from the NiyamLens repository. The output directory must not already exist and must stay outside the Git repository.

```powershell
node tools/prepare-field-review-kit.mjs `
  --intake 'C:\Users\duvvu\Desktop\SIH\NiyamLens-Field-Pilot-2026-09-04-02\human-review-intake.template.json' `
  --exploratory-ocr 'C:\Users\duvvu\Desktop\SIH\NiyamLens-Field-Pilot-2026-09-04-02\exploratory-ocr-raw-v1.json' `
  --photo-root 'C:\Users\duvvu\Desktop\SIH\NiyamLens-Field-Pilot-2026-09-04-02' `
  --output 'C:\Users\duvvu\Documents\ChatGPT\SIH 2026\NiyamLens_Field_Review_Kit_2026-09-05-v2' `
  --expected-count 24
```

Do not delete or overwrite an existing kit to make a new version. Use a new dated/versioned output path so the selection and human-review trail remain recoverable.

The `-v2` directory is the usable current kit. The unversioned directory was retained only to honor the create-only rule after browser QA found an embedded-script escaping defect; do not distribute or review from that earlier directory.

## What is generated

- `review.html`: one-photo-at-a-time offline reviewer UI with embedded original bytes, source SHA-256, and attribution.
- `selection-manifest.json`: the 24 selected rows, six excluded rows, source-artifact hashes, and limitations. It contains no OCR text or expected values.
- `reviewer-a.template.json` and `reviewer-b.template.json`: blank reviewer inputs with `pending` fields and null identity/attestations.
- `lead-metadata-worksheet.json`: shape, scripts, conditions, collector, camera-capture time, and prior-use fields deliberately left unresolved.
- `adjudicator.template.json`: blank third-reviewer container for disagreements only.
- `KIT-INTEGRITY.json`: source and photo hashes, with an explicit no-authenticity/no-label caveat.
- `README.md` and `DO_NOT_PUBLISH.txt`: offline procedure and handling restrictions.

The HTML declares a restrictive Content Security Policy with `connect-src 'none'`. Dynamic source metadata is displayed using `textContent`, and embedded JSON escapes script-closing characters. Reviewer entries are kept only in page memory until a JSON download; the page does not use network calls or persistent browser storage.

The UI can be exercised without opening the reserved photographs. This command builds a temporary kit from 30 generated one-pixel fixtures, completes its 24-row workflow in a headless browser, checks the downloaded reviewer record, verifies that later edits return it to draft status, and rejects any HTTP(S) request:

```powershell
node tools/qa-field-review-kit.mjs
```

## Human review sequence

For the current assignment, use the separate private handoffs for [Arif / Reviewer A](./REVIEWER_A_ARIF_HANDOFF.md) and [Tharun / Reviewer B](./REVIEWER_B_THARUN_HANDOFF.md). Their names assign roles but do not pre-fill or verify reviewer identity or attestations.

1. Give two different people separate fresh copies of the kit.
2. Keep the exploratory OCR file, catalogue answers, and the other reviewer's output unavailable to both people.
3. Each reviewer selects A or B, creates a reviewer code, checks the two self-attestations only if true, reviews all 24 photos, and exports JSON.
4. Hash and retain both exports before the reviewers exchange results.
5. Compare the three critical-field status/value pairs: MRP, net quantity, and pack/manufacture date.
6. If any status or value differs, a third person reviews the photograph without OCR and records only the disagreements, reason, and final field objects.

The tool cannot prove who used the browser, whether a reviewer was independent, or whether a label is correct. Those remain human attestations. A readable field must use a complete parser-valid value; non-readable categories use null values and are excluded rather than counted as correct negatives. “Not visible” refers to the single photograph, not absence from a complete physical package.

## Complete source metadata separately

The downloaded source establishes an acquisition time and licence/attribution record, not the original camera-capture time. A real lead must review and complete:

- collector or responsible metadata-reviewer code;
- whether the SKU/photo was previously used for development;
- package shape;
- visible scripts;
- capture conditions; and
- any source/provenance limitation.

Do not change an unknown prior-use value to `false` merely to satisfy the pilot validator. The selection excludes the supplied six-row exploratory artifact, but cannot establish all previous human/model exposure or pretrained-model exposure.

## Move from reviewer input to the frozen pilot

The reviewer exports deliberately are not freeze-ready on their own.

Use [the evidence-import runbook](./REVIEW_EVIDENCE_IMPORT.md) to validate and merge the two original exports, completed lead metadata, and any required value-blind third-person adjudication into a create-only draft.

1. Build/import the prospective pilot draft with `tools/field-pilot.mjs`, using the original collection directory as `--photo-root`.
2. Merge the two real reviewer records into each sample's `groundTruth.reviews`. Keep reviewer ID, review time, `ocrOutputsConsulted: false`, `independentPhotoReview: true`, and the three field objects.
3. Add a different third reviewer only where the first two status/value identities disagree.
4. Print and choose the exact supported browser configurations before freeze:

   ```powershell
   npm run field:browser -- --modes
   ```

5. Register the chosen exact mode object or objects in the draft manifest.
6. Validate all original hashes, truthful metadata, review chronology, development exclusions, and reviewer differences.
7. Freeze the labelled manifest before any reserved-photo OCR run.
8. Start the dedicated local preview and execute only a mode registered before freeze. Use a new create-only raw-run path:

   ```powershell
   npm run field:browser -- --run `
     --manifest 'C:\path\FROZEN.json' `
     --photo-root 'C:\Users\duvvu\Desktop\SIH\NiyamLens-Field-Pilot-2026-09-04-02' `
     --mode browser-standard `
     --base-url http://127.0.0.1:4191/ `
     --output 'C:\path\NEW-RAW-RUNS.json'
   ```

The browser runner refuses unfrozen manifests and unregistered modes. It keeps failed rows and raw OCR unchanged. A later officer-assisted transcript remains a separate result channel.

## Reporting boundary

The 24 rows can support a small, self-attested extraction pilot after truthful metadata, two independent labels, disagreement adjudication, pre-registered modes, and freeze all succeed. They still do not establish:

- representative Indian-market field accuracy;
- legal compliance/verdict accuracy;
- physical typography accuracy;
- a statistically powered result;
- independence from model pretraining; or
- governmental/legal approval.

Report exact readable denominators per field, every missing/failed run, corrections separately from raw OCR, the selection limitations, and the precise frozen manifest/mode hashes.
