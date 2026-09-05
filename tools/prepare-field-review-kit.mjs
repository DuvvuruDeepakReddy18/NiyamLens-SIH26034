#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIELD_IDS = Object.freeze(['mrp', 'netQuantity', 'packDate'])
const MAX_JSON_BYTES = 20_000_000
const MAX_PHOTO_BYTES = 15 * 1024 * 1024
const MAX_TOTAL_PHOTO_BYTES = 100 * 1024 * 1024
const DEFAULT_EXPECTED_COUNT = 24

const usage = `Prepare an offline, create-only human review kit. This command reads image bytes only to hash and embed them; it does not decode, inspect, OCR or label photographs.

node tools/prepare-field-review-kit.mjs \\
  --intake C:\\path\\human-review-intake.template.json \\
  --exploratory-ocr C:\\path\\exploratory-ocr-raw-v1.json \\
  --photo-root C:\\path\\collection \\
  --output C:\\path\\NEW_REVIEW_KIT_DIRECTORY \\
  [--expected-count 24]

The output directory and all files are create-only. Keep the output outside the repository: it embeds licensed source photographs and must not be published to Git.`

const fail = message => { throw new Error(message) }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const identifier = (value, name) => {
  if (typeof value !== 'string' || value.length > 100 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) fail(`${name} must use 1–100 letters, digits, dots, underscores or hyphens.`)
  return value
}
const boundedText = (value, name, max = 4000, nullable = false) => {
  if (nullable && value === null) return value
  if (typeof value !== 'string' || value.length > max) fail(`${name} must be text of at most ${max} characters${nullable ? ' or null' : ''}.`)
  return value
}
const safeRelativePath = value => {
  if (typeof value !== 'string' || !value || value.length > 1000) fail('sourcePath must be nonempty root-relative text.')
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(normalized) || /[\u0000-\u001f:]/.test(normalized) || normalized.split('/').some(part => !part || part === '.' || part === '..')) fail('sourcePath must stay inside the selected photo root.')
  return normalized
}
const safeJsonForScript = value => JSON.stringify(value).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

async function readBounded(path, max, name) {
  const link = await lstat(path)
  if (!link.isFile() || link.isSymbolicLink() || link.size <= 0 || link.size > max) fail(`${name} must be a regular nonempty file no larger than ${max} bytes.`)
  return readFile(path)
}

async function readJson(path, name) {
  const bytes = await readBounded(path, MAX_JSON_BYTES, name)
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail(`${name} must be valid UTF-8 JSON.`) }
  return { value, bytes }
}

async function rootedPhoto(photoRoot, sourcePath) {
  const root = await realpath(photoRoot)
  const safePath = safeRelativePath(sourcePath)
  const target = await realpath(resolve(root, safePath))
  const rel = relative(root, target)
  if (!rel || isAbsolute(rel) || rel.startsWith('..')) fail('A photo resolves outside --photo-root.')
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) fail('Every photo must resolve to a regular non-symlink file.')
  return { target, safePath }
}

