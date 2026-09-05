# OCR and field-validation follow-up — 5 September 2026

Later checkpoint: [AI review, clipped-date fix and fresh Chrome results](AI_REVIEW_AND_OCR_FOLLOWUP_2026-09-05.md). Historical results below are retained; they are not overwritten with later measurements.

This follows [the earlier readiness checkpoint](READINESS_IMPLEMENTATION_2026-09-05.md). It separates engineering work, developer-assisted recognition, actual hosted infrastructure tests, and human evidence. No SIH result, general OCR accuracy, legal approval, or completed human study is claimed.

## Arif and Tharun: ready to start, not recorded as complete

- **Arif — Reviewer A:** `NiyamLens_Arif_Reviewer_A_2026-09-05.zip` in the parent SIH 2026 directory.
- **Tharun — Reviewer B:** `NiyamLens_Tharun_Reviewer_B_2026-09-05.zip` in the same directory.
- Each private bundle contains the complete verified v2 kit and only that person's named handoff. Extract first, open `review.html`, choose the assigned A/B slot, label all 24 photos independently, and export the original JSON.
- Both bundled HTML files were byte-hash checked against the verified kit: `6625a5dcc67f61a167e15b47fd4133c1982b22f6bd97f244abbd5b8fa3c5f2c2`.
- No reviewer answers, identity attestations, or completion times were filled by the assistant. No emails, invitations, cloud uploads, or public sharing were sent. The 24 reserved photos have not been opened for recognition or tuned against during this work.
- Return the two original exports privately. Do not compare answers beforehand. Different names alone do not establish independence.

Bundle SHA-256:

| Bundle | SHA-256 |
|---|---|
| Arif A | `242a35d63a84f07f103b79196552978da67ff0fd776fe2f618e6c22d25f97919` |
| Tharun B | `75e5e37dcde1d1abeda24a66062d3ea353e979a54cdb6f26b6fe0ce8b988b04b` |

The [evidence importer](REVIEW_EVIDENCE_IMPORT.md) validates exact photo/selection hashes, distinct reviewer codes, all 24 rows, readable-value formats, chronology and attestations. It generates a value-blinded third-review request when A/B disagree. Merge requires genuinely completed lead metadata, preserves originals by hash, and produces a **draft**, never an automatic freeze or score. Its tests use clearly synthetic review data only.

The coordinator's `NiyamLens_Field_Review_Coordinator_2026-09-05/LEAD-WORKING-v1.json` remains intentionally unfilled. Public-source photographs do not establish physical millimetres, complete-package absence, original capture time or prior model exposure.

## OCR changes

1. Added conservative heading-above-value proposals, alongside the existing same-row proposals. They require complete literal values and bounded, unambiguous source geometry. Invalid units, competing values/columns, rotated text and reused fragments are withheld. No digits or units are repaired.
2. Added source close-ups, highlighted heading/value fragments, optional full-frame viewing, and a current/raw/selected critical-field comparison. These are candidate readings, not checked answers or accuracy scores.
3. Fixed a false-conflict bug: previously, appending both a broken raw reading and its selected joined row could create conflicting candidates from the same observation. A selected fragment now appears **once** in the new derived working observation. Every unrelated source fragment is retained; earlier observations and genuine disagreements remain intact.
4. Original raw text and OCR pass history stay unchanged and separate from derived working text. Selecting a layout proposal never confirms a declaration or physical measurement. Raw and derived source mappings are auditable.
5. Fixed a second provenance defect: the source close-up could fall back to the analysis derivative when Paddle had actually read the original-resolution canvas. It now displays a lossless PNG of the exact canvas sent to recognition, including focused scans. Both possible source URLs and transform state are bound at run time and rechecked at append; changed sources are rejected.

### Known-photo development result, not a blind accuracy estimate

Actual Chrome upload, local Paddle recognition, proposal selection and append were exercised on **all eight previously used difficult development photos**. Four available proposals were selected by the automated acceptance script; this is not represented as a human inspecting or attesting to them. The ten eligible positive references are provisional development labels, not the independent 24-photo set.

