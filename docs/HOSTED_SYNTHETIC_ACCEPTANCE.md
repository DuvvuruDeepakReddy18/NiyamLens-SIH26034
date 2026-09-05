# Hosted synthetic integration acceptance

This is a **live infrastructure test with synthetic accounts**, not a human team pilot, an OCR accuracy study, or legal validation. It tests the currently public application release; it never deploys local changes or silently changes the rule-pack identifier on a previously sealed record.

## Strict scope

`tools/hosted-disposable-pilot.mjs` is locked to the existing NiyamLens Supabase project and stable public application origin. It requires `--run`, the exact `--project-ref`, and the exact `--allow-origin`. It refuses an unignored output directory.

A new run creates only:

- Two uniquely named synthetic test organizations.
- Four synthetic Auth identities at the reserved `example.invalid` domain: two officers and one supervisor in the primary test organization, and an officer in the control organization.
- Exactly four memberships for those identities. Existing human accounts, passwords, memberships, organization names and global Auth/SMTP settings are not modified.
- Three visibly marked generated test cases, six private original/analysis image objects, and test review/assignment records.

Auth uses the administrator `createUser` operation with email confirmation enabled in that operation, followed by real password sign-in. No invite, reset, recovery or signup-mail operation is used. [Supabase createUser reference](https://supabase.com/docs/reference/javascript/auth-admin-createuser)

The existing official Supabase CLI manages its own login. Project keys are retrieved by the supported CLI option and retained only in the test process; no privileged keys are written or printed. Only randomly generated **synthetic account passwords** are saved in the ignored run folder, for independent browser testing. These files are not application-encrypted; use a trusted device and do not attach or commit them.

## Verification and evidence

Before hosted execution:

```powershell
node --test tests/hosted-disposable-pilot.test.mjs tests/hosted-permissions-probe.test.mjs
```

An owner-approved live run:

```powershell
node tools/hosted-disposable-pilot.mjs --run --allow-origin https://niyamlens-sih26034.vercel.app --project-ref sivqthnclblqtqshexgx
```

The private run directory is `.niyamlens-private/team-pilot/hosted-RUN-UUID/`. Its `manifest.json` contains exact created IDs, image digests, check outcomes, failure history and a cleanup plan, but no session tokens or privileged keys. `synthetic-credentials.json` must remain private. The script prints only a sanitized run summary.

The hosted checks cover password sign-in, real signed uploads and registration, idempotent seal receipts, the existing 41-check exact-case/evidence authorization matrix, downloading all six files and matching their SHA-256 digests, case and assignment lists, officer review denial, supervisor review idempotency and stale-version conflicts, assignment conflicts, and revocation of a disposable officer's membership while retaining its existing token. The exact membership is restored after the revocation check so browser acceptance can continue.

`passed` is true only if every recorded check passed. A resumed run retains original failures; intervention does not retroactively convert them into successful automatic recovery.

## Resume and cleanup

Do not start another new run to work around a partial failure. Review the manifest first. The guarded resume path accepts only a run that already has its two organizations and four identities, rechecks the exact server-owned synthetic markers, names and memberships, and refuses a changed public build:

```powershell
node tools/hosted-disposable-pilot.mjs --run --allow-origin https://niyamlens-sih26034.vercel.app --project-ref sivqthnclblqtqshexgx --resume RUN-UUID
```

For a known existing uploaded file, resume may explicitly invoke verification to continue investigating. That action is logged as an operator intervention, not proof that the application's automatic retry worked.

There is no automatic broad deletion. Test resources are retained for review and browser acceptance. After testing, disable only these four exact memberships. Physical removal requires separately reviewed exact-target cleanup: verify all synthetic identity markers and organization names; remove only recorded Storage paths; then the scoped dependent database rows and exact synthetic Auth users. Never reset the database, delete by a broad prefix without verifying each target, or alter human accounts. Retain the redacted result and manifest provenance.

## Limits

This runner does not prove invitation/recovery email delivery, independent human inspection, OCR correctness, real-device offline behavior, physical font measurement, backup/restore, or performance at scale. The current public deployment has Connected OCR disabled and returns a configuration error before that route's authorization branch; this run cannot establish its live provider or revocation behavior. Browser workflows are a separate acceptance layer. A pass against RC5 is not a pass for unshipped RC6 changes.

## Observed run: 5 September 2026

Run `a745ef38-a2db-447b-a671-7f1517a3842b` tested the public **LMPC-RC-2026.09-RC5** build. The result is **completed with failures**, not a release pass.

| Live evidence | Observed result |
| --- | --- |
| Four generated accounts, actual password authentication | All four signed in to real Supabase |
| Role/organization isolation | Existing 41-check hosted authorization matrix passed 41/41 |
| Three marked cases and six sealed image files | Actual uploads, verified registrations, server seal receipts and identical seal retries succeeded after the intervention below |
| Signed-link retrieval | All six files downloaded and their bytes/SHA-256 matched |
| Case lists | Four-account owner/supervisor/control-organization scope checks passed |
| Reviews | Officer denied; supervisor commit and identical retry succeeded; stale-review conflict failed with HTTP 500 instead of 409 |
| Independent assignment/revocation checks | Five follow-up checks passed, including old-token read/upload/seal denial and exact membership restoration |
| Lost upload acknowledgement | **Failed**: existing correct bytes with no registration caused a repeated `prepare` to return 503 |
| Repaired local handler with real providers | **3/3 passed**, including existing-object recovery and one idempotent exact registration. This is not a deployed-production fix |

To finish independent tests after the upload failure, the operator explicitly invoked verification for the exact already-uploaded test file. The manifest records this intervention and retains the failed automatic-retry check. The second failure was not suppressed either: the same stale-review RPC directly against Supabase eventually returned 504, while a read confirmed the case remained version 2.

Read-only OpenAPI metadata identified hosted PostgREST **14.5**. The upstream changelog records a fix for automatic transaction retry on SQLSTATE `40001` in version 16.0. Because application-level business conflicts currently raise that serialization-failure code, provider retry is a supported explanation for the observed timeout, not a captured database trace. A forward migration to a dedicated HTTP conflict code must be reviewed and explicitly applied before claiming the hosted issue fixed. [PostgREST changelog](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md), [v14 custom HTTP error codes](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes)

An initial earlier run stopped before creating any resources because the new CLI returned a redacted key without its explicit reveal option. That failed manifest is retained. The corrected runner captures the authorized full key only in memory.

The successful local-candidate recovery check added one extra marked original image/registration with a new panel ID under an existing synthetic case ID. It is **not attached to that case's sealed payload**. The manifest contains its exact cleanup path, source-file digests and check results. No production deployment, migration application or broad cleanup occurred during these checks. Chrome acceptance and final fixture-membership disabling are coordinated separately.

Final containment checkpoint: the separately authorized Chrome flow created one additional synthetic officer-A case from `public/sample-real-label.png`, ran actual browser OCR without manual text corrections or physical confirmations, and passed fresh-context strict portable-export verification. A separate read-only check confirmed its exact owner/workspace, RC5/version 1, six client audit events, original source digest and both registered image objects before adding it to the manifest. The original three API-seeded fixtures lack a genuine browser audit timeline and are not substitutes for this export test.

After every Chrome context closed, all **four exact synthetic memberships were disabled and independently verified inactive**. No human account changed. Four Auth accounts, two organizations, four sealed test cases and nine images/registrations (eight sealed originals/analyses plus one extra recovery image) remain for review. Nothing was deleted; re-enabling a test membership requires a deliberate administrator action. The final sanitized result is in `reports/readiness-2026-09-05/HOSTED_SYNTHETIC_ACCEPTANCE.md` and its companion JSON.
