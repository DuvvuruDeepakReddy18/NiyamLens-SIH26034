import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createEvidenceStore } from '../src/lib/storage.mjs'
import { createOperation, createSyncEngine } from '../src/lib/syncEngine.mjs'

// Executes shipped SQL and RLS in PostgreSQL, combined with the actual IndexedDB
// outbox. Auth identities, Storage rows and transport failures are fixtures:
// these checks must never be reported as hosted Supabase acceptance.
const org = '11000000-0000-4000-8000-000000000001'
const otherOrg = '11000000-0000-4000-8000-000000000002'
const officer = '22000000-0000-4000-8000-000000000001'
const peer = '22000000-0000-4000-8000-000000000002'
const supervisor = '22000000-0000-4000-8000-000000000003'
const outsider = '22000000-0000-4000-8000-000000000004'
const admin = '22000000-0000-4000-8000-000000000005'
const payload = { automatedResult: { status: 'manual_review' }, evidenceItems: [] }
const reason = 'Pilot fixture: decisive declarations require physical inspection.'

test('team pilot: real PostgreSQL permissions and durable failure recovery', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const asRole = async (role, user = '') => {
    assert.ok(['authenticated', 'service_role', 'anon'].includes(role))
    await db.exec(`reset role; set role ${role}`)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  }
  const active = async (user, enabled) => {
    await db.exec('reset role')
    await db.query('update memberships set active=$2 where user_id=$1', [user, enabled])
  }
  const seal = (actor, id, hash = 'a'.repeat(64), target = org) => db.query('select commit_case($1,$2,$3,$4,$5) as version', [target, actor, id, payload, hash])
  const review = (actor, id, operation, version, status = 'manual_review', note = reason, target = org) => db.query('select review_case($1,$2,$3,$4,$5,$6,$7) as version', [target, actor, id, operation, version, status, note])
  const assign = (actor, id, assignee = officer, reference = 'Pilot inspection', target = org) => db.query('select create_assignment($1,$2,$3,$4,$5)', [target, actor, id, assignee, reference])
  const advance = (actor, id, version, status, target = org) => db.query('select update_assignment($1,$2,$3,$4,$5) as version', [target, actor, id, version, status])
  const visible = async (table, column = 'id') => {
    assert.ok(['cases', 'case_reviews', 'evidence_objects', 'assignments', 'server_audit'].includes(table))
    assert.ok(['id', 'path', 'sequence'].includes(column))
    return (await db.query(`select ${column} as value from ${table} order by ${column}`)).rows.map((row) => row.value)
  }
  const count = async (table) => {
    assert.ok(['cases', 'case_reviews', 'assignments', 'server_audit'].includes(table))
    return (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n
  }
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
    for (const migration of ['202609040001_workspaces.sql', '202609040002_assignment_transactions.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'))
    }
    await db.query('insert into auth.users values($1),($2),($3),($4),($5)', [officer, peer, supervisor, outsider, admin])
    await db.query("insert into organizations(id,name) values($1,'Pilot A'),($2,'Pilot B')", [org, otherOrg])
    await db.query("insert into memberships(org_id,user_id,role) values($1,$3,'officer'),($1,$4,'officer'),($1,$5,'supervisor'),($2,$6,'supervisor'),($1,$7,'admin')", [org, otherOrg, officer, peer, supervisor, outsider, admin])
    await asRole('service_role')
    await seal(officer, 'pilot-officer-a')
    await seal(peer, 'pilot-officer-b')
    await seal(outsider, 'pilot-other-org', 'b'.repeat(64), otherOrg)
    const reviews = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    await review(supervisor, 'pilot-officer-a', reviews[0], 1)
    await review(supervisor, 'pilot-officer-b', reviews[1], 1)
    await review(outsider, 'pilot-other-org', reviews[2], 1, 'manual_review', reason, otherOrg)
    const assignments = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    await assign(supervisor, assignments[0], officer)
    await assign(supervisor, assignments[1], peer)
    await assign(outsider, assignments[2], outsider, 'Other org inspection', otherOrg)
    for (const [target, actor, id] of [[org, officer, 'pilot-officer-a'], [org, peer, 'pilot-officer-b'], [otherOrg, outsider, 'pilot-other-org']]) {
      for (const kind of ['original', 'analysis']) {
        const panel = crypto.randomUUID()
        await db.query('insert into evidence_objects(path,org_id,owner_id,case_id,panel_id,kind,sha256,bytes,mime) values($1,$2,$3,$4,$5,$6,$7,100,$8)', [`${id}/${kind}`, target, actor, id, panel, kind, 'a'.repeat(64), 'image/jpeg'])
      }
    }

    await t.test('each officer reads only owned cases, reviews, evidence registrations and assignments', async () => {
      for (const [actor, id, index] of [[officer, 'pilot-officer-a', 0], [peer, 'pilot-officer-b', 1]]) {
        await asRole('authenticated', actor)
        assert.deepEqual(await visible('cases'), [id])
        assert.deepEqual(await visible('case_reviews'), [reviews[index]])
        assert.deepEqual(await visible('evidence_objects', 'path'), [`${id}/analysis`, `${id}/original`])
        assert.deepEqual(await visible('assignments'), [assignments[index]])
        assert.deepEqual(await visible('server_audit', 'sequence'), [])
      }
    })
    await t.test('supervisor and admin see both officers but no other-organization data', async () => {
      for (const actor of [supervisor, admin]) {
        await asRole('authenticated', actor)
        assert.deepEqual(await visible('cases'), ['pilot-officer-a', 'pilot-officer-b'])
        assert.deepEqual(await visible('case_reviews'), reviews.slice(0, 2).sort())
        assert.equal((await visible('evidence_objects', 'path')).length, 4)
        assert.deepEqual(await visible('assignments'), assignments.slice(0, 2).sort())
        assert.equal((await visible('server_audit', 'sequence')).length, 6)
      }
      await asRole('authenticated', outsider)
      assert.deepEqual(await visible('cases'), ['pilot-other-org'])
      assert.deepEqual(await visible('case_reviews'), [reviews[2]])
      assert.deepEqual(await visible('evidence_objects', 'path'), ['pilot-other-org/analysis', 'pilot-other-org/original'])
      assert.deepEqual(await visible('assignments'), [assignments[2]])
      assert.equal((await visible('server_audit', 'sequence')).length, 3)
    })
    await t.test('browser roles cannot write operational rows, elevate membership or execute privileged functions', async () => {
      for (const actor of [officer, supervisor, admin]) {
        await asRole('authenticated', actor)
        for (const statement of ["update memberships set role='admin'", "delete from cases", "update case_reviews set status='compliant'", "delete from evidence_objects", "update assignments set status='closed'", "delete from server_audit"]) {
          await assert.rejects(db.exec(statement), { code: '42501' })
        }
        await assert.rejects(seal(actor, 'forged-direct-rpc'), { code: '42501' })
        await assert.rejects(review(actor, 'pilot-officer-a', crypto.randomUUID(), 2), { code: '42501' })
        await assert.rejects(assign(actor, crypto.randomUUID()), { code: '42501' })
      }
      await asRole('anon')
      await assert.rejects(db.exec('select * from evidence_objects'), { code: '42501' })
    })
    await t.test('cross-organization actors cannot seal, review, assign or alter guessed IDs', async () => {
      await asRole('service_role')
      await assert.rejects(seal(outsider, 'cross-org-case'), { code: '42501' })
      await assert.rejects(review(outsider, 'pilot-officer-a', crypto.randomUUID(), 2), { code: '42501' })
      await assert.rejects(assign(outsider, crypto.randomUUID()), { code: '42501' })
      await assert.rejects(assign(supervisor, crypto.randomUUID(), outsider), { code: '42501' })
      await assert.rejects(advance(outsider, assignments[0], 1, 'in_progress'), { code: '42501' })
      await assert.rejects(advance(outsider, assignments[0], 1, 'in_progress', otherOrg), { code: '42501' })
    })
    await t.test('suspended officers and reviewers immediately lose SQL read and mutation authority', async () => {
      for (const actor of [officer, supervisor]) {
        await active(actor, false)
        try {
          await asRole('authenticated', actor)
          for (const [table, column] of [['cases', 'id'], ['case_reviews', 'id'], ['evidence_objects', 'path'], ['assignments', 'id'], ['server_audit', 'sequence']]) assert.deepEqual(await visible(table, column), [])
          await asRole('service_role')
          await assert.rejects(seal(actor, 'suspended-pilot-case'), { code: '42501' })
          await assert.rejects(review(actor, 'pilot-officer-a', crypto.randomUUID(), 2), { code: '42501' })
          await assert.rejects(advance(actor, assignments[0], 1, 'in_progress'), { code: '42501' })
          await assert.rejects(assign(actor, crypto.randomUUID(), peer), { code: '42501' })
          if (actor === officer) await assert.rejects(assign(supervisor, crypto.randomUUID(), officer), { code: '42501' })
        } finally { await active(actor, true) }
      }
    })
    await t.test('altered seal and review replays conflict without altering immutable observations', async () => {
      await asRole('service_role')
      const before = await count('server_audit')
      assert.equal((await seal(officer, 'pilot-officer-a')).rows[0].version, 2)
      await assert.rejects(seal(peer, 'pilot-officer-a'), { code: '40001' })
      await assert.rejects(seal(officer, 'pilot-officer-a', 'f'.repeat(64)), { code: '40001' })
      await assert.rejects(review(supervisor, 'pilot-officer-a', reviews[0], 2, 'compliant'), { code: '23505' })
      await assert.rejects(review(admin, 'pilot-officer-a', reviews[0], 2), { code: '23505' })
      assert.equal(await count('server_audit'), before)
      const row = (await db.query("select payload,version from cases where id='pilot-officer-a'")).rows[0]
      assert.equal(row.version, 2)
      assert.deepEqual(row.payload, payload)
    })
    await t.test('stale review keeps the first committed decision and emits no second audit entry', async () => {
      await asRole('service_role')
      const before = await count('server_audit')
      assert.equal((await review(supervisor, 'pilot-officer-b', crypto.randomUUID(), 2, 'non_compliant')).rows[0].version, 3)
      await assert.rejects(review(admin, 'pilot-officer-b', crypto.randomUUID(), 2, 'compliant'), { code: '40001' })
      assert.equal(await count('server_audit'), before + 1)
      assert.equal((await db.query("select version from cases where id='pilot-officer-b'")).rows[0].version, 3)
    })
    await t.test('invalid review rolls back insert, case version and server audit together', async () => {
      await asRole('service_role')
      const before = [await count('case_reviews'), await count('server_audit')]
      await assert.rejects(review(supervisor, 'pilot-officer-a', crypto.randomUUID(), 2, 'manual_review', 'short'), { code: '23514' })
      assert.deepEqual([await count('case_reviews'), await count('server_audit')], before)
      assert.equal((await db.query("select version from cases where id='pilot-officer-a'")).rows[0].version, 2)
    })
    await t.test('assignment creation replay is idempotent; changed contents and stale transitions conflict', async () => {
      await asRole('service_role')
      const before = await count('server_audit')
      await assign(supervisor, assignments[0], officer)
      await assert.rejects(assign(supervisor, assignments[0], peer), { code: '40001' })
      await assert.rejects(assign(admin, assignments[0], officer), { code: '40001' })
      await assert.rejects(assign(supervisor, assignments[0], officer, 'Altered reference'), { code: '40001' })
      await assert.rejects(advance(peer, assignments[0], 1, 'in_progress'), { code: '42501' })
      await assert.rejects(advance(officer, assignments[0], 1, 'submitted'), { code: '40001' })
      assert.equal((await advance(officer, assignments[0], 1, 'in_progress')).rows[0].version, 2)
      await assert.rejects(advance(officer, assignments[0], 1, 'in_progress'), { code: '40001' })
      await advance(officer, assignments[0], 2, 'submitted')
      await assert.rejects(advance(officer, assignments[0], 3, 'closed'), { code: '40001' })
      await advance(supervisor, assignments[0], 3, 'in_progress')
      await advance(officer, assignments[0], 4, 'submitted')
      await advance(supervisor, assignments[0], 5, 'closed')
      await assert.rejects(advance(supervisor, assignments[0], 6, 'in_progress'), { code: '40001' })
      assert.equal(await count('server_audit'), before + 5)
    })
    await t.test('lost response after real SQL seal survives local reopen and retries to one case and receipt', async () => {
      await asRole('service_role')
      const id = 'pilot-lost-seal-ack'
      const scope = `pilot-${crypto.randomUUID()}`
      const initial = createEvidenceStore(scope)
      const operation = createOperation('seal', id, payload)
      await initial.saveAndQueue({ id, ...payload, syncState: 'pending' }, operation)
      const before = await count('server_audit')
      let calls = 0
      const transport = async (sent) => {
        assert.equal(sent.id, operation.id)
        const result = await seal(officer, sent.recordId)
        if (++calls === 1) throw new Error('Injected: response lost after database commit')
        return { record: { id, ...payload, syncState: 'synced', serverVersion: result.rows[0].version } }
      }
      await createSyncEngine({ store: initial, transport }).run(true)
      assert.equal((await initial.get('inspections', id)).syncState, 'pending')
      assert.equal((await initial.get('outbox', operation.id)).attempts, 1)
      const reopened = createEvidenceStore(scope)
      await createSyncEngine({ store: reopened, transport }).run(true)
      assert.equal(calls, 2)
      assert.equal((await db.query('select count(*)::int as n from cases where id=$1', [id])).rows[0].n, 1)
      assert.equal(await count('server_audit'), before + 1)
      assert.deepEqual(await reopened.all('outbox'), [])
      assert.equal((await reopened.get('inspections', id)).serverVersion, 1)
    })
    await t.test('lost review acknowledgement retries its same operation without duplicate review or version bump', async () => {
      await asRole('service_role')
      const id = 'pilot-review-lost-ack'
      await seal(officer, id)
      const store = createEvidenceStore(`pilot-review-${crypto.randomUUID()}`)
      const operation = createOperation('review', id, { status: 'manual_review', reason }, 1)
      await store.saveAndQueue({ id, syncState: 'pending-review' }, operation)
      const before = [await count('case_reviews'), await count('server_audit')]
      let calls = 0
      const engine = createSyncEngine({ store, transport: async (sent) => {
        const result = await review(supervisor, sent.recordId, sent.id, sent.baseVersion, sent.payload.status, sent.payload.reason)
        if (++calls === 1) throw new Error('Injected: review committed, acknowledgement unavailable')
        return { record: { id, syncState: 'synced', serverVersion: result.rows[0].version } }
      } })
      await engine.run(true); await engine.run(true)
      assert.equal(calls, 2)
      assert.deepEqual([await count('case_reviews'), await count('server_audit')], before.map((value) => value + 1))
      assert.equal((await store.get('inspections', id)).serverVersion, 2)
      assert.deepEqual(await store.all('outbox'), [])
    })
  } finally { await db.close() }
})

