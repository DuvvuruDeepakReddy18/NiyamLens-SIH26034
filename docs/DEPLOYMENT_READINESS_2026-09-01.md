# Deployment readiness — NiyamLens 0.2.0

**Checked:** 1 September 2026  
**Target:** Static Vite deployment on Vercel  
**Release status:** Deployable competition prototype; deployment not yet executed

## Release gates

| Gate | Status | Evidence |
|---|---|---|
| Unit and regression suite | PASS | 37/37 tests |
| Production compilation | PASS | `npm run build`; one 296 KB JavaScript bundle plus CSS and static OCR assets |
| Production browser workflow | PASS | Upload, perspective correction, extraction, verdicts, evidence report, persistence, supervisor override/reopen, validation lab, blind challenge and mobile navigation; zero page/console errors |
| Offline production startup | PASS | Service worker v5 caches 16 required shell/OCR resources |
| Offline OCR | PASS | Browser set fully offline; 91% sample confidence and 9 parsed declaration signals |
| Production dependency audit | PASS | 0 known production vulnerabilities from `npm audit --omit=dev` |
| Deployment configuration | PASS | `vercel.json` defines Vite build/output and cache headers |
| Vercel authentication | PASS | Local CLI authenticated as `duvvurudeepakreddy18` |
| GitHub remote and backup | **BLOCKED** | Parent Git repository has no commits and no remote; active GitHub CLI account is `BANU-09`, with `DuvvuruDeepakReddy18` also authenticated but inactive |
| Department/laboratory approval | PENDING | Required before enforcement use; not a blocker for an SIH/SAH prototype deployment |

## Deployment characteristics

- The application is a static client-side application; there are no database migrations, API servers or secrets required for the competition build.
- HTTPS is required for production camera/service-worker behavior and is supplied by Vercel.
- English, Hindi, Telugu and Tamil OCR runtime files are shipped with the application; the first service-worker installation downloads roughly 28 MB.
- Evidence and workflow state are stored per browser in IndexedDB/local storage. Deploying the site does not create cross-device synchronization or a department-wide shared dashboard.
- Native barcode scanning depends on Chromium `BarcodeDetector`; manual GTIN and four-corner correction remain available fallbacks.
- Local audit hashes detect mutation but are not an external/WORM audit anchor.

## Deploy procedure

1. Create a dedicated GitHub repository under the team-selected account.
2. Commit the `niyamlens` directory, including `public/ocr`; do not commit `node_modules`, `dist`, `.vercel` or QA screenshots.
3. Push the default branch and connect it to Vercel, or deploy directly with `npx vercel@latest --prod`.
4. On the deployed HTTPS URL, run one live packet through capture, OCR, calibration, finalization and report reopen.
5. Toggle the browser offline and confirm reload plus OCR.

## Rollback triggers

- The application shell or OCR assets fail to load from the production URL.
- Any page error occurs in capture, finalization, override or report reopen.
- Offline mode serves HTML for a JavaScript/WASM request or OCR fails after the cache reports ready.
- Saved records cannot be reopened after a fresh page reload.

For a first deployment, rollback means removing the production alias or restoring the previous Vercel deployment. For later releases, retain the last known-good Vercel deployment until the smoke test passes.
