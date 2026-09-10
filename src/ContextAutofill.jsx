import { CONTEXT_LABELS, contextSuggestions } from './lib/inspectionAutofill.mjs'
import './inspectionAutofill.css'

export default function ContextAutofill({ extraction, meta, onUseDetected }) {
  const suggestions = contextSuggestions(extraction)
  const entries = Object.entries(suggestions).filter(([key]) => key !== 'unit')
  return <section className="context-autofill" aria-label="Automatic context and geometry">
    <header><strong>{entries.length ? 'Detected details filled automatically' : 'Waiting for readable product details'}</strong><span>Review, then confirm</span></header>
    <p>Detected context and verification source notes are prepared after extraction. Your edits are kept. A suggested value is not a verified fact.</p>
    {entries.length > 0 && <ul>{entries.map(([key, candidate]) => {
      const manual = meta.contextAutofill?.manual?.[key]
      const value = key === 'quantity' ? `${candidate.value} ${suggestions.unit?.value || ''}` : key === 'perishable' ? 'Date-sensitive declaration detected' : String(candidate.value).replaceAll('_', ' ')
      return <li key={key}><div><b>{CONTEXT_LABELS[key]}</b><span>{value}</span><small>{manual ? 'Your entry is protected from automatic changes.' : candidate.evidence}</small></div>{manual ? <button type="button" onClick={() => onUseDetected(key)}>Use detected {key === 'quantity' ? 'quantity + unit' : 'value'}</button> : <span className="autofill-badge">Auto-filled · verify</span>}</li>
    })}</ul>}
    <div className="geometry-autofill-note"><b>Physical geometry {meta.pdpArea ? `· ${meta.pdpArea} cm²` : '· measurement needed'}</b><p>{meta.pdpArea ? 'Area is available from your supplied dimensions or direct entry; verify the physical panel.' : 'Enter the measured panel width and height below; the area fills automatically. OCR and barcodes cannot establish centimetres without a known physical scale.'} Reference and glyph measurements stay linked to their photo. Confirmation boxes are never ticked automatically.</p></div>
  </section>
}
