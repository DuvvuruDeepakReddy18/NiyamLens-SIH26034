# NiyamLens 0.4.2 — release validation

4 September 2026. Release branch: `codex/managed-cloud-release`, repository: `DuvvuruDeepakReddy18/NiyamLens-SIH26034` (private). This is a tested prototype release, not a claim of statutory approval, general OCR reliability or an SIH win.

## Verified locally

| Gate | Result | Boundary |
| --- | --- | --- |
| Full automated regression suite | 318 passed; zero failed/skipped | Node 26.1.0 locally; GitHub CI pins Node 22 |
| Vite production build | Passed | Large optional OCR chunks and OpenCV browser-externalization warnings remain |
| Pinned Paddle assets, source and build | 17/17 SHA-256 checks at each location; 68,186,300 bytes each | Asset integrity, not recognition quality |
| Exact frozen photographs | 8 development + 6 checkset hashes match | Checkset has zero positive critical-field references; neither set is an independently labelled holdout |
| Dependency audit | No known vulnerabilities reported | Advisory lookup, not a penetration-test guarantee |
| Production audit gate | Passed; five fail-closed audit-gate regressions passed separately | Unavailable registry responses cannot count as success |
| Focused security/backend suite | 53 passed, included in the full suite | Provider calls mocked; embedded SQL policies separately stressed |
| Embedded SQL stress | 100 duplicate seals stored one case; 30 stale-version reviews yielded one success/29 conflicts; 100 quota attempts allowed 30; cross-org visibility zero | Not hosted concurrent Supabase sessions |
| OCR/parser/report subset | 81 passed, included in the full suite | Includes 10,000 malformed inputs; does not execute all images through browser OCR |
| Native DOCX generator | Structural/content checks passed | Independent Word visual acceptance still required |

The release adds fail-closed source/build asset gates to CI, seven asset/corpus regressions, explicit non-holdout checkset support, byte-preserving Git attributes and an ignore rule for the unsuccessful experimental English model. The production Paddle models, runtime and available notices are included. Ignored photographs, Python environments, secrets and build output are not included in the backup.

## Recognition evidence — do not combine denominators

The independent raw-output rescore verified 64 unchanged historical records. On ten provisional readable critical references in eight development photos, historical Tesseract modes and production merge scored **0/10**, while RapidOCR multilingual and each of four English strategies scored **1/10**. These are poor end-to-end results. Details and source hashes: [OCR validation](ocr-validation.md).

Separate actual Chrome testing in the preceding implementation pass ran the optional Paddle model on the unchanged Amul photo and an officer-selected crop. The crop read `Net Content:`, `500ml`, `MRP:22.00` and the erroneous `linclusive all taxes`. No corrected critical OCR text was typed. Append, draft restore, conservative manual-review sealing and local audit verification were observed. That one known-photo success is not a full-corpus or blind accuracy result.

This release pass reopened that saved case in Chrome and generated its actual image-bearing native Word report; the UI reported **1492 KB** and offered a save link. Two save-link attempts did not yield a browser download event or a verified file at the expected Downloads path. Therefore **download completion remains unverified**, not passed. The already sealed historical case retains its old `500ml` context title; the title-parser fix prevents this in new extraction and does not rewrite sealed evidence.

## Push and live gates

Use the exact pushed commit's GitHub Actions run to verify clean-checkout Node 22 results. Local success is not a substitute. This report is prepared with the release changes; final commit/check URLs are provided in the task handoff.

The previous branch head `1a53740` had a successful Vercel GitHub status. During this pass the connected Vercel team was accessible, but its project listing returned empty and the saved project ID returned 404. No replacement project was created and no production deployment was forced. A new GitHub-triggered deployment, if produced, must be checked independently.

The local Chrome build states **Cloud not configured**. Live login, signed Storage transfer, cross-account RLS, synchronization and connected Google Vision remain separate acceptance gates. No synthetic user, quota stress or cloud migration was applied to production in this pass.

## Remaining acceptance work

- Full-corpus actual browser Paddle runs and a representative, independently human-labelled unseen positive dataset.
- Target-phone cold-load, memory and offline/cache tests for the optional large OCR engine.
- Verified browser downloads and Word visual layout on a real image-bearing case.
- Hosted Supabase Auth/Storage and cross-account integration against the exact release deployment.
- Qualified review of rule applicability and physical measurement method before legal-use claims.

Reproduction instructions: [clean checkout](../../docs/RELEASE_REPRODUCIBILITY.md), [security validation](SECURITY-VALIDATION.md), [OCR validation](ocr-validation.md).
