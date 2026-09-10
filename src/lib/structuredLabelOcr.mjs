import { runPaddleOcr, createPaddleFocusInput, preparePaddleAppend } from './paddleOcr.mjs'
import { buildStructuredPaddleAddition } from './paddleWorkingText.mjs'
import { extractDeclarations } from './extraction.mjs'
import { resolvePaddleFocusSuggestion } from './ocrFocusGuidance.mjs'
import { usableDeclaration } from './inspectionAnalysis.mjs'
import { ocrController, throwIfAborted, OCR_LIMITS } from './ocrLifecycle.mjs'

export const AUTOMATIC_RECOVERY_LIMIT = 2
export function unresolvedRecoveryRegions(output, evidenceItems) {
  const working = buildStructuredPaddleAddition(output.items).workingAddition
  const parsed = extractDeclarations(working)
  const candidates = output.items.flatMap(item => item.focusGuidance?.suggestions || [])
  const order = ['mrp', 'netQuantity', 'packDate']
  return candidates.filter(item => order.includes(item.field) && !usableDeclaration(parsed.byId[item.field]))
    .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field))
    .slice(0, AUTOMATIC_RECOVERY_LIMIT)
    .map(candidate => resolvePaddleFocusSuggestion({ suggestions: candidates, suggestionId: candidate.id, evidenceItems }))
}

// Re-read real, explicitly bound pixels around a literal unresolved heading.
// No expected values, external API, sensitive detector or endless retry loop.
export async function readLabelWithRecovery({ evidenceItems, signal, onProgress = () => {}, runner = runPaddleOcr, focusFactory = createPaddleFocusInput }) {
  const job = ocrController(signal, OCR_LIMITS.totalMs)
  try {
    const primary = await runner({ evidenceItems, signal: job.signal, onProgress })
    throwIfAborted(job.signal)
    const recoveries = []; const recoveryNotes = []
    const targets = unresolvedRecoveryRegions(primary, evidenceItems)
    for (const [index, target] of targets.entries()) {
      throwIfAborted(job.signal)
      onProgress({ running: true, progress: 90, label: `Checking unresolved ${target.suggestion.field} · close-up ${index + 1}/${targets.length}`, error: '' })
      try {
        const output = await runner({ evidenceItems: [target.panel], signal: job.signal,
          inputFactory: async item => {
            const frame = await focusFactory(item, target.rect)
            return { ...frame, automaticFocus: true, source: frame.source.replace(/^officer-selected-/, 'automatic-heading-') }
          },
          onProgress: state => onProgress({ ...state, progress: 90 + Math.round(state.progress * .08), label: `Automatic ${target.suggestion.field} close-up · ${state.label}` }),
        })
        throwIfAborted(job.signal)
        recoveries.push(output)
        recoveryNotes.push({ field: target.suggestion.field, panelId: target.panel.id, rect: target.rect, status: 'read', method: 'automatic-heading-crop', characters: output.items.reduce((sum, item) => sum + item.text.length, 0) })
      } catch (error) {
        throwIfAborted(job.signal)
        if (error.name === 'AbortError') throw error
        recoveryNotes.push({ field: target.suggestion.field, panelId: target.panel.id, status: 'unavailable', reason: String(error.message).slice(0, 500) })
      }
    }
    return { ...primary, recoveries, recoveryNotes }
  } finally { job.dispose() }
}

export function prepareRecoveredLabelAppend({ evidenceItems, text, rawOcrText, output, runId }) {
  const observations = [output, ...(output.recoveries || [])]
  if (observations.length > AUTOMATIC_RECOVERY_LIMIT + 1) throw new Error('Automatic recovery exceeded its bounded observation limit.')
  let next = { evidenceItems, text, rawOcrText }
  const candidateRows = []; const workingMappings = []; const warnings = []
  observations.forEach((observation, index) => {
    next = preparePaddleAppend({ evidenceItems: next.evidenceItems, text: next.text, rawOcrText: next.rawOcrText, output: observation, runId: index ? `${runId}:automatic-${index}` : runId, structured: true })
    candidateRows.push(...next.candidateRows); workingMappings.push(...next.workingMappings); warnings.push(...next.warnings)
  })
  return { ...next, candidateRows, workingMappings, warnings }
}
