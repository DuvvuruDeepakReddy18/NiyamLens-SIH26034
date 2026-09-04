import { useState } from 'react'
import './paddle-review.css'

export default function PaddleReview({ preview, onAppend, onDismiss }) {
  const [selected, setSelected] = useState([])
  const proposals = preview.proposals || []
  return <section className="paddle-review" aria-label="Paddle OCR preview">
    <header><div><span className="eyebrow">ALTERNATIVE LOCAL READING</span><h3>Inspect before appending</h3></div><button type="button" onClick={onDismiss}>Dismiss preview</button></header>
    <p>PP-OCRv6 small · real on-device recognition. This is an additional reading, not a verified accuracy upgrade. The language selector applies to Tesseract; Paddle uses its fixed bundled model. Nothing has been appended yet.</p>
    {preview.output.items.map((item, index) => <details key={item.id} open={preview.output.items.length === 1}>
      <summary>Panel {index + 1} · {item.lines.length} recognized lines · {item.source}</summary>
      <pre>{item.text || '(no readable text on this panel)'}</pre>
    </details>)}
    {preview.layoutWarning && <p role="status">Raw OCR is available. Layout suggestions were withheld: {preview.layoutWarning}</p>}
    {proposals.length > 0 && <div className="paddle-proposals"><h4>Optional heading/value suggestions</h4><p>Only spaces and reading order change. Check the highlighted original fragments before selecting a suggestion. It remains officer-reviewed evidence, never raw OCR or automatic compliance.</p>
      {proposals.map(proposal => {
        const item = preview.output.items.find(panel => panel.id === proposal.panelId)
        return <article key={proposal.id}>
          <div className="proposal-photo" style={{ aspectRatio: `${item.width} / ${item.height}` }}><img src={item.previewUrl} alt="Captured panel or selected crop with proposed heading and value highlighted" /><svg viewBox={`0 0 ${item.width} ${item.height}`} aria-hidden="true">{proposal.parts.map((part, i) => <polygon key={part.sourceId} points={part.box.map(point => point.join(',')).join(' ')} className={i === 0 ? 'heading-box' : 'value-box'} />)}</svg></div>
          <div><strong>{proposal.text}</strong><small>Orange: heading · blue: value. Original characters are unchanged.</small><label><input type="checkbox" checked={selected.includes(proposal.id)} onChange={event => setSelected(current => event.target.checked ? [...current, proposal.id] : current.filter(id => id !== proposal.id))} />I checked these fragments against the photo; include this layout suggestion.</label></div>
        </article>
      })}
    </div>}
    <button type="button" className="primary-action" onClick={() => onAppend(proposals.filter(proposal => selected.includes(proposal.id)))}>Append raw Paddle OCR{selected.length ? ` + ${selected.length} reviewed suggestion${selected.length === 1 ? '' : 's'}` : ''}</button>
    <small>Earlier OCR and manual corrections are preserved. New conflicts remain visible. Field and measurement confirmations are reset; no full-inspection confidence score is invented.</small>
  </section>
}
