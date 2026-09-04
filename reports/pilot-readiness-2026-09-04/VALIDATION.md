# NiyamLens 0.4.4 — implementation and observed validation

4 September 2026. This is an implementation/test checkpoint, not an SIH-winning guarantee, regulatory certification, finished field pilot or production sign-off.

**Superseded for current deployment status:** see [the 5 September public-cutover report](../public-release-2026-09-05/VALIDATION.md). The observations below are retained as historical pre-promotion evidence.

## Implemented

- **Verify cloud copy**: explicitly fetches fresh current-origin server metadata and every original/analysis image, validates receipt shape and image hashes, and refuses cached fallback. Request-specific cancellation leaves synchronization and local evidence intact. A transient check banner is separate from the sealed receipt.
- Team/organization permission and offline-recovery regressions, plus an explicitly enabled, GET-only hosted permission probe. Real test identities are not fabricated.
- A 20–30-product field-pilot workflow with historical SKU/hash exclusions, independent reference/adjudication records, a frozen manifest, pre-registered modes, unedited raw outputs, separate correction metrics and explicit missing denominators.
- An isolated backup importer/restoration verifier using the actual migrations and PostgreSQL audit computation. It verifies rows, relationships and both original/analysis bytes, with complete transaction rollback. It cannot reset the live service.
- An attributed, bounded public-photo downloader and six-photo local OCR smoke tool. Private inputs/outputs are excluded from Git and Vercel uploads.

Operator instructions: [pilot readiness](../../docs/PILOT_READINESS.md), [team acceptance](../../docs/TEAM_PILOT_ACCEPTANCE.md), [field pilot](../../docs/FIELD_PILOT_RUNBOOK.md), [OCR smoke](../../docs/FIELD_OCR_SMOKE.md), [backup restoration](../../docs/BACKUP_RESTORE.md).

## Public-photo acquisition and actual OCR

The owner authorized downloading public photos into a separate Desktop/SIH folder. Successful collection:

`C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02/`

- 30 distinct-SKU source photographs, 36,070,949 image bytes, unchanged by this downloader. SHA-256 and full JPEG decoding were checked during acquisition; a separate post-run disk check matched all 30 file lengths and hashes.
- Successful manifest SHA-256: `262dd6a85e4acd678ec7faaf1a9e2fbf0330d5751ac3315eb18377bbbd415a08`.
- One catalogue request and 45 image attempts: 30 saved, 14 source/mirror 404s and one dimension/format rejection. The complete attempt/skip log remains in the manifest. No existing OCR answer files were fetched.
- A preceding zero-image attempt at the non-suffixed folder returned HTTP 503. Its failure log remains; nothing was overwritten or deleted.
- Open Food Facts contributors supply the photos. Per-image uploader/source/product links and CC BY-SA 3.0 image/ODbL database attribution are retained. See [the official license guide](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/).

Selection was recorded **before OCR**: first six in acquisition order for exploratory development; remaining 24 reserved, unrun candidates for independent human labelling. Those six SKU/hash pairs are now automatically excluded from later pilots by `datasets/field-smoke-2026-09-04.json`. The 24 are not a validated holdout: human metadata review, legal-scope/sampling decisions and independent reference annotations are still absent. Country tags and upload timestamps do not prove Indian-market applicability or camera capture time. Model pretraining exposure is unknown.

Actual run: installed Node Tesseract.js/core 7.0.0, local English LSTM model, AUTO segmentation, unchanged full-original bytes, no crops/preprocessing or manual text repair, one pass per selected photo. This is **not the complete browser Paddle/preprocessing pipeline**.

| Sample | Raw characters | Elapsed seconds | Critical-field output (not ground truth) |
| --- | ---: | ---: | --- |
| PUBLIC-001 | 489 | 1.03 | No MRP, quantity or packing-date suggestion |
| PUBLIC-002 | 611 | 1.33 | Invalid quantity suggestion; no MRP/packing-date suggestion |
| PUBLIC-003 | 1,336 | 1.74 | No critical-field suggestion |
| PUBLIC-004 | 230 | 1.24 | Invalid quantity suggestion; no MRP/packing-date suggestion |
| PUBLIC-005 | 811 | 1.76 | No critical-field suggestion |
| PUBLIC-006 | 787 | 5.57 | Format-valid MRP suggestion; no quantity/packing-date suggestion |

All six recognition processes completed, but **process completion is not recognition accuracy**. The raw outputs expose missed/invalid fields. No correctness percentage was calculated; the MRP suggestion is not independently verified. Some source views omit relevant declarations, so missing extraction is not automatically a recognition error or a package violation. Latency includes validation and fresh worker initialization.

Raw output is preserved in the Desktop folder as `exploratory-ocr-raw-v1.json`, SHA-256 `82bd8f0c1cd6422cc030b5d43a341d13be2a60e9ddf09723c217d74a4f0aad94`. It was not committed or uploaded to hosting. `human-review-intake.template.json` deliberately has unfilled metadata/labels; do not import it as completed ground truth or show raw outputs to the independent reference annotators.

