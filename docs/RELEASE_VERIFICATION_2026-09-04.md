# Managed-workspace release candidate — 4 September 2026

This release candidate adds the managed-cloud implementation. It does **not** claim that Supabase is connected or that a full shared-workspace service is live.

## Release verification

| Check | Result |
| --- | --- |
| Unit, database and client regression tests | 93/93 passed |
| Production Vite build | Passed |
| Production dependency audit | `npm audit --omit=dev --audit-level=high`: zero known vulnerabilities |
| Account-change cancellation | Bound-user requests, aborted uploads and stale-response regressions passed |
| Portable evidence reports | Bounded downloads, original/analysis digest checks and embedded-image export tests passed |
| Cloud timeline provenance | Officer-supplied events retained but not labelled independently verified |
| Managed-mode browser regression | Passed in Chrome with zero page errors: offline queue, two byte/hash-checked mocked uploads, server recomputation, portable export, timeline provenance and sign-out/account-switch isolation |
| Hosted Supabase Auth/Storage | Not run: account sign-in and project creation required |
| Hosting configuration | Existing Vercel project confirmed; no production or preview environment variables configured |
| Secret hygiene | Only empty `.env.example` tracked; environment files and non-application artifacts excluded from hosting build context |

The SQL tests execute actual embedded PostgreSQL with Auth/Storage schema fixtures. Client and managed-browser tests mock provider services. Neither substitutes for real Supabase token, Storage, email or multi-user acceptance testing.

## Publication

- Release branch: `codex/managed-cloud-release`.
- Source backup and Vercel preview: pending completion of the release checks.
- Production is intentionally unchanged: <https://niyamlens-sih26034.vercel.app/>.
- Verified existing production deployment: `dpl_HuQQppi67JvjrsfQ7xjmtMqNvnFU` (Ready).
- Previous production source: `ac488014b7a219570a704c2e6e96cd5421f25c2d`.

Do not promote an unconfigured preview and call it managed mode. Without the public Supabase configuration, the interface explicitly remains a local workspace; evidence stays in that browser. `/api/health` must report not-ready until the real service is configured and reachable.

## Activation gate

1. The account owner signs in to Supabase and confirms the project, region and billing choices. No password or privileged key belongs in chat or Git.
2. Apply the two reviewed migrations to the correct new project. Configure invite-only authentication, password recovery and a tested email sender.
3. Configure server-only secrets and browser-safe public variables in the correct Vercel environment, then rebuild. Never put the service-role key in a `VITE_` variable.
4. Provision the first existing Auth user as the workspace administrator. Add separate officer and supervisor test accounts.
5. Complete `SUPABASE_SETUP.md` acceptance checks: upload/download byte verification, unauthorized denial, role and organization isolation, account switching, offline retries, reviews and concurrent conflicts.
6. Verify the hosted readiness endpoint and inspect logs, then decide whether to promote for team use. A field-enforcement release also needs the separate legal, OCR and calibration validation described in `PROTOTYPE_HARDENING_STATUS.md`.

## Rollback

No production alias or database has been changed in this pass. If a future configured release fails its acceptance checks, keep traffic on the verified existing deployment; do not reset or delete the evidence database as a rollback. Application rollback and any forward-only database migration repair require separate review.
