import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

// Actual SQL/RLS/transaction tests in embedded PostgreSQL. Supabase Auth and
// Storage schemas are minimal fixtures here, NOT a live hosted-service test.
test('PostgreSQL workspace migration and authorization invariants', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const org = '10000000-0000-4000-8000-000000000001'
  const otherOrg = '10000000-0000-4000-8000-000000000002'
  const officer = '20000000-0000-4000-8000-000000000001'
  const peer = '20000000-0000-4000-8000-000000000002'
  const supervisor = '20000000-0000-4000-8000-000000000003'
  const outsider = '20000000-0000-4000-8000-000000000004'
  const operation = '30000000-0000-4000-8000-000000000001'
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
    for (const name of ['202609040001_workspaces.sql', '202609040002_assignment_transactions.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    await db.query('insert into auth.users values($1),($2),($3),($4)', [officer, peer, supervisor, outsider])
    await db.query("insert into organizations(id,name) values($1,'One'),($2,'Two')", [org, otherOrg])
    await db.query("insert into memberships(org_id,user_id,role) values($1,$3,'officer'),($1,$4,'officer'),($1,$5,'supervisor'),($2,$6,'supervisor')", [org, otherOrg, officer, peer, supervisor, outsider])
    const asRole = async (role, user) => { await db.exec(`reset role; set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']) }
    const seal = (actor, id, hash = 'original-hash') => db.query('select commit_case($1,$2,$3,$4,$5) as version', [org, actor, id, { automatedResult: { status: 'manual_review' }, evidenceItems: [] }, hash])
    await asRole('service_role')
    await seal(officer, 'case-first'); await seal(peer, 'case-second')

    await t.test('immutable case retries are idempotent and altered retries conflict', async () => {
      assert.equal((await seal(officer, 'case-first')).rows[0].version, 1)
      await assert.rejects(seal(officer, 'case-first', 'different-hash'), { code: '40001' })
      assert.equal((await db.query('select count(*)::int as n from cases')).rows[0].n, 2)
      await assert.rejects(db.exec("update cases set payload='{}'"), { code: '42501' })
      await assert.rejects(db.exec("delete from server_audit"), { code: '42501' })
    })
    await t.test('officers see only their own case, reviewers only their organization', async () => {
      await asRole('authenticated', officer)
      assert.deepEqual((await db.query('select id from cases')).rows.map((item) => item.id), ['case-first'])
      await assert.rejects(db.exec("update memberships set role='admin'"), { code: '42501' })
      await assert.rejects(seal(officer, 'bypass-case'), { code: '42501' })
      await asRole('authenticated', supervisor)
      assert.equal((await db.query('select count(*)::int as n from cases')).rows[0].n, 2)
      await asRole('authenticated', outsider)
      assert.equal((await db.query('select count(*)::int as n from cases')).rows[0].n, 0)
      await asRole('anon')
      await assert.rejects(db.exec('select * from cases'), { code: '42501' })
    })
    await t.test('review role, idempotency and optimistic concurrency are enforced in SQL', async () => {
      await asRole('service_role')
      const review = (actor, id, version, status = 'compliant') => db.query('select review_case($1,$2,$3,$4,$5,$6,$7) as version', [org, actor, 'case-first', id, version, status, 'Compared original label and physical package.'])
      await assert.rejects(review(officer, operation, 1), { code: '42501' })
      assert.equal((await review(supervisor, operation, 1)).rows[0].version, 2)
      assert.equal((await review(supervisor, operation, 1)).rows[0].version, 2)
      await assert.rejects(review(supervisor, crypto.randomUUID(), 1), { code: '40001' })
      const row = (await db.query("select payload,version from cases where id='case-first'")).rows[0]
      assert.equal(row.version, 2); assert.equal(row.payload.automatedResult.status, 'manual_review')
      assert.equal((await db.query('select count(*)::int as n from case_reviews')).rows[0].n, 1)
    })
    await t.test('a suspended membership loses both read and RPC write access', async () => {
      await db.exec('reset role')
      await db.query('update memberships set active=false where user_id=$1', [officer])
      await asRole('authenticated', officer)
      assert.equal((await db.query('select count(*)::int as n from cases')).rows[0].n, 0)
      await asRole('service_role')
      await assert.rejects(seal(officer, 'suspended-case'), { code: '42501' })
      await db.exec('reset role'); await db.query('update memberships set active=true where user_id=$1', [officer])
    })
    await t.test('assignments enforce assignee access, transitions, versioning and append audit', async () => {
      await asRole('service_role')
      const id = crypto.randomUUID()
      await db.query('select create_assignment($1,$2,$3,$4,$5)', [org, supervisor, id, officer, 'Inspect package A'])
      const update = (actor, version, status) => db.query('select update_assignment($1,$2,$3,$4,$5)', [org, actor, id, version, status])
      await assert.rejects(update(peer, 1, 'in_progress'), { code: '42501' })
      await assert.rejects(update(officer, 1, 'closed'), { code: '40001' })
      await update(officer, 1, 'in_progress')
      await assert.rejects(update(officer, 1, 'submitted'), { code: '40001' })
      await update(officer, 2, 'submitted'); await update(supervisor, 3, 'closed')
      assert.equal((await db.query('select status from assignments where id=$1', [id])).rows[0].status, 'closed')
    })
    await t.test('server audit sequence is complete and quotas are independent by window', async () => {
      await asRole('service_role')
      const rows = (await db.query('select * from server_audit where org_id=$1 order by sequence', [org])).rows
      assert.equal(rows.length, 7)
      for (let index = 0; index < rows.length; index++) {
        assert.equal(Number(rows[index].sequence), index + 1)
        assert.equal(rows[index].previous_hash, index ? rows[index - 1].hash : 'GENESIS')
        assert.match(rows[index].hash, /^[a-f0-9]{64}$/)
      }
      const consume = (seconds) => db.query("select consume_quota('test-user',1,$1) as allowed", [seconds])
      assert.equal((await consume(60)).rows[0].allowed, true)
      assert.equal((await consume(60)).rows[0].allowed, false)
      assert.equal((await consume(86400)).rows[0].allowed, true)
    })
  } finally { await db.close() }
})
