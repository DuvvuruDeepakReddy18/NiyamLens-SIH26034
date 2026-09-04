# 0.4.3 hosted release checkpoint

4 September 2026. Cloud-configured staging is live; authenticated acceptance and public promotion are not complete.

- Source: [`3760cfca2e3c09883ec8a45838d9dbf8081da1b6`](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/commit/3760cfca2e3c09883ec8a45838d9dbf8081da1b6), pushed to `codex/managed-cloud-release` from a clean working tree.
- [GitHub CI run 33875385729](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33875385729): completed successfully. Application tests, audit-gate tests, build, source/build OCR asset integrity and production dependency audit passed.
- [Cloud-configured staged application](https://niyamlens-sih26034-pbgjljnoj-duvvurudeepakreddy18s-projects.vercel.app/): deployment `dpl_9GnDpup4NMcnGLyRYvrVX6LWCxLi`, Ready.
- Deployed with `vercel deploy --prod --skip-domain --yes`, using the existing four Production-scoped Supabase variables. No values were exported or committed.
- Hosted build log: **“Build configuration: production managed mode; key types and matching project URLs checked, hosted acceptance still required.”** The build used package version 0.4.3, and the managed browser entry is `/assets/index-BrqMA9Pg.js`.
- Chrome opened this exact staged application and displayed **NIYAMLENS · SECURE WORKSPACE / Sign in**, not a local-only training workspace.

## Live read-only API checks

Observed between 13:02:04 and 13:02:33 UTC (18:32:04–18:32:33 IST).

| Endpoint, unsigned-in application request | Observed result |
| --- | --- |
| `GET /api/health` | HTTP 200; `{"service":"niyamlens","ready":true}` |
| `GET /api/cases` | HTTP 401; sign-in error only; no records |
| `GET /api/evidence` | HTTP 401; sign-in error only; no records |
| `GET /api/assignments` | HTTP 401; sign-in error only; no records |

All four returned `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The official Vercel CLI used its existing authentication for deployment access; no application identity was supplied. Health proves access to the organizations table, not successful user authentication or object transfer.

The Windows `vercel.ps1` wrapper consumed the argument separator before curl flags. The successful read-only check used the installed CLI's Node entrypoint with the same official CLI arguments. No token was extracted, no diagnostic mode was enabled, and no browser security policy was bypassed.

## Public alias and rollback

After staging, `vercel inspect https://niyamlens-sih26034.vercel.app` still resolved the public site to the prior deployment `dpl_HuQQppi67JvjrsfQ7xjmtMqNvnFU`. No promotion command was run. Use the staged link above for this release; the automatically generated GitHub Preview does not have Production cloud settings.

This stage uses the existing intended-production Supabase database. No migrations, resets, invitations, account replacements or evidence uploads were performed by this hosted check. Leave the existing public alias in place if authenticated acceptance fails; do not reset the database as application rollback.

## What remains before public promotion

1. The owner signs in privately in the new Chrome tab using the already-provisioned account. Do not send passwords or invitation links in chat.
2. Complete an identified test inspection: original/analysis private upload, server-side digest verification, sealing, reload from Supabase and export read-back. Complete role/isolation/offline-retry checks with separately authorized accounts.
3. Verify invitation/recovery delivery and update exact Auth redirect configuration for the final public domain when ready. Google Vision credentials remain unconfigured; database/object backup restoration remains untested.
4. Only after acceptance, promote the tested release and repeat public-domain smoke checks.

See [the detailed real-photo and saved-report verification](VALIDATION.md). The JSON disk save and byte-for-byte read-back succeeded; DOCX generation succeeded but its disk-save read-back was not separately completed. Broad-label OCR accuracy is not claimed solved.

Nonblocking build notices remain for large optional OCR bundles and upstream install scripts. GitHub also warned that the v4 setup/checkout actions target a deprecated Node runtime and were forced onto Node 24; the application verification job selected Node 22 and completed. These notices are not suppressed or described as validation failures.
