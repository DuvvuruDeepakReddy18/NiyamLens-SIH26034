import { useMemo, useState } from 'react'
import { comparePaddleFieldReadings, proposalSourceView } from './lib/paddleReviewEvidence.mjs'
import './paddle-review.css'

const fieldText = field => field.conflict ? `Conflicting readings: ${field.candidates.map(item => item.value).join(' / ')}` : field.value ? `${field.value}${field.status === 'format_valid' ? ' · unverified' : ' · needs review'}` : 'Not recovered'

export default function PaddleReview({ preview, currentText = '', onAppend, onDismiss }) {
  const [selected, setSelected] = useState([])
  const proposals = preview.proposals || []
  const sourceViews = useMemo(() => new Map(proposals.flatMap(proposal => {
    try { return [[proposal.id, proposalSourceView(preview.output.items.find(panel => panel.id === proposal.panelId), proposal)]] }
    catch { return [] }
  })), [preview])
  const selectedRows = proposals.filter(proposal => selected.includes(proposal.id) && sourceViews.has(proposal.id))
  const comparison = useMemo(() => {
    try { return comparePaddleFieldReadings({ currentText, items: preview.output.items, selectedRows }) }
    catch (error) { return { error: error.message } }
  }, [preview, currentText, selected])
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
        const view = sourceViews.get(proposal.id)
        return <article key={proposal.id}>
          <div className="proposal-source">
            {view ? <><span className="eyebrow">SOURCE CLOSE-UP</span><svg className="proposal-closeup" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="img" aria-label={`Source close-up for ${proposal.text}`}>
              <image href={item.previewUrl} width={item.width} height={item.height} />
              {proposal.parts.map((part, i) => <polygon key={part.sourceId} points={part.box.map(point => point.join(',')).join(' ')} className={i === 0 ? 'heading-box' : 'value-box'} />)}
            </svg><details><summary>Show full source frame</summary><div className="proposal-photo" style={{ aspectRatio: `${item.width} / ${item.height}` }}><img src={item.previewUrl} alt="Full captured panel or officer-selected crop" /><svg viewBox={`0 0 ${item.width} ${item.height}`} aria-hidden="true">{proposal.parts.map((part, i) => <polygon key={part.sourceId} points={part.box.map(point => point.join(',')).join(' ')} className={i === 0 ? 'heading-box' : 'value-box'} />)}</svg></div></details></> : <p role="status">Source mapping could not be verified. This suggestion is unavailable; recapture or inspect the original panel.</p>}
          </div>
          <div><strong>{proposal.text}</strong><small>Orange: heading · blue: value. Original characters are unchanged. The close-up is display-only, not a new OCR reading.</small><label><input type="checkbox" disabled={!view} checked={selected.includes(proposal.id) && Boolean(view)} onChange={event => setSelected(current => event.target.checked ? [...current, proposal.id] : current.filter(id => id !== proposal.id))} />I checked these fragments against the photo; include this layout suggestion.</label></div>
        </article>
      })}
    </div>}
    <section className="paddle-field-comparison" aria-label="Unverified field comparison"><h4>What would change?</h4><p>Existing text is included. These are candidate readings, not checked answers or accuracy scores.</p>
      {comparison.error ? <p role="status">Comparison unavailable: {comparison.error}</p> : <><div className="paddle-comparison-scroll" tabIndex="0" role="region" aria-label="Candidate readings table"><table><thead><tr><th scope="col">Field</th><th scope="col">Current transcript</th><th scope="col">With raw Paddle</th><th scope="col">With selected suggestions</th></tr></thead><tbody>{comparison.fields.map(field => <tr key={field.id}><th scope="row">{field.label}</th><td>{fieldText(field.current)}</td><td className={field.raw.conflict ? 'reading-conflict' : ''}>{fieldText(field.raw)}</td><td className={field.selected.conflict ? 'reading-conflict' : ''}>{fieldText(field.selected)}</td></tr>)}</tbody></table></div><small>{comparison.limitation}</small></>}
    </section>
    <button type="button" className="primary-action" disabled={Boolean(comparison.error)} onClick={() => onAppend(selectedRows)}>Append raw Paddle OCR{selectedRows.length ? ` + ${selectedRows.length} reviewed suggestion${selectedRows.length === 1 ? '' : 's'}` : ''}</button>
    <small>Earlier OCR and manual corrections are preserved. New conflicts remain visible. Field and measurement confirmations are reset; no full-inspection confidence score is invented.</small>
  </section>
}
