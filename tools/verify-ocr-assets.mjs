#!/usr/bin/env node
// Offline release check. Does not download, execute OCR, or upload photographs.
import { readFile, stat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED = [
  'worker.js',
  'runtime/ort-wasm-simd-threaded.jsep.mjs',
  'runtime/ort-wasm-simd-threaded.jsep.wasm',
  'models/PP-OCRv6_small_det_onnx_infer.tar',
  'models/PP-OCRv6_small_rec_onnx_infer.tar',
  'licenses/PaddleOCR-LICENSE.txt',
  'licenses/ONNXRuntime-LICENSE.txt',
  'licenses/ONNXRuntime-ThirdPartyNotices.txt',
]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function verifyOcrAssets(directory, { packageFile = resolve(root, 'package.json') } = {}) {
  const base = await realpath(directory)
  const manifest = JSON.parse(await readFile(resolve(base, 'manifest.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(packageFile, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.assetId !== 'paddle-v1' || !Array.isArray(manifest.artifacts) || manifest.artifacts.length < REQUIRED.length || manifest.artifacts.length > 100) throw new Error('Invalid or incomplete Paddle asset manifest.')
  if (manifest.sdkVersion !== pkg.dependencies?.['@paddleocr/paddleocr-js'] || manifest.onnxRuntimeVersion !== pkg.dependencies?.['onnxruntime-web']) throw new Error('Paddle asset SDK/runtime versions do not match pinned package dependencies.')
  if (manifest.workerUrl !== '/ocr/paddle-v1/worker.js' || manifest.runtimeOptions?.wasmPaths !== '/ocr/paddle-v1/runtime/') throw new Error('Paddle worker/runtime must use the expected same-origin asset paths.')
  for (const role of ['det', 'rec']) {
    const name = `PP-OCRv6_small_${role}`
    if (manifest.modelAssets?.[role]?.modelName !== name || manifest.modelAssets[role].url !== `/ocr/paddle-v1/models/${name}_onnx_infer.tar`) throw new Error(`Paddle ${role} model identity or same-origin URL is invalid.`)
  }
  const seen = new Set()
  let totalBytes = 0
  for (const artifact of manifest.artifacts) {
    if (typeof artifact.path !== 'string' || !artifact.path || artifact.path.includes('\\') || artifact.path.split('/').some(part => !part || part === '.' || part === '..') || isAbsolute(artifact.path) || seen.has(artifact.path)) throw new Error('Paddle asset paths must be unique safe relative paths.')
    seen.add(artifact.path)
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.bytes > 100_000_000 || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) throw new Error(`Invalid size/hash metadata: ${artifact.path}`)
    const file = await realpath(resolve(base, artifact.path))
    const child = relative(base, file)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error(`Paddle asset escapes its release directory: ${artifact.path}`)
    const info = await stat(file)
    if (!info.isFile() || info.size !== artifact.bytes) throw new Error(`Paddle asset missing, truncated or changed in size: ${artifact.path}`)
    if (hash(await readFile(file)) !== artifact.sha256) throw new Error(`Paddle asset SHA-256 mismatch: ${artifact.path}`)
    totalBytes += info.size
    if (totalBytes > 150_000_000) throw new Error('Paddle asset release exceeds its byte limit.')
  }
  for (const file of REQUIRED) if (!seen.has(file)) throw new Error(`Paddle asset manifest omits a required runtime/model/licence: ${file}`)
  if (manifest.totalArtifactBytes !== totalBytes) throw new Error('Paddle asset total byte count differs from the manifest.')
  return { verified: true, artifacts: seen.size, bytes: totalBytes, networkRequests: 0, recognitionTested: false, scope: 'Release asset presence and SHA-256 integrity; not recognition quality or independent source authenticity.' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1) { console.error('Usage: node tools/verify-ocr-assets.mjs [public/ocr/paddle-v1|dist/ocr/paddle-v1]'); process.exitCode = 1 }
  else verifyOcrAssets(resolve(root, args[0] || 'public/ocr/paddle-v1')).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(`OCR asset verification failed: ${error.message}`); process.exitCode = 1 })
}
