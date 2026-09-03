# Deployment readiness — 3 September 2026

## Outcome

The current local source is buildable and deployable to Vercel. The public alias has not been updated with this change set yet. Local/deep OCR needs no secret; connected OCR remains disabled until the deployment has a server-side Google Vision key.

## Verified release evidence

| Check | Result | Evidence |
|---|---|---|
| Unit/integration tests | PASS | 54/54 tests |
| Production compilation | PASS | Vite production build |
| Full browser workflow | PASS | Upload, perspective correction, extraction, verdicts, report, persistence, supervisor flow, Validation Lab and Blind Challenge; zero recorded errors |
| Exact OCR regression | PASS | 12/12 expected lines, 91% reliability, 92% engine confidence, 10 signals, 10 grounded regions, zero external requests |
| Offline production PWA | PASS | 16 shell/OCR cache entries, offline reload and offline OCR |
| Connected OCR contract | PASS | Explicit transfer, normalized result, FSSAI extraction and preserved evidence during simulated 503 outage |
| Real-photo standard OCR | MEASURED | 75.9% expected-token recall, 64.9% average reliability, 65.4% average engine confidence |
| Real-photo deep OCR | MEASURED | 79.3% expected-token recall on the same cases; +3.4 percentage points |
| Connected live provider | NOT RUN | Requires the team's own billing-enabled Google Cloud project and secret |
| Public deployment of this revision | PENDING | Current changes are local until explicitly pushed/deployed |

The real-photo pilot has only ten scored photos from six products. It measures token recovery and does not establish field accuracy, legal completeness or enforcement-grade performance.

## Vercel configuration

Static/offline functionality:

```powershell
npx vercel@latest --prod
```

Optional connected OCR:

1. Enable the Cloud Vision API in the team's Google Cloud project.
2. Create and restrict an API credential for that API and approved deployment context.
3. Add `GOOGLE_CLOUD_VISION_API_KEY` to the Vercel project as a server-side environment variable.
4. Redeploy, then verify `GET /api/ocr` returns `configured: true`.
5. Test only with a package image the team is authorized to transmit.

Never name the variable with a `VITE_` prefix: Vite-prefixed values are eligible for browser bundling. Rotate any key that is copied into a screenshot, log or repository.

## Release commands

```powershell
npm test
npm run build
npm run qa:ui
npm run qa:ocr
npm run qa:ocr:connected
npm run qa:pwa
npm run qa:ocr:real
npm run qa:ocr:real:deep
```

## Remaining production gates

- Department-approved, amendment-complete legal rule matrix.
- Dual-reviewed Legal Metrology field dataset with a sealed package-level test split.
- Validated physical measurement method and reference design.
- Departmental identity, authorization, shared storage, retention and deletion policy.
- Externally anchored/WORM audit storage and signed rule-pack releases.
- Cloud-provider data-processing, region, retention and cost approval if connected OCR is enabled.
