import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { BACKUP_FORMAT, COLUMNS, migrationSqlDigest, currentMigrationManifest, createRehearsalDatabase, verifyWorkspaceBackup, rehearseWorkspaceRestore } from '../tools/workspace-backup.mjs'
import { hashPayload } from '../server/caseService.mjs'
import { main } from '../tools/verify-workspace-backup.mjs'

const org = '10000000-0000-4000-8000-000000000001'
const officer = '20000000-0000-4000-8000-000000000001'
const supervisor = '20000000-0000-4000-8000-000000000002'
const panel = '30000000-0000-4000-8000-000000000001'
const caseId = 'NLM-backup-fixture-001'
const clone = value => JSON.parse(JSON.stringify(value))

async function fixture() {
  const original = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#123456' } }).png().toBuffer()
  const analysis = await sharp(original).resize(6, 5).jpeg().toBuffer()
  const images = [['original', original, 'image/png'], ['analysis', analysis, 'image/jpeg']].map(([kind, bytes, mime]) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return { kind, bytes, mime, sha256, path: `${org}/${officer}/${caseId}/${panel}/${kind}-${sha256}` }
  })
  const payload = { id: caseId, actor: { id: officer }, text: 'Synthetic fixture; not a field result', automatedResult: { status: 'manual_review' }, evidenceItems: [{ id: panel, originalPath: images[0].path, analysisPath: images[1].path, sha256: images[0].sha256 }] }
  const db = await createRehearsalDatabase()
  try {
    await db.query('insert into auth.users values($1),($2)', [officer, supervisor])
    await db.query("insert into organizations(id,name) values($1,'Isolated backup fixture')", [org])
    await db.query("insert into memberships(org_id,user_id,role) values($1,$2,'officer'),($1,$3,'supervisor')", [org, officer, supervisor])
    for (const image of images) await db.query('insert into evidence_objects(path,org_id,owner_id,case_id,panel_id,kind,sha256,bytes,mime) values($1,$2,$3,$4,$5,$6,$7,$8,$9)', [image.path, org, officer, caseId, panel, image.kind, image.sha256, image.bytes.length, image.mime])
    await db.query('select commit_case($1,$2,$3,$4,$5)', [org, officer, caseId, payload, hashPayload(payload)])
    await db.query('select review_case($1,$2,$3,$4,$5,$6,$7)', [org, supervisor, caseId, '40000000-0000-4000-8000-000000000001', 1, 'manual_review', 'Synthetic restore test; no statutory decision.'])
    await db.query('select create_assignment($1,$2,$3,$4,$5)', [org, supervisor, '50000000-0000-4000-8000-000000000001', officer, 'Synthetic restore assignment'])
    const tables = {}
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const target = table === 'auth_users' ? 'auth.users' : table
      // Preserve PG timestamp microseconds as text; JS Date loses precision and
      // would invalidate the actual server audit digest.
      const selected = columns.map(column => ['created_at', 'verified_at'].includes(column) ? `${column}::text as ${column}` : column).join(',')
      tables[table] = (await db.query(`select ${selected} from ${target}`)).rows
    }
    return { format: BACKUP_FORMAT, schema: await currentMigrationManifest(), scope: { orgId: org, snapshotAt: new Date().toISOString(), consistentSnapshot: true, authUsers: 'ids-only', captureMethod: 'synthetic-fixture' }, tables, objects: images.map(image => ({ path: image.path, base64: image.bytes.toString('base64') })) }
  } finally { await db.close() }
}

