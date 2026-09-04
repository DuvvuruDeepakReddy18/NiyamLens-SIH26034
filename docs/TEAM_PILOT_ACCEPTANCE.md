# Team permissions and failure-recovery acceptance

Updated 4 September 2026. This adds executable local regression coverage and an opt-in **read-only** hosted permissions probe. It does not provision teammates or claim that the currently single-administrator deployment passed a multi-user pilot.

## What is implemented and verified locally

Run from the repository:

```powershell
node --test tests/pilot-permissions-recovery.test.mjs tests/hosted-permissions-probe.test.mjs
```

Result when added: **23 tests passed, zero skipped**. These files are included automatically by `npm test`.

| Gate | What the executable test checks | Boundary of the evidence |
| --- | --- | --- |
| Two officers | Each sees only owned cases, reviews, original/analysis registrations and assigned work | Real PostgreSQL RLS; synthetic Auth identities and Storage registration rows |
| Supervisor and administrator | Both officers' work is visible; the other organization's work is hidden | Real shipped database policies, not hosted sign-ins |
| Another organization | Guessed case and assignment IDs cannot cross organizations; foreign assignees rejected | SQL/RPC authorization |
| Suspension | Officer and supervisor immediately lose operational reads and RPC mutations; suspended assignee rejected | Membership changed only in the disposable in-memory database |
| Privilege escalation | Browser roles cannot rewrite operational rows, elevate membership or call service-only mutations | SQL grants/RLS/function permissions |
| Review conflicts | Altered replay, changed actor and stale version cannot overwrite original observations or create an extra audit event | Real `review_case` transaction |
| Assignment conflicts | Identical creation retries do not duplicate work; altered replay, stale versions, foreign assignees and invalid/closed transitions rejected | Real assignment functions |
| Atomic failure | Invalid review changes neither review rows, case version nor audit rows | PostgreSQL constraint/transaction rollback |
| Lost seal/review response | Database commits, client receives an injected failure, local store reopens, exact operation retries: one case/review and one audit event | Actual SQL plus actual IndexedDB outbox, with injected transport failure |
| Session expiry / rate limiting / outage | 401, 429 and 503 pause queued work without losing payloads; successful retry drains it in order | Simulated HTTP failure; no real account expired or live outage induced |
| Hosted probe safety | No run without explicit target consent and four distinct tokens; GET only, no redirects, bounded non-cacheable responses, no secrets in output | Unit-tested probe with mock HTTP, not a hosted permissions result |

## Hosted probe prerequisites — currently not completed

An administrator must approve and prepare **four separate accounts**:

1. Officer A in the pilot organization.
2. Officer B in that same organization.
3. A supervisor in that organization, with no membership in the control organization.
4. A member of a different control organization, with no membership in the pilot organization.

Officer A, Officer B and the other-organization member each need an already-sealed test case with one registered original/analysis image pair. Use ordinary, non-sensitive package photos and explicitly label their inspection notes as pilot observations. The tool never creates these records, sends invitations, changes a role, suspends an account or asks for a password. Do not use the sole administrator as a substitute for four different identities.

Use the exact intended managed deployment URL. The existing Vercel staged deployment shares the intended operational database; it is **not** an isolated staging database. Do not perform destructive failure tests against it.

### Private local configuration

Create `.niyamlens-private/team-pilot/config.json` locally. This directory is Git-ignored. Fill these placeholders from the approved fixture cases, not from guessed paths. Each original/analysis pair must be from the same panel; the two officers must have different owner UUIDs.

```json
{
  "origin": "https://EXACT-MANAGED-DEPLOYMENT.vercel.app",
  "storageOrigin": "https://YOUR-PROJECT.supabase.co",
  "workspaces": {
    "primary": "PILOT-WORKSPACE-UUID",
    "other": "CONTROL-WORKSPACE-UUID"
  },
  "cases": {
    "officerA": {
      "id": "OFFICER-A-CASE-ID",
      "originalPath": "PILOT-WORKSPACE-UUID/OFFICER-A-UUID/OFFICER-A-CASE-ID/PANEL-UUID/original-SHA256",
      "analysisPath": "PILOT-WORKSPACE-UUID/OFFICER-A-UUID/OFFICER-A-CASE-ID/PANEL-UUID/analysis-SHA256"
    },
    "officerB": {
      "id": "OFFICER-B-CASE-ID",
      "originalPath": "PILOT-WORKSPACE-UUID/OFFICER-B-UUID/OFFICER-B-CASE-ID/PANEL-UUID/original-SHA256",
      "analysisPath": "PILOT-WORKSPACE-UUID/OFFICER-B-UUID/OFFICER-B-CASE-ID/PANEL-UUID/analysis-SHA256"
    },
    "otherOrg": {
      "id": "CONTROL-CASE-ID",
      "originalPath": "CONTROL-WORKSPACE-UUID/CONTROL-USER-UUID/CONTROL-CASE-ID/PANEL-UUID/original-SHA256",
      "analysisPath": "CONTROL-WORKSPACE-UUID/CONTROL-USER-UUID/CONTROL-CASE-ID/PANEL-UUID/analysis-SHA256"
    }
  }
}
```

