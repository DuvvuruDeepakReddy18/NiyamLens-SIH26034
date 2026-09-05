# NiyamLens — SIH26034 Competition Prototype

NiyamLens is a local-first inspection system for packaged-commodity declarations. It turns photographs of a real package into a reviewable evidence packet: image quality, original hashes, OCR text and word regions, structured declarations, calibrated typography, deterministic rule findings, an audit chain and a printable report.

The product is designed around the question a judge will ask: **can it survive a random packet in real time?** The Blind Challenge route disables controlled fixtures, starts a sealed timer and records every material action.

## Current readiness — RC6 released 5 September 2026

Current: [verified RC6 release and remaining limits](docs/RC6_RELEASE_2026-09-05.md), [team PDF](docs/NiyamLens_RC6_Team_Handoff_2026-09-05.pdf), and [fresh-photo/timing/review assignments](docs/VALIDATION_NEXT_ACTIONS.md). Earlier implementation/OCR reports retain their historical results. Passing engineering checks does not establish real-label accuracy or legal approval.

Version 0.4.4 / rule pack `LMPC-RC-2026.09-RC6` adds an explicit Rule 3 applicability gate, conservative food-package typography review, optional local Paddle OCR (whole panels and officer-selected crops), reviewable layout suggestions and hardened evidence/synchronization boundaries. Release commit `d13aad5` passed 603 tests in CI; the final local test-harness follow-up passed 604. The public release passed 68 hosted API checks, four-role Chrome acceptance and one synthetic offline-to-online seal/export workflow. See the release report for exact scopes, source hashes and unresolved field evidence.

