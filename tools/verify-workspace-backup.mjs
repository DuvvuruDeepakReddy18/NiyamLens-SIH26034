import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readBoundedFile } from './verify-cloud-export.mjs'
import { BACKUP_LIMITS, rehearseWorkspaceRestore, currentMigrationManifest } from './workspace-backup.mjs'

export async function main(args) {
  if (args.length === 1 && args[0] === '--schema-manifest') return { schema: await currentMigrationManifest() }
  if (args.length !== 1 || args[0].startsWith('--')) throw new Error('BACKUP_USAGE_INVALID')
  const bytes = await readBoundedFile(args[0], BACKUP_LIMITS.fileBytes)
  let bundle
  try { bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('BACKUP_JSON_INVALID') }
  return { ...await rehearseWorkspaceRestore(bundle), artifactBytes: bytes.length, artifactSha256: createHash('sha256').update(bytes).digest('hex') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)) }
  catch (error) {
    console.error(JSON.stringify({ passed: false, error: /^BACKUP_[A-Z_]+$/.test(error?.message || '') ? error.message : 'BACKUP_READ_OR_REHEARSAL_FAILED', ...(typeof error.noPartialRestore === 'boolean' ? { noPartialRestore: error.noPartialRestore } : {}) }))
    process.exitCode = 1
  }
}
