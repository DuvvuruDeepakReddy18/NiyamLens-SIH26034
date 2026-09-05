// Read-only source audit plus lossless local viewing copies. Never alters JPEGs.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const selection = JSON.parse(await readFile('../NiyamLens_Field_Review_Kit_2026-09-05-v2/selection-manifest.json', 'utf8'))
const photoRoot = 'C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02'
const directory = resolve('reports/ai-reference-2026-09-05')
await mkdir(directory, { recursive: true })
const report = { kind: 'strict-JPEG-source-validation-no-OCR', checkedAt: new Date().toISOString(), decoder: { sharp: sharp.versions.sharp, vips: sharp.versions.vips }, rows: [], limitations: ['Decoder success does not prove capture quality or label readability.', 'PNG viewing copies preserve decoded pixel values and dimensions; original JPEG bytes remain untouched.'] }
for (const sample of selection.samples) {
  const bytes = await readFile(resolve(photoRoot, sample.sourcePath))
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== sample.sha256 || bytes.length !== sample.byteLength) throw new Error('SOURCE_CHANGED: ' + sample.id)
  const row = { id: sample.id, sha256: hash, bytes: bytes.length, strictDecoded: false }
  try {
    const { data, info } = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true })
    Object.assign(row, { strictDecoded: true, width: info.width, height: info.height })
    if (['PUBLIC-016', 'PUBLIC-018', 'PUBLIC-021'].includes(sample.id)) {
      const colors = new Set()
      for (let i = info.width * (info.height - 100) * info.channels; i < data.length; i += info.channels) colors.add([...data.subarray(i, i + 3)].join(','))
      row.distinctBottom100RowColors = colors.size
      const png = await sharp(data, { raw: info }).png().toBuffer()
      const copy = `${sample.id}-lossless-view.png`
      await writeFile(resolve(directory, copy), png, { flag: 'wx' })
      row.viewingCopy = copy
      row.viewingCopySha256 = createHash('sha256').update(png).digest('hex')
    }
  } catch (error) { row.error = error.message }
  report.rows.push(row)
}
await writeFile(resolve(directory, 'source-quality.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ checked: report.rows.length, errors: report.rows.filter(row => row.error), copies: report.rows.filter(row => row.viewingCopy).map(row => resolve(directory, row.viewingCopy)) }))