function mimeFor(path, bytes) {
  const ext = extname(path).toLowerCase()
  if ((ext === '.jpg' || ext === '.jpeg') && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (ext === '.webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  fail('Photo extension and bounded file signature must agree for JPEG, PNG or WebP.')
}

function validateIntake(value) {
  if (!Array.isArray(value) || value.length < 20 || value.length > 30) fail('Human-review intake must contain 20–30 photo records.')
  const ids = new Set(); const products = new Set(); const paths = new Set()
  return value.map((sample, index) => {
    if (!plain(sample)) fail(`Intake row ${index + 1} must be an object.`)
    const id = identifier(sample.id, `intake[${index}].id`)
    const productKey = boundedText(sample.productKey, `intake[${index}].productKey`, 200)
    const sourcePath = safeRelativePath(sample.sourcePath)
    if (ids.has(id) || products.has(productKey.toLowerCase()) || paths.has(sourcePath.toLowerCase())) fail('Intake IDs, product keys and source paths must be unique.')
    ids.add(id); products.add(productKey.toLowerCase()); paths.add(sourcePath.toLowerCase())
    if (sample.groundTruth !== null || Object.hasOwn(sample, 'expectedValues')) fail('Intake must not contain ground truth or expected values.')
    if (sample.collectorId !== null || sample.capturedAt !== null || sample.shape !== null || sample.previouslyUsedForDevelopment !== null || !Array.isArray(sample.scripts) || sample.scripts.length || !Array.isArray(sample.conditions) || sample.conditions.length || sample.humanMetadataReviewRequired !== true) fail('Collector, capture time, prior use, shape, scripts and conditions must remain explicitly unfilled for lead review.')
    boundedText(sample.acquiredAt, `intake[${index}].acquiredAt`, 100)
    boundedText(sample.captureRights, `intake[${index}].captureRights`, 100)
    boundedText(sample.rightsNote, `intake[${index}].rightsNote`, 4000)
    return { ...sample, id, productKey, sourcePath }
  })
}

function validateExploratory(value) {
  if (!plain(value) || value.kind !== 'exploratory-field-ocr-smoke' || value.groundTruthProvided !== false || value.isHoldout !== false || value.accuracy !== null || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 30) fail('Expected an unlabelled, non-holdout exploratory OCR smoke artifact with 1–30 rows.')
  const seen = new Set()
  return value.rows.map((row, index) => {
    if (!plain(row)) fail(`Exploratory row ${index + 1} must be an object.`)
    const sampleId = identifier(row.sampleId, `exploratory.rows[${index}].sampleId`)
    const productKey = boundedText(row.productKey, `exploratory.rows[${index}].productKey`, 200)
    const sourcePath = safeRelativePath(row.sourcePath)
    if (typeof row.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceSha256)) fail('Every exploratory row must retain its lowercase original-image SHA-256.')
    const identity = `${sampleId}\u0000${productKey.toLowerCase()}\u0000${sourcePath.toLowerCase()}\u0000${row.sourceSha256}`
    if (seen.has(identity)) fail('Exploratory exclusion rows must be unique.')
    seen.add(identity)
    return { sampleId, productKey, sourcePath, sourceSha256: row.sourceSha256 }
  })
}

async function loadIntakePhotos(intake, photoRoot) {
  let totalBytes = 0
  const hashes = new Set()
  const samples = []
  for (const sample of intake) {
    const { target, safePath } = await rootedPhoto(photoRoot, sample.sourcePath)
    const bytes = await readBounded(target, MAX_PHOTO_BYTES, 'review photo')
    totalBytes += bytes.length
    if (totalBytes > MAX_TOTAL_PHOTO_BYTES) fail('Review photo bytes exceed the 100 MiB kit bound.')
    const mime = mimeFor(safePath, bytes)
    const sha256 = digest(bytes)
    if (hashes.has(sha256)) fail('Duplicate source image bytes cannot form independent photo rows.')
    hashes.add(sha256)
    samples.push({
      id: sample.id,
      productKey: sample.productKey,
      sourcePath: safePath,
      sha256,
      byteLength: bytes.length,
      mime,
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      acquiredAt: sample.acquiredAt,
      capturedAt: sample.capturedAt,
      captureRights: sample.captureRights,
      rightsNote: sample.rightsNote,
    })
  }
  return samples
}

export function selectReservedSamples(samples, exclusions, expectedCount = DEFAULT_EXPECTED_COUNT) {
  const ids = new Set(exclusions.map(row => row.sampleId.toLowerCase()))
  const products = new Set(exclusions.map(row => row.productKey.toLowerCase()))
  const paths = new Set(exclusions.map(row => row.sourcePath.toLowerCase()))
  const hashes = new Set(exclusions.map(row => row.sourceSha256))
  const excluded = []; const reserved = []
  for (const sample of samples) {
    const matchedOn = []
    if (ids.has(sample.id.toLowerCase())) matchedOn.push('sampleId')
    if (products.has(sample.productKey.toLowerCase())) matchedOn.push('productKey')
    if (paths.has(sample.sourcePath.toLowerCase())) matchedOn.push('sourcePath')
    if (hashes.has(sample.sha256)) matchedOn.push('sourceSha256')
    if (matchedOn.length) excluded.push({ sampleId: sample.id, productKey: sample.productKey, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, matchedOn })
    else reserved.push(sample)
  }
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 30 || reserved.length !== expectedCount) fail(`Expected exactly ${expectedCount} reserved photos after exploratory-row exclusions; found ${reserved.length}.`)
  if (excluded.length !== exclusions.length) fail('Every exploratory OCR row must match exactly one intake photo by ID/product/path/hash selection evidence.')
  return { reserved, excluded }
}

const blankField = () => ({ status: 'pending', value: null, metricEligible: false, verbatim: '', notes: '' })
const blankReviewRow = sample => ({ sampleId: sample.id, sourceSha256: sample.sha256, photoReadability: 'pending', fields: Object.fromEntries(FIELD_IDS.map(field => [field, blankField()])), notes: '' })

export function buildReviewerTemplate(selection, reviewerSlot = null) {
  if (reviewerSlot !== null && !['A', 'B'].includes(reviewerSlot)) fail('Reviewer template slot must be A, B or null.')
  return {
    schemaVersion: 1,
    kind: 'niyamlens-independent-photo-review-v1',
    datasetId: selection.datasetId,
    sourceSelectionSha256: selection.sourceSelectionSha256,
    status: 'blank-reviewer-input',
    reviewerSlot,
    reviewerId: null,
    reviewedAt: null,
    timestampSource: null,
    ocrOutputsConsulted: null,
    independentPhotoReview: null,
    reviews: selection.samples.map(blankReviewRow),
    limitations: [
      'This is blank reviewer input, not a verified label set or ground truth.',
      'not_visible means not visible in this one photograph; it does not prove absence from the complete physical package.',
      'Identity, independence and non-consultation of OCR must be entered by the real reviewer and are self-attested.',
    ],
  }
}

