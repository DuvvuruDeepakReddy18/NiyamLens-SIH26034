import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { failure } from '../server/security.mjs'

const migrationNames = [
  '202609040001_workspaces.sql',
  '202609040002_assignment_transactions.sql',
  '202609050001_business_conflict_http_409.sql',
]

const expectConflict = promise => assert.rejects(promise, error => {
  assert.equal(error.code, 'PT409')
  return true
})

test('forward migration uses PT409 for durable business conflicts without changing state or idempotent replays', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const org = '10000000-0000-4000-8000-000000000001'
  const officer = '20000000-0000-4000-8000-000000000001'
  const peer = '20000000-0000-4000-8000-000000000002'
  const supervisor = '20000000-0000-4000-8000-000000000003'
  const caseName = 'pt409-case-01'
  const assignment = '30000000-0000-4000-8000-000000000001'
  const reviewOperation = '40000000-0000-4000-8000-000000000001'
  const staleReview = '40000000-0000-4000-8000-000000000002'
  const payload = { automatedResult: { status: 'manual_review' }, evidenceItems: [] }
  const reason = 'Compared the preserved package evidence and recorded a review.'
  const snapshot = async () => {
    const count = async table => (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n
    const row = (await db.query('select version,payload_hash from cases where org_id=$1 and id=$2', [org, caseName])).rows[0] || null
    const task = (await db.query('select version,status,package_ref from assignments where id=$1', [assignment])).rows[0] || null
    return { cases: await count('cases'), reviews: await count('case_reviews'), assignments: await count('assignments'), audit: await count('server_audit'), row, task }
  }
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
    for (const name of migrationNames) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    await db.query('insert into auth.users values($1),($2),($3)', [officer, peer, supervisor])
    await db.query("insert into organizations(id,name) values($1,'PT409 test')", [org])
    await db.query("insert into memberships(org_id,user_id,role) values($1,$2,'officer'),($1,$3,'officer'),($1,$4,'supervisor')", [org, officer, peer, supervisor])

    const seal = (actor = officer, hash = 'original-hash') => db.query('select commit_case($1,$2,$3,$4,$5) as version', [org, actor, caseName, payload, hash])
    assert.equal((await seal()).rows[0].version, 1)
    const sealed = await snapshot()
    assert.equal((await seal()).rows[0].version, 1)
    assert.deepEqual(await snapshot(), sealed)
    await expectConflict(seal(officer, 'changed-hash'))
    await expectConflict(seal(peer, 'original-hash'))
    assert.deepEqual(await snapshot(), sealed)

    const review = (operation, version) => db.query('select review_case($1,$2,$3,$4,$5,$6,$7) as version', [org, supervisor, caseName, operation, version, 'manual_review', reason])
    assert.equal((await review(reviewOperation, 1)).rows[0].version, 2)
    const reviewed = await snapshot()
    assert.equal((await review(reviewOperation, 1)).rows[0].version, 2)
    assert.deepEqual(await snapshot(), reviewed)
    await expectConflict(review(staleReview, 1))
    assert.deepEqual(await snapshot(), reviewed)

    const createAssignment = reference => db.query('select create_assignment($1,$2,$3,$4,$5) as id', [org, supervisor, assignment, officer, reference])
    assert.equal((await createAssignment('Inspect package A')).rows[0].id, assignment)
    const assigned = await snapshot()
    assert.equal((await createAssignment('Inspect package A')).rows[0].id, assignment)
    assert.deepEqual(await snapshot(), assigned)
    await expectConflict(createAssignment('Altered package reference'))
    assert.deepEqual(await snapshot(), assigned)

    const advance = (version, status) => db.query('select update_assignment($1,$2,$3,$4,$5) as version', [org, officer, assignment, version, status])
    await expectConflict(advance(1, 'submitted'))
    assert.deepEqual(await snapshot(), assigned)
    assert.equal((await advance(1, 'in_progress')).rows[0].version, 2)
    const advanced = await snapshot()
    await expectConflict(advance(1, 'submitted'))
    await expectConflict(advance(2, 'closed'))
    assert.deepEqual(await snapshot(), advanced)

    const definitions = (await db.query(`select proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[]) order by proname`, [['commit_case', 'review_case', 'create_assignment', 'update_assignment']])).rows
    assert.equal(definitions.length, 4)
    assert.ok(definitions.every(row => row.prosecdef && row.proconfig?.includes('search_path=public, pg_temp')))
    for (const signature of ['commit_case(uuid,uuid,text,jsonb,text)', 'review_case(uuid,uuid,text,uuid,integer,text,text)', 'create_assignment(uuid,uuid,uuid,uuid,text)', 'update_assignment(uuid,uuid,uuid,integer,text)']) {
      const privileges = (await db.query("select has_function_privilege('service_role',$1,'execute') as service,has_function_privilege('authenticated',$1,'execute') as authenticated,has_function_privilege('anon',$1,'execute') as anon", [`public.${signature}`])).rows[0]
      assert.deepEqual(privileges, { service: true, authenticated: false, anon: false })
    }
  } finally { await db.close() }
})

test('API maps PT409 to one stable sanitized HTTP 409 response while retaining 40001 compatibility', () => {
  const response = () => ({
    headers: {}, code: 0, body: null,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return body },
  })
  const conflict = response()
  failure(conflict, { code: 'PT409', message: 'private row and actor details' })
  assert.equal(conflict.code, 409)
  assert.deepEqual(conflict.body, { error: 'This operation conflicts with an existing record. Refresh and review before retrying.' })
  assert.doesNotMatch(conflict.body.error, /private|actor/i)
  const serialization = response()
  failure(serialization, { code: '40001', message: 'serialization retry required' })
  assert.equal(serialization.code, 409)
})
