# NiyamLens 0.4.4 — public production cutover

5 September 2026. This is an observed release checkpoint, not regulatory certification, a completed field pilot or a guarantee of SIH selection.

## Outcome

- The stable public application is <https://niyamlens-sih26034.vercel.app/>.
- The alias resolves to READY Production deployment `dpl_87dvmg6us3ZqfYj4mohJMrheJDpw`; its corresponding source checkpoint is Git commit `8124280a1d24d072fb35108c7b34b436670c6f06`.
- The deployed release is NiyamLens `0.4.4`, rule pack `LMPC-RC-2026.09-RC5`, rule matrix `LMPC-MATRIX-2026.09-RC5` and service-worker cache `niyamlens-shell-v12`.
- The observed public JavaScript asset is `assets/index-Bkf70dEu.js`.

The tested READY build was promoted without a database migration or a Supabase data reset. Generated Vercel deployment URLs remain behind Vercel Authentication; ordinary NiyamLens users must use the stable public application and must not be added to the Vercel infrastructure team.

## Public smoke and boundary checks

Independent cookie-free checks passed after promotion:

| Check | Observed result |
| --- | --- |
| `GET /` on the stable public application | `200 OK`; NiyamLens inspection-console HTML |
| `GET /api/health` | `200 OK`; `{"service":"niyamlens","ready":true}` |
| Unsigned `GET /api/cases` | `401 Unauthorized`; application-level sign-in requirement |
| Same paths on the generated `bqda9qfmx` URL | `302` to Vercel SSO, as intended |

## Supabase redirect correction

Before correction, the Auth Site URL was the generated `bqda9qfmx` deployment. A recipient who accepted the invitation therefore reached Vercel's **Request Sent** page. That page requested access to deployment infrastructure; it was not a NiyamLens role or invitation screen.

Using an owner-authorized Supabase CLI session, the hosted Auth configuration was read, changed through a narrow Management API PATCH and read back. Only these fields changed:

- Site URL: `https://niyamlens-sih26034.vercel.app/`
- Redirect allowlist: the stable origin was added; the two existing exact staged origins were preserved.

No wildcard was added. SMTP/provider fields, signup policy, users, passwords, memberships and database content were not changed by this configuration update. The repository's localhost-oriented `supabase/config.toml` was deliberately not pushed.

## First approved Officer recovery

A parameterized, read-only query selected only non-secret status fields for the first approved Officer identity. It found exactly one matching Auth account. `email_confirmed_at` and `last_sign_in_at` were both populated, proving that the invitation had already been consumed before Vercel blocked the redirect. No invitation was resent and the account was not recreated.

A separate aggregate read-only check found exactly one active owner `admin` membership and exactly one active recipient `officer` membership in the primary organization; the redirect change did not alter either role.

Exactly one password-recovery request was then accepted for that identity with `redirect_to=https://niyamlens-sih26034.vercel.app`.

A subsequent recipient-supplied Chrome screenshot visibly showed the stable public origin, NiyamLens, the approved identity with role `officer`, and **Authenticated workspace · server-verified permissions**. In the current managed build, that screen requires an existing Supabase session and a completed active-membership query that did not take the offline-cache branch. This closes the public-origin authenticated Officer-workspace UI gate. The still image does not independently prove the preceding inbox/password sequence or any evidence upload, authenticated API mutation, server receipt, OCR result or multi-user isolation result.

## Automated verification repeated after cutover

- Application tests: **475/475 passed**, zero fail/cancel/skip/todo.
- Audit-gate regressions: **5/5 passed**.
- Production build: passed, **1,701 modules**.
- Source OCR assets: **17/17**, 68,186,300 bytes, zero network fetches.
- Built OCR assets: **17/17**, the same byte total, zero network fetches.
- Production dependency audit: **0 vulnerabilities** at every severity.
- Git secret/privacy audit: no staged or Git-visible untracked file, credential, JWT, provider token, invite link or recovery link.

Non-blocking build warnings remain the documented OpenCV browser externalization/chunk-size warnings and Node `DEP0190` in the npm-audit wrapper.

## Rollback

The immediately previous independently inspected READY Production deployment is `dpl_9GnDpup4NMcnGLyRYvrVX6LWCxLi`. If a release-critical application regression appears, promote that exact deployment and re-run public smoke checks. Application rollback must not reset or replace the shared Supabase database.

## Gates still open

1. Verify sign-out denial, then complete an authenticated upload/seal/receipt/**Verify cloud copy** cycle with the first Officer on the public origin.
2. Complete the approved two-Officer/one-Supervisor/other-organization permission matrix without reusing identities across roles.
3. Run offline retry and concurrent stale-review conflict handling with real separate accounts.
4. Complete the pre-registered unseen-photo pilot with independent reference labels; do not score manually corrected OCR as raw OCR.
5. Create a consistent live database/object export, protect it off-site and rehearse service restore only in a separately approved disposable project.
