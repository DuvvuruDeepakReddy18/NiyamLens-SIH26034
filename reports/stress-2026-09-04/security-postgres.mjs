// Embedded PostgreSQL invariants under queued contention, not live Supabase.
// PGlite runs one local backend; this is NOT a multi-backend isolation benchmark.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

test('queued retries, competing stale reviews, role isolation and quota ceiling in actual migration SQL', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const org = '10000000-0000-4000-8000-000000000011'
  const other = '10000000-0000-4000-8000-000000000012'
  const officer = '20000000-0000-4000-8000-000000000011'
  const supervisor = '20000000-0000-4000-8000-000000000012'
  const outsider = '20000000-0000-4000-8000-000000000013'
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
    for (const name of ['202609040001_workspaces.sql', '202609040002_assignment_transactions.sql']) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    await db.query('insert into auth.users values($1),($2),($3)', [officer, supervisor, outsider])
    await db.query("insert into organizations(id,name) values($1,'Stress One'),($2,'Stress Two')", [org, other])
    await db.query("insert into memberships(org_id,user_id,role) values($1,$3,'officer'),($1,$4,'supervisor'),($2,$5,'supervisor')", [org, other, officer, supervisor, outsider])
    await db.exec('set role service_role')
    const seal = (hash = 'same-immutable-hash') => db.query('select commit_case($1,$2,$3,$4,$5) as version', [org, officer, 'stress-idempotent-case', { automatedResult: { status: 'manual_review' } }, hash])
    const seals = await Promise.all(Array.from({ length: 100 }, () => seal()))
    assert.ok(seals.every((result) => result.rows[0].version === 1))
    assert.equal((await db.query('select count(*)::int n from cases')).rows[0].n, 1)
    await assert.rejects(seal('tampered-hash'), { code: '40001' })
    const reviews = await Promise.allSettled(Array.from({ length: 30 }, () => db.query('select review_case($1,$2,$3,$4,$5,$6,$7) as version', [org, supervisor, 'stress-idempotent-case', crypto.randomUUID(), 1, 'compliant', 'Inspected the original physical package.'])))
    assert.equal(reviews.filter((item) => item.status === 'fulfilled').length, 1)
    assert.ok(reviews.filter((item) => item.status === 'rejected').every((item) => item.reason.code === '40001'))
    const quota = await Promise.all(Array.from({ length: 100 }, () => db.query("select consume_quota('stress-quota',30,86400) allowed")))
    assert.equal(quota.filter((item) => item.rows[0].allowed).length, 30)
    assert.equal((await db.query('select count(*)::int n from server_audit')).rows[0].n, 2)
    for (const table of ['cases', 'case_reviews', 'server_audit']) await assert.rejects(db.exec(`delete from ${table}`), { code: '42501' })
    await db.exec('reset role; set role authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider])
    for (const table of ['cases', 'case_reviews', 'server_audit', 'evidence_objects', 'assignments']) assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0)
    console.log(JSON.stringify({ mode: 'actual migrations / embedded PGlite, NOT live Auth or Storage', identicalSealCalls: 100, storedCases: 1, competingVersionOneReviews: 30, successfulReviews: 1, staleConflicts: 29, auditEvents: 2, quotaCalls: 100, quotaAllowed: 30, crossOrgVisibleRows: 0, caveat: 'Queued work on one embedded backend does not prove hosted multi-session isolation.' }))
  } finally { await db.close() }
})