test('workspace backup and isolated restore', async t => {
  const good = await fixture()
  await t.test('restores real migrations, all relations, reviewed version and both private image byte streams', async () => {
    const result = await rehearseWorkspaceRestore(good)
    assert.equal(result.passed, true)
    assert.equal(result.restoredObjects, 2)
    assert.equal(result.tableRows.case_reviews, 1)
    assert.equal(good.tables.cases[0].version, 2)
    assert.equal(hashPayload(good.tables.cases[0].payload), good.tables.cases[0].payload_hash)
    assert.equal(result.auditHashesRecomputed, true)
    assert.equal(result.persistentDestinationWritten, false)
    assert.equal(result.liveSupabaseRestorePerformed, false)
    assert.equal(result.authLoginsRestored, false)
  })
  await t.test('refuses a case-only export or incomplete table collection', async () => {
    await assert.rejects(verifyWorkspaceBackup(good.tables.cases[0].payload), /BACKUP_FORMAT_INVALID/)
    const bad = clone(good); delete bad.tables.assignments
    await assert.rejects(verifyWorkspaceBackup(bad), /BACKUP_TABLE_SET_INVALID/)
  })
  await t.test('refuses tampered bytes before restoration', async () => {
    const bad = clone(good); bad.objects[0].base64 = Buffer.alloc(Buffer.from(bad.objects[0].base64, 'base64').length).toString('base64')
    await assert.rejects(rehearseWorkspaceRestore(bad), /BACKUP_OBJECT_HASH_MISMATCH/)
  })
  await t.test('refuses a missing analysis object or missing registration', async () => {
    const bad = clone(good); bad.objects.pop()
    await assert.rejects(rehearseWorkspaceRestore(bad), /BACKUP_OBJECT_SET_MISSING_OR_EXTRA/)
    const bad2 = clone(good); bad2.tables.evidence_objects.pop(); bad2.objects.pop()
    await assert.rejects(rehearseWorkspaceRestore(bad2), /BACKUP_REQUIRED_OBJECT_MISSING/)
  })
  await t.test('never resolves or writes traversal, absolute or URL object paths', async () => {
    for (const path of ['../../secret', 'C:/tmp/object', 'https://example.com/photo', `${org}/${officer}/${caseId}/${panel}/original-../x`]) {
      const bad = clone(good); bad.objects[0].path = path
      await assert.rejects(rehearseWorkspaceRestore(bad), /BACKUP_OBJECT_ENTRY_INVALID/)
    }
  })
  await t.test('refuses cross-workspace and missing Auth references', async () => {
    const bad = clone(good); bad.tables.memberships[0].org_id = '10000000-0000-4000-8000-000000000099'
    await assert.rejects(verifyWorkspaceBackup(bad), /BACKUP_CROSS_WORKSPACE_ROW/)
    const bad2 = clone(good); bad2.tables.auth_users.pop()
    await assert.rejects(verifyWorkspaceBackup(bad2), /BACKUP_MEMBERSHIP_INVALID/)
  })
  await t.test('rejects accidental credentials and unbounded bytes', async () => {
    const bad = clone(good); bad.tables.auth_users[0].encrypted_password = 'not-a-real-password'
    await assert.rejects(verifyWorkspaceBackup(bad), /BACKUP_ROW_COLUMNS_INVALID/)
    const bad2 = clone(good); bad2.tables.evidence_objects[0].bytes = 15 * 1024 * 1024 + 1
    await assert.rejects(verifyWorkspaceBackup(bad2), /BACKUP_OBJECT_REGISTRATION_INVALID/)
  })
  await t.test('rejects schema drift, payload mutation and review/version mismatch', async () => {
    const bad = clone(good); bad.schema[0].sha256 = '0'.repeat(64)
    await assert.rejects(verifyWorkspaceBackup(bad), /BACKUP_SCHEMA_VERSION_MISMATCH/)
    const bad2 = clone(good); bad2.tables.cases[0].payload.text = 'changed'
    await assert.rejects(verifyWorkspaceBackup(bad2), /BACKUP_CASE_INVALID_OR_HASH_MISMATCH/)
    const bad3 = clone(good); bad3.tables.cases[0].version = 1
    await assert.rejects(verifyWorkspaceBackup(bad3), /BACKUP_CASE_VERSION_REVIEW_MISMATCH/)
  })
  await t.test('migration hashes are portable across LF, CRLF and UTF-8 BOM but preserve SQL edits', async () => {
    const lf = 'create table example(id uuid);\n-- A comment\n'
    assert.equal(migrationSqlDigest(Buffer.from(lf)), migrationSqlDigest(Buffer.from(lf.replaceAll('\n', '\r\n'))))
    assert.equal(migrationSqlDigest(Buffer.from(lf)), migrationSqlDigest(Buffer.from('\uFEFF' + lf)))
    assert.notEqual(migrationSqlDigest(Buffer.from(lf)), migrationSqlDigest(Buffer.from(lf.replace('uuid', 'text'))))
    const reordered = clone(good); reordered.schema = reordered.schema.map(({ name, sha256 }) => ({ sha256, name }))
    assert.equal((await verifyWorkspaceBackup(reordered)).summary.registeredObjects, 2)
  })
  await t.test('IDs, hashes and sequence reject coercible arrays', async () => {
    const bad = clone(good); bad.scope.orgId = [org]
    await assert.rejects(verifyWorkspaceBackup(bad), /BACKUP_SCOPE_INVALID/)
    const bad2 = clone(good); bad2.tables.auth_users[0].id = [officer]
    await assert.rejects(verifyWorkspaceBackup(bad2), /BACKUP_AUTH_ID_INVALID/)
    const bad3 = clone(good); bad3.tables.cases[0].payload.evidenceItems[0].sha256 = [bad3.tables.cases[0].payload.evidenceItems[0].sha256]; bad3.tables.cases[0].payload_hash = hashPayload(bad3.tables.cases[0].payload)
    await assert.rejects(verifyWorkspaceBackup(bad3), /BACKUP_PANEL_INVALID/)
    const bad4 = clone(good); bad4.tables.server_audit[0].sequence = [1]
    await assert.rejects(verifyWorkspaceBackup(bad4), /BACKUP_AUDIT_CHAIN_INVALID/)
  })
  await t.test('rejects bytes with matching forged digest but invalid image encoding', async () => {
    const bad = clone(good); const row = bad.tables.evidence_objects[0]
    const bytes = Buffer.from('not actually an image')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const path = row.path.replace(row.sha256, hash)
    row.path = path; row.sha256 = hash; row.bytes = bytes.length
    bad.objects[0] = { path, base64: bytes.toString('base64') }
    const caseRow = bad.tables.cases[0]; caseRow.payload.evidenceItems[0].originalPath = path; caseRow.payload.evidenceItems[0].sha256 = hash; caseRow.payload_hash = hashPayload(caseRow.payload)
    await assert.rejects(rehearseWorkspaceRestore(bad), /BACKUP_IMAGE_DECODE_INVALID/)
  })
  await t.test('SQL constraint failures roll back all case, org and object writes', async () => {
    const bad = clone(good); bad.tables.case_reviews[0].status = 'unsupported'
    await assert.rejects(rehearseWorkspaceRestore(bad), error => error.message === 'BACKUP_RESTORE_CONSTRAINT_FAILED' && error.noPartialRestore === true)
  })
  await t.test('audit tampering rolls back even after rows and object bytes are staged', async () => {
    const bad = clone(good); bad.tables.server_audit[0].details.extra = 'mutated'
    await assert.rejects(rehearseWorkspaceRestore(bad), error => error.message === 'BACKUP_AUDIT_HASH_MISMATCH' && error.noPartialRestore === true)
  })
  await t.test('a truncated tail cannot silently discard an assignment audit', async () => {
    const bad = clone(good); bad.tables.server_audit.pop()
    await assert.rejects(rehearseWorkspaceRestore(bad), error => error.message === 'BACKUP_ASSIGNMENT_AUDIT_MISMATCH' && error.noPartialRestore === true)
  })
  await t.test('a dropped assignment cannot leave a dangling audit entry', async () => {
    const bad = clone(good); bad.tables.assignments = []
    await assert.rejects(rehearseWorkspaceRestore(bad), error => error.message === 'BACKUP_AUDIT_RELATION_MISSING' && error.noPartialRestore === true)
  })
  await t.test('CLI schema command is read-only and unsupported arguments fail', async () => {
    assert.deepEqual((await main(['--schema-manifest'])).schema, good.schema)
    await assert.rejects(main(['--restore-live']), /BACKUP_USAGE_INVALID/)
  })
})
