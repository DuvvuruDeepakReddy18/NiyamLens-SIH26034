import { reviewableCompoundMrpTableCandidates } from './compoundMrpTableCandidate.mjs'
import { parsePositiveNumber } from './labelParser.mjs'

const LIMITS = Object.freeze({ panels: 4, lines: 250, text: 100000, lineText: 2000, identifier: 200, imageUrl: 40000000, pixels: 6000000 })
const finite = value => typeof value === 'number' && Number.isFinite(value)
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new Error('Source records must contain plain data.')
  return value
}
function dense(value, max) {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length) throw new Error('Source arrays must be dense and bounded.')
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, index) || {}, 'value')) throw new Error('Source arrays cannot contain accessors or holes.')
  return value
}
function text(value, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error('Source identifiers and text must be bounded strings.')
  return value
}
function pngFrame(url, width, height) {
  text(url, LIMITS.imageUrl)
  const prefix = 'data:image/png;base64,'
  if (!url.startsWith(prefix)) throw new Error('The source preview must be the exact local PNG used by OCR.')
  const encoded = url.slice(prefix.length)
  if (encoded.length < 44 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('The source PNG is malformed.')
  // Read only IHDR, not the multi-megabyte image. Browser decoding remains
  // mandatory; an image load error makes the component withhold the candidate.
  const bytes = Uint8Array.from(atob(encoded.slice(0, 44)), character => character.charCodeAt(0))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]
  if (signature.some((byte, index) => bytes[index] !== byte)) throw new Error('The source preview has no valid PNG dimension header.')
  const view = new DataView(bytes.buffer)
  if (view.getUint32(16) !== width || view.getUint32(20) !== height) throw new Error('PNG dimensions disagree with the OCR coordinate frame.')
}
function quad(box, width, height) {
  dense(box, 4); if (box.length !== 4) throw new Error('Each source needs a four-point box.')
  return box.map(point => {
    dense(point, 2)
    if (point.length !== 2 || !point.every(finite) || point[0] < 0 || point[1] < 0 || point[0] > width || point[1] > height) throw new Error('Source geometry lies outside the OCR preview.')
    return [...point]
  })
}
function sourceItem(input) {
  plain(input)
  const id = text(input.id, LIMITS.identifier)
  const width = input.width; const height = input.height
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 10000) || width * height > LIMITS.pixels) throw new Error('The OCR coordinate frame is too large or invalid.')
  if (input.retryMode != null) {
    plain(input.retryMode)
    if (input.retryMode.photometric !== 'max-rgb-v1' || input.retryMode.rotation !== 0) throw new Error('Rotated or unsupported retry frames are not used for this table aid.')
  }
  const binding = plain(input.sourceBinding)
  if (binding.schemaVersion !== 1 || !['original', 'analysis'].includes(binding.inputKind) || text(binding.analysisUrl, LIMITS.imageUrl) !== input.imageUrl || !/^data:image\/(png|jpeg|webp);base64,/.test(input.imageUrl)) throw new Error('The source preview is not bound to this captured panel.')
  text(binding.transform, 20000)
  pngFrame(input.previewUrl, width, height)
  const ids = new Set()
  const lines = dense(input.lines, LIMITS.lines).map(entry => {
    plain(entry)
    const lineId = text(entry.id, LIMITS.identifier)
    if (ids.has(lineId) || entry.panelId !== id) throw new Error('Source fragments must have unique IDs and belong to this panel.')
    ids.add(lineId)
    const value = text(entry.text, LIMITS.lineText, true)
    if (/[\r\n]/.test(value)) throw new Error('OCR fragments must retain their original single-line boundaries.')
    return { id: lineId, panelId: id, text: value, box: quad(entry.box, width, height) }
  })
  if (text(input.text, LIMITS.text, true) !== lines.map(line => line.text).join('\n')) throw new Error('Raw OCR text does not match its source fragments.')
  return { id, width, height, previewUrl: input.previewUrl, lines, rawText: input.text, transformed: Boolean(input.retryMode) }
}
function region(parts, item) {
  const points = parts.flatMap(part => part.box)
  const minX = Math.min(...points.map(point => point[0])); const maxX = Math.max(...points.map(point => point[0]))
  const minY = Math.min(...points.map(point => point[1])); const maxY = Math.max(...points.map(point => point[1]))
  if (maxX <= minX || maxY <= minY) throw new Error('Source fragments have no visible area.')
  const padding = Math.max(8, (maxY - minY) * .15)
  const x = Math.max(0, minX - padding); const y = Math.max(0, minY - padding)
  return { x, y, width: Math.min(item.width, maxX + padding) - x, height: Math.min(item.height, maxY + padding) - y }
}
function displayCard(item, candidate) {
  if (candidate.panelId !== item.id || candidate.field !== 'mrp' || candidate.requiresOfficerReview !== true || candidate.eligibleForAutomaticVerdict !== false || candidate.mutatesTranscript !== false) throw new Error('The table aid must remain an unverified, unchanged-source diagnostic.')
  const sources = new Map(item.lines.map(line => [line.id, line]))
  const get = id => { const found = sources.get(id); if (!found) throw new Error('The table references an unavailable source fragment.'); return found }
  if (candidate.sourceIds.length !== 3 || candidate.anchorPairs.length !== 3) throw new Error('A complete compound row and all three supporting pairs are required.')
  const row = candidate.sourceIds.map(get)
  if (row.map(part => part.text).join(' ') !== candidate.text || candidate.parts.some((part, index) => part.sourceId !== row[index].id || part.text !== row[index].text || JSON.stringify(part.box) !== JSON.stringify(row[index].box))) throw new Error('The compound row changed its original source mapping.')
  for (const span of Object.values(candidate.literalSpans)) {
    const source = get(span.sourceId)
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > source.text.length || source.text.slice(span.start, span.end) !== span.text) throw new Error('A literal field span no longer matches its raw source.')
  }
  const anchorLabels = { batch: 'Batch / lot', packed: 'Packed / manufactured', 'use-by': 'Use by / expiry' }
  const anchors = candidate.anchorPairs.map(pair => {
    if (!Object.hasOwn(anchorLabels, pair.kind)) throw new Error('Unknown supporting anchor type.')
    return { label: anchorLabels[pair.kind], heading: get(pair.headingId), value: get(pair.valueId) }
  })
  const all = [...row, ...anchors.flatMap(pair => [pair.heading, pair.value])]
  if (new Set(all.map(part => part.id)).size !== 9) throw new Error('Compound and supporting sources cannot be reused.')
  const amount = candidate.literalSpans.amount.text
  if (parsePositiveNumber(amount, 2)?.normalized !== candidate.value) throw new Error('The displayed amount is not the exact literal amount span.')
  return { id: candidate.id, panelId: item.id, value: amount, rowText: candidate.text, row, anchors, all,
    previewUrl: item.previewUrl, width: item.width, height: item.height, rowRegion: region(row, item), tableRegion: region(all, item),
    unitPriceText: candidate.unitSalePrice.rawText, unitPriceFormatValid: candidate.unitSalePrice.formatValid === true,
    transformed: item.transformed, sourceGeometryKind: 'OCR-line-boxes-not-glyph-measurements' }
}

export function compoundTableReview(items) {
  try {
    dense(items, LIMITS.panels)
    const ids = new Set(); const clean = items.map(item => {
      const value = sourceItem(item)
      if (ids.has(value.id)) throw new Error('Preview panel IDs must be unique.')
      ids.add(value.id); return value
    })
    const cards = clean.flatMap(item => reviewableCompoundMrpTableCandidates(item.lines).candidates.map(candidate => displayCard(item, candidate)))
    return { status: cards.length ? 'available' : 'none', cards, reason: '', verified: false }
  } catch (error) {
    return { status: 'unavailable', cards: [], reason: typeof error?.message === 'string' ? error.message.slice(0, 250) : 'Source mapping could not be checked.', verified: false }
  }
}
