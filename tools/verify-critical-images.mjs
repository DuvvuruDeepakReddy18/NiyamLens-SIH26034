#!/usr/bin/env node
// Strict, local-only image provenance check; never substitutes missing photos.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCriticalFieldManifest } from '../src/lib/criticalFieldBenchmark.mjs'
import { verifyCriticalSourceImages } from './score-critical-fields.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
export async function verifyFrozenImages(manifestFiles = ['datasets/critical-fields.v1.json', 'datasets/critical-fields.checkset.v1.json']) {
  if (!Array.isArray(manifestFiles) || !manifestFiles.length || manifestFiles.length > 10 || manifestFiles.some(file => typeof file !== 'string' || !file.endsWith('.json'))) throw new Error('Provide one to ten JSON manifest filenames.')
  const results = []
  for (const filename of manifestFiles) {
    const bytes = await readFile(resolve(root, filename))
    if (bytes.length > 1_000_000) throw new Error('Frozen image manifest exceeds its byte limit.')
    const manifest = validateCriticalFieldManifest(JSON.parse(bytes.toString('utf8')))
    results.push({ manifest: filename, manifestSha256: createHash('sha256').update(bytes).digest('hex'), ...(await verifyCriticalSourceImages(manifest, root)) })
  }
  return { results, photosVerified: results.reduce((sum, item) => sum + item.count, 0), ocrExecuted: false, humanReviewed: false, legalAccuracyEstablished: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  verifyFrozenImages(args.length ? args : undefined).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(`Frozen image verification FAILED (no photos skipped): ${error.message}\nSupply the exact original image files at their manifest paths. Do not replace hashes with newly downloaded or transformed images to make this check pass.`)
    process.exitCode = 1
  })
}
