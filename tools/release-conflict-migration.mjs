// A narrow, guarded function-only release. This is NOT a workspace/Auth/Storage backup.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const PROJECT = 'sivqthnclblqtqshexgx'
export const SIGNATURES = ['commit_case(uuid,uuid,text,jsonb,text)', 'review_case(uuid,uuid,text,uuid,integer,text,text)', 'create_assignment(uuid,uuid,uuid,uuid,text)', 'update_assignment(uuid,uuid,uuid,integer,text)']
const directory = resolve('.niyamlens-private/releases/rc6-conflict-20260905-v2')
const sha = value => createHash('sha256').update(value).digest('hex')
const must = (value, code) => { if (!value) throw new Error(code) }
const literal = value => `'${value.replaceAll("'", "''")}'`
export const metadataSql = `select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition,
  p.prosrc as body, md5(p.prosrc) as body_md5, pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer, p.proconfig as config,
  has_function_privilege('anon',p.oid,'execute') as anon,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated,
  has_function_privilege('service_role',p.oid,'execute') as service
  from pg_proc p where p.oid in (${SIGNATURES.map(s => `'public.${s}'::regprocedure`).join(',')}) order by p.proname;`
async function query(sqlFile) {
  let result
  try {
    result = await promisify(execFile)(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'db', 'query', '--linked', '--project-ref', PROJECT, '--file', sqlFile, '--output', 'json'], { timeout: 60000, maxBuffer: 1000000 })
    return JSON.parse(result.stdout).rows
  } catch { throw new Error('MIGRATION_QUERY_FAILED_NO_RAW_PROVIDER_OUTPUT') }
}
export function validateFunctions(rows, code) {
  must(Array.isArray(rows) && rows.length === 4, 'FOUR_FUNCTIONS_REQUIRED')
  for (const signature of SIGNATURES) {
    const row = rows.find(r => r.signature.replace(/^public\./, '') === signature)
    must(row && row.owner === 'postgres' && row.security_definer && row.service && !row.anon && !row.authenticated && row.config?.includes('search_path=public, pg_temp'), 'FUNCTION_SCOPE_OR_PRIVILEGES_CHANGED')
    must(row.body.includes(`errcode='${code}'`) && !row.body.includes(`errcode='${code === '40001' ? 'PT409' : '40001'}'`), 'FUNCTION_RELEASE_NOT_EXPECTED')
  }
  return rows
}
export function guards(rows) {
  return `do $guard$ begin\n${rows.map(r => `if (select md5(prosrc) from pg_proc where oid=${literal('public.' + r.signature.replace(/^public\./, ''))}::regprocedure) <> ${literal(r.body_md5)} then raise exception 'Function drift; migration not applied'; end if;`).join('\n')}\nend $guard$;\n`
}
async function main(args) {
  must(args.length === 1 && ['--prepare', '--rehearse', '--apply', '--verify'].includes(args[0]), 'MIGRATION_MODE_REQUIRED')
  must(await promisify(execFile)('git', ['check-ignore', '--quiet', '.niyamlens-private/releases/placeholder']).then(() => true, () => false), 'PRIVATE_DIRECTORY_NOT_IGNORED')
  if (args[0] === '--prepare') {
    await mkdir(resolve('.niyamlens-private/releases'), { recursive: true })
    await mkdir(directory, { recursive: false })
    const readPath = join(directory, 'read-functions.sql')
    await writeFile(readPath, `begin transaction isolation level repeatable read read only;\n${metadataSql}\ncommit;`, { flag: 'wx' })
    const before = validateFunctions(await query(readPath), '40001')
    const migration = await readFile('supabase/migrations/202609050001_business_conflict_http_409.sql', 'utf8')
    // All four bodies must differ only in the explicitly reviewed business error code.
    for (const row of before) {
      const name = row.signature.split('(')[0].replace(/^public\./, '')
      const next = migration.match(new RegExp(`function public\\.${name}\\([^]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1]
      // The inspected live SQL was pasted without indentation. Preserve all
      // intra-line text; only line endings and leading/trailing indentation differ.
      const normalize = s => s.replace(/\r\n/g, '\n').trim().split('\n').map(line => line.trim()).join('\n')
      must(next && normalize(next) === normalize(row.body).replaceAll("errcode='40001'", "errcode='PT409'"), 'UNREVIEWED_FUNCTION_BODY_CHANGE')
    }
    const permissions = `revoke all on function ${SIGNATURES.map(s => 'public.' + s).join(',')} from public,anon,authenticated;\ngrant execute on function ${SIGNATURES.map(s => 'public.' + s).join(',')} to service_role;\n`
    const rollback = `-- Exact pre-release definitions. Restores functions only; no table or account data.\nbegin;\nset local lock_timeout='5s';\n${before.map(r => r.definition + ';').join('\n')}\n${permissions}commit;\n`
    await writeFile(join(directory, 'rollback-functions.sql'), rollback, { flag: 'wx', mode: 0o600 })
    await writeFile(join(directory, 'before.json'), JSON.stringify({ project: PROJECT, observedAt: new Date().toISOString(), kind: 'function-only-rollback-not-workspace-backup', migrationSha256: sha(migration), rollbackSha256: sha(rollback), functions: before }, null, 2), { flag: 'wx', mode: 0o600 })
    const prefix = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='20s';\n${guards(before)}${migration}\n`
    await writeFile(join(directory, 'rehearse.sql'), prefix + metadataSql + '\nrollback;\n', { flag: 'wx' })
    await writeFile(join(directory, 'apply.sql'), prefix + metadataSql + '\ncommit;\n', { flag: 'wx' })
    console.log(JSON.stringify({ passed: true, mode: 'prepared-read-only', functions: 4, backup: 'function definitions and restricted execute grants only', directory, migrationSha256: sha(migration), rollbackSha256: sha(rollback) }))
    return
  }
  const before = JSON.parse(await readFile(join(directory, 'before.json'), 'utf8'))
  must(before.project === PROJECT && before.migrationSha256 === sha(await readFile('supabase/migrations/202609050001_business_conflict_http_409.sql', 'utf8')), 'MIGRATION_HASH_CHANGED')
  if (args[0] === '--verify') {
    validateFunctions(await query(join(directory, 'read-functions.sql')), 'PT409')
    console.log(JSON.stringify({ passed: true, mode: 'live-function-readback', functions: 4, publicRolesCannotExecute: true }))
    return
  }
  const mode = args[0].slice(2)
  const originalMigration = await readFile('supabase/migrations/202609050001_business_conflict_http_409.sql', 'utf8')
  const expectedSql = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='20s';\n${guards(before.functions)}${originalMigration}\n${metadataSql}\n${mode === 'rehearse' ? 'rollback' : 'commit'};\n`
  must(await readFile(join(directory, `${mode}.sql`), 'utf8') === expectedSql, 'RELEASE_SQL_ARTIFACT_CHANGED')
  must(sha(await readFile(join(directory, 'rollback-functions.sql'), 'utf8')) === before.rollbackSha256, 'ROLLBACK_ARTIFACT_CHANGED')
  if (mode === 'apply') {
    const rehearsal = JSON.parse(await readFile(join(directory, 'rehearsal-result.json'), 'utf8'))
    must(rehearsal.passed && rehearsal.migrationSha256 === before.migrationSha256, 'SUCCESSFUL_SAME_MIGRATION_REHEARSAL_REQUIRED')
    await writeFile(join(directory, 'apply-attempt.json'), JSON.stringify({ startedAt: new Date().toISOString(), project: PROJECT, migrationSha256: before.migrationSha256 }), { flag: 'wx' })
  }
  validateFunctions(await query(join(directory, `${mode}.sql`)), 'PT409')
  const after = validateFunctions(await query(join(directory, 'read-functions.sql')), mode === 'rehearse' ? '40001' : 'PT409')
  if (mode === 'rehearse') must(JSON.stringify(after) === JSON.stringify(before.functions), 'REHEARSAL_DID_NOT_RESTORE_EXACT_FUNCTIONS')
  const result = { passed: true, mode, migrationSha256: before.migrationSha256, observedAt: new Date().toISOString(), functions: 4, tableOrAccountChanges: false }
  await writeFile(join(directory, mode === 'rehearse' ? 'rehearsal-result.json' : 'apply-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(result))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ passed: false, code: /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'MIGRATION_STOPPED_CHECK_PRIVATE_RECEIPTS' })); process.exitCode = 1
})
