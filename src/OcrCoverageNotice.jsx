import { usableDeclaration } from './lib/inspectionAnalysis.mjs'
import { labelLocationHints } from './lib/captureCoach.mjs'
export default function OcrCoverageNotice({ extraction, rawOcrText = '' }) {
  const important = ['productName', 'mrp', 'netQuantity', 'packDate', 'responsibleEntity', 'consumerCare']
  const missing = important.map(id => extraction.byId[id]).filter(field => !usableDeclaration(field))
  const readable = extraction.fields.filter(usableDeclaration).length
  const locations = labelLocationHints(extraction, extraction.raw + '\n\n' + rawOcrText)
  if (!extraction.raw.trim()) return null
  return <aside className="ocr-coverage-notice" aria-label="OCR extraction coverage" role="status"><b>{readable} of {extraction.fields.length} tracked details have a usable reading · not an accuracy score</b><p>{missing.length ? `Still unresolved: ${missing.map(field => field.label).join(', ')}. Add a clear close-up of the relevant panel or inspect the retained alternatives.` : 'Core price, quantity, date, identity and contact readings are available. Compare them with the package before confirming.'}</p>{locations.map(hint => <p key={hint.id}><b>{extraction.byId[hint.id].label}:</b> {hint.guidance}</p>)}<p>Read label fields checks all captured panels and can retry up to two unresolved MRP, quantity or date regions. It cannot recover text outside the photo or hidden by glare. Physical size and officer confirmation are never guessed.</p></aside>
}
