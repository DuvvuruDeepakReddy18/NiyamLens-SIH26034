#!/usr/bin/env node
// Optional experimental browser engine assets only. Never uploads photographs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/ocr/paddle-v1');
const MAX_DOWNLOAD_BYTES = 120_000_000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
let downloadedBytes = 0;
const manifest = {
  schemaVersion: 1,
  assetId: 'paddle-v1',
  preparedOn: '2026-09-04',
  purpose: 'Optional local browser OCR experiment; recognition quality and browser compatibility must be separately verified.',
  sdkVersion: '0.4.2',
  onnxRuntimeVersion: '1.24.3',
  photosUploaded: false,
  noRuntimeCdnFallback: 'Caller must explicitly provide same-origin model URLs, a custom same-origin worker and ortOptions.wasmPaths. This preparation script does not modify SDK behaviour or application defaults.',
  runtimeOptions: { backend: 'wasm', numThreads: 1, proxy: false, wasmPaths: '/ocr/paddle-v1/runtime/' },
  workerUrl: '/ocr/paddle-v1/worker.js',
  modelAssets: {},
  sourceHashPolicy: 'Local SDK/runtime files and downloaded model archives must match pinned SHA-256 digests. First-source capture is an explicit bootstrap step, never automatic trust on every run.',
  licenses: 'Original worker comments are preserved byte-for-byte. See licenses/ and per-artifact source records. Project licences alone do not independently prove all model-training data or redistribution rights.',
  artifacts: [],
};

