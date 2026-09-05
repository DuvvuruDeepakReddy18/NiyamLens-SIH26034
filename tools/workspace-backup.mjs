// Offline only. No network, environment secrets, disk database, SQL supplied by
// the bundle, or extraction to bundle-controlled paths is supported.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import sharp from 'sharp'
import { hashPayload } from '../server/caseService.mjs'

export const BACKUP_FORMAT = 'niyamlens-workspace-backup-v1'
export const BACKUP_LIMITS = Object.freeze({ fileBytes: 96 * 1024 * 1024, imageBytes: 15 * 1024 * 1024, totalImageBytes: 64 * 1024 * 1024, rowsPerTable: 5000, objects: 1024 })
export const MIGRATIONS = Object.freeze(['202609040001_workspaces.sql', '202609040002_assignment_transactions.sql', '202609050001_business_conflict_http_409.sql'])
// Keep the exact previously supported schema restorable. A historical backup
// must not silently acquire new function bodies or be relabelled as current.
const supportedMigrationNames = names => Array.isArray(names) && [2, 3].includes(names.length) && names.every((name, index) => name === MIGRATIONS[index])
export const COLUMNS = Object.freeze({
  auth_users: ['id'],
  organizations: ['id', 'name', 'created_at'],
  memberships: ['org_id', 'user_id', 'role', 'active', 'display_name'],
  cases: ['org_id', 'id', 'owner_id', 'payload', 'payload_hash', 'version', 'created_at'],
  case_reviews: ['id', 'org_id', 'case_id', 'actor_id', 'status', 'reason', 'created_at'],
  evidence_objects: ['path', 'org_id', 'owner_id', 'case_id', 'panel_id', 'kind', 'sha256', 'bytes', 'mime', 'verified_at'],
  assignments: ['id', 'org_id', 'officer_id', 'creator_id', 'package_ref', 'status', 'version', 'case_id', 'created_at'],
  server_audit: ['org_id', 'sequence', 'actor_id', 'event', 'details', 'previous_hash', 'hash', 'created_at'],
})
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9_-]{8,100}$/
const isUuid = value => typeof value === 'string' && UUID.test(value)
const isHash = value => typeof value === 'string' && HASH.test(value)
const isId = value => typeof value === 'string' && ID.test(value)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const check = (condition, code) => { if (!condition) throw new Error(code) }
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const validDate = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
const key = (org, id) => `${org}/${id}`

function jsonShape(value, depth = 0, budget = { nodes: 0 }) {
  check(++budget.nodes <= 200000 && depth <= 20, 'BACKUP_SHAPE_LIMIT')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') { check(Number.isFinite(value), 'BACKUP_NONFINITE_NUMBER'); return }
  if (typeof value === 'string') { check(value.length <= 2000000, 'BACKUP_METADATA_STRING_LIMIT'); return }
  check(Array.isArray(value) || plain(value), 'BACKUP_NOT_PLAIN_JSON')
  for (const [name, child] of Object.entries(value)) {
    check(!['__proto__', 'prototype', 'constructor'].includes(name), 'BACKUP_RESERVED_KEY')
    jsonShape(child, depth + 1, budget)
  }
}

export function migrationSqlDigest(bytes) {
  // Git may check SQL out as CRLF on Windows and LF on Linux. Normalize only
  // those line endings and an optional UTF-8 BOM; every other byte is material.
  const sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  return digest(Buffer.from(sql, 'utf8'))
}

export async function currentMigrationManifest() {
  return Promise.all(MIGRATIONS.map(async name => ({ name, sha256: migrationSqlDigest(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url))) })))
}

function uniqueMap(rows, makeKey, code) {
  const result = new Map()
  for (const row of rows) { const id = makeKey(row); check(!result.has(id), code); result.set(id, row) }
  return result
}

