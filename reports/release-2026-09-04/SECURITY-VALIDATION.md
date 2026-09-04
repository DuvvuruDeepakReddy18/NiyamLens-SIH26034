# Release security validation — NiyamLens 0.4.2

4 September 2026. Pre-push review of the working tree on `codex/managed-cloud-release`. This report records local checks, not a hosted penetration test or legal certification.

## Results

| Check | Measured result |
| --- | --- |
| `npm audit --json` | 0 known reported vulnerabilities: 0 critical, high, moderate, low or informational. Dependency metadata reports 246 total packages. This is the registry advisory result, not a guarantee that no vulnerability exists. |
| Focused security/auth/evidence/backend regressions | 53 tests passed, 0 failed. |
| Actual SQL migration stress in embedded PGlite | 1 stress test passed: 100 identical seal calls stored one case; 30 version-one review attempts produced one success and 29 conflicts; 100 quota attempts allowed exactly 30; cross-organization visible rows were zero. |
| Credential-pattern scan | 234 tracked/unignored candidate files, including 194 text files, examined at the inventory snapshot. No matches for private keys, GitHub tokens, Google API keys, AWS access-key IDs, Supabase secret keys, JWTs, credential-bearing PostgreSQL URIs, or long quoted credential assignments. No secret values were printed. Pattern scanning is not an exhaustive secret-detection guarantee. |
| Environment files | The only tracked environment file is the empty `.env.example`. `.env*` and `.vercel/` remain ignored. No local Supabase/Google Vision environment configuration was present in this shell. This says nothing about remote Vercel configuration. |
| Large files | No current candidate file exceeded 100 MB. The new intentional same-origin Paddle assets total 68,186,300 bytes; the largest individual asset is the 25,014,754-byte ONNX WASM runtime. Hashes, upstream source references and available notices are retained in the asset manifest. |

The initial sandboxed Node test invocation failed before executing tests because subprocess creation was denied (`spawn EPERM`). The identical test command was rerun with permitted subprocess access and passed. It was not counted as an application failure or hidden.

## Staging boundary

Exclude the experimental file `reports/recognition-2026-09-04-pass2/models/en_PP-OCRv5_rec_mobile.onnx` from the push. It is 7,872,351 bytes, belongs to the unsuccessful offline English-model comparison, and is not used by the application. Keep the experiment code, recorded model hash and measured results; do not delete local evidence merely to keep Git small.

The production `public/ocr/paddle-v1/` assets are different: they are required for the implemented same-origin optional browser OCR workflow and should be included unless the release process explicitly recreates and verifies them before deployment. Do not omit them while claiming the feature is deployable.

The existing isolated Python environment, temporary SDK extraction, downloaded Tesseract experiments, original Open Food Facts photo cache, local secrets, `.vercel/` and generated `dist/` remain outside Git through existing ignore rules. Public-package OCR transcripts and earlier failure reports can remain as transparent research evidence. Historical stress reports explicitly describe old reproduced failures; the current regression results should not be confused with those reports.

## Coverage and cloud boundaries

The focused checks exercise:

- Verified identity and workspace membership, including rejection of self-asserted roles, expired identity and non-members.
- Officer ownership, organization isolation, suspended membership, immutable cases, stale review conflicts and quota limits in actual migration SQL.
- Server-side recomputation of findings and provenance; controlled fixtures cannot be sealed as operational cloud records.
- Complete image decoding, byte/pixel/dimension ceilings, corrupt image rejection, evidence digests and revalidation before signing a private read.
- Bounded OCR provider responses and request deadlines; missing server secrets fail closed.
- Nested case schema validation, bounded metadata, finite pagination and synchronization acknowledgement races.
- Audit tampering detection and encrypted-evidence round trips.

PGlite uses fixture Auth/Storage schemas on one embedded backend. Provider calls in the focused suites are mocks. These tests do **not** verify real Supabase login, hosted multi-session RLS, signed uploads/downloads, live connected OCR, production Vercel timeouts or target-phone resource limits. Those are separate acceptance gates; local test success must not be advertised as live cloud verification.

No new release-blocking security defect was reproduced within this bounded review. Exclude the experiment-only model before staging, retain deployment limitations, and use the root release checks for final build/browser/commit status.

## Reproduction

```powershell
npm audit --json
node --test tests/security.test.mjs tests/security-boundaries-regression.test.mjs tests/workspace-security.test.mjs tests/database.test.mjs tests/ocr-api.test.mjs tests/ocr-cloud-history.test.mjs tests/evidence-intake.test.mjs tests/cloud-audit-presentation.test.mjs
node --test reports/stress-2026-09-04/security-postgres.mjs
```

No live service was modified or load-tested by this security check, and this subtask did not stage, commit, push or deploy files.
