# NiyamLens 0.4.4 — team pilot and release gates

Prepared 4 September 2026. This release implements tools and safeguards for the five next steps: team permissions, fresh cloud retrieval, unfamiliar-label evaluation, failure recovery, and backup restoration. **Implementation is not the same as a completed hosted/field pilot.** The public release must remain gated until real evidence closes the remaining checks.

## 1. Verify an actual cloud copy in Chrome

On the new managed release, sign in and open **Inspection history → Verify cloud copy** on a synchronized case.

The action requests a fresh case/receipt from the current origin, then requests the original and analysis images for every panel through that origin's current evidence API. It bypasses local image bytes without deleting or rewriting them. Each download is size/MIME bounded and its SHA-256 must match the registered original digest or analysis-path digest. A missing, denied, expired or corrupt object fails the operation: cached bytes cannot silently substitute for failed cloud retrieval.

During the operation, **Cancel evidence check** cancels only this report request, not background synchronization. A later response cannot replace a newer report. After all checks complete, **Fresh cloud copy checked** displays the current server version, number of image objects and check time. This is a transient browser check, not legal certification or an independently signed receipt. Normal **Open evidence** still supports already-cached evidence and does not display the fresh-cloud badge.

This action is disabled for unsynchronized/pending-review cases. It does not overwrite a local draft or unsent review. Save a JSON report from the freshly opened report if a portable artifact is needed, and use `tools/verify-cloud-export.mjs` to check the named saved file independently.

## 2. Validate team permissions and recovery

```powershell
npm run qa:pilot
```

This runs the actual shipped SQL/RLS with disposable PostgreSQL identities, the actual IndexedDB outbox with injected failures, and the cloud-client/probe regressions. It covers two officers, a supervisor/administrator, a different organization, suspended membership, forbidden direct writes, stale review/assignment versions, atomic rollback, lost server acknowledgements, and transient session/rate-limit/service failures. These are executable isolated tests, not real Supabase sign-ins or deliberate production outages.

For hosted acceptance, use [TEAM_PILOT_ACCEPTANCE.md](TEAM_PILOT_ACCEPTANCE.md). The opt-in probe performs 41 read-only authorization checks on prepared real accounts and cases; missing prerequisites fail closed. It never provisions accounts or uses a browser's private token storage. Four approved identities and three already-sealed test cases are needed for the full isolation matrix. Ordinary UI checks must also cover lists, assignments, and supervisor review/conflict handling.

**Do not use the sole administrator as a substitute for multiple roles.** Do not invite guessed email addresses, change real roles, or suspend the owner to manufacture a test. The owner must identify the teammates and approve any disposable control organization/accounts.

## 3. Evaluate new label photos without hiding corrections

```powershell
npm run field:pilot -- --help
npm run qa:field-pilot
```

The new `field-pilot` workflow imports and hashes local originals, excludes recorded development images/SKUs, requires a 20–30-product sampling plan and independent reference labels, freezes the manifest before OCR, records raw runs and hashes, and scores each pre-registered OCR mode. Read [FIELD_PILOT_RUNBOOK.md](FIELD_PILOT_RUNBOOK.md) alongside the command help for the exact intake/review/run schemas. Photos in a separate approved Desktop folder use `--photo-root`; the repository's historical exclusion inventory remains separate.

Raw OCR and officer-corrected working text are scored separately. Missing runs, unreadable references, corrected fields, review observations, and elapsed review time remain explicit. Corrections cannot be counted as raw OCR success. The first pilot measures MRP, net quantity and packing date through the existing critical-field extractor; it does not establish every declaration, typography or legal rule's accuracy.

No new photos or reference answers are invented by this release. Collect fresh SKU-disjoint photos, including difficult lighting, curved packs, small type and regional scripts. Two people independently label the physical/photo evidence before consulting OCR; a third resolves disagreements. Once pilot results influence tuning, retire that dataset to development and collect a new one. Team attestations and checksums do not prove independent human identity or unseen model-training exposure.

For an explicitly authorized public-image collection, `npm run field:download -- --output ABSOLUTE-NEW-FOLDER --count 30 --download` acquires bounded, original Open Food Facts images with source attribution, licenses, checksums and a complete attempt/skip log. It refuses an existing output folder and never downloads existing OCR answers. The unfilled human-review intake is not a validated holdout. The separate `npm run field:smoke -- --help` tool can run at most six selected photos through local Node Tesseract, preserving raw output without repairs or an accuracy score. It does not substitute for the complete browser pipeline. Any smoke-tested SKU/hash must be entered in a `datasets/field-smoke-*.json` development exclusion marker before the later human-labelled pilot.

## 4. Rehearse backup restoration safely

```powershell
npm run qa:backup
npm run backup:verify -- --schema-manifest
npm run backup:verify -- .niyamlens-private/backups/workspace-snapshot.json
```

See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the exact snapshot contract and operator collection procedure. The verifier requires matching schema, table relationships, immutable payload hashes, complete registered original/analysis bytes and an internally consistent server audit. It applies the real migrations to a new in-memory PostgreSQL instance and restores rows plus image bytes in a transaction. Validation, constraint or audit failure cannot leave a partial restored dataset.

It deliberately has no live-restore switch. Auth UUID stubs and a byte-stream table are not restored Supabase logins or the real Storage service. A portable case JSON is not a full workspace backup. The live gate still needs a consistent operator export, protected off-site copy, and a service-level recovery test in a **separately approved disposable project**. Never reset the evidence-bearing project for a rehearsal.

## 5. Stage first; promote only after observed acceptance

The release checklist is:

- Automated application/probe/restore tests, five audit-gate tests, build and OCR asset hashes pass.
- Managed staging health and unsigned-in denials pass; hosted build reports managed configuration.
- A real owner/teammate signs into the exact new origin and **Verify cloud copy** succeeds there.
- The real multi-user/other-organization matrix and hands-on offline/review checks pass.
- The new-photo pilot and backup/service-restore evidence are reviewed; remaining limitations have an explicit owner.
- Auth Site URL/allowed recovery redirects are set for the final public domain; then promote and repeat public-domain smoke checks.

No skipped test is promoted to a pass. Local-only GitHub Preview configuration is not a cloud-ready build. Keep the last known public deployment in place if any release-critical gate fails. Roll back application hosting only; do not reset the shared database as application rollback.

## Private artifacts and team handoff

Use `.niyamlens-private/team-pilot/`, `.niyamlens-private/field-pilot/` and `.niyamlens-private/backups/` for local identities/configuration, photos/labels, observations and snapshots. The whole directory is Git-ignored. It is **not encrypted automatically**: use a trusted encrypted device and approved protected/off-site storage. Never commit credentials, complete cloud evidence bundles or a plaintext workspace backup. Commit redacted test summaries and operator instructions instead.

Prior live evidence remains recorded in [the 0.4.3 cloud acceptance report](../reports/fix-gaps-2026-09-04/CLOUD-ACCEPTANCE.md). It is not retroactive proof of this release's fresh-cloud action or multi-user pilot.