export function buildLeadWorksheet(selection) {
  return {
    schemaVersion: 1,
    kind: 'niyamlens-field-pilot-lead-metadata-worksheet-v1',
    datasetId: selection.datasetId,
    sourceSelectionSha256: selection.sourceSelectionSha256,
    status: 'unfilled-not-import-or-freeze-ready',
    completedBy: null,
    completedAt: null,
    samples: selection.samples.map(sample => ({
      id: sample.id,
      productKey: sample.productKey,
      sourcePath: sample.sourcePath,
      sourceSha256: sample.sha256,
      acquiredAt: sample.acquiredAt,
      capturedAt: null,
      captureRights: sample.captureRights,
      rightsNote: sample.rightsNote,
      collectorId: null,
      previouslyUsedForDevelopment: null,
      shape: null,
      scripts: [],
      conditions: [],
      notes: null,
    })),
    requiredBeforePilotImport: [
      'Identify a real collectorId or responsible metadata reviewer.',
      'Investigate and truthfully record previouslyUsedForDevelopment; do not change unknown to false by assumption.',
      'Review shape, visible scripts and capture conditions from the exact photograph without OCR output.',
      'Keep capturedAt null when the source does not establish the original camera-capture time; acquiredAt is only download time.',
    ],
  }
}

function reviewHtml(kit) {
  const embedded = safeJsonForScript(kit)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'">
  <title>NiyamLens independent photo review</title>
  <style>
    :root{color-scheme:light;--ink:#133238;--muted:#587078;--paper:#f6f3e9;--card:#fffdfa;--line:#d7d5c8;--accent:#008b72;--warn:#a74e19;--focus:#005fcc}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}.shell{max-width:1500px;margin:auto;padding:20px}.banner{background:#0b4039;color:white;padding:18px 22px;border-radius:18px}.banner h1{margin:0 0 6px;font-size:24px}.banner p{margin:3px 0}.warning{margin:14px 0;padding:12px 15px;border:1px solid #db9b63;background:#fff1df;border-radius:12px;color:#71340f}.identity,.workspace,.field{background:var(--card);border:1px solid var(--line);border-radius:16px}.identity{display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px;padding:15px;margin:14px 0}.workspace{display:grid;grid-template-columns:minmax(360px,1.15fr) minmax(360px,.85fr);gap:18px;padding:16px}.photo{min-width:0}.photo img{width:100%;height:66vh;object-fit:contain;background:#1a2325;border-radius:12px}.photo-meta{margin-top:10px;display:grid;gap:4px;word-break:break-word}.review{min-width:0}.topline{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.field{padding:12px;margin:10px 0}.field h3{margin:0 0 8px;font-size:15px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}label{display:grid;gap:5px;color:var(--muted);font-size:13px}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;border:1px solid #aeb9b7;border-radius:9px;padding:9px;background:white;color:var(--ink)}textarea{min-height:62px;resize:vertical}input:focus,select:focus,textarea:focus,button:focus{outline:3px solid color-mix(in srgb,var(--focus) 28%,transparent);outline-offset:1px}.attest{display:flex;gap:9px;align-items:flex-start;color:var(--ink)}.attest input{width:auto;margin-top:4px}.actions,.nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}button{border:1px solid #75918c;background:white;color:var(--ink);border-radius:999px;padding:9px 14px;cursor:pointer}button.primary{background:var(--accent);color:white;border-color:var(--accent)}button:disabled{opacity:.45;cursor:not-allowed}.status{min-height:24px;margin-top:8px;color:var(--warn);font-weight:650}.quiet{color:var(--muted);font-size:13px}.hidden{display:none!important}@media(max-width:900px){.identity{grid-template-columns:1fr}.workspace{grid-template-columns:1fr}.photo img{height:45vh}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main class="shell">
  <section class="banner"><h1>NiyamLens independent photo review</h1><p id="dataset"></p><p>Offline file: the Content Security Policy blocks network access. Your entries remain in memory until you download JSON.</p></section>
  <div class="warning"><strong>No OCR output or expected answer is included.</strong> Review only the photograph. “Not visible” means not visible in this photograph, not absent from the full package. Do not call an export verified by the tool.</div>
  <section class="identity">
    <label>Reviewer slot<select id="reviewer-slot"><option value="">Choose A or B</option><option value="A">Independent reviewer A</option><option value="B">Independent reviewer B</option></select></label>
    <label>Reviewer code<input id="reviewer-id" maxlength="100" autocomplete="off" placeholder="Reviewer-created code"></label>
    <label class="attest"><input id="no-ocr" type="checkbox"><span>I attest that I did not consult OCR output, catalogue answers, or another review while labelling.</span></label>
    <label class="attest"><input id="independent" type="checkbox"><span>I attest that this is my own independent visual review. This is self-attested, not verified by software.</span></label>
  </section>
  <section class="workspace">
    <div class="photo">
      <img id="photo" alt="Source package-label photograph under review">
      <div class="photo-meta"><strong id="sample-title"></strong><span id="source-path"></span><span id="source-hash"></span><span id="rights"></span></div>
    </div>
    <div class="review">
      <div class="topline"><strong id="counter"></strong><span id="progress" class="quiet"></span></div>
      <label>Photo readability<select id="photo-readability"><option value="pending">Not reviewed</option><option value="sufficient_for_some_labels">Sufficient for at least one critical field</option><option value="no_critical_field_readable">No critical field readable</option><option value="image_unreadable">Image itself unreadable</option></select></label>
      <div id="fields"></div>
      <label>Photo-level notes<textarea id="photo-notes" maxlength="2000" placeholder="Visible limitations or context; do not paste OCR output"></textarea></label>
      <div class="nav"><button id="previous">Previous</button><button id="next">Next</button></div>
      <div class="actions"><button id="save-draft">Download draft JSON</button><button id="load-draft">Load draft JSON</button><input id="draft-file" class="hidden" type="file" accept="application/json"><button id="export" class="primary">Export completed review JSON</button></div>
      <div id="status" class="status" role="status" aria-live="polite"></div>
    </div>
  </section>
</main>
<script id="kit-data" type="application/json">${embedded}</script>
<script>
'use strict';
const kit=JSON.parse(document.getElementById('kit-data').textContent);
const fieldIds=['mrp','netQuantity','packDate'];
const fieldNames={mrp:'MRP',netQuantity:'Net quantity',packDate:'Pack / manufacture date'};
const statuses=[['pending','Not reviewed'],['readable','Readable — enter normalized value'],['not_visible','Not visible in this photograph'],['illegible','Visible but illegible'],['ambiguous_field','Ambiguous / conflicting field']];
const blankField=()=>({status:'pending',value:null,metricEligible:false,verbatim:'',notes:''});
const blankRow=s=>({sampleId:s.id,sourceSha256:s.sha256,photoReadability:'pending',fields:Object.fromEntries(fieldIds.map(id=>[id,blankField()])),notes:''});
let state={schemaVersion:1,kind:'niyamlens-independent-photo-review-v1',datasetId:kit.datasetId,sourceSelectionSha256:kit.sourceSelectionSha256,status:'draft-reviewer-input',reviewerSlot:null,reviewerId:null,reviewedAt:null,timestampSource:null,ocrOutputsConsulted:null,independentPhotoReview:null,reviews:kit.samples.map(blankRow),limitations:kit.limitations};
let index=0;let dirty=false;
const byId=id=>document.getElementById(id);
const fields=byId('fields');
for(const id of fieldIds){const box=document.createElement('section');box.className='field';const title=document.createElement('h3');title.textContent=fieldNames[id];box.appendChild(title);const grid=document.createElement('div');grid.className='grid';const statusLabel=document.createElement('label');statusLabel.textContent='Observation';const select=document.createElement('select');select.dataset.field=id;select.dataset.part='status';for(const pair of statuses){const option=document.createElement('option');option.value=pair[0];option.textContent=pair[1];select.appendChild(option)}statusLabel.appendChild(select);grid.appendChild(statusLabel);const valueLabel=document.createElement('label');valueLabel.textContent='Normalized value (required only if readable)';const value=document.createElement('input');value.maxLength=2000;value.autocomplete='off';value.dataset.field=id;value.dataset.part='value';value.placeholder=id==='mrp'?'Example format: 22.00':id==='netQuantity'?'Example format: 500 ml':'Exact valid printed date';valueLabel.appendChild(value);grid.appendChild(valueLabel);const verbatimLabel=document.createElement('label');verbatimLabel.textContent='Verbatim visible text (optional)';const verbatim=document.createElement('input');verbatim.maxLength=2000;verbatim.autocomplete='off';verbatim.dataset.field=id;verbatim.dataset.part='verbatim';verbatimLabel.appendChild(verbatim);grid.appendChild(verbatimLabel);const notesLabel=document.createElement('label');notesLabel.textContent='Reviewer notes';const notes=document.createElement('textarea');notes.maxLength=2000;notes.dataset.field=id;notes.dataset.part='notes';notesLabel.appendChild(notes);grid.appendChild(notesLabel);box.appendChild(grid);fields.appendChild(box)}
function current(){return state.reviews[index]}
function invalidateCompletion(){if(state.status==='reviewer-entered-complete'){state.status='draft-reviewer-input';state.reviewedAt=null;state.timestampSource=null;state.reviews=state.reviews.map(row=>{const {reviewerId,reviewedAt,ocrOutputsConsulted,independentPhotoReview,...draft}=row;return draft})}}
function syncIdentity(){invalidateCompletion();state.reviewerSlot=byId('reviewer-slot').value||null;state.reviewerId=byId('reviewer-id').value.trim()||null;state.ocrOutputsConsulted=byId('no-ocr').checked?false:null;state.independentPhotoReview=byId('independent').checked?true:null;dirty=true}
function syncRow(){invalidateCompletion();const row=current();row.photoReadability=byId('photo-readability').value;row.notes=byId('photo-notes').value;for(const id of fieldIds){const status=document.querySelector('[data-field="'+id+'"][data-part="status"]').value;const typed=document.querySelector('[data-field="'+id+'"][data-part="value"]').value.trim();row.fields[id]={status:status,value:status==='readable'?(typed||null):null,metricEligible:status==='readable',verbatim:document.querySelector('[data-field="'+id+'"][data-part="verbatim"]').value,notes:document.querySelector('[data-field="'+id+'"][data-part="notes"]').value}}dirty=true;renderProgress()}
function rowComplete(row){return row.photoReadability!=='pending'&&fieldIds.every(id=>row.fields[id].status!=='pending'&&(row.fields[id].status!=='readable'||typeof row.fields[id].value==='string'&&row.fields[id].value.length>0))}
function renderProgress(){const done=state.reviews.filter(rowComplete).length;byId('progress').textContent=done+' / '+state.reviews.length+' photos complete'}
function render(){const sample=kit.samples[index];const row=current();byId('photo').src=sample.dataUrl;byId('sample-title').textContent=sample.id+' • product '+sample.productKey;byId('source-path').textContent='Source: '+sample.sourcePath;byId('source-hash').textContent='Original SHA-256: '+sample.sha256;byId('rights').textContent='Attribution / rights: '+sample.rightsNote;byId('counter').textContent='Photo '+(index+1)+' of '+kit.samples.length;byId('photo-readability').value=row.photoReadability;byId('photo-notes').value=row.notes||'';for(const id of fieldIds){const value=row.fields[id]||blankField();document.querySelector('[data-field="'+id+'"][data-part="status"]').value=value.status;const input=document.querySelector('[data-field="'+id+'"][data-part="value"]');input.value=value.value||'';input.disabled=value.status!=='readable';document.querySelector('[data-field="'+id+'"][data-part="verbatim"]').value=value.verbatim||'';document.querySelector('[data-field="'+id+'"][data-part="notes"]').value=value.notes||''}byId('previous').disabled=index===0;byId('next').disabled=index===kit.samples.length-1;renderProgress()}
function payload(complete){syncIdentity();syncRow();if(complete){if(!state.reviewerSlot||!state.reviewerId||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(state.reviewerId))throw new Error('Choose reviewer A/B and enter a safe reviewer code.');if(state.ocrOutputsConsulted!==false||state.independentPhotoReview!==true)throw new Error('Both reviewer attestations must be actively checked.');const incomplete=state.reviews.filter(row=>!rowComplete(row));if(incomplete.length)throw new Error(incomplete.length+' photo(s) remain incomplete.');state.status='reviewer-entered-complete';state.reviewedAt=new Date().toISOString();state.timestampSource='reviewer-device-clock-at-export';state.reviews=state.reviews.map(row=>({...row,reviewerId:state.reviewerId,reviewedAt:state.reviewedAt,ocrOutputsConsulted:false,independentPhotoReview:true}))}return JSON.parse(JSON.stringify(state))}
function download(value,suffix){const bytes=JSON.stringify(value,null,2)+'\\n';const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));const a=document.createElement('a');a.href=url;const reviewer=(value.reviewerId||'unassigned').replace(/[^a-zA-Z0-9_.-]/g,'-');a.download=kit.datasetId+'-'+(value.reviewerSlot||'slot')+'-'+reviewer+'.'+suffix+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);dirty=false}
function show(message,error){byId('status').textContent=message;byId('status').style.color=error?'#a33b16':'#08735f'}
function importDraft(value){if(!value||value.schemaVersion!==1||value.kind!=='niyamlens-independent-photo-review-v1'||value.datasetId!==kit.datasetId||value.sourceSelectionSha256!==kit.sourceSelectionSha256||!Array.isArray(value.reviews)||value.reviews.length!==kit.samples.length)throw new Error('Draft does not belong to this exact review selection.');const expected=new Map(kit.samples.map(s=>[s.id,s.sha256]));for(const row of value.reviews){if(!row||expected.get(row.sampleId)!==row.sourceSha256||!row.fields)throw new Error('Draft sample identity or source hash mismatch.');for(const id of fieldIds){const f=row.fields[id];if(!f||!statuses.some(pair=>pair[0]===f.status)||typeof f.notes!=='string'||typeof f.verbatim!=='string'||(f.status==='readable'&&f.value!==null&&typeof f.value!=='string'))throw new Error('Draft contains an invalid field entry.')}}state=value;state.reviews=value.reviews.map(row=>{const {reviewerId,reviewedAt,ocrOutputsConsulted,independentPhotoReview,...draft}=row;return draft});state.status='draft-reviewer-input';state.reviewedAt=null;state.timestampSource=null;byId('reviewer-slot').value=state.reviewerSlot||'';byId('reviewer-id').value=state.reviewerId||'';byId('no-ocr').checked=state.ocrOutputsConsulted===false;byId('independent').checked=state.independentPhotoReview===true;index=0;dirty=false;render()}
byId('dataset').textContent=kit.datasetId+' • '+kit.samples.length+' reserved photos • selection '+kit.sourceSelectionSha256.slice(0,16)+'…';
for(const id of ['reviewer-slot','reviewer-id','no-ocr','independent'])byId(id).addEventListener('change',syncIdentity);byId('reviewer-id').addEventListener('input',syncIdentity);
byId('photo-readability').addEventListener('change',syncRow);byId('photo-notes').addEventListener('input',syncRow);fields.addEventListener('input',syncRow);fields.addEventListener('change',event=>{syncRow();if(event.target.dataset.part==='status')render()});
byId('previous').addEventListener('click',()=>{syncRow();if(index>0){index--;render()}});byId('next').addEventListener('click',()=>{syncRow();if(index<kit.samples.length-1){index++;render()}});
byId('save-draft').addEventListener('click',()=>{try{download(payload(false),'draft');show('Draft downloaded locally. It is not a completed or verified review.',false)}catch(error){show(error.message,true)}});
byId('export').addEventListener('click',()=>{try{download(payload(true),'review');show('Completed reviewer-entered JSON downloaded locally. The tool has not verified identity or correctness.',false)}catch(error){show(error.message,true)}});
byId('load-draft').addEventListener('click',()=>byId('draft-file').click());byId('draft-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file||file.size>5000000)throw new Error('Choose a review draft JSON no larger than 5 MB.');importDraft(JSON.parse(await file.text()));show('Draft loaded and bound to this exact photo selection.',false)}catch(error){show('Draft not loaded: '+error.message,true)}finally{event.target.value=''}});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}});render();
</script>
</body>
</html>
`
}

function kitReadme(selection, sourceRoot) {
  return `# NiyamLens reserved-photo human review kit

This portable offline kit contains **${selection.samples.length} reserved photos**. ${selection.excluded.length} photos present in the acquisition intake were excluded because they already appear in the exploratory OCR artifact. The reserved set has no ground truth in this kit and is **not** claimed to be a verified holdout, representative sample, or free of pretrained-model exposure.

## Privacy and handling

- \`review.html\` embeds the unchanged source photo bytes as data URLs so it can be used offline.
- Its Content Security Policy blocks network access. It does not upload reviewer entries or photos.
- Reviewer identity and observations remain in memory until the reviewer downloads JSON. No browser persistence is used.
- Keep this directory outside Git and do not publish its photos or completed human reviews without authorization and licence review.
- Original photo root used by the generator: \`${sourceRoot}\`. This path is recorded here for local operation; it is not sent to the browser.

## Independent review procedure

1. Give Reviewer A and Reviewer B separate fresh copies of the entire kit. Do not give either person exploratory OCR output, catalogue answers, or the other person's labels.
2. Each person opens \`review.html\`, selects their own slot, enters a reviewer-created code, reviews one photograph at a time, and downloads a completed JSON file.
3. A readable field needs the exact valid normalized value used for scoring: for example \`22.00\`, \`500 ml\`, or the complete printed date. The optional verbatim field preserves the visible wording.
4. \`not_visible\` means the field is not visible in this photograph; it is not proof that the declaration is absent from the complete package.
5. Hash and retain both completed exports before the reviewers exchange results.
6. Compare field status and value for every sample. Any disagreement requires a third person who independently examines the photo without OCR. Record only disagreement resolutions in \`adjudicator.template.json\`, with a real reason and timestamp.
7. Reviewer identity, independence, non-consultation, timestamps and correctness are self-attested. The HTML does not verify them and the resulting files must not be described as tool-verified labels.

\`reviewer-a.template.json\` and \`reviewer-b.template.json\` are blank backups. They contain no expected values. They may be loaded with **Load draft JSON** or copied as an integration reference.

## Lead metadata worksheet

Complete \`lead-metadata-worksheet.json\` separately. It deliberately leaves shape, visible scripts, conditions, collector ID, prior development use, and camera-capture time unresolved. Do not change \`previouslyUsedForDevelopment\` to \`false\` without actually checking. The Open Food Facts download time is \`acquiredAt\`; it is not the original camera-capture time.

## Integration with the prospective pilot

This kit is reviewer input, not a frozen manifest.

1. Complete the lead worksheet truthfully and build a normal draft/import manifest with \`tools/field-pilot.mjs\`, using the original collection directory as \`--photo-root\`.
2. For each sample, map the two completed exports into \`sample.groundTruth.reviews\`. Each review object used by the pilot must contain the real \`reviewerId\`, \`reviewedAt\`, \`ocrOutputsConsulted: false\`, \`independentPhotoReview: true\`, and the three \`fields\` objects. Do not transfer the kit's \`pending\` placeholders.
3. If reviewer status/value identities differ, add a third adjudication object with a different real reviewer ID, a later timestamp, a reason, \`ocrOutputsConsulted: false\`, \`independentPhotoReview: true\`, and final field objects.
4. Print supported browser configurations **before freeze**:

   \`npm run field:browser -- --modes\`

5. Register the exact selected mode objects in the draft manifest, validate all 24 originals and exclusion inventory, then freeze. Do not run browser OCR before the human labels and mode registration are frozen.
6. Run the frozen manifest only with the exact registered configuration, for example:

   \`npm run field:browser -- --run --manifest FROZEN.json --photo-root "${sourceRoot}" --mode browser-standard --base-url http://127.0.0.1:4191/ --output NEW-RAW-RUNS.json\`

7. Preserve failed/missing rows. Raw OCR and officer-assisted text are scored separately. This 24-photo pilot still does not establish legal compliance accuracy, typography accuracy, or representative Indian-market performance.

## Files

- \`review.html\` — offline one-photo-at-a-time reviewer UI with embedded unchanged photos
- \`selection-manifest.json\` — included/excluded identities, hashes, attribution, and selection limitations; no OCR text
- \`reviewer-a.template.json\`, \`reviewer-b.template.json\` — blank reviewer input
- \`lead-metadata-worksheet.json\` — intentionally unfilled source/capture metadata
- \`adjudicator.template.json\` — intentionally blank disagreement container
- \`KIT-INTEGRITY.json\` — source artifact and photo-selection hashes
- \`DO_NOT_PUBLISH.txt\` — handling warning
`
}

