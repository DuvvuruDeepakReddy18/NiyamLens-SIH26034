# NiyamLens — SIH26034 Competition Prototype

NiyamLens is a local-first inspection system for packaged-commodity declarations. It turns photographs of a real package into a reviewable evidence packet: image quality, original hashes, OCR text and word regions, structured declarations, calibrated typography, deterministic rule findings, an audit chain and a printable report.

The product is designed around the question a judge will ask: **can it survive a random packet in real time?** The Blind Challenge route disables controlled fixtures, starts a sealed timer and records every material action.

## Run

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`.

English, Hindi, Telugu and Tamil OCR assets are bundled under `public/ocr`, so the engine does not depend on a public CDN. Saved inspections and evidence remain in the browser's local IndexedDB.

## What is implemented

- Real camera/file intake for up to four label panels, with guided roles for identity, price/date, responsible entity/consumer care and quantity/barcode evidence.
- SHA-256 digest of every original image before preprocessing.
- Image-quality gates for sharpness, brightness, contrast and glare.
- Rotation, grayscale and contrast preprocessing without replacing the original.
- Three-pass local Tesseract OCR in English, Hindi, Telugu or Tamil combinations, plus an optional seven-pass deep scan using four overlapping detail tiles.
- Calibrated OCR reliability based on engine confidence, pass agreement, capture quality and evidence volume, with explicit retake guidance.
- Explicit opt-in connected OCR through a serverless Google Vision boundary; browser OCR remains the offline/private default and failed connected requests preserve local evidence.
- OCR word boxes mapped to clickable declaration evidence regions.
- Deterministic extraction of MRP, quantity, dates, responsible entity, consumer care, origin, unit price, FSSAI licence text and barcode text, including GTIN check-digit validation.
- Native `BarcodeDetector` support with corner geometry, card-free panel flattening and manual GTIN fallback. Barcode geometry corrects perspective but does not establish absolute millimetres.
- Four-corner projective homography to flatten skewed label panels.
- Reference-card detection, two-point manual calibration and WebXR depth-capability check.
- Flat-panel and cylindrical-panel area calculators with uncertainty propagation.
- Per-panel calibration, per-region physical line-box estimates and text-width evaluation. Transforming a panel invalidates its calibration instead of silently reusing stale pixels.
- Versioned rules-as-code with confidence-aware abstention.
- Rule 7 / Table I area tiers and boundary uncertainty.
- Rule 26 small-package, tobacco, pan masala, fast-food, formulation and medical-device profiles.
- Blind Challenge mode with controlled-packet lockout and elapsed timer.
- Hash-linked audit events and tamper verification.
- Local officer/supervisor separation, assignments and reason-required overrides.
- PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM encrypted evidence export/import, including large image-bearing records and legacy-v1 import.
- IndexedDB evidence register, dashboard, history, JSON export and print/PDF packet.
- Validation Lab for quoted JSON/CSV datasets with verdict accuracy, field-detection precision/recall/F1, extracted-value accuracy, false-violation rate and abstention rate.
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

Current verified baseline:

- 54 automated tests passing.
- Production Vite build passing.
- Full browser workflow passing with zero recorded console/page errors.
- Production service-worker reload and OCR passing with the browser fully offline.
- Exact sample-label OCR regression passing: all 12 expected lines recovered with no manual correction, 91% calibrated reliability, 92% engine confidence, 10 structured signals and 10 mapped evidence regions.
- Connected-OCR browser contract passing: explicit image transfer, normalized result display, FSSAI extraction and evidence preservation during a simulated provider outage.
- Real-label pilot: standard local OCR recovered 75.9% of expected tokens; local deep scan recovered 79.3% on the same 10 untouched photos from six Indian-market products. No manual correction was used. The source dataset's precomputed Google Vision annotations score 96.6% on the same tokens and remain a reference baseline, not a result from the deployed app.

The OCR QA loads the bundled engine assets. The UI separates calibrated **reliability** from provider **engine confidence**; neither is accuracy. Neither the exact-text fixture nor the small real-label pilot establishes field or compliance accuracy. The real pilot intentionally preserves failed tokens and a curved-label stress case; see the [Open Food Facts pilot protocol](datasets/openfoodfacts-india/README.md), the [Legal Metrology field-dataset schema](datasets/legal-metrology-field/README.md) and the committed reports in `reports/`.

## Deployment

The repository includes `vercel.json`; Vercel can build it as a static Vite application with `npm run build` and serve `dist`. Camera capture and service workers require HTTPS outside localhost, which Vercel supplies.

```powershell
npx vercel@latest --prod
```

Deployment does not create a central database: inspection history, assignments and evidence remain local to each browser through IndexedDB/local storage. Production departmental identity, shared case synchronization and externally anchored audit storage remain future server-side work.

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

- [Downloadable team feature and verification PDF](docs/NiyamLens_Team_Feature_Verification_Guide.pdf)
- [Team feature and verification guide](docs/TEAM_FEATURE_VERIFICATION_GUIDE.md)
- [Architecture and trust model](docs/ARCHITECTURE.md)
- [Hybrid OCR architecture decision](docs/ADR-001-HYBRID-OCR.md)
- [Legal review register](docs/LEGAL_REVIEW.md)
- [Field validation protocol](docs/FIELD_VALIDATION_PROTOCOL.md)
- [Judge demonstration runbook](docs/JUDGE_DEMO.md)
- [Deployment readiness](docs/DEPLOYMENT_READINESS_2026-09-03.md)