## Automated/local checks

- Final full application suite passed **475/475**, with zero skipped/cancelled tests. A sandbox-only attempt could not spawn Node workers; the allowed rerun executed the tests successfully. An earlier run passed 472/472 before the three final child-lifecycle regression tests were added.
- Separate audit-gate tests passed 5/5 after an allowed retry for a sandbox worker-spawn denial.
- Production dependency audit returned a complete report with zero findings on this run. This is a point-in-time package audit, not a security guarantee.
- Local 0.4.4 build passed. It explicitly reports local-only configuration, not a configured managed/cloud build. Existing large optional OCR chunks/OpenCV externalization warnings remain.
- Source and built OCR asset gates each passed 17/17, 68,186,300 bytes, zero network requests. Asset integrity is not OCR accuracy.
- Chrome at `http://127.0.0.1:5181/`: controlled fixture could be finalized locally, opened from history, rendered, and closed without the cloud-check badge. This checks local regression only; it is not a real-photo or cloud acceptance result.

## GitHub and managed staging

Application/test commit `7b4e00e30f837bbd59075e732cdb96bd00b6f306` was pushed to `codex/managed-cloud-release`. [GitHub verification run 33890421240](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33890421240) completed successfully: application tests, audit-gate tests, build, source/build OCR asset verification and production dependency audit.

Managed stage: <https://niyamlens-sih26034-bqda9qfmx-duvvurudeepakreddy18s-projects.vercel.app/>. Deployment `dpl_87dvmg6us3ZqfYj4mohJMrheJDpw` is READY, version 0.4.4 / RC5 / service-worker cache v12. The remote build explicitly passed the **production managed mode** configuration gate. It used the existing configured project; no environment secret values were inspected or copied.

Read-only deployed checks on the new origin:

| Route | Observed result without an application session |
| --- | --- |
| `/api/health` | 200, `ready: true` |
| `/api/cases` | 401, sign-in required |
| `/api/evidence` | 401, sign-in required |
| `/api/assignments` | 401, sign-in required |

