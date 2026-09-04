# NiyamLens 0.4.4 — implementation and observed validation

4 September 2026. This is an implementation/test checkpoint, not an SIH-winning guarantee, regulatory certification, finished field pilot or production sign-off.

## Implemented

- **Verify cloud copy**: explicitly fetches fresh current-origin server metadata and every original/analysis image, validates receipt shape and image hashes, and refuses cached fallback. Request-specific cancellation leaves synchronization and local evidence intact. A transient check banner is separate from the sealed receipt.
- Team/organization permission and offline-recovery regressions, plus an explicitly enabled, GET-only hosted permission probe. Real test identities are not fabricated.
- A 20–30-product field-pilot workflow with historical SKU/hash exclusions, independent reference/adjudication records, a frozen manifest, pre-registered modes, unedited raw outputs, separate correction metrics and explicit missing denominators.
- An isolated backup importer/restoration verifier using the actual migrations and PostgreSQL audit computation. It verifies rows, relationships and both original/analysis bytes, with complete transaction rollback. It cannot reset the live service.
- An attributed, bounded public-photo downloader and six-photo local OCR smoke tool. Private inputs/outputs are excluded from Git and Vercel uploads.

Operator instructions: [pilot readiness](../../docs/PILOT_READINESS.md), [team acceptance](../../docs/TEAM_PILOT_ACCEPTANCE.md), [field pilot](../../docs/FIELD_PILOT_RUNBOOK.md), [OCR smoke](../../docs/FIELD_OCR_SMOKE.md), [backup restoration](../../docs/BACKUP_RESTORE.md).

## Public-photo acquisition and actual OCR

The owner authorized downloading public photos into a separate Desktop/SIH folder. Successful collection:

`C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02/`

- 30 distinct-SKU source photographs, 36,070,949 image bytes, unchanged by this downloader. SHA-256 and full JPEG decoding were checked during acquisition; a separate post-run disk check matched all 30 file lengths and hashes.
- Successful manifest SHA-256: `262dd6a85e4acd678ec7faaf1a9e2fbf0330d5751ac3315eb18377bbbd415a08`.
- One catalogue request and 45 image attempts: 30 saved, 14 source/mirror 404s and one dimension/format rejection. The complete attempt/skip log remains in the manifest. No existing OCR answer files were fetched.
- A preceding zero-image attempt at the non-suffixed folder returned HTTP 503. Its failure log remains; nothing was overwritten or deleted.
- Open Food Facts contributors supply the photos. Per-image uploader/source/product links and CC BY-SA 3.0 image/ODbL database attribution are retained. See [the official license guide](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/).

Selection was recorded **before OCR**: first six in acquisition order for exploratory development; remaining 24 reserved, unrun candidates for independent human labelling. Those six SKU/hash pairs are now automatically excluded from later pilots by `datasets/field-smoke-2026-09-04.json`. The 24 are not a validated holdout: human metadata review, legal-scope/sampling decisions and independent reference annotations are still absent. Country tags and upload timestamps do not prove Indian-market applicability or camera capture time. Model pretraining exposure is unknown.

Actual run: installed Node Tesseract.js/core 7.0.0, local English LSTM model, AUTO segmentation, unchanged full-original bytes, no crops/preprocessing or manual text repair, one pass per selected photo. This is **not the complete browser Paddle/preprocessing pipeline**.

| Sample | Raw characters | Elapsed seconds | Critical-field output (not ground truth) |
| --- | ---: | ---: | --- |
| PUBLIC-001 | 489 | 1.03 | No MRP, quantity or packing-date suggestion |
| PUBLIC-002 | 611 | 1.33 | Invalid quantity suggestion; no MRP/packing-date suggestion |
| PUBLIC-003 | 1,336 | 1.74 | No critical-field suggestion |
| PUBLIC-004 | 230 | 1.24 | Invalid quantity suggestion; no MRP/packing-date suggestion |
| PUBLIC-005 | 811 | 1.76 | No critical-field suggestion |
| PUBLIC-006 | 787 | 5.57 | Format-valid MRP suggestion; no quantity/packing-date suggestion |

All six recognition processes completed, but **process completion is not recognition accuracy**. The raw outputs expose missed/invalid fields. No correctness percentage was calculated; the MRP suggestion is not independently verified. Some source views omit relevant declarations, so missing extraction is not automatically a recognition error or a package violation. Latency includes validation and fresh worker initialization.