async function createOnlyFile(path, value) {
  await writeFile(path, value, { flag: 'wx' })
}

export async function prepareFieldReviewKit({ intakePath, exploratoryOcrPath, photoRoot, output, expectedCount = DEFAULT_EXPECTED_COUNT, now = () => new Date().toISOString() }) {
  for (const [name, value] of Object.entries({ intakePath, exploratoryOcrPath, photoRoot, output })) if (typeof value !== 'string' || !value.trim()) fail(`${name} is required.`)
  const target = resolve(output)
  const relToRepo = relative(repoRoot, target)
  if (!relToRepo || (!isAbsolute(relToRepo) && !relToRepo.startsWith('..'))) fail('Review kit output must stay outside the Git repository because it embeds source photos.')
  try { await lstat(target); fail('Output directory already exists; choose a new create-only path.') } catch (error) { if (error.message.startsWith('Output directory already exists')) throw error; if (error.code !== 'ENOENT') throw error }
  const targetParent = dirname(target)
  const parentInfo = await stat(targetParent)
  if (!parentInfo.isDirectory()) fail('Output parent must already exist.')

  const intakeFile = await readJson(resolve(intakePath), 'human-review intake')
  const exploratoryFile = await readJson(resolve(exploratoryOcrPath), 'exploratory OCR artifact')
  const intake = validateIntake(intakeFile.value)
  const exclusions = validateExploratory(exploratoryFile.value)
  const loaded = await loadIntakePhotos(intake, resolve(photoRoot))
  const { reserved, excluded } = selectReservedSamples(loaded, exclusions, expectedCount)
  const datasetId = `niyamlens-reserved-${reserved.length}-2026-09-05`
  const sourceSelectionSha256 = digest(Buffer.from(JSON.stringify(reserved.map(sample => [sample.id, sample.productKey, sample.sourcePath, sample.sha256]))))
  const selection = {
    schemaVersion: 1,
    kind: 'niyamlens-field-review-selection-v1',
    datasetId,
    generatedAt: now(),
    isHoldout: false,
    groundTruthProvided: false,
    sourceSelectionSha256,
    sourceArtifacts: {
      intakeSha256: digest(intakeFile.bytes),
      exploratoryOcrArtifactSha256: digest(exploratoryFile.bytes),
    },
    samples: reserved.map(({ dataUrl, mime, ...sample }) => ({ ...sample, mime })),
    excluded,
    limitations: [
      'Selection excludes only the IDs/products/paths/hashes recorded in the supplied exploratory OCR rows; it does not establish all prior model or human exposure.',
      'No photograph was decoded, visually inspected or OCRed by this generator. Bytes were read only for hashing, signature checks and data-URL embedding.',
      'No ground truth, package metadata, reviewer identity, independence or correctness attestation is supplied by the generator.',
      'Public-source acquisition is not a representative field sample and capturedAt remains unknown.',
    ],
  }
  const htmlKit = { datasetId, sourceSelectionSha256, samples: reserved, limitations: buildReviewerTemplate(selection).limitations }
  const temp = join(targetParent, `.niyamlens-review-kit-${process.pid}-${randomBytes(6).toString('hex')}`)
  await mkdir(temp, { recursive: false })
  try {
    await createOnlyFile(join(temp, 'review.html'), reviewHtml(htmlKit))
    await createOnlyFile(join(temp, 'selection-manifest.json'), `${JSON.stringify(selection, null, 2)}\n`)
    await createOnlyFile(join(temp, 'reviewer-a.template.json'), `${JSON.stringify(buildReviewerTemplate(selection, 'A'), null, 2)}\n`)
    await createOnlyFile(join(temp, 'reviewer-b.template.json'), `${JSON.stringify(buildReviewerTemplate(selection, 'B'), null, 2)}\n`)
    await createOnlyFile(join(temp, 'lead-metadata-worksheet.json'), `${JSON.stringify(buildLeadWorksheet(selection), null, 2)}\n`)
    await createOnlyFile(join(temp, 'adjudicator.template.json'), `${JSON.stringify({ schemaVersion: 1, kind: 'niyamlens-independent-photo-adjudication-v1', datasetId, sourceSelectionSha256, status: 'blank-disagreements-only', reviewerId: null, reviewedAt: null, timestampSource: null, ocrOutputsConsulted: null, independentPhotoReview: null, comparedReviewFiles: [], adjudications: [], warning: 'Blank third-reviewer input only. Do not add agreement rows, expected values, a reviewer identity, attestation or result until a real disagreement review occurs.' }, null, 2)}\n`)
    await createOnlyFile(join(temp, 'README.md'), kitReadme(selection, resolve(photoRoot)))
    await createOnlyFile(join(temp, 'DO_NOT_PUBLISH.txt'), 'PRIVATE REVIEW WORKING COPY\n\nThis directory embeds licensed package photographs and may later contain reviewer identifiers and human labels. Keep it outside Git and do not upload or publish it without authorization and licence review.\n')
    await createOnlyFile(join(temp, 'KIT-INTEGRITY.json'), `${JSON.stringify({ schemaVersion: 1, kind: 'niyamlens-review-kit-integrity-v1', datasetId, generatedAt: selection.generatedAt, sourceSelectionSha256, sourceArtifactHashes: selection.sourceArtifacts, photoCount: selection.samples.length, photoHashes: selection.samples.map(sample => ({ sampleId: sample.id, sourcePath: sample.sourcePath, sha256: sample.sha256, byteLength: sample.byteLength })), caveat: 'Hashes bind selected bytes and source artifacts. They do not verify reviewer identity, independence, labels, provenance or legal correctness.' }, null, 2)}\n`)
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
  return { output: target, datasetId, photoCount: selection.samples.length, excludedCount: selection.excluded.length, sourceSelectionSha256, files: ['review.html', 'selection-manifest.json', 'reviewer-a.template.json', 'reviewer-b.template.json', 'lead-metadata-worksheet.json', 'adjudicator.template.json', 'README.md', 'DO_NOT_PUBLISH.txt', 'KIT-INTEGRITY.json'], claims: { groundTruthProvided: false, isHoldout: false, ocrExecutedByGenerator: false, reviewerIdentityVerified: false } }
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(`${usage}\n`); return }
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1]
    if (!['--intake', '--exploratory-ocr', '--photo-root', '--output', '--expected-count'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(options, key)) fail(`Unsupported, duplicate or incomplete option: ${key || '(missing)'}.`)
    options[key] = value
  }
  for (const key of ['--intake', '--exploratory-ocr', '--photo-root', '--output']) if (!options[key]) fail(`${key} is required.\n${usage}`)
  const expectedCount = options['--expected-count'] === undefined ? DEFAULT_EXPECTED_COUNT : Number(options['--expected-count'])
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 30) fail('--expected-count must be an integer from 1 to 30.')
  const result = await prepareFieldReviewKit({ intakePath: options['--intake'], exploratoryOcrPath: options['--exploratory-ocr'], photoRoot: options['--photo-root'], output: options['--output'], expectedCount })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\nReview kit created offline. No OCR, label, ground truth, reviewer identity or independence claim was generated.\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Field review kit failed: ${error.message}\n`); process.exitCode = 1 })
