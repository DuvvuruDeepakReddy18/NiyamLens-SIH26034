// Literal recognition diagnostic only. This does NOT associate tokens with
// declaration headings, identify legal compliance, or choose a winning reading.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { normalizeCriticalValue } from '../../src/lib/criticalFieldBenchmark.mjs'

const root = new URL('../../', import.meta.url)
const inputUrls = [new URL('english-strategies-raw.json', import.meta.url), new URL('../recognition-2026-09-04/rapidocr-default-raw.json', import.meta.url)]
const manifestBytes = await readFile(new URL('datasets/critical-fields.v1.json', root))
const manifest = JSON.parse(manifestBytes)
const patterns = {
  mrp: /(?<![\p{L}\p{N}./])\d+(?:\.\d+)?(?![\p{L}\p{N}./])/gu,
  netQuantity: /(?<![\p{L}\p{N}.,])\d+(?:[.,]\d+)?\s*(?:kilograms?|millilitres?|milliliters?|litres?|liters?|grams?|kg|ml|g|l|ℓ)(?![\p{L}\p{N}])/giu,
  packDate: /(?<!\d)\d{1,2}([/.-])\d{1,2}\1(?:\d{4}|\d{2})(?!\d)/g,
}
const runs = []
for (const url of inputUrls) {
  const bytes = await readFile(url)
  const input = JSON.parse(bytes)
  for (const mode of [...new Set(input.rows.map(row => row.mode))]) {
    const rows = input.rows.filter(row => row.mode === mode)
    if (rows.length !== manifest.samples.length) throw new Error('Only complete all-photo configurations may be compared here')
    const fields = []
    for (const sample of manifest.samples) {
      const row = rows.find(item => item.sampleId === sample.id)
      if (!row || row.sourceSha256 !== sample.sha256 || row.manuallyEdited !== false) throw new Error('Row identity/edit status mismatch')
      for (const field of ['mrp', 'netQuantity', 'packDate']) {
        const label = sample.fields[field]
        if (!label.metricEligible || label.status !== 'readable') continue
        const tokens = [...row.rawText.matchAll(patterns[field])]
        const match = !row.error && tokens.find(token => normalizeCriticalValue(field, token[0]) === normalizeCriticalValue(field, label.value))
        const index = match?.index ?? -1
        const line = index < 0 ? null : row.rawText.slice(row.rawText.lastIndexOf('\n', index) + 1, row.rawText.indexOf('\n', index) < 0 ? undefined : row.rawText.indexOf('\n', index))
        fields.push({ sampleId: sample.id, field, expected: label.value, rawTokenPresent: Boolean(match), matchedToken: match?.[0] ?? null, matchedLine: line, error: row.error || null })
      }
    }
    runs.push({ mode, rawTokenPresent: fields.filter(field => field.rawTokenPresent).length, eligibleTokens: fields.length, inferenceMs: rows.reduce((sum, row) => sum + row.metadata.elapsedMs, 0), inputSha256: createHash('sha256').update(bytes).digest('hex'), fields })
  }
}
const report = { purpose: 'Literal token-presence diagnostics; not field extraction accuracy', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), warning: 'A matching number anywhere in OCR can belong to another field. No heading/location association or accepted verdict is inferred. Quantity spelling/case normalization only; no digit repair or arithmetic. This previously used eight-image development corpus has provisional AI labels, not human-reviewed holdout ground truth.', runs }
await writeFile(new URL('token-diagnostic.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify(runs.map(({ mode, rawTokenPresent, eligibleTokens, inferenceMs }) => ({ mode, rawTokenPresent, eligibleTokens, inferenceMs })), null, 2))