export async function verifyWorkspaceBackup(bundle) {
  check(exactKeys(bundle, ['format', 'schema', 'scope', 'tables', 'objects']) && bundle.format === BACKUP_FORMAT, 'BACKUP_FORMAT_INVALID')
  jsonShape({ format: bundle.format, schema: bundle.schema, scope: bundle.scope, tables: bundle.tables })
  check(exactKeys(bundle.scope, ['orgId', 'snapshotAt', 'consistentSnapshot', 'authUsers', 'captureMethod']) && isUuid(bundle.scope.orgId) && validDate(bundle.scope.snapshotAt) && bundle.scope.consistentSnapshot === true && bundle.scope.authUsers === 'ids-only' && ['operator-export', 'synthetic-fixture'].includes(bundle.scope.captureMethod), 'BACKUP_SCOPE_INVALID')
  const manifest = await currentMigrationManifest()
  check(Array.isArray(bundle.schema) && supportedMigrationNames(bundle.schema.map(item => item?.name)) && bundle.schema.every((item, index) => exactKeys(item, ['name', 'sha256']) && item.name === manifest[index].name && isHash(item.sha256) && item.sha256 === manifest[index].sha256), 'BACKUP_SCHEMA_VERSION_MISMATCH')
  check(exactKeys(bundle.tables, Object.keys(COLUMNS)), 'BACKUP_TABLE_SET_INVALID')
  for (const [table, columns] of Object.entries(COLUMNS)) {
    check(Array.isArray(bundle.tables[table]) && bundle.tables[table].length <= BACKUP_LIMITS.rowsPerTable, 'BACKUP_TABLE_ROW_LIMIT')
    for (const row of bundle.tables[table]) {
      check(exactKeys(row, columns), 'BACKUP_ROW_COLUMNS_INVALID')
      if (Object.hasOwn(row, 'org_id')) check(row.org_id === bundle.scope.orgId, 'BACKUP_CROSS_WORKSPACE_ROW')
      for (const field of ['created_at', 'verified_at']) if (Object.hasOwn(row, field)) check(validDate(row[field]), 'BACKUP_TIMESTAMP_INVALID')
    }
  }
  const t = bundle.tables
  check(t.organizations.length === 1 && t.organizations[0].id === bundle.scope.orgId && typeof t.organizations[0].name === 'string' && t.organizations[0].name.length >= 1 && t.organizations[0].name.length <= 300, 'BACKUP_ORGANIZATION_INVALID')
  const users = uniqueMap(t.auth_users, row => row.id, 'BACKUP_DUPLICATE_AUTH_ID')
  for (const user of users.keys()) check(isUuid(user), 'BACKUP_AUTH_ID_INVALID')
  const members = uniqueMap(t.memberships, row => row.user_id, 'BACKUP_DUPLICATE_MEMBERSHIP')
  for (const row of members.values()) check(users.has(row.user_id) && ['officer', 'supervisor', 'admin'].includes(row.role) && typeof row.active === 'boolean' && typeof row.display_name === 'string' && row.display_name.length <= 300, 'BACKUP_MEMBERSHIP_INVALID')
  const cases = uniqueMap(t.cases, row => key(row.org_id, row.id), 'BACKUP_DUPLICATE_CASE')
  const requiredObjects = new Map()
  for (const row of cases.values()) {
    check(isId(row.id) && users.has(row.owner_id) && members.has(row.owner_id) && Number.isSafeInteger(row.version) && row.version >= 1 && plain(row.payload) && isHash(row.payload_hash) && hashPayload(row.payload) === row.payload_hash, 'BACKUP_CASE_INVALID_OR_HASH_MISMATCH')
    check(row.payload.id === row.id && row.payload.actor?.id === row.owner_id && Array.isArray(row.payload.evidenceItems) && row.payload.evidenceItems.length >= 1 && row.payload.evidenceItems.length <= 4, 'BACKUP_CASE_EVIDENCE_INVALID')
    const panels = new Set()
    for (const panel of row.payload.evidenceItems) {
      check(plain(panel) && isUuid(panel.id) && !panels.has(panel.id) && isHash(panel.sha256), 'BACKUP_PANEL_INVALID')
      panels.add(panel.id)
      for (const kind of ['original', 'analysis']) {
        const path = panel[`${kind}Path`]
        check(typeof path === 'string' && path.length < 500 && path.startsWith(`${row.org_id}/${row.owner_id}/${row.id}/${panel.id}/${kind}-`) && isHash(path.split('/').at(-1)?.slice(kind.length + 1)) && path.split('/').length === 5, 'BACKUP_EVIDENCE_PATH_INVALID')
        if (kind === 'original') check(path.endsWith(`-${panel.sha256}`), 'BACKUP_ORIGINAL_HASH_MISMATCH')
        check(!requiredObjects.has(path), 'BACKUP_DUPLICATE_PANEL_PATH')
        requiredObjects.set(path, { row, panel, kind })
      }
    }
  }
  uniqueMap(t.case_reviews, row => row.id, 'BACKUP_DUPLICATE_REVIEW')
  for (const row of t.case_reviews) check(isUuid(row.id) && isId(row.case_id) && cases.has(key(row.org_id, row.case_id)) && users.has(row.actor_id) && members.has(row.actor_id), 'BACKUP_REVIEW_RELATION_INVALID')
  for (const row of cases.values()) check(row.version === 1 + t.case_reviews.filter(review => review.case_id === row.id).length, 'BACKUP_CASE_VERSION_REVIEW_MISMATCH')
  uniqueMap(t.assignments, row => row.id, 'BACKUP_DUPLICATE_ASSIGNMENT')
  for (const row of t.assignments) check(isUuid(row.id) && users.has(row.officer_id) && users.has(row.creator_id) && members.has(row.officer_id) && members.has(row.creator_id) && (row.case_id === null || (isId(row.case_id) && cases.has(key(row.org_id, row.case_id)))) && Number.isSafeInteger(row.version) && row.version >= 1, 'BACKUP_ASSIGNMENT_RELATION_INVALID')
  const registrations = uniqueMap(t.evidence_objects, row => row.path, 'BACKUP_DUPLICATE_OBJECT_REGISTRATION')
  // Includes registered uploads that were not sealed yet. They still need byte
  // backups, but are explicitly not counted as restored case evidence.
  for (const row of registrations.values()) {
    check(users.has(row.owner_id) && members.has(row.owner_id) && isId(row.case_id) && isUuid(row.panel_id) && ['original', 'analysis'].includes(row.kind) && isHash(row.sha256) && row.path === `${row.org_id}/${row.owner_id}/${row.case_id}/${row.panel_id}/${row.kind}-${row.sha256}` && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= BACKUP_LIMITS.imageBytes && ['image/png', 'image/jpeg', 'image/webp'].includes(row.mime), 'BACKUP_OBJECT_REGISTRATION_INVALID')
    const expected = requiredObjects.get(row.path)
    if (expected) check(row.owner_id === expected.row.owner_id && row.case_id === expected.row.id && row.panel_id === expected.panel.id && row.kind === expected.kind, 'BACKUP_OBJECT_RELATION_INVALID')
  }
  for (const path of requiredObjects.keys()) check(registrations.has(path), 'BACKUP_REQUIRED_OBJECT_MISSING')
  check(Array.isArray(bundle.objects) && bundle.objects.length <= BACKUP_LIMITS.objects && bundle.objects.length === registrations.size, 'BACKUP_OBJECT_SET_MISSING_OR_EXTRA')
  const objectBytes = new Map(); let totalImageBytes = 0
  for (const object of bundle.objects) {
    check(exactKeys(object, ['path', 'base64']) && registrations.has(object.path) && !objectBytes.has(object.path), 'BACKUP_OBJECT_ENTRY_INVALID')
    const row = registrations.get(object.path)
    check(typeof object.base64 === 'string' && object.base64.length === 4 * Math.ceil(row.bytes / 3) && /^[A-Za-z0-9+/]+={0,2}$/.test(object.base64), 'BACKUP_OBJECT_BASE64_INVALID')
    const bytes = Buffer.from(object.base64, 'base64')
    check(bytes.length === row.bytes && bytes.toString('base64') === object.base64 && digest(bytes) === row.sha256, 'BACKUP_OBJECT_HASH_MISMATCH')
    totalImageBytes += bytes.length; check(totalImageBytes <= BACKUP_LIMITS.totalImageBytes, 'BACKUP_TOTAL_IMAGE_LIMIT')
    try {
      const decoder = sharp(bytes, { failOn: 'error', limitInputPixels: 25000000 })
      const meta = await decoder.metadata()
      check(({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' })[meta.format] === row.mime && (meta.pages || 1) === 1, 'BACKUP_IMAGE_MIME_OR_PAGE_INVALID')
      await decoder.stats() // Decode, rather than trusting a forged MIME signature.
    } catch { throw new Error('BACKUP_IMAGE_DECODE_INVALID') }
    objectBytes.set(object.path, bytes)
  }
  let prev = 'GENESIS'; let sequence = 0
  for (const row of [...t.server_audit].sort((a, b) => Number(a.sequence) - Number(b.sequence))) {
    check((typeof row.sequence === 'number' || (typeof row.sequence === 'string' && /^[1-9][0-9]*$/.test(row.sequence))) && Number.isSafeInteger(Number(row.sequence)) && Number(row.sequence) === ++sequence && row.previous_hash === prev && isHash(row.hash) && users.has(row.actor_id) && typeof row.event === 'string' && row.event.length > 0 && row.event.length <= 100 && plain(row.details), 'BACKUP_AUDIT_CHAIN_INVALID')
    prev = row.hash
  }
  return { bundle, objectBytes, summary: { format: BACKUP_FORMAT, schemaMigrationNames: bundle.schema.map(item => item.name), currentSchema: bundle.schema.length === MIGRATIONS.length, forwardMigrationsNotApplied: MIGRATIONS.slice(bundle.schema.length), captureMethod: bundle.scope.captureMethod, tableRows: Object.fromEntries(Object.entries(t).map(([table, rows]) => [table, rows.length])), registeredObjects: registrations.size, caseObjects: requiredObjects.size, unsealedRegisteredObjects: registrations.size - requiredObjects.size, totalImageBytes, snapshotConsistencyIndependentlyVerified: false, liveSnapshotAuthenticityVerified: false } }
}

export async function createRehearsalDatabase(migrationNames = MIGRATIONS) {
  check(supportedMigrationNames(migrationNames), 'BACKUP_SCHEMA_VERSION_MISMATCH')
  const selectedNames = [...migrationNames]
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec(`set timezone = 'UTC'; create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
    for (const name of selectedNames) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    await db.exec('create schema backup_rehearsal; create table backup_rehearsal.object_bytes(path text primary key references public.evidence_objects(path), bytes bytea not null)')
    return db
  } catch (error) { await db.close(); throw error }
}

export async function rehearseWorkspaceRestore(bundle) {
  const verified = await verifyWorkspaceBackup(bundle) // All bytes checked BEFORE any restore is attempted.
  const db = await createRehearsalDatabase(bundle.schema.map(item => item.name))
  try {
    await db.exec('begin')
    try {
      for (const [table, columns] of Object.entries(COLUMNS)) {
        const target = table === 'auth_users' ? 'auth.users' : `public.${table}`
        for (const row of bundle.tables[table]) await db.query(`insert into ${target} (${columns.join(',')}) values (${columns.map((_, index) => `$${index + 1}`).join(',')})`, columns.map(column => row[column]))
      }
      for (const [path, bytes] of verified.objectBytes) await db.query('insert into backup_rehearsal.object_bytes values($1,$2)', [path, bytes])
      // Recompute with PostgreSQL's own JSONB/timestamp formatting, matching the
      // actual migration's audit function rather than approximating it in JS.
      const badAudit = await db.query(`select count(*)::int as n from server_audit where hash <> encode(extensions.digest(convert_to(jsonb_build_object('previous',previous_hash,'sequence',sequence,'actor',actor_id,'event',event,'details',details,'at',created_at)::text,'UTF8'),'sha256'),'hex')`)
      check(badAudit.rows[0].n === 0, 'BACKUP_AUDIT_HASH_MISMATCH')
      const missingSeal = await db.query(`select count(*)::int as n from cases c where not exists(select 1 from server_audit a where a.org_id=c.org_id and a.actor_id=c.owner_id and a.event='case_sealed' and a.details->>'caseId'=c.id and a.details->>'payloadHash'=c.payload_hash)`)
      check(missingSeal.rows[0].n === 0, 'BACKUP_CASE_SEAL_AUDIT_MISSING')
      const missingReview = await db.query(`select count(*)::int as n from case_reviews r where not exists(select 1 from server_audit a where a.org_id=r.org_id and a.actor_id=r.actor_id and a.event='case_reviewed' and a.details->>'caseId'=r.case_id and a.details->>'operation'=r.id::text and a.details->>'status'=r.status)`)
      check(missingReview.rows[0].n === 0, 'BACKUP_REVIEW_AUDIT_MISSING')
      const badAssignments = await db.query(`select count(*)::int as n from assignments x where
        not exists(select 1 from server_audit a where a.org_id=x.org_id and a.actor_id=x.creator_id and a.event='assignment_created' and a.details->>'assignmentId'=x.id::text and a.details->>'officerId'=x.officer_id::text)
        or x.version <> 1+(select count(*) from server_audit a where a.org_id=x.org_id and a.event='assignment_updated' and a.details->>'assignmentId'=x.id::text)
        or (x.version=1 and x.status<>'assigned')
        or (x.version>1 and not exists(select 1 from server_audit a where a.org_id=x.org_id and a.event='assignment_updated' and a.details->>'assignmentId'=x.id::text and a.details->>'version'=x.version::text and a.details->>'status'=x.status))`)
      check(badAssignments.rows[0].n === 0, 'BACKUP_ASSIGNMENT_AUDIT_MISMATCH')
      const danglingAudit = await db.query(`select count(*)::int as n from server_audit a where
        (a.event in ('case_sealed','case_reviewed') and not exists(select 1 from cases c where c.org_id=a.org_id and c.id=a.details->>'caseId'))
        or (a.event='case_reviewed' and not exists(select 1 from case_reviews r where r.org_id=a.org_id and r.id::text=a.details->>'operation'))
        or (a.event in ('assignment_created','assignment_updated') and not exists(select 1 from assignments x where x.org_id=a.org_id and x.id::text=a.details->>'assignmentId'))`)
      check(danglingAudit.rows[0].n === 0, 'BACKUP_AUDIT_RELATION_MISSING')
      // A restored object must reproduce both the metadata length and SHA-256.
      const badObjects = await db.query(`select count(*)::int as n from evidence_objects e left join backup_rehearsal.object_bytes b using(path) where b.bytes is null or octet_length(b.bytes)<>e.bytes or encode(extensions.digest(b.bytes,'sha256'),'hex')<>e.sha256`)
      check(badObjects.rows[0].n === 0, 'BACKUP_RESTORED_OBJECT_MISMATCH')
      await db.exec('commit')
    } catch (error) {
      await db.exec('rollback')
      const targets = Object.keys(COLUMNS).map(table => table === 'auth_users' ? 'auth.users' : `public.${table}`)
      const rows = (await db.query(`select ${[...targets, 'backup_rehearsal.object_bytes'].map(table => `(select count(*) from ${table})`).join('+')} as n`)).rows[0].n
      const failure = new Error(/^BACKUP_[A-Z_]+$/.test(error.message || '') ? error.message : 'BACKUP_RESTORE_CONSTRAINT_FAILED')
      failure.noPartialRestore = Number(rows) === 0
      throw failure
    }
    const restored = (await db.query('select count(*)::int as n from backup_rehearsal.object_bytes')).rows[0].n
    return { passed: true, mode: 'isolated-in-memory-postgresql-rehearsal', ...verified.summary, restoredObjects: restored, auditHashesRecomputed: true, transactionCommitted: true, persistentDestinationWritten: false, liveSupabaseRestorePerformed: false, authLoginsRestored: false, limitations: ['Auth contains UUID stubs only; passwords, providers, sessions, keys and delivery settings are NOT backed up or restored.', 'Private object bytes are restored to an isolated bytea fixture, not a live Supabase Storage service.', 'Only this one workspace and registered evidence objects are covered; unregistered bucket objects, quota counters and unrelated schemas are excluded.', 'Internal consistency and a caller-declared snapshot time are not independent proof of a complete or authentic live snapshot.'] }
  } finally { await db.close() }
}