Actual Chrome Paddle recognition of an untouched Amul photograph recovered `MRP:22.00`; an officer-selected crop also read `Net Content:` followed by `500ml`, without typing corrected OCR text. This is a known-photo, officer-assisted acceptance check—not a blind accuracy result. Earlier bad readings remain preserved and may require explicit conflict resolution. Strict whole-image experiments on eight provisional development photos still show poor end-to-end critical-field extraction. See [this pass's handoff](reports/recognition-2026-09-04-pass2/IMPLEMENTATION-STATUS.md) and [measured experiments](reports/recognition-2026-09-04-pass2/RESULTS.md). Do not present this as general real-label accuracy or guaranteed SIH success.

## Run

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`.

English, Hindi, Telugu and Tamil OCR assets are bundled under `public/ocr`, so the engine does not depend on a public CDN. Saved inspections and evidence remain in the browser's local IndexedDB.

The optional Paddle model uses an additional approximately 68 MB of local assets. It is lazy-loaded, not required for app startup, and runs in a separately terminable Web Worker. The Tesseract language selector does not change Paddle's fixed model. To reproduce/verify the pinned assets after installation, run `node tools/prepare-paddle-assets.mjs`; it verifies hashes and never uploads photographs. First-time offline Paddle use is not guaranteed until its assets have successfully cached.

## What is implemented

- Real camera/file intake for up to four label panels, with guided roles for identity, price/date, responsible entity/consumer care and quantity/barcode evidence.
- SHA-256 digest of every original image before preprocessing.
- Image-quality gates for sharpness, brightness, contrast and glare.
- Rotation, grayscale and contrast preprocessing without replacing the original.
- Three-pass local Tesseract OCR in English, Hindi, Telugu or Tamil combinations, plus an optional seven-pass deep scan using four overlapping detail tiles.
- Optional PP-OCRv6 small local recognition with a preview-before-append workflow. Exact raw text and engine/model/run identities stay separate from officer-selected geometric row suggestions. The same engine can scan a selected original-resolution crop.
- Unvalidated OCR reliability heuristic based on engine confidence, pass agreement, capture quality and evidence volume, with explicit retake guidance. Manual input has no OCR-confidence score.
- Explicit opt-in connected OCR through a serverless Google Vision boundary; browser OCR remains the offline/private default and failed connected requests preserve local evidence.
- OCR word boxes mapped to clickable declaration evidence regions.
- Deterministic extraction of MRP, quantity, dates, responsible entity, consumer care, origin, unit price, FSSAI licence text and barcode text, including GTIN check-digit validation.
- Native `BarcodeDetector` support with corner geometry, card-free panel flattening and manual GTIN fallback. Barcode geometry corrects perspective but does not establish absolute millimetres.
- Four-corner projective homography to flatten skewed label panels.
- Reference-card detection, two-point manual calibration and WebXR depth-capability check.
- Flat-panel and cylindrical-panel area calculators with uncertainty propagation.
- Per-panel physical glyph calibration and text-width evaluation. OCR regions are not physical glyph measurements; their cards deliberately show no millimetre estimate. Transforming a panel invalidates its calibration instead of silently reusing stale pixels.
- Versioned rules-as-code with confidence-aware abstention.
- Rule 7 / Table I area tiers and boundary uncertainty.
- Officer-assisted Rule 8 declaration placement and net-quantity clear-space ratios with uncertainty; this does not automatically identify a legal PDP.
- Rule 26 small-package, tobacco, pan masala, fast-food, formulation and medical-device profiles.
- Blind Challenge mode with controlled-packet lockout and elapsed timer.
- Hash-linked local audit events and internal consistency verification, not independent proof of image authenticity.
- Local officer/supervisor separation, assignments and reason-required overrides.
- PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM encrypted evidence export/import, including large image-bearing records and legacy-v1 import.
- IndexedDB evidence register, dashboard, history, JSON export, editable DOCX and print/PDF packet. Word generation supplies a visible save link; visual/download acceptance remains pending.
- Validation Lab for bounded JSON/CSV datasets with labelled denominators, per-field exact matches, false-clear and false-violation rates, abstention, and explicit unavailable metrics when ground truth is missing. This runs on supplied transcripts, not live OCR.
- A visible approval register that never presents a prototype interpretation as department-approved law.
- Installable PWA shell.

## Judge demo path

1. Open **Blind challenge** and ask the judge to choose any packet.
2. Start the challenge, capture all declaration panels and show the original hashes.
3. Run OCR; click an extracted declaration to highlight the matched image region.
4. Show image-quality warnings, package classification and any exemption logic.
5. Calculate the panel area, calibrate the reference and inspect the uncertainty interval.
6. Finalize the run, open the evidence packet and show **Audit chain verified**.
7. Switch to Supervisor in **Officer operations**, record a reasoned disposition and show that the automated status remains preserved.
8. Open **Validation lab** and explain that field claims require an imported labelled dataset; synthetic fixtures are never presented as accuracy evidence.

See [docs/JUDGE_DEMO.md](docs/JUDGE_DEMO.md) for the timed script.

## Verification

```powershell
npm test
npm run build
npm run qa:ui
npm run qa:ocr
npm run qa:ocr:connected
npm run dataset:real:fetch
npm run qa:ocr:real
npm run qa:ocr:real:deep
npm run qa:ocr:google-baseline
npm run qa:pwa
```

Timestamped local test snapshot: 524 automated regression tests passed with 0 failures on 5 September 2026 before later branch changes. Rerun the commands above and retain their output for any release claim. [Clean-checkout instructions](docs/RELEASE_REPRODUCIBILITY.md) explain the independent CI, pinned-asset and exact-photo gates. Actual Chrome verification and exact frozen-corpus denominators are documented in the linked reports; read their limitations before making a claim. Earlier fixture/token-recovery reports remain historical artifacts, not current end-to-end field accuracy. The optional browser engine has not been tested on an independent held-out corpus or every target phone. Cloud identity, storage and provider behavior must be verified against the exact deployed revision before presentation.

The UI distinguishes engine scores from unvalidated reliability heuristics. Neither is an accuracy probability. The Validation Lab scores supplied transcripts; it does not automatically execute browser OCR. See the [Open Food Facts pilot protocol](datasets/openfoodfacts-india/README.md), [field-dataset schema](datasets/legal-metrology-field/README.md) and raw reports in `reports/`.

## Deployment

The repository includes `vercel.json`; Vercel can build it as a static Vite application with `npm run build` and serve `dist`. Camera capture and service workers require HTTPS outside localhost, which Vercel supplies.

```powershell
npx vercel@latest --prod
```

Deployment alone does not create or configure a central database. Supabase workspace/Auth/Storage adapters and migrations are implemented, but the current local acceptance environment is not configured for cloud access. Local history remains in each browser; live cross-account permissions, uploads and synchronization need a separately configured Supabase deployment and acceptance check. Local audit verification is not independently anchored authenticity.

Connected OCR is intentionally disabled unless `GOOGLE_CLOUD_VISION_API_KEY` is configured as a server-side Vercel environment variable. Never use a `VITE_` prefix for this secret. The static application and local/deep OCR work without it. Use `vercel dev` rather than the Vite dev server when manually exercising the serverless route locally.

## Core architecture

```text
Camera / files
  -> original digest + quality gate
  -> reversible OCR preprocessing
  -> local/deep OCR + optional explicit connected OCR + word geometry
  -> structured declaration extraction
  -> inspector context + per-panel geometry + scale
  -> versioned deterministic rules + uncertainty
  -> PASS / FLAG / REVIEW / EXEMPT
  -> hash-linked audit chain
  -> IndexedDB register / encrypted transfer / printable packet
```

Important modules:

- `src/lib/evidence.mjs` — intake, integrity and preprocessing.
- `src/lib/vision.mjs` — quality analysis, OCR geometry, reference and depth capability.
- `src/lib/extraction.mjs` — deterministic OCR-to-declaration parsing.
- `src/lib/rules.mjs` — versioned compliance and uncertainty engine.
- `src/lib/ruleMatrix.mjs` — review matrix, approval gates and legal boundary fixtures.
- `src/lib/audit.mjs` — hash-linked local audit chain.
- `src/lib/secureBundle.mjs` — encrypted offline evidence transfer.
- `src/lib/benchmark.mjs` — labelled-dataset metrics.
- `src/lib/storage.mjs` — local evidence register.
- `src/App.jsx` — inspection, challenge, validation, operations and reports.

## Important boundary

This is a fully functional competition prototype, not an enforcement-grade statutory system and not legal advice. Its local hash chain detects mutation but is not an externally anchored or WORM audit ledger. Before official use, the sponsoring department must approve the amendment-complete applicability matrix, measurement method, field dataset, identity system, retention policy and security architecture. The system surfaces those gates instead of fabricating approval.

Further detail:

- [Narrated continuous prototype walkthrough](docs/NiyamLens_Live_Prototype_Walkthrough.mp4)
- [Editable six-slide official SIH-template deck](docs/NiyamLens_SIH26034_Official_SIH_Template.pptx)
- [Ready-to-submit six-page SIH PDF](docs/NiyamLens_SIH26034_Ready_to_Submit.pdf)
- [Downloadable team feature and verification PDF](docs/NiyamLens_Team_Feature_Verification_Guide.pdf)
- [Team feature and verification guide](docs/TEAM_FEATURE_VERIFICATION_GUIDE.md)
- [Release verification record](docs/RELEASE_VERIFICATION_2026-09-03.md)
- [Architecture and trust model](docs/ARCHITECTURE.md)
- [Hybrid OCR architecture decision](docs/ADR-001-HYBRID-OCR.md)
- [Legal review register](docs/LEGAL_REVIEW.md)
- [Independent domain and legal review packet](docs/DOMAIN_REVIEW_PACKET.md)
- [Field validation protocol](docs/FIELD_VALIDATION_PROTOCOL.md)
- [Judge demonstration runbook](docs/JUDGE_DEMO.md)
- [Team competition rehearsal and unseen-package protocol](docs/TEAM_WINNING_REHEARSAL.md)
- [Deployment readiness](docs/DEPLOYMENT_READINESS_2026-09-03.md)
