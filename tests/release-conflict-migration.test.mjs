import test from 'node:test'
import assert from 'node:assert/strict'
import { SIGNATURES, validateFunctions, guards } from '../tools/release-conflict-migration.mjs'
const rows = () => SIGNATURES.map(signature => ({ signature, owner: 'postgres', security_definer: true, service: true, anon: false, authenticated: false, config: ['search_path=public, pg_temp'], body: "raise exception 'conflict' using errcode='40001';", body_md5: 'e'.repeat(32) }))
test('migration preflight rejects wrong release, absent functions and unsafe execute grants', () => {
  assert.equal(validateFunctions(rows(), '40001').length, 4)
  assert.throws(() => validateFunctions(rows().slice(1), '40001'))
  assert.throws(() => validateFunctions(rows(), 'PT409'))
  for (const change of [{ anon: true }, { authenticated: true }, { service: false }, { security_definer: false }, { config: [] }, { owner: 'unexpected' }]) {
    const input = rows(); Object.assign(input[0], change)
    assert.throws(() => validateFunctions(input, '40001'))
  }
})
test('migration guards bind each exact function signature and pre-release body digest', () => {
  const sql = guards(rows())
  assert.equal((sql.match(/raise exception/g) || []).length, 4)
  for (const signature of SIGNATURES) assert.ok(sql.includes(`'public.${signature}'::regprocedure`))
  assert.ok(sql.includes('e'.repeat(32)))
})
