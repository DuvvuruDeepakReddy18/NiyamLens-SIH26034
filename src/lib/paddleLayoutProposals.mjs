import { reconstructOcrReadingOrder, reviewableDeclarationProposals } from './ocrReadingOrder.mjs'
import { reviewableStackedDeclarationProposals } from './spatialOcr.mjs'

export function collectPaddleLayoutProposals(items) {
  if (!Array.isArray(items) || items.length > 4) throw new Error('At most four Paddle panels can be reviewed together.')
  const candidates = []; const warnings = []
  for (const item of items) {
    try {
      candidates.push(...reviewableDeclarationProposals(reconstructOcrReadingOrder(item.lines)).proposals.map(row => ({ ...row, panelId: item.id })))
      candidates.push(...reviewableStackedDeclarationProposals(item.lines).proposals.map(row => ({ ...row, panelId: item.id })))
    } catch (error) { warnings.push(error.message) }
  }
  if (candidates.length > 50) return { proposals: [], warnings: [...warnings, 'More than 50 layout suggestions; use a smaller declaration-region crop. No suggestions were automatically chosen.'] }
  const uses = new Map()
  for (const candidate of candidates) for (const source of candidate.sourceIds) {
    const key = JSON.stringify([candidate.panelId, source]); uses.set(key, (uses.get(key) || 0) + 1)
  }
  const proposals = candidates.filter(candidate => candidate.sourceIds.every(source => uses.get(JSON.stringify([candidate.panelId, source])) === 1))
  if (proposals.length !== candidates.length) warnings.push('Competing suggestions reused a source fragment and were withheld. Inspect the source rather than choosing an arbitrary ordering.')
  return { proposals, warnings }
}