| Pipeline / acceptance policy | MRP | Net quantity | Pack/manufacture date | Total |
|---|---:|---:|---:|---:|
| Unchanged raw Paddle extraction | 1/3 | 0/5 | 0/2 | **1/10** |
| Derived working text with all available mapped proposals selected by the test | 1/3 | 3/5 | 1/2 | **5/10** |

Five fields remain unresolved. All eight photos remain in the record. No text was typed to obtain the derived result. This improvement is **field association with explicit review**, not an OCR-model accuracy improvement. Do not call 5/10 a market accuracy rate or a blind score. Shared-machine run durations are not human workflow timings or isolated performance benchmarks.

Final actual-UI artifact: `reports/readiness-2026-09-05/paddle-review-browser-2026-09-05T06-09-32-588Z.json`, against `index-BxSPiyKO.js`. All eight raw transcripts exactly match the pre-preview-fix baseline. For all four displayed proposals, the decoded preview image's RGBA SHA-256 and dimensions match the actual Paddle worker input. The runner observed but did not alter recognition input. It confirmed persisted derived text, preserved original image/raw-history hashes, and no declaration or physical-measurement confirmations. No page errors or non-local requests occurred. Desktop/mobile source close-ups were also visually inspected.

## Hosted testing and discovered upload defect

Official Supabase CLI login was restored. Hosted testing uses four clearly synthetic password accounts, two uniquely marked organizations, and generated synthetic evidence. It does not reuse one person as four roles or change real teammates' passwords, roles, email settings or memberships. Test credentials and cleanup targets remain in the ignored private pilot directory, not public reports.

The public deployment was independently identified as **RC5**, while the local candidate is **RC6**. Hosted RC5 results do not certify unshipped RC6 code.

A real failure was reproduced: a signed PUT succeeded, but retrying `prepare` before `verify` returned 503 because an unregistered storage object already existed. The failed result is retained. An explicit verification intervention allowed the remaining RC5 tests to continue; that is not an automatic-recovery pass.

The local fix recovers a failed non-upserting upload preparation only after downloading the exact caller-owned object, checking its byte count and SHA-256, and fully decoding the image before registration. It never enables overwriting or treats a storage conflict as proof of success. Missing/unavailable objects remain retryable; corrupt or mismatched bytes cannot be registered. Regression tests cover recovery, repeat idempotency, wrong hash, corrupt bytes, missing storage, provider outage, and normal first-time preparation.

Hosted authorization checks passed **41/41**, signed-download hashes **6/6**, and list scopes **4/4**, after the explicitly recorded recovery intervention. All three synthetic cases received idempotent seal receipts. This is real hosted infrastructure evidence, not mock accounts or a human acceptance study.

A separate stale-review test produced a 500 response instead of a prompt conflict. A direct stale RPC later timed out with 504. The deployed provider identifies as PostgREST 14.5. The likely cause is the use of serialization-failure SQLSTATE `40001` for non-retryable business conflicts: PostgREST's primary changelog documents a related automatic-retry fix under 16.0. This remains a supported causal inference, not a server trace proving every retry. See the [PostgREST changelog](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md#160---2026-08-07).

A local forward migration, `supabase/migrations/202609050001_business_conflict_http_409.sql`, now uses the explicitly HTTP-mapped `PT409` for application conflicts in case sealing, reviews and assignments, preserving genuine database serialization errors separately. This follows PostgREST's [custom SQLSTATE documentation](https://docs.postgrest.org/en/v14/references/errors.html). Local PostgreSQL tests verify stale/altered conflicts leave records and audit counts unchanged, exact retries remain idempotent, and security/grants remain intact. It was **not** applied live; the production defect remains open until a controlled migration and hosted retest.

The fixed local upload handler also passed **3/3 against real Supabase Auth/Storage**: initial upload remained unregistered, repeat preparation verified and registered it, and another repeat remained idempotent with exactly one registration. This validates the candidate handler with live providers, not the unchanged production endpoint. Five additional hosted assignment/revocation checks passed, including denial of old tokens after membership suspension and exact restoration of only the test memberships.

See the [sanitized hosted results](../reports/readiness-2026-09-05/HOSTED_SYNTHETIC_ACCEPTANCE.md) for recorded failures, checks and candidate source hashes. No production deployment or live schema migration was performed in this follow-up.

### Migration and backup rollout boundary

