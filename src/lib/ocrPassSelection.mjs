import { validateOcrHistory } from './ocrHistory.mjs'
import { MAX_EVIDENCE_TEXT } from './inspectionWorkflow.mjs'

export const OCR_PASS_SELECTION_METHOD = 'officer-selected-existing-raw-passes-v1'
const keyOf = selection => JSON.stringify([selection.panelId, selection.passId])

// This intentionally replaces only the WORKING transcript. The caller must
// audit the choice before publishing, retain rawOcrText/evidenceItems unchanged,
// invalidate earlier confirmations, and never restore a confidence percentage.
export function prepareOcrPassSelection({ evidenceItems, selections, reason }) {
  validateOcrHistory(evidenceItems)
  if (!evidenceItems.length) throw new Error('Capture a package photograph and run OCR before selecting readings.')
  if (!Array.isArray(selections) || !selections.length || selections.length > 128 || Object.keys(selections).length !== selections.length) throw new Error('Select at least one existing raw OCR reading.')
  if (typeof reason !== 'string' || reason.trim().length < 12 || reason.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason)) throw new Error('Explain your selection in 12–1000 characters, based on comparison with the photograph.')
  const selectedKeys = new Set()
  for (const selection of selections) {
    if (!selection || typeof selection.panelId !== 'string' || typeof selection.passId !== 'string' || Object.keys(selection).some(key => !['panelId', 'passId'].includes(key))) throw new Error('Select existing raw pass IDs only; supplied or edited text cannot be applied.')
    const key = keyOf(selection)
    if (selectedKeys.has(key)) throw new Error('Each raw OCR reading may be selected only once.')
    const panel = evidenceItems.find(item => item.id === selection.panelId)
    const pass = panel?.ocrPasses?.find(item => item.id === selection.passId)
    if (!pass || !pass.text.trim()) throw new Error('A selected raw OCR reading is missing or empty. Review the current history again.')
    selectedKeys.add(key)
  }
  const selectedPasses = []; const excludedPasses = []; const unreadPanelIds = []; const sections = []
  evidenceItems.forEach((panel, panelIndex) => {
    const passes = panel.ocrPasses || []
    const readable = passes.filter(pass => pass.text.trim())
    const included = passes.filter(pass => selectedKeys.has(keyOf({ panelId: panel.id, passId: pass.id })))
    if (readable.length && !included.length) throw new Error(`Select at least one raw reading for panel ${panelIndex + 1}; no photographed panel with OCR may be silently omitted.`)
    if (!readable.length) {
      unreadPanelIds.push(panel.id)
      sections.push(`[PANEL ${panelIndex + 1} · NO RAW OCR READING AVAILABLE · NOT ASSESSED FROM OCR]`)
    }
    passes.forEach((pass, passIndex) => {
      const selected = selectedKeys.has(keyOf({ panelId: panel.id, passId: pass.id }))
      const reference = { panelId: panel.id, passId: pass.id, characters: pass.text.length, provider: pass.provider || 'unrecorded', model: pass.model || 'unrecorded', strategy: pass.strategy || 'unrecorded' }
      if (selected) {
        selectedPasses.push(reference)
        // Exact pass bytes follow a clearly labelled system separator. Even
        // leading/trailing whitespace is retained, unlike a hand-edited merge.
        sections.push(`[OFFICER-SELECTED RAW PASS · PANEL ${panelIndex + 1} · READING ${passIndex + 1}]\n${pass.text}`)
      } else excludedPasses.push(reference)
    })
  })
  const text = sections.join('\n\n')
  if (!text.trim() || text.length > MAX_EVIDENCE_TEXT) throw new Error('The selected working transcript exceeds the 100,000-character evidence limit. Select fewer complete readings; raw history is preserved.')
  return { text, auditPayload: { method: OCR_PASS_SELECTION_METHOD, reason: reason.trim(), selectedPasses, excludedPasses, unreadPanelIds, workingTextCharacters: text.length, rawHistoryPreserved: true, workingTranscriptReplaced: true, legalVerdictInferred: false } }
}
