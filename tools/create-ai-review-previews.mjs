// Diagnostic viewing derivatives only; no OCR and no source modifications.
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = 'reports/ai-reference-2026-09-05'
const records = []
for (const id of ['PUBLIC-016', 'PUBLIC-018', 'PUBLIC-021']) {
  const source = await readFile(`${root}/${id}-lossless-view.png`)
  const bytes = await sharp(source, { failOn: 'warning' }).resize({ width: 1100, height: 1400, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const path = `${root}/${id}-overview.png`
  await writeFile(path, bytes, { flag: 'wx' })
  records.push({ id, path, kind: 'downsampled-overview-for-visual-inspection-only', sourceSha256: createHash('sha256').update(source).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') })
}
await writeFile(`${root}/viewing-derivatives.json`, JSON.stringify(records, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(records))