The backup rehearsal now knows the new third migration. Exact historical two-migration backups remain restorable **as historical schemas**, with the unapplied forward migration explicitly listed; their hashes and function bodies are not silently rewritten. Tests verify both historical and current isolated restores. This is not a new real-cloud backup or a live restore.

For a later authorized rollout, deploy the API compatibility mapper (which accepts both legacy `40001` and `PT409`) before applying the forward database migration; retain a verified backup and inspect the exact live function definitions first. Then rerun the known failed upload and stale-review cases against the deployed release. Do not relabel earlier RC5 acceptance as RC6 success, and do not edit old backup schema hashes to force acceptance.

## Remaining real-human gates

| Gate | What is ready | What is still missing |
|---|---|---|
| Independent photo labels | Two private named kits; guarded importer and frozen-pilot runner | Arif's and Tharun's actual original exports, researched lead metadata, third-person adjudication if needed, then freeze before OCR |
| Complete-inspection timing | [Paired protocol](BLIND_PILOT_AND_TIME_STUDY.md), blank trial file and scorer | Real participants, physical packages, all stages and failed attempts, independent report-quality checks |
| Domain review | [Qualified-review packet](DOMAIN_REVIEW_PACKET.md) with intentionally blank findings/signature | An identified qualified practitioner and their actual adjudication of scope, rules, reports and measurement |
| Human hosted acceptance | Real infrastructure tests using isolated synthetic identities | Real teammate use, browser/device workflow, offline recovery and an independently observed cross-device retrieval |

The assistant cannot supply people's independent answers, physical observations, timings or professional signatures. Passing automated tests does not close these gates.

## Final verification checkpoint

- Full regression suite: **589 passed, 0 failed** after the OCR, upload, conflict-migration, historical/current backup changes and two final report-redaction tests. The final complete run used `node --test --test-reporter=dot tests/*.test.mjs` and exited successfully; the earlier standard reporter showed 587/587 before those two tests were added.
- `npm run build`: passed, local-only candidate `index-BxSPiyKO.js`. Existing large optional OCR/OpenCV bundle warnings remain; this was not a cloud-enabled deployment.
- Final-build Chrome `qa:ui` and `qa:functional`: passed, no page errors; capture-guidance regression also passed. Synthetic fixtures here are not field-accuracy observations.
- Actual eight-photo Paddle/UI test: all eight retained, unchanged raw transcripts, four exact source-pixel matches, derived extraction 5/10 under the explicit automated selection policy described above.
- Fresh hosted Chrome checks on RC5: **4/4 roles** signed in, saw only their authorized case lists and role controls, retrieved fresh records/evidence and signed out. Eight retrieved image copies matched the registered hashes and their synthetic source bytes. Public RC5 still uses full list records; this does not exercise the local RC6 compact-list hydration path.
- Strict audit-export verification correctly rejected the three API-created fixtures, which intentionally have no client audit trail. The verifier was not relaxed and no missing audit history was invented. These results are scoped to role/read/retrieval integrity; see `reports/readiness-2026-09-05/hosted-synthetic-browser-2026-09-05T06-22-32-951Z.json`.
- One additional **actual-browser-created synthetic case passed the complete hosted path**: upload, real standard browser OCR, one finalize, original/analysis verification, cloud seal, fresh-context sign-in/retrieval, and strict portable JSON verification. No OCR text corrections, field confirmations or physical measurements were supplied. There were no page errors or blocked mutations; the saved browser had no remaining draft or queued changes. Unlike the API-only fixtures, this case has the real UI-generated audit chain. See `reports/readiness-2026-09-05/hosted-browser-seal-2026-09-05T06-30-19-965Z.json`. It proves one synthetic RC5 workflow, not unseen-package accuracy or human timing.
- **All four exact synthetic memberships were disabled and independently verified inactive after Chrome finished.** Four test accounts, two organizations, four sealed cases, eight sealed image objects and one additional recovery-test image are retained for inspection. Nothing was deleted and no human account was changed. The additional browser-created case was independently checked against hosted owner/org, source-image hash, both registrations and its six UI audit events.
- `git diff --check`: passed. Changes are local; no commit, push, production deployment or live database migration was performed in this follow-up. The existing service on port 5173 was not stopped; only the isolated test preview on 4191 was closed.
