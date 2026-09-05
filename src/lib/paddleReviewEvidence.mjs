import { extractDeclarations } from './extraction.mjs'
import { buildPaddleWorkingAddition } from './paddleWorkingText.mjs'

const fieldNames = { mrp: 'MRP', netQuantity: 'Net quantity', packDate: 'Packed / manufactured date' }
const finite = value => typeof value === 'number' && Number.isFinite(value)
const readout = field => ({ value: field.value || null, conflict: Boolean(field.conflict), status: field.validation?.status || 'not_detected', candidates: (field.candidates || []).map(item => ({ value: item.value, valid: item.valid })) })

// A display-only crop of the actual source frame. No resampling, OCR, unit
// inference or change to the preserved original bytes takes place here.
export function proposalSourceView(item, proposal) {
  if (!['width', 'height'].every(key => finite(item?.[key]) && item[key] > 0 && item[key] <= 10000) || !Array.isArray(proposal?.parts) || proposal.parts.length < 2 || proposal.parts.length > 12) throw new Error('A bounded source frame and mapped fragments are required.')
  const points = []
  for (const part of proposal.parts) {
    const source = item.lines?.find(line => line.id === part.sourceId)
    if (!source || source.text !== part.text || JSON.stringify(source.box) !== JSON.stringify(part.box) || !Array.isArray(part.box) || part.box.length !== 4) throw new Error('Source fragments must match the unchanged OCR mapping.')
    for (const point of part.box) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(finite) || point[0] < 0 || point[1] < 0 || point[0] > item.width || point[1] > item.height) throw new Error('Source fragment lies outside its captured frame.')
      points.push(point)
    }
  }
  const xs = points.map(point => point[0]); const ys = points.map(point => point[1])
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys)
  if (maxX <= minX || maxY <= minY) throw new Error('Source fragments need a nonempty visible region.')
  const padding = Math.max(12, (maxY - minY) * 0.65)
  const x = Math.max(0, minX - padding); const y = Math.max(0, minY - padding)
  return { x, y, width: Math.min(item.width, maxX + padding) - x, height: Math.min(item.height, maxY + padding) - y }
}

// This is a parser comparison, NOT reference ground truth or a correctness
// score. Existing text participates so a new reading cannot hide old conflicts.
export function comparePaddleFieldReadings({ currentText = '', items = [], selectedRows = [] }) {
  if (typeof currentText !== 'string' || currentText.length > 100000) throw new Error('Bounded preview text is required.')
  const { rawAddition, workingAddition } = buildPaddleWorkingAddition(items, selectedRows)
  const withRaw = currentText + rawAddition
  const withSelected = currentText + workingAddition
  if (withRaw.length > 100000 || withSelected.length > 100000) throw new Error('Preview comparison exceeds the inspection text limit.')
  const before = extractDeclarations(currentText); const raw = extractDeclarations(withRaw); const selected = extractDeclarations(withSelected)
  return { fields: Object.entries(fieldNames).map(([id, label]) => ({ id, label, current: readout(before.byId[id]), raw: readout(raw.byId[id]), selected: readout(selected.byId[id]) })), selectedCount: selectedRows.length, rawCharacters: rawAddition.length,
    limitation: 'Candidate extraction only. Selected fragments occur once in the new derived working reading; original raw history remains unchanged. Earlier readings and their conflicts remain included; nothing is verified or appended by this comparison.' }
}
