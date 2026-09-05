import { collectPaddleLayoutProposals } from './paddleLayoutProposals.mjs'

// Explicitly reviewed reordering applies only to a NEW Paddle observation.
// Original strings enter raw history unchanged. A selected source fragment
// appears once in working text, not once as a broken row and again as a repair.
export function buildPaddleWorkingAddition(items, selectedRows = [], panelOrder = items?.map(item => item?.id)) {
  return buildMappedAddition(items, selectedRows, panelOrder, 'officer')
}

// The candidate path computes its own strict geometric associations. Callers
// cannot supply "automatic" answers or claim that a person accepted the rows.
// Candidates still require field verification against the captured photograph.
export function buildStructuredPaddleAddition(items, panelOrder = items?.map(item => item?.id)) {
  const { proposals, warnings } = collectPaddleLayoutProposals(items)
  return { ...buildMappedAddition(items, proposals, panelOrder, 'machine'), warnings }
}

function buildMappedAddition(items, selectedRows, panelOrder, attribution) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 4 || !Array.isArray(selectedRows) || selectedRows.length > 50) throw new Error('Bounded Paddle readings and layout suggestions are required.')
  const panels = new Map()
  let characters = 0
  for (const item of items) {
    if (typeof item?.id !== 'string' || !item.id || panels.has(item.id) || typeof item.text !== 'string' || item.text.length > 100000 || !Array.isArray(item.lines) || item.lines.length > 1000) throw new Error('Invalid Paddle source reading.')
    const ids = new Set()
    for (const line of item.lines) {
      if (typeof line?.id !== 'string' || !line.id || ids.has(line.id) || typeof line.text !== 'string' || line.text.length > 2000 || /[\r\n]/.test(line.text)) throw new Error('Paddle source lines must be bounded and uniquely mapped.')
      ids.add(line.id)
    }
    if (item.lines.map(line => line.text).join('\n') !== item.text) throw new Error('Raw Paddle text must exactly match its source lines.')
    characters += item.text.length
    if (characters > 100000) throw new Error('Paddle readings exceed the inspection text limit.')
    panels.set(item.id, item)
  }
  const usedSources = new Map()
  const mappedRows = selectedRows.map(row => {
    const item = panels.get(row?.panelId)
    if (!item || !Array.isArray(row.sourceIds) || row.sourceIds.length < 2 || row.sourceIds.length > 12 || new Set(row.sourceIds).size !== row.sourceIds.length) throw new Error('Invalid layout proposal source mapping.')
    const sources = row.sourceIds.map(id => item.lines.find(line => line.id === id))
    if (sources.some(source => !source) || row.text !== sources.map(source => source.text).join(' ')) throw new Error('A layout proposal changed its original OCR text.')
    const used = usedSources.get(item.id) || new Set()
    for (const id of row.sourceIds) {
      if (used.has(id)) throw new Error('A source fragment cannot be reused by multiple selected suggestions.')
      used.add(id)
    }
    usedSources.set(item.id, used)
    return { panelId: item.id, text: row.text, sourceIds: [...row.sourceIds], parts: sources.map(({ id, text, box }) => ({ id, text, box })), frame: { width: item.width, height: item.height, crop: item.crop || null }, method: attribution === 'machine' ? 'system-derived-geometric-candidate' : 'officer-selected-geometric-row', ...(attribution === 'machine' ? { field: row.field, value: row.value, requiresOfficerReview: true, eligibleForAutomaticVerdict: false } : {}) }
  })
  let rawAddition = ''; let workingAddition = ''
  const workingMappings = []
  for (const item of items) {
    const index = panelOrder.indexOf(item.id)
    if (index < 0) throw new Error('Paddle observation does not belong to the current captured panels.')
    const rawBlock = `\n\n[PADDLE ${item.crop ? 'FOCUSED ' : ''}RAW OCR · PANEL ${index + 1}]\n${item.text}`
    rawAddition += rawBlock
    const selected = mappedRows.filter(row => row.panelId === item.id)
    if (!selected.length) { workingAddition += rawBlock; continue }
    const consumed = new Set(); const rows = []
    for (const line of item.lines) {
      if (consumed.has(line.id)) continue
      const joined = selected.find(row => row.sourceIds.includes(line.id))
      const mapped = joined ? { text: joined.text, sourceIds: joined.sourceIds, kind: attribution === 'machine' ? 'machine-layout-candidate' : 'officer-reviewed-layout' } : { text: line.text, sourceIds: [line.id], kind: 'unchanged' }
      for (const id of mapped.sourceIds) consumed.add(id)
      rows.push(mapped)
    }
    if (consumed.size !== item.lines.length) throw new Error('Working reading order must retain every source exactly once.')
    const label = attribution === 'machine' ? 'MACHINE LAYOUT CANDIDATES · UNVERIFIED' : 'OFFICER-SELECTED LAYOUT SUGGESTIONS'
    workingAddition += `\n\n[${label} · PANEL ${index + 1} · DERIVED WORKING TEXT, NOT RAW OCR]\n${rows.map(row => row.text).join('\n')}`
    workingMappings.push({ panelId: item.id, sourceOnce: true, rows })
  }
  if (rawAddition.length > 100000 || workingAddition.length > 100000) throw new Error('Paddle readings exceed the inspection text limit.')
  return { rawAddition, workingAddition, reviewedRows: attribution === 'officer' ? mappedRows : [], candidateRows: attribution === 'machine' ? mappedRows : [], workingMappings }
}
