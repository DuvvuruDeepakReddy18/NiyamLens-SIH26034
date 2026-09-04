# Functional prototype: implementation and verification

4 September 2026 — SIH26034 / NiyamLens

This is an implementation update, **not a claim that the system is production-certified or automatically accurate on every real package**. A hosted Supabase project is now configured and reachable from a staged Vercel deployment. The public domain remains unchanged until first-user setup and real Auth/Storage acceptance checks pass. The managed release is backed up on GitHub on `codex/managed-cloud-release`. See [the current activation checkpoint](CLOUD_ACTIVATION_2026-09-04.md) for exact hosted status, including the unresolved npm advisory-service timeout; `RELEASE_VERIFICATION_2026-09-04.md` preserves the earlier preview verification.

## Implemented

| Area | What changed | Verification |
| --- | --- | --- |
| Durable evidence | IndexedDB saves resolve after transaction commit, not request success; case plus queued operation is atomic | Abort-after-write and queue-atomicity tests |
| Draft recovery | Captured panels, text, original OCR, metadata and audit history autosave locally; explicit restore/discard after reload | Chrome restore-after-reload test |
| Sealed evidence | Saved inspections lock against editing; new evidence needs a new case | Chrome lock test; database immutability test |
| OCR review | Per-field confirmation/absence/unreadable/not-captured states, source notes, competing OCR readings retained | Unit tests and actual browser OCR on a synthetic regression fixture |
| Original transcript | OCR transcript is separate from officer corrections and appears in reports | Chrome correction/reload/report test |
| Geometry safety | Unverified/curved measurements cannot automatically determine typography; physical PDP, same-plane scale and width-character applicability need confirmation | Safety-policy unit tests |
| Exemption safety | Quantity/classification confirmation required; metadata quantity cannot contradict the label to obtain an exemption | Unit test |
| Reviews | All dispositions append; original automated findings stay unchanged; reasons required | Two-review Chrome test and SQL version/idempotency tests |
| Shared workspaces | Supabase Auth, invite-only provisioning, server-verified officer/supervisor/admin roles, organization isolation | PostgreSQL RLS tests; mocked Auth browser test; live service test pending |
| Private uploads | Exact-path signed uploads; server checks byte count, allowed magic/type and digest; originals plus analysis files | Implemented; mocked descriptor/API contract test; actual Storage test pending |
| Identity changes | Requests are bound to the original authenticated user; switching account cancels pending uploads and rejects stale responses | Focused client regression tests; actual multi-user Auth acceptance pending |
| Portable cloud exports | Download and hash-check original/analysis images before embedding them; never export expiring private URLs as evidence | Bounded-download, digest and expired-URL regression tests |
| Timeline provenance | Preserve the officer-supplied cloud timeline without presenting its hashes as independently verified server evidence | Cloud/local presentation regression tests |
| Synchronization | Durable outbox, capped retry backoff, per-case blocking on conflicts, explicit review reconciliation | Unit tests and offline/online mocked-service Chrome flow |
| Assignments | Supervisor-created tasks with role-checked, versioned transitions and atomic server audit entries | PostgreSQL tests; live team workflow pending |
| History | Removed the 50-case retention truncation; search and 20-row display pages | More-than-50 storage test; Chrome search test |
| Offline privacy | Service worker excludes API/authenticated responses and caches the local OCR engine | Production-build offline reload/OCR test |
| Operations | Local API launcher, schema migrations, environment template, user provisioning helper and CI test/build workflow | Build/tests pass; provisioning not run against a hosted project |

The system-design and testing skills guided the implementation toward permission checks, immutable records, transaction failures and conflicts, rather than only successful demo paths.

## Tests to reproduce

Initial implementation handoff: **82/82 unit/database tests passed**, the production build passed, and Chrome checks passed for the existing UI, new functional safeguards, mocked connected OCR, offline production OCR, and mocked managed-workspace flow. The release fixes expanded the suite to **93 tests**; the dated release record tracks the final rerun. The source remains subject to the live-service and field-validation limitations below.

```powershell
npm test
npm run build
# Start npm run dev in another terminal:
npm run qa:ui
npm run qa:functional
npm run qa:ocr:connected
# Start npm run preview -- --host 127.0.0.1 --port 4173:
npm run qa:pwa
```

`qa:ui` and `qa:functional` use explicitly synthetic regression labels. They test actual clicks, upload processing, Tesseract execution and persistence; they do not measure real-world accuracy. `qa:ocr:connected` uses a mocked provider response and an outage response, not paid Google OCR calls.

`tests/database.test.mjs` executes both migration files in actual embedded PostgreSQL with minimal Auth/Storage schema fixtures. It verifies officer and organization isolation, denied direct writes, suspended memberships, immutable retries, versioned reviews, assignment transitions, audit linkage and quota windows. It does not test Supabase email, token issuance, Storage or PostgREST infrastructure.

The separate `tools/qa-workspace-ui.mjs` exercises compiled managed-mode sign-in, account-derived controls, real local offline queueing, upload descriptors and server-recomputed case payloads against **mock services**. To reproduce, build a separate test output using dummy public configuration, serve it on 4174 and run the script. Never deploy that dummy-configured output.

## Still required before calling it production-ready

- Finish first-user setup and verify hosted acceptance in `SUPABASE_SETUP.md` against the configured Supabase project. Read the activation checkpoint before any migration command or promotion.
- Validate OCR and per-field error rates on a representative held-out collection of real Indian labels. This pass does not improve or remeasure the previously reported real-label benchmark. Displayed reliability numbers remain heuristics, not calibrated probabilities.
- Validate font measurements across devices/surfaces with known physical reference measurements. A confirmation checkbox is an officer assertion, not a laboratory calibration.
- Have a qualified domain reviewer approve the versioned legal rules. Food-law coverage, specialist classifications and ambiguous exemptions are not automatically resolved by this software.
- Set organization retention, incident-response and access-review procedures; configure and test database plus object-storage backup/restore.
- Test byte-level interrupted upload behavior on poor field networks; current recovery retries an individual file.
- Address device security: cached offline evidence is not application-encrypted at rest. Remote revocation prevents server access but cannot erase a copy already saved on someone else's device.
- Add external audit anchoring/signature controls if required. The current service-role/database administrator remains privileged; an internal hash chain is not independent tamper-proof certification.
- Test real mobile cameras, multiple browsers, large case collections and simultaneous operators. IndexedDB still depends on browser storage quota and device capacity.

## Dependency warning

Installation reported two high-severity findings in the development-only `image-size` dependency brought in by `pptxgenjs`. The published advisories list vulnerable versions through 2.0.2 and no patched version: [ICNS parser](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JXL/HEIF parsers](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).

It is not imported by the browser application or new API routes. Avoid untrusted ICNS/HEIF/JXL input in slide-generation tools. No blind major-version override was made. Earlier online audit calls intermittently timed out; the 4 September release rerun of `npm audit --omit=dev --audit-level=high` completed and reported zero vulnerabilities in production dependencies. That result does not clear the development-tool findings. The CI audit checks production dependencies separately.

## Team next step

Follow `SUPABASE_SETUP.md`. Share only the project URL in chat; enter secret values locally or in the hosting dashboard. Deploy a staging instance, complete the acceptance checklist, and only then decide whether to promote it for real field use.
