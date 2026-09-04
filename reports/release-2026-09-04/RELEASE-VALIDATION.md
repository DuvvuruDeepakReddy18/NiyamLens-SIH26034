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

Release implementation commit **`b5b0b86e9a759a95e0a0a144608ba0badc856886`** was pushed successfully and verified against the remote branch head. [Commit](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/commit/b5b0b86e9a759a95e0a0a144608ba0badc856886).

The exact commit's [GitHub Actions run 33869453524](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33869453524) completed successfully at 11:46:22 UTC. The clean Ubuntu/Node 22 checkout installed from the lockfile, passed **318/318 application tests** and **5/5 audit-gate tests**, built successfully, verified source and built Paddle hashes and passed the fail-closed production dependency audit. This is remote CI evidence, not merely a local run.

The connected Vercel tool listed the team but returned no projects and 404 for the saved project ID. GitHub's deployment integration nevertheless created a successful **Preview** deployment for the exact implementation commit (deployment record `6263587832`, completed 11:46:09 UTC). [Preview](https://niyamlens-sih26034-opet1rruw-duvvurudeepakreddy18s-projects.vercel.app). No replacement project was created, no main-branch merge was made and no production promotion was forced.

Chrome opened the deployed RC5 preview successfully. A real-photo upload completed with the original SHA-256 `9d2187d0603d8781814e24320b452d596dc826a50ba29f0a7643f6d43b0c619b`, and the UI confirmed a locally saved draft. The browser upload automation returned very late; its timing is not an application upload-performance measurement.

The preview also completed actual whole-image Paddle inference using its deployed assets. The original 56-line transcript was read from the visible preview before explicit append and is retained in [chrome-preview-paddle-raw.json](chrome-preview-paddle-raw.json). The MRP was `22.00`, but `Net Content:` and `500mL` were separated by an unrelated line, and quantity conflict remained visible. The UI showed three declaration signals and no invented inspection-wide confidence. A reload offered **Restore draft**; restoration displayed the retained raw transcript and the same quantity conflict. No OCR text, physical-verification assertion or layout suggestion was manually corrected. This is a one-known-photo workflow test, not a general accuracy claim.

The restored preview inspection was sealed as **`NLM-20260904-a6ccb79d-6299-46aa-89ff-79efff8a23fb`**, titled `Amul`. Its report remained **MANUAL REVIEW**, preserved original and working transcripts separately, and displayed **Local audit chain verified — 5 recorded events**. This was a local IndexedDB test record on the preview origin, not a cloud case or a legal determination.

Unauthenticated external HTTP checks of `/api/health`, `/api/cases` and `/api/evidence` received non-JSON HTTP 302 responses at the preview access layer. They did not exercise authenticated application authorization and are not counted as passing backend integration.

Both the local build **and this deployed preview** state **Cloud not configured**. Live login, signed Storage transfer, cross-account RLS, synchronization and connected Google Vision remain unverified and are not live on this preview. No synthetic user, quota stress or cloud migration was applied to production in this pass.

## Remaining acceptance work

- Full-corpus actual browser Paddle runs and a representative, independently human-labelled unseen positive dataset.
- Target-phone cold-load, memory and offline/cache tests for the optional large OCR engine.
- Verified browser downloads and Word visual layout on a real image-bearing case.
- Hosted Supabase Auth/Storage and cross-account integration against the exact release deployment.
- Qualified review of rule applicability and physical measurement method before legal-use claims.

Reproduction instructions: [clean checkout](../../docs/RELEASE_REPRODUCIBILITY.md), [security validation](SECURITY-VALIDATION.md), [OCR validation](ocr-validation.md).