Raw output is preserved in the Desktop folder as `exploratory-ocr-raw-v1.json`, SHA-256 `82bd8f0c1cd6422cc030b5d43a341d13be2a60e9ddf09723c217d74a4f0aad94`. It was not committed or uploaded to hosting. `human-review-intake.template.json` deliberately has unfilled metadata/labels; do not import it as completed ground truth or show raw outputs to the independent reference annotators.

## Automated/local checks

- Final full application suite passed **475/475**, with zero skipped/cancelled tests. A sandbox-only attempt could not spawn Node workers; the allowed rerun executed the tests successfully. An earlier run passed 472/472 before the three final child-lifecycle regression tests were added.
- Separate audit-gate tests passed 5/5 after an allowed retry for a sandbox worker-spawn denial.
- Production dependency audit returned a complete report with zero findings on this run. This is a point-in-time package audit, not a security guarantee.
- Local 0.4.4 build passed. It explicitly reports local-only configuration, not a configured managed/cloud build. Existing large optional OCR chunks/OpenCV externalization warnings remain.
- Source and built OCR asset gates each passed 17/17, 68,186,300 bytes, zero network requests. Asset integrity is not OCR accuracy.
- Chrome at `http://127.0.0.1:5181/`: controlled fixture could be finalized locally, opened from history, rendered, and closed without the cloud-check badge. This checks local regression only; it is not a real-photo or cloud acceptance result.

## GitHub and managed staging

Application/test commit `7b4e00e30f837bbd59075e732cdb96bd00b6f306` was pushed to `codex/managed-cloud-release`. [GitHub verification run 33890421240](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33890421240) completed successfully: application tests, audit-gate tests, build, source/build OCR asset verification and production dependency audit.

Managed stage: <https://niyamlens-sih26034-bqda9qfmx-duvvurudeepakreddy18s-projects.vercel.app/>. Deployment `dpl_87dvmg6us3ZqfYj4mohJMrheJDpw` is READY, version 0.4.4 / RC5 / service-worker cache v12. The remote build explicitly passed the **production managed mode** configuration gate. It used the existing configured project; no environment secret values were inspected or copied.

Read-only deployed checks on the new origin:

| Route | Observed result without an application session |
| --- | --- |
| `/api/health` | 200, `ready: true` |
| `/api/cases` | 401, sign-in required |
| `/api/evidence` | 401, sign-in required |
| `/api/assignments` | 401, sign-in required |

All four responses included `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Vercel's authorized deployment transport was used without a NiyamLens session; these checks do not establish cross-role authorization or private Storage retrieval. Chrome rendered the new secure-workspace sign-in screen. Owner sign-in/fresh-cloud acceptance is pending.

The new exact HTTPS origin was added to the existing Supabase redirect allowlist and read back; there are now two exact stage URLs, no new wildcard. The existing default Site URL and older allowed origin were preserved. No reset email was sent. This narrowly permits explicit new-stage recovery redirects; final public-domain Auth configuration remains a separate gate.

Deployment used `--prod --skip-domain` to obtain managed configuration without promoting the public site. The public URL <https://niyamlens-sih26034.vercel.app/> was independently inspected afterward and still points to `dpl_HuQQppi67JvjrsfQ7xjmtMqNvnFU`, not this release. Generated Vercel team aliases are not a public-domain acceptance result.

## Real gates not yet closed

1. Sign-in and fresh-cloud retrieval on the exact new managed staging origin.
2. Approved distinct officer/supervisor/other-organization identities and cases, hosted permission matrix, real concurrent review/assignment and browser offline/retry checks.
3. Two independent humans' reference labels for the 24 remaining candidates (plus sampling/coverage review); then frozen full-browser pilot results.
4. Consistent real database/object export, protected off-site copy and service-level restore in a separately approved disposable project. In-memory tests do not restore Supabase Auth or Storage.
5. Native Word save/read-back acceptance, final public-domain Auth configuration and deliberate public promotion only after acceptance.

No teammate identities, invitations, role changes, live database changes, recovery emails, or live backup restore were invented/performed to bypass those gates. The existing public alias is not to be promoted automatically.
