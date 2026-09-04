# Workspace backup verification and isolated restore rehearsal

Implemented 4 September 2026. **This is a local validation lane, not a completed live-project backup or a production restore.** It never reads environment credentials, connects to a service, overwrites a backup, extracts files to supplied paths, or writes a persistent database. A successful result does not unlock the public-release gate by itself.

## Why database backup alone is insufficient

Supabase database backups contain Storage metadata, not the stored image bytes. Supabase recommends regular CLI exports and off-site backups for Free projects; automatic daily backup retention is provided on paid plans. [Supabase database backups](https://supabase.com/docs/guides/platform/backups). Storage objects must be downloaded separately using the Dashboard, CLI or an S3-compatible tool. [Supabase Storage downloads](https://supabase.com/docs/guides/storage/management/download-objects).

NiyamLens case JSON and password-encrypted `secureBundle` files are portable individual-case exports. They are **not** complete workspace backups: they do not reconstruct all memberships, assignments, reviews, registration rows, server audit or Auth. The hydrated case JSON also differs from the stored immutable payload, so its hash cannot be substituted for `cases.payload_hash`.

## Run safely

```powershell
node tools/verify-workspace-backup.mjs --schema-manifest
node tools/verify-workspace-backup.mjs ".niyamlens-private/backups/workspace-snapshot.json"
node --test tests/workspace-backup.test.mjs
```

Place operator snapshots under the Git-ignored `.niyamlens-private/backups/` directory or an approved protected location outside the repository. Git ignore is not encryption or a backup by itself; do not commit or publicly share snapshots.

The verifier emits a redacted JSON summary and artifact SHA-256; it never prints evidence bytes, identities, raw payloads or arbitrary parser errors. Preserve its output with the source backup using your normal protected artifact handling. It performs complete validation first, creates a fresh **in-memory** PostgreSQL instance, applies the repository's actual migrations, stages rows and image byte streams in one transaction, rechecks image hashes and server audit digests in PostgreSQL, and commits only if everything succeeds. It then closes the database. A constraint or audit failure rolls back and confirms no imported table or object rows remain. There is no live-restore switch.

Auth and Storage are explicit fixtures: `auth.users` contains UUID stubs only, and objects are restored into a private local `bytea` table. Real Auth login and the Supabase Storage HTTP service are **not** exercised. This is a restore rehearsal of this application data contract, not a Supabase disaster-recovery rehearsal.

## Version 1 import contract

The input is a UTF-8 JSON file with exactly these top-level fields:

```json
{
  "format": "niyamlens-workspace-backup-v1",
  "schema": [{"name": "migration filename", "sha256": "SHA-256 from --schema-manifest"}],
  "scope": {
    "orgId": "workspace UUID",
    "snapshotAt": "2026-09-04T12:00:00.000000+00:00",
    "consistentSnapshot": true,
    "authUsers": "ids-only",
    "captureMethod": "operator-export"
  },
  "tables": {},
  "objects": [{"path": "exact evidence_objects.path", "base64": "canonical base64 bytes"}]
}
```

`schema` must match the two names, migration order and hashes emitted by the current tool. Object field insertion order is irrelevant. Hashing decodes strict UTF-8, removes an optional leading BOM and changes CRLF line endings to LF before hashing UTF-8; all other SQL text remains material. This makes Windows/Linux Git checkouts compatible without hiding SQL edits. Unsupported schema drift is rejected rather than guessed. A synthetic test uses `captureMethod: "synthetic-fixture"`; its success is reported as such.

All table keys below are required, including empty arrays. Each row must contain exactly the columns listed. **Never include Auth passwords, tokens, email addresses, session tables, keys or arbitrary SQL.**

| Table key | Exact columns |
| --- | --- |
| `auth_users` | `id` only |
| `organizations` | `id`, `name`, `created_at` |
| `memberships` | `org_id`, `user_id`, `role`, `active`, `display_name` |
| `cases` | `org_id`, `id`, `owner_id`, `payload`, `payload_hash`, `version`, `created_at` |
| `case_reviews` | `id`, `org_id`, `case_id`, `actor_id`, `status`, `reason`, `created_at` |
| `evidence_objects` | `path`, `org_id`, `owner_id`, `case_id`, `panel_id`, `kind`, `sha256`, `bytes`, `mime`, `verified_at` |
| `assignments` | `id`, `org_id`, `officer_id`, `creator_id`, `package_ref`, `status`, `version`, `case_id`, `created_at` |
| `server_audit` | `org_id`, `sequence`, `actor_id`, `event`, `details`, `previous_hash`, `hash`, `created_at` |

Every row belongs to exactly one workspace. `auth_users` supplies only IDs referenced by those rows. All timestamps must preserve the database's microseconds as strings; **do not round-trip them through JavaScript `Date`**, which truncates precision and can invalidate server audit hashes. Export timestamps as PostgreSQL `::text` in a UTC session or preserve complete database timestamp strings. The audit hash rehearsal uses UTC, matching the current deployment's database setting; a different historical server timezone requires a separately reviewed contract rather than changing hashes.

`cases.payload` is the raw stored JSONB value. Its canonical SHA-256 must equal `payload_hash`. A review does not mutate this payload: later outcomes are separate `case_reviews` rows, and `cases.version` must equal one plus the number of case reviews. Do not export a UI-merged record in its place. The complete server audit sequence must start at `GENESIS`, remain contiguous, hash correctly and include each case's seal/hash receipt.

Every registration row requires exactly one object entry. Both original and analysis images for every case panel are mandatory. Registered uploads not yet attached to a sealed case are preserved and counted separately. Unregistered bucket objects are excluded from this contract and must be inventoried separately for a full service backup. No object path is ever used as a local filesystem path.

Bounds: 96 MiB JSON file; 5,000 rows per table; 1,024 objects; 15 MiB per image; 64 MiB total decoded image bytes; static JPEG/PNG/WebP images, at most 25 million pixels. Larger backups require a reviewed streaming contract, not disabling these limits.

## Operator collection procedure — still required for the live project

1. Identify the exact source project/workspace, record the source schema version and establish a maintenance window that stops new case, upload, review, assignment and membership mutations. Confirm all already-running writes have settled. Avoid announcing a consistent snapshot while writes are still in flight.
2. Have the authorized project operator export the listed application tables in **one read-only repeatable-read database transaction**, filtered to that workspace. Export only the referenced Auth UUIDs into `auth_users`; do not export Auth credentials to this file. Preserve timestamp precision and raw case payloads. A sequence of ordinary paginated REST reads while the workspace changes is not a consistent database snapshot.
3. Download the original bytes for every captured `evidence_objects.path` from the private `evidence` bucket using approved operator access. Never make the bucket public. Keep the captured registration metadata, MIME, byte length and SHA-256 with the corresponding bytes. Do not fetch transformed/thumbnails or re-encode evidence. Inspect the Storage inventory separately for uploads that have not reached registration.
4. While writes remain paused, reconcile registered object count, complete download count, case/review/assignment counts and the last server audit sequence. Assemble the documented JSON in an encrypted, access-controlled backup location outside Git; set `consistentSnapshot: true` only after the operator establishes it. That field is an operator assertion, not independent proof supplied by this tool.
5. Run the tool above. Preserve its SHA-256 summary, snapshot time, operator identity and observed counts in the restricted operations log; keep personal identities out of public team reports. Copy the protected snapshot to approved off-site storage and confirm the copied bytes' hash. The JSON itself is not encrypted; use the organization's protected backup storage and key-management procedure, not a plaintext cloud share.
6. Separately back up and plan recovery for Auth, configuration, SMTP, secrets, policies, bucket settings and excluded schemas using Supabase's documented operator process. Do not substitute UUID stubs for a real Auth recovery. Supabase's project clone is database-only and needs manual Storage/settings reconfiguration. [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).
7. A real disaster-recovery acceptance test must use a **different, explicitly approved disposable Supabase project**, restore Auth/database plus original objects, configure its server-only secrets privately, sign in with authorized test identities and retrieve a case through the current application. This tool intentionally cannot perform that step. **Never reset or restore the current evidence-bearing project for a test.**

## Release status

Automated fixture tests cover original/analysis round-trip, immutable payload versus later review/version state, migration drift, missing objects, tampered bytes, fake images, missing Auth references, cross-workspace rows, unsupported columns, traversal/URL paths, SQL rollback and audit tampering. Live consistent snapshot capture, off-site copy verification, service-level restore, recovery time and backup scheduling remain pending. No backup schedule, retention guarantee, successful live restore, or independently authentic audit has been claimed.