All four responses included `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Vercel's authorized deployment transport was used without a NiyamLens session; these checks do not establish cross-role authorization or private Storage retrieval. Chrome initially rendered the new secure-workspace sign-in screen. The subsequent authenticated fresh-cloud check below closes the one-owner retrieval gate.

The new exact HTTPS origin was added to the existing Supabase redirect allowlist and read back; there are now two exact stage URLs, no new wildcard. The existing default Site URL and older allowed origin were preserved. No reset email was sent. This narrowly permits explicit new-stage recovery redirects; final public-domain Auth configuration remains a separate gate.

Deployment used `--prod --skip-domain` to obtain managed configuration without promoting the public site. The public URL <https://niyamlens-sih26034.vercel.app/> was independently inspected afterward and still points to `dpl_HuQQppi67JvjrsfQ7xjmtMqNvnFU`, not this release. Generated Vercel team aliases are not a public-domain acceptance result.

## Authenticated fresh-cloud acceptance — 4 September, 21:23 IST

After the owner signed in privately, Chrome on the exact `bqda9qfmx` stage displayed the administrator role and **Authenticated workspace · server-verified permissions**, with one case and zero queued changes. No password, session token or browser storage was inspected or transferred.

Observed sequence: **Inspection history → Verify cloud copy** on case `NLM-20260904-eccae07d-8675-4cb1-805e-b843ccaa907e` (Amul). The in-progress status explicitly said it was fetching server metadata and hash-checking original/analysis images with no cached fallback. It completed with:

> Fresh cloud copy checked — Server version 1 · 2 original/analysis images downloaded and SHA-256 checked · 4 Sept 2026, 9:23 pm.

The report identified the intended case and visibly rendered `6.jpg`, labelled **Package evidence panel 1**, original digest prefix `9d2187d0603d878181…`. Its server receipt remained version 1, received 4 September at 20:09 IST, payload hash `c1989169252434d695e1e1cff853fef2a2ece6c46018facb2e3e3b5fc1ee6e7a`. The existing two raw Paddle readings and separately selected working reading remained in the report. The verdict remained **MANUAL REVIEW** and the outbox returned to zero queued changes. No new case, OCR pass, correction, review, upload or server mutation was submitted by this check.

Independent read-only code review found no success path that bypasses the fresh metadata request or both registered image digests. The 15 cloud-client tests passed again. The UI badge is created only after `openRecord(source: 'cloud')` completes and current-user/request cancellation checks pass. Unlike the older-origin acceptance, this action exercised the latest origin's hardened evidence GET path and explicitly bypassed local image bytes; no browser cache/database was erased to manufacture the result.

This is a live **one-administrator, one-case private retrieval** acceptance. The receipt's payload hash is shape-checked and displayed, not recomputed from the hydrated report or independently authenticated. Fresh means newly requested, not necessarily a newer server version. This does not establish multi-user isolation, clean-device recovery, export/save round-trip, complete backup restoration, OCR accuracy, physical authenticity or statutory compliance. No public-domain promotion was performed.

## Team-account preparation — 4 September

The owner supplied four distinct email addresses for two primary-workspace officers, one primary-workspace supervisor, and a control-workspace officer. Their mapping is stored only in the Git/hosting-ignored local roster; the addresses are omitted from this shareable report. No account, invitation, workspace, membership or password was created or changed during preflight.

During initial preflight, the live Supabase **Authentication → Emails → SMTP Settings** page showed **Enable custom SMTP** switched off. The [official SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp) states that the default sender restricts delivery to project-team addresses and currently limits sending to two messages per hour. The later saved custom-SMTP configuration is recorded below; actual invitation/recovery delivery still needs testing. Do not grant infrastructure dashboard access to app test users to bypass delivery restrictions. No send failure or successful delivery is claimed because no invitation was attempted.

After email delivery and account creation are approved, verify exact existing Auth/workspace UUIDs before adding memberships. Keep the owner's primary administrator membership unchanged. The safe control-workspace plan uses the owner as its first administrator, then grants the fourth test identity only an officer membership there. Keep the supervisor out of the control workspace and the control officer out of the primary workspace. Provision sequentially; existing membership roles/suspension are never overwritten automatically.

## Real gates not yet closed

Email setup follow-up: selected Brevo Free transactional SMTP as a temporary pilot route. The owner privately created/entered its key and saved. Chrome verified persisted enabled SMTP and the non-secret provider settings without exposing credentials. Following explicit approval, the default Site URL was changed from the older `ojawbw6dc` stage to the latest `bqda9qfmx` root, saved, reloaded and read back; both redirect-allowlist entries and the public alias remained unchanged.

The first recipient's exact-email search, committed with Enter, settled with no matching Auth users. The first invitation attempt returned `POST /invite`, HTTP 500, `525 "5.7.1 Unauthorized IP address"` on 4 September at 23:27:39. Brevo showed SMTP IP blocking active, API IP blocking inactive, zero authorized addresses and one blocked Amazon address (`3.25.0.105`) at 23:28.

After fresh owner approval, only that address was authorized. Read-back showed one authorized address, zero unauthorized addresses, SMTP blocking still active and API blocking still inactive. A new exact-recipient lookup remained empty; exactly one retry then succeeded. Supabase displayed `Sent invite email`, created the intended Auth identity as **Waiting for verification**, and logged `POST /invite`, HTTP 200, `user invited: request completed`, at 23:38:25. Its exact Auth UUID remains only in the private ignored roster. This is accepted sending/account creation, not proof of inbox arrival, unchanged-link behavior or successful sign-in. No other recipient was invited.

A subsequent read-only database invariant check returned one row: primary workspace `fec1146e-67d3-4cac-94e9-cf624fefa41e` (`NiyamLens team`), one matching active owner-admin, one matching invited Auth identity and zero memberships for that recipient. After separate action-time approval, a serializable, table-locked transaction rechecked exact-name/canonical-name uniqueness, expected workspace UUID, both Auth UUIDs, the owner's sole active-admin row and the recipient's global zero-membership state. It inserted one active `officer` row without upsert. The returned row showed the intended workspace/recipient, `officer`, `active=true` and a non-empty display name. An independent postcondition query then returned owner active-admin `1`, recipient active-officer `1`, recipient membership total `1`. No other membership or owner access changed.

[The setup runbook](../../docs/TEAM_EMAIL_SETUP.md) records both attempts, the narrow IP authorization and remaining acceptance gates. Brevo's shared API/SMTP allowlist has security side effects; do not disable protection or widen access automatically. Inbox delivery, unchanged-link behavior, recipient acceptance and role isolation remain unverified. The tracking page exposed only anonymization, not a verified no-rewrite control, and was left unchanged. No full email-delivery acceptance or production sign-off is claimed.

1. Approved distinct officer/supervisor/other-organization identities and cases, hosted permission matrix, real concurrent review/assignment and browser offline/retry checks.
2. Two independent humans' reference labels for the 24 remaining candidates (plus sampling/coverage review); then frozen full-browser pilot results.
3. Consistent real database/object export, protected off-site copy and service-level restore in a separately approved disposable project. In-memory tests do not restore Supabase Auth or Storage.
4. Native Word save/read-back acceptance, final public-domain Auth configuration and deliberate public promotion only after acceptance.

No teammate identity, recipient delivery or acceptance was fabricated. The failed first attempt, successful retry, saved Auth settings and one approved Officer membership are recorded above. No other role grant, live schema edit, recovery email or live backup restore was used to bypass the remaining gates. The existing public alias is not to be promoted automatically.
