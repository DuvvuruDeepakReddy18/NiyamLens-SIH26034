# Hosted activation checkpoint — 4 September 2026

Last checked: 11:55 IST. **The backend is connected on a staged deployment; a fully verified team service is not yet released.** No first Auth user, administrator membership, or email invitation has been created in this pass.

## Created and configured

- Supabase project: `NiyamLens-SIH26034`, ref `sivqthnclblqtqshexgx`, on the existing Free organization. Region: Sydney (`ap-southeast-2`). No existing project was modified or deleted.
- Project URL: `https://sivqthnclblqtqshexgx.supabase.co`.
- Both repository migrations were installed together in a transaction through the project's SQL Editor. The transaction completed successfully; a separate catalog query verified the resulting objects and privileges.
- All eight application tables have RLS enabled. Anonymous table reads and authenticated direct writes are denied. The seven application read policies are restricted to the authenticated role. Privileged mutation RPCs are executable only by the server role; the two membership helpers support read policies.
- The `evidence` bucket is private, accepts JPEG/PNG/WebP, and limits each file to 15 MiB. No permissive Storage object policies were added.
- Four variables are saved for **Vercel Production only**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The server key is a Secret. The modern Supabase secret/publishable key pair is used with these existing environment-variable names. No privileged value is included in Git, this document, or a local env file.
- Public self-signup and anonymous sign-in are disabled; email confirmation remains enabled. Minimum password length was saved as 12.
- The Auth Site URL currently points to the connected staged deployment below, so initial setup links do not target the old local-only site. Before promotion, update it to the final public app URL and review exact recovery redirects. No wildcard redirect was added.
- Google Vision credentials were **not** configured. Browser OCR remains the available OCR engine; paid connected OCR is not claimed live.

## Deployment and source

- [Connected staged deployment](https://niyamlens-sih26034-ojawbw6dc-duvvurudeepakreddy18s-projects.vercel.app/): `dpl_HDsW7bFMJf9t2f9DNUt3Nz5AWAw7`, Ready.
- Deployed from clean release commit `c945c370e9daa6539f3e75b4f46505b0ea8e6f5a` using `vercel deploy --prod --skip-domain --yes`. This uses Production configuration without promoting the public project domain. This is a staged application deployment using the intended production database, **not a separate staging database**.
- Build completed; managed-mode asset is `/assets/index-BtJTzEcn.js`. Chrome displayed the secure sign-in page, not the local training workspace.
- [Public site](https://niyamlens-sih26034.vercel.app/) still resolves to `dpl_HuQQppi67JvjrsfQ7xjmtMqNvnFU`, the previous deployment. Verified with `vercel inspect` after staging. No promotion command was run.
- Code and the CI repair are backed up on [`codex/managed-cloud-release`](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/tree/codex/managed-cloud-release). A source-code backup is **not** a backup of cloud evidence.

## Actual verification

| Check | Observed result |
| --- | --- |
| Application/database/client tests | 93/93 passed locally and on GitHub |
| CI audit-gate regression tests | 5/5 passed locally and on GitHub |
| Production build | Passed locally, on GitHub, and on Vercel |
| `GET /api/health` | HTTP 200, `ready:true`, `Cache-Control: no-store` |
| Unsigned-in `GET /api/cases`, `/api/evidence`, `/api/assignments` | Each HTTP 401; no records returned; `no-store` |
| Unsigned-in `POST /api/reviews` | HTTP 401; no review created; `no-store` |
| Deliberately invalid Bearer token on `GET /api/cases` | HTTP 401 session rejection from the connected Auth path; no data returned; `no-store` |
| `GET /api/ocr` | HTTP 200, `configured:false`, explicit-opt-in; `no-store` |
| Database security catalog | Eight RLS tables, seven scoped SELECT policies, expected function privileges, private bucket and digest function present |
| Real password login, invitation/recovery delivery, signed uploads and multi-user workflows | **Not yet verified** |
| Database plus object backup/restore | **Not configured or tested** |

Health only proves that the server can reach the organizations table. It does not prove authentication, Storage transfers, RPC transactions, email delivery, or role isolation end to end.

## Current blockers

1. Chrome's setup control stopped responding before any invitation was sent. Resume from the existing Supabase project in Chrome. The first administrator invitation discussed with the owner is still unsent; do not claim an account exists.
2. [GitHub run 33842936739](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33842936739) passed install/tests/build but failed its production dependency audit: the public npm bulk advisory endpoint timed out on all three bounded attempts. This is an unavailable security report, not a reported vulnerability and not a passing audit. The npm 11 CI fix removes the retired fallback without suppressing security failures. Do not disable the gate to obtain a green run.

## Resume safely

1. Restore Chrome setup access. Confirm the email-provider setting persisted and inspect email delivery restrictions/SMTP. Send the authorized first-admin invitation, then let the account owner open the email and enter/set their own password. Never request a password in chat.
2. Add the existing Auth UUID to a new named organization with an admin membership, following `SUPABASE_SETUP.md`. Verify that the Auth user exists first; refuse duplicate organizations or silently overwritten memberships. No workspace has been provisioned yet.
3. Complete the hosted acceptance checklist with approved test accounts and explicitly identified test evidence. Verify real original/analysis transfers, hashes, server receipts, offline retries, isolation, account switching, assignments and review conflicts. The intended production database is in use: do not reset it or delete test records without reviewing scope and authorization.
4. Obtain a successful production dependency audit when the registry is available. Review any actual findings if returned.
5. After acceptance, set the Auth Site URL to the public domain, verify recovery, promote the tested deployment, and recheck the public domain. Keep the previous deployment available for rollback. Do not reset the database as an application rollback.

## Important migration-history warning

SQL Editor installed the schema, but the project currently has **no `supabase_migrations.schema_migrations` ledger**. Do **not** blindly run `supabase db push`: it would treat both already-installed CREATE TABLE migrations as unapplied. Before using CLI migrations, compare the installed schema with the two repository files and use the documented CLI migration-repair workflow to mark exactly `202609040001` and `202609040002` applied, then inspect `supabase migration list` and the planned diff. No repair/history write is claimed in this pass.

The underlying OCR, legal-rule, geometry, device-security and field-validation limitations remain listed in `PROTOTYPE_HARDENING_STATUS.md`.
