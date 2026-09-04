import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyOcrAssets } from '../tools/verify-ocr-assets.mjs'

const template = JSON.parse(await readFile(new URL('../public/ocr/paddle-v1/manifest.json', import.meta.url), 'utf8'))
async function fixture(action) {
  const dir = await mkdtemp(join(tmpdir(), 'niyamlens-asset-contract-'))
  const manifest = structuredClone(template)
  try {
    for (const artifact of manifest.artifacts) {
      const bytes = Buffer.from(`Synthetic integrity-test bytes for ${artifact.path}`)
      await mkdir(join(dir, artifact.path, '..'), { recursive: true })
      await writeFile(join(dir, artifact.path), bytes)
      artifact.bytes = bytes.length
      artifact.sha256 = createHash('sha256').update(bytes).digest('hex')
    }
    manifest.totalArtifactBytes = manifest.artifacts.reduce((sum, item) => sum + item.bytes, 0)
    const save = () => writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
    await save()
    await action({ dir, manifest, save })
  } finally { await rm(dir, { recursive: true, force: true }) }
}

test('offline asset verification checks synthetic byte identity without claiming OCR accuracy', () => fixture(async ({ dir }) => {
  const result = await verifyOcrAssets(dir)
  assert.equal(result.verified, true)
  assert.equal(result.networkRequests, 0)
  assert.equal(result.recognitionTested, false)
}))

test('missing model is a release failure, not an optional successful skip', () => fixture(async ({ dir }) => {
  await rm(join(dir, 'models/PP-OCRv6_small_rec_onnx_infer.tar'))
  await assert.rejects(verifyOcrAssets(dir), /ENOENT/)
}))

test('same-length tampering fails the asset SHA-256 gate', () => fixture(async ({ dir }) => {
  const file = join(dir, 'worker.js'); const bytes = await readFile(file); bytes[0] ^= 1
  await writeFile(file, bytes)
  await assert.rejects(verifyOcrAssets(dir), /SHA-256 mismatch/)
}))

test('omitted required runtime and mismatched versions fail closed', () => fixture(async ({ dir, manifest, save }) => {
  manifest.sdkVersion = '0.0.0'; await save()
  await assert.rejects(verifyOcrAssets(dir), /versions/)
  manifest.sdkVersion = template.sdkVersion
  manifest.artifacts = manifest.artifacts.filter(item => item.path !== 'worker.js'); await save()
  await assert.rejects(verifyOcrAssets(dir), /omits a required/)
}))

test('asset path traversal and duplicate paths are rejected', () => fixture(async ({ dir, manifest, save }) => {
  manifest.artifacts[0].path = '../outside'; await save()
  await assert.rejects(verifyOcrAssets(dir), /safe relative/)
  manifest.artifacts[0] = structuredClone(manifest.artifacts[1]); await save()
  await assert.rejects(verifyOcrAssets(dir), /unique safe/)
}))

test('asset model URLs cannot silently move inference assets to a remote service', () => fixture(async ({ dir, manifest, save }) => {
  manifest.modelAssets.det.url = 'https://example.com/det.tar'; await save()
  await assert.rejects(verifyOcrAssets(dir), /same-origin URL/)
}))