const MODELS = [
  { role: 'det', name: 'PP-OCRv6_small_det', bytes: 9_891_840, sha256: 'd218f6fbf0f1c23d2161bd6ac7f5eaa6104fa89955c09290497e31008e2618e4' },
  { role: 'rec', name: 'PP-OCRv6_small_rec', bytes: 21_319_680, sha256: 'd267ab077a44a0eedb1ea8f8c542d263f211de8e9d7a029bf9fcfff7e5a88fb1' },
];
const DOWNLOADS = [
  { file: 'licenses/PaddleOCR-LICENSE.txt', url: 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/LICENSE', maxBytes: 100_000, sha256: '3840c5c0c61c294264d2dd77b8777be6ddd90121ef4e0e64abcd22edea581d6e', license: 'Apache-2.0 upstream project licence' },
  { file: 'licenses/ONNXRuntime-LICENSE.txt', url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.24.3/LICENSE', maxBytes: 100_000, sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c', license: 'MIT' },
  { file: 'licenses/ONNXRuntime-ThirdPartyNotices.txt', url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.24.3/ThirdPartyNotices.txt', maxBytes: 1_000_000, sha256: '0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2', license: 'Upstream third-party notices' },
];
const LOCAL = [
  { from: 'node_modules/@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js', to: 'worker.js', sha256: '477db3f009c118823a5f9ebe15f1e96c1c464165715ba28a9884290f61addf52', sourceUrl: 'https://registry.npmjs.org/@paddleocr/paddleocr-js/-/paddleocr-js-0.4.2.tgz', license: 'Apache-2.0 SDK; embedded dependency notices retained in original bytes' },
  { from: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs', to: 'runtime/ort-wasm-simd-threaded.jsep.mjs', sha256: '9a99acd12acc495184c9ea4d458ac9424f8180aacfbc7b8371ed64f9351e4a81', sourceUrl: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.24.3.tgz', license: 'MIT plus bundled third-party components' },
  { from: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm', to: 'runtime/ort-wasm-simd-threaded.jsep.wasm', sha256: '2e0a3d0e3f6b7c13ecfaba38c13691fd19c9ed470e72f9d7d8416ca59ab6dbcd', sourceUrl: 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.24.3.tgz', license: 'MIT plus bundled third-party components' },
];

function target(relative) {
  const resolved = path.resolve(OUT, relative);
  if (!resolved.startsWith(`${OUT}${path.sep}`)) throw new Error(`Unsafe output path: ${relative}`);
  return resolved;
}

function verify(bytes, expected, label) {
  const actual = sha256(bytes);
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error(`No pinned source digest for ${label}; source review is required.`);
  if (expected && actual !== expected) throw new Error(`SHA-256 mismatch for ${label}: ${actual}`);
  return actual;
}

async function readIfExists(file) {
  try { return await fs.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeNewOrIdentical(relative, bytes) {
  const file = target(relative);
  const existing = await readIfExists(file);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error(`Refusing to overwrite differing existing artifact: ${relative}`);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes, { flag: 'wx' });
}

async function download(item) {
  const existing = await readIfExists(target(item.file));
  if (existing) { verify(existing, item.sha256, item.file); return existing; }
  if (!item.sha256) throw new Error(`Unpinned download blocked: ${item.file}`);
  console.log(`Downloading pinned asset: ${item.file}`);
  const response = await fetch(item.url, { redirect: 'error', signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`${item.file}: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > item.maxBytes) throw new Error(`${item.file}: advertised download exceeds limit`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    downloadedBytes += chunk.byteLength;
    if (size > item.maxBytes || downloadedBytes > MAX_DOWNLOAD_BYTES) throw new Error('Asset download byte budget exceeded');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  if (item.bytes !== undefined && size !== item.bytes) throw new Error(`${item.file}: size changed: ${size}`);
  verify(bytes, item.sha256, item.file);
  await writeNewOrIdentical(item.file, bytes);
  return bytes;
}

// Parse bounded tar resources in memory; never extract archive-controlled paths.
function modelResources(tar, name) {
  const entries = [];
  let offset = 0;
  const field = (start, length) => tar.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '').trim();
  while (offset + 512 <= tar.length) {
    if (tar.subarray(offset, offset + 512).every((byte) => byte === 0)) break;
    if (entries.length >= 64) throw new Error(`${name}: too many tar resources`);
    const sizeText = field(offset + 124, 12);
    if (!/^[0-7]+$/.test(sizeText)) throw new Error(`${name}: invalid tar size`);
    const size = Number.parseInt(sizeText, 8);
    const start = offset + 512;
    if (!Number.isSafeInteger(size) || size < 0 || start + size > tar.length) throw new Error(`${name}: truncated tar entry`);
    const entryName = field(offset, 100);
    const type = tar[offset + 156];
    if (type === 0 || type === 48) entries.push({ name: entryName, bytes: tar.subarray(start, start + size) });
    else if (![53, 120, 103].includes(type)) throw new Error(`${name}: unsupported tar entry type ${type}`);
    offset = start + Math.ceil(size / 512) * 512;
  }
  const find = (filename) => {
    const matches = entries.filter((entry) => entry.name === filename || entry.name.endsWith(`/${filename}`));
    if (matches.length !== 1) throw new Error(`${name}: expected exactly one ${filename}`);
    return matches[0];
  };
  const config = find('inference.yml');
  const model = find('inference.onnx');
  const text = config.bytes.toString('utf8');
  const declared = text.match(/^\s*model_name:\s*["']?([^\s"']+)["']?\s*$/m)?.[1];
  if (declared !== name) throw new Error(`${name}: inference.yml model_name mismatch (${declared})`);
  return {
    declaredModelName: declared,
    resources: entries.map((entry) => ({ name: entry.name, bytes: entry.bytes.length, sha256: sha256(entry.bytes) })),
    requiredResourcesPresent: model.bytes.length > 0 && config.bytes.length > 0,
    browserInferenceVerified: false,
  };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Unknown argument: this version only accepts pinned assets');
  for (const [name, version] of [['@paddleocr/paddleocr-js', '0.4.2'], ['onnxruntime-web', '1.24.3']]) {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
    if (pkg.version !== version) throw new Error(`${name} must be exactly ${version}; found ${pkg.version}`);
  }
  const sdk = await fs.readFile(path.join(ROOT, 'node_modules/@paddleocr/paddleocr-js/dist/index.mjs'), 'utf8');
  for (const item of LOCAL) {
    const bytes = await fs.readFile(path.join(ROOT, item.from));
    const digest = verify(bytes, item.sha256, item.from);
    await writeNewOrIdentical(item.to, bytes);
    manifest.artifacts.push({ path: item.to, bytes: bytes.length, sha256: digest, sourceUrl: item.sourceUrl, sourceEntry: item.from.replace(/^node_modules\//, ''), license: item.license });
  }
  for (const item of MODELS) {
    const filename = `${item.name}_onnx_infer.tar`;
    const url = `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/${filename}`;
    if (!sdk.includes(url)) throw new Error(`Official model URL absent from pinned SDK: ${url}`);
    const file = `models/${filename}`;
    const bytes = await download({ ...item, file, url, maxBytes: 40_000_000 });
    const resources = modelResources(bytes, item.name);
    manifest.modelAssets[item.role] = { modelName: item.name, url: `/ocr/paddle-v1/${file}` };
    manifest.artifacts.push({ path: file, bytes: bytes.length, sha256: sha256(bytes), sourceUrl: url, license: 'Official Paddle model archive; upstream PaddleOCR project Apache-2.0 licence retained separately; archive resource list retained for review', ...resources });
  }
  for (const item of DOWNLOADS) {
    const bytes = await download(item);
    manifest.artifacts.push({ path: item.file, bytes: bytes.length, sha256: sha256(bytes), sourceUrl: item.url, license: item.license });
  }
  // Preserve dependency metadata and available upstream notices, not invented licences.
  for (const [pkg, files] of [
    ['@paddleocr/paddleocr-js', ['package.json', 'README.md']],
    ['onnxruntime-web', ['package.json']],
    ['@techstark/opencv-js', ['package.json', 'LICENSE']],
    ['js-yaml', ['package.json', 'LICENSE']],
    ['clipper-lib', ['package.json', 'clipper.js']],
  ]) {
    for (const filename of files) {
      const bytes = await fs.readFile(path.join(ROOT, 'node_modules', pkg, filename));
      const file = `licenses/${pkg.replace(/^@/, '').replaceAll('/', '-')}/${filename}`;
      await writeNewOrIdentical(file, bytes);
      manifest.artifacts.push({ path: file, bytes: bytes.length, sha256: sha256(bytes), sourcePackage: pkg, sourceEntry: filename, purpose: 'Preserved installed-package metadata/licence/source notices; transitive dependency versions do not establish exact bundled-worker versions' });
    }
  }
  manifest.totalArtifactBytes = manifest.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  await writeNewOrIdentical('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  console.log(JSON.stringify({ output: path.relative(ROOT, OUT), downloadedBytes, maximumDownloadBytes: MAX_DOWNLOAD_BYTES, totalArtifactBytes: manifest.totalArtifactBytes, artifacts: manifest.artifacts.length, modelAssets: manifest.modelAssets, browserInferenceVerified: false, hashes: manifest.artifacts.map(({ path: file, sha256: digest }) => ({ file, sha256: digest })) }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
