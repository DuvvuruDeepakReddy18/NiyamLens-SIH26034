# Human-review evidence import runbook

This runbook turns two real reviewer exports, completed source metadata, and any required third-person adjudication into a create-only `prospective-field-pilot` draft accepted by the existing field-pilot validator. The importer reads JSON only. It does not open or OCR any reserved photo, freeze the pilot, calculate accuracy, or verify a person's identity.

## 1. Make the two reviews genuinely separate

- Reviewer A is **Arif**; Reviewer B is **Tharun**. This is task assignment only, not software-verified identity.
- Give each person a separate fresh copy of `NiyamLens_Field_Review_Kit_2026-09-05-v2` and only their own handoff file.
- Do not give either person the six-row exploratory OCR artifact, product-catalogue answers, the other's export, or a NiyamLens prediction for these 24 photos.
- Receive their original completed JSON files through a private channel. Do not edit them. Keep both originals until their hashes are recorded by the importer.
- The team has names but no confirmed email-to-reviewer mapping in this workflow. No message, upload, or publication is performed by the tooling.

Share [Reviewer A — Arif](./REVIEWER_A_ARIF_HANDOFF.md) only with Arif and [Reviewer B — Tharun](./REVIEWER_B_THARUN_HANDOFF.md) only with Tharun.

## 2. Complete lead metadata truthfully

Create an enriched but still blank working copy; this adds the explicit role/evidence fields without filling any observation or changing prior use to `false`:

```powershell
node tools/import-field-review-evidence.mjs lead-template `
  --selection 'C:\Users\duvvu\Documents\ChatGPT\SIH 2026\NiyamLens_Field_Review_Kit_2026-09-05-v2\selection-manifest.json' `
  --lead 'C:\Users\duvvu\Documents\ChatGPT\SIH 2026\NiyamLens_Field_Review_Kit_2026-09-05-v2\lead-metadata-worksheet.json' `
  --output 'C:\private\LEAD-WORKING-v1.json'
```

Never overwrite the blank original. A real coordinator must inspect provenance and each exact photograph without using OCR output, then:

- set top-level `status` to `lead-entered-complete`;
- set `completedBy` to the coordinator's non-secret code and `completedAt` to the real UTC completion time;
- retain each sample's ID, product key, path, source hash, acquisition time, rights value, and rights note exactly;
- set a real `collectorId` and add `collectorRole` as either `original-collector` or `metadata-reviewer-not-original-photographer`;
- for these licensed public-source photos, use `metadata-reviewer-not-original-photographer`; do not imply that a team member took the original photograph;
- keep `capturedAt: null` and add `captureTimeEvidence: null` when original camera time is unknown;
- research prior use for every SKU/photo. Set `previouslyUsedForDevelopment: false` only when that conclusion is genuinely supported and add a nonempty `priorUseBasis`. A `true` or unresolved value correctly blocks import;
- enter a real package `shape`, one or more visible `scripts`, and one or more observed `conditions`; and
- use `notes` for source/crop/visibility limitations.

The importer cannot establish pretrained-model exposure or verify these statements. It preserves that limitation in the draft.

## 3. Detect disagreements without disclosing A/B values

Run from the repository, using new output paths:

```powershell
node tools/import-field-review-evidence.mjs adjudication-request `
  --selection 'C:\Users\duvvu\Documents\ChatGPT\SIH 2026\NiyamLens_Field_Review_Kit_2026-09-05-v2\selection-manifest.json' `
  --review-a 'C:\private\ARIF-ORIGINAL.json' `
  --review-b 'C:\private\THARUN-ORIGINAL.json' `
  --output 'C:\private\ADJUDICATION-REQUEST-v1.json'
```

The command checks selection and photo hashes, distinct reviewer codes, all 24 rows, complete critical fields, per-row identity/timestamp binding, chronology, and the two independence/no-OCR attestations. The request lists only sample IDs, hashes, and disputed field names. It deliberately omits both reviewers' values.

If its status is `no-adjudication-required`, do not invent a third review and omit `--adjudication` during merge.

If disagreements exist, a different third person receives a fresh kit copy plus the request—but not either A/B export. They independently inspect only the listed photos, complete all three critical fields for each listed row, add a reason, and set:

- `status`: `adjudicator-entered-complete`;
- their own non-secret `reviewerId`;
- the real UTC `reviewedAt`, after both initial reviews;
- `timestampSource`: `adjudicator-device-clock-at-completion`;
- `ocrOutputsConsulted`: `false`; and
- `independentPhotoReview`: `true`.

They must not alter `comparedReviewFiles`, sample hashes, or `disputedFields`. Those bind the adjudication to the exact A/B files without exposing their answers.

## 4. Create the labelled draft

Pre-register only configurations you intend to run. The command below safely resolves the repository's exact current `browser-standard` definition; repeat `--mode` only for another configuration selected before OCR results are seen.

```powershell
node tools/import-field-review-evidence.mjs merge `
  --selection 'C:\Users\duvvu\Documents\ChatGPT\SIH 2026\NiyamLens_Field_Review_Kit_2026-09-05-v2\selection-manifest.json' `
  --review-a 'C:\private\ARIF-ORIGINAL.json' `
  --review-b 'C:\private\THARUN-ORIGINAL.json' `
  --lead 'C:\private\LEAD-COMPLETED-v1.json' `
  --owner 'team-lead-code' `
  --mode browser-standard `
  --adjudication 'C:\private\ADJUDICATION-COMPLETED-v1.json' `
  --output 'C:\private\NIYAMLENS-LABELLED-DRAFT-v1.json'
```

Omit `--adjudication` only when the request reported none. The importer refuses missing or unnecessary adjudication. It also refuses pending metadata, a reused reviewer ID, review-before-acquisition timestamps, invalid readable values, altered source hashes, `previouslyUsedForDevelopment` other than researched `false`, misleading collector roles, or unsupported OCR modes.

## 5. Validate, then freeze separately

The merge output remains a draft even when it has a mode. Validate original bytes and the live development-exclusion inventory before freeze:

```powershell
node tools/field-pilot.mjs validate `
  --manifest 'C:\private\NIYAMLENS-LABELLED-DRAFT-v1.json' `
  --photo-root 'C:\Users\duvvu\Desktop\SIH\NiyamLens-Field-Pilot-2026-09-04-02'
```

Read the reported caveat. If anything has changed or a product/hash appears in development inventory, investigate; do not simply flip metadata or remove an exclusion. Only after successful validation and human review should the lead run the existing create-only `freeze` command. The importer never does that step.

## Evidence limits

File hashes prove byte consistency, not human identity, independence, correctness, capture provenance, or prior non-exposure. This 24-photo availability sample is not a verified holdout, representative market sample, legal-verdict benchmark, typography benchmark, or statistically powered result. Report raw OCR and officer-corrected results separately after freeze.
