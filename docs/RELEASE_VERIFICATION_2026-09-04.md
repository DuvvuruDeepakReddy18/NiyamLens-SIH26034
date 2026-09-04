# Managed-workspace release candidate — 4 September 2026

This release candidate adds the managed-cloud implementation. It does **not** claim that Supabase is connected or that a full shared-workspace service is live.

## Release verification

| Check | Result |
| --- | --- |
| Unit, database and client regression tests | 93/93 passed |
| Production Vite build | Passed |
| GitHub-hosted verification | Source commit's install, test and build steps passed; registry audit still running at this verification snapshot |
| Production dependency audit | `npm audit --omit=dev --audit-level=high`: zero known vulnerabilities |
| Account-change cancellation | Bound-user requests, aborted uploads and stale-response regressions passed |
| Portable evidence reports | Bounded downloads, original/analysis digest checks and embedded-image export tests passed |
| Cloud timeline provenance | Officer-supplied events retained but not labelled independently verified |
| Managed-mode browser regression | Passed in Chrome with zero page errors: offline queue, two byte/hash-checked mocked uploads, server recomputation, portable export, timeline provenance and sign-out/account-switch isolation |
| Hosted Supabase Auth/Storage | Not run: account sign-in and project creation required |
| Hosting configuration | Existing Vercel project confirmed; no production or preview environment variables configured |
| Hosted preview | Ready; homepage serves the expected bundle; downloaded JavaScript SHA-256 exactly matches the tested build |
| Hosted readiness/API | `/api/health`: HTTP 503 and `ready:false`; `/api/cases`: HTTP 503, shared backend not configured. No case data returned |
| Secret hygiene | Only empty `.env.example` tracked; environment files and non-application artifacts excluded from hosting build context |

The SQL tests execute actual embedded PostgreSQL with Auth/Storage schema fixtures. Client and managed-browser tests mock provider services. Neither substitutes for real Supabase token, Storage, email or multi-user acceptance testing.

## Publication

- Release branch: [`codex/managed-cloud-release`](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/tree/codex/managed-cloud-release), pushed and verified against the remote.
- Deployed application source: [`424b6b59f955f6df3cce08f14780d9f372ef77ee`](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/commit/424b6b59f955f6df3cce08f14780d9f372ef77ee). Subsequent release-note-only commits do not change this tested snapshot.
- [Verified Vercel preview](https://niyamlens-sih26034-iolybk76r-duvvurudeepakreddy18s-projects.vercel.app): `dpl_qMaavkHYHYDGczfN6SpMn2TWgGbS`, Ready, Preview, Vite, 18-second deployment duration. Created automatically by the GitHub push; build logs confirm branch and commit.
- Preview protection is enabled: unauthenticated requests redirect to Vercel sign-in. Authenticated CLI smoke checks used a CLI-generated project automation bypass token; no token is included in this record or Git. No public-access setting was disabled.
- Verified app asset: `/assets/index-XrkyorMA.js`, SHA-256 `bae0ed10b8fcfacabb2b3de984a6b6d1322b116494f661d133f6914cdb4db562` (local and hosted exact match).
- [Source-commit CI run](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33838301686); its test/build steps passed, audit was pending when checked. No final remote audit success is claimed.
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