An authorized operator must supply each user's current, short-lived Supabase access token via a local secret manager or an ignored `.env` file. Never paste tokens/passwords into chat, terminal commands retained in history, reports, screenshots or Git. The probe does not extract tokens from browser cookies, local storage or profiles, and it does not use the privileged service-role key.

Required environment-variable names:

- `NIYAMLENS_PILOT_OFFICER_A_TOKEN`
- `NIYAMLENS_PILOT_OFFICER_B_TOKEN`
- `NIYAMLENS_PILOT_SUPERVISOR_TOKEN`
- `NIYAMLENS_PILOT_OTHER_ORG_TOKEN`

For example, once secrets are prepared in the ignored `.niyamlens-private/team-pilot/.env` file:

```powershell
node --env-file=.niyamlens-private/team-pilot/.env tools/verify-hosted-permissions.mjs --run --config .niyamlens-private/team-pilot/config.json --allow-origin https://EXACT-MANAGED-DEPLOYMENT.vercel.app
```

`--run` and the exact approved HTTPS origin are mandatory. Trailing paths, query strings, credentials, ports and redirects are rejected. Configuration is restricted to 20,000 actual file bytes and strictly decoded UTF-8 JSON; oversized or malformed input is rejected before any requests. Missing configuration or tokens returns exit **2**, with `blocked: true`; it is not a skipped/passing live test. A performed run returns exit **0** only when all 41 checks pass, or exit **1** for a failed check. Never edit expectations to make a failure pass.

### What the 41 live checks would prove

For each of the four identities, the probe requests each of the three known cases and its two private evidence links: **36 exact case/image authorization checks**, plus **four foreign-workspace denials** and **one unsigned-in denial**. This exercises the current deployed evidence GET path, including its server-side registered-image verification, when run against the latest managed deployment.

It outputs only check labels, HTTP status or sanitized error codes and limitations. It does not print response bodies, identity details, image data, tokens or signed URLs. Evidence links are checked against the exact configured Storage origin and path but **not downloaded**. Evidence GET consumes the normal read quota; no cases, memberships or Storage objects are created or modified. A signed-link issuance check is not the separate image-byte/hash retrieval acceptance gate.

## Remaining hands-on pilot checks

- In separate Chrome profiles/devices, confirm the case **list**, assignment list, evidence report, and supervisor review UI match the account's role. Exact-case API checks are not an exhaustive pagination/list audit.
- On an approved test case, two reviewers start from the same version; one commits, the other must see a conflict while keeping the unsent reason. Reconcile explicitly rather than rewriting the base version blindly.
- On a trusted test device, disconnect internet, seal an ordinary package inspection, reload, then reconnect. Keep the same account/workspace. There must be one receipt after retry, with original/analysis hashes matching the local file. Pending means **not cloud-backed**.
- Interrupt a single file upload. Retry must verify/reuse the exact already-present file or upload the missing one. This is per-file recovery, not byte-level resumable upload. Preserve the original browser data until the receipt is verified.
- Test a genuine expired session and sign in again; the queue and unsent reasons must remain. Do not delete local data to "fix" an expired session.
- With explicit administrator approval and a spare test identity, suspend membership and verify old-token reads, uploads, OCR and mutations fail. Re-enable only according to the approved test plan. The read-only probe deliberately does not automate this live mutation.

Save real probe output and observed browser evidence under `.niyamlens-private/team-pilot/`. Publish only redacted summaries. Passing these checks is a release gate, not legal certification or a promise of OCR accuracy on unseen packages.