for (const status of [401, 429, 503]) {
  test(`transient ${status} pauses the queue and preserves all intent until an explicit successful retry`, async () => {
    const scope = `pilot-transient-${crypto.randomUUID()}`
    const store = createEvidenceStore(scope)
    const first = createOperation('review', 'pilot-first-case', { reason: 'Preserve this exact unsent review.' }, 3)
    const next = createOperation('review', 'pilot-second-case', { reason: 'Second case must wait.' }, 1)
    first.createdAt = '2026-09-04T00:00:00.000Z'; next.createdAt = '2026-09-04T00:00:01.000Z'
    await store.saveAndQueue({ id: first.recordId, syncState: 'pending-review' }, first)
    await store.saveAndQueue({ id: next.recordId, syncState: 'pending-review' }, next)
    let calls = 0
    await createSyncEngine({ store, transport: async () => { calls++; throw Object.assign(new Error('Injected recoverable service failure'), { status }) } }).run(true)
    assert.equal(calls, 1)
    assert.deepEqual((await store.get('outbox', first.id)).payload, first.payload)
    assert.equal((await store.get('outbox', first.id)).state, 'pending')
    assert.equal((await store.get('outbox', next.id)).attempts, 0)
    const reopened = createEvidenceStore(scope)
    const sent = []
    await createSyncEngine({ store: reopened, transport: async (operation) => { sent.push(operation.id); return { record: { id: operation.recordId, syncState: 'synced', serverVersion: operation.baseVersion + 1 } } } }).run(true)
    assert.deepEqual(sent, [first.id, next.id])
    assert.deepEqual(await reopened.all('outbox'), [])
  })
}
