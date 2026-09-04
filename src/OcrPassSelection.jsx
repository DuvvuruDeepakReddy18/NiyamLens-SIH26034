import { useEffect, useMemo, useState } from 'react'
import { prepareOcrPassSelection } from './lib/ocrPassSelection.mjs'
import './ocr-pass-selection.css'

const keyOf = (panelId, passId) => JSON.stringify([panelId, passId])

export default function OcrPassSelection({ evidenceItems, onApply, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const historyVersion = JSON.stringify(evidenceItems.map(panel => [panel.id, (panel.ocrPasses || []).map(pass => [pass.id, pass.text])]))
  useEffect(() => { setSelected([]); setReason(''); setAcknowledged(false); setError('') }, [historyVersion])
  const selections = useMemo(() => selected.map(key => { const [panelId, passId] = JSON.parse(key); return { panelId, passId } }), [selected])
  const preview = useMemo(() => {
    try { return { result: prepareOcrPassSelection({ evidenceItems, selections, reason }) } }
    catch (failure) { return { error: failure.message } }
  }, [evidenceItems, selections, reason])
  if (!evidenceItems.some(panel => (panel.ocrPasses || []).some(pass => pass.text.trim()))) return null
  const busy = disabled || applying
  const apply = async () => {
    if (busy || !acknowledged || !preview.result) return
    setApplying(true); setError('')
    try {
      // Pass IDs and a reason only. Parent re-resolves current immutable passes
      // under its operation lock and audits before changing any working text.
      const applied = await onApply({ selections, reason })
      if (applied !== false) { setOpen(false); setAcknowledged(false) }
    } catch (failure) { setError(failure.message || 'Unable to apply the selection. Existing text was preserved.') }
    finally { setApplying(false) }
  }
  return <section className="ocr-pass-selection" aria-label="Choose working OCR readings">
    <button className="ocr-pass-toggle" type="button" disabled={busy} aria-expanded={open} onClick={() => setOpen(value => !value)}>Choose working OCR readings</button>
    {open && <div className="ocr-pass-body">
      <h3>Choose the readings supported by your photograph</h3>
      <p>A whole-image reading and a clearer crop can disagree. Compare the original image and every raw reading below. Nothing is preselected or ranked by a desired answer.</p>
      <p className="ocr-pass-warning">Applying replaces the current working transcript, including manual edits. All original images and all raw OCR passes remain in evidence. Excluded readings are recorded in the audit trail, not erased. This is an officer choice—not automatic correction or compliance approval.</p>
      <fieldset disabled={busy}>
        <legend>Raw OCR history</legend>
        {evidenceItems.map((panel, panelIndex) => <div className="ocr-pass-panel" key={panel.id}>
          <h4>Panel {panelIndex + 1} · {panel.name || 'Captured label'}</h4>
          <p>Select at least one nonempty reading for this panel. A cropped reading may not cover declarations elsewhere on the photograph.</p>
          {panel.analysisUrl && <img className="ocr-pass-photo" src={panel.analysisUrl} alt={`Original analysis view for panel ${panelIndex + 1}; compare the raw readings against this photograph`} />}
          {(panel.ocrPasses || []).map((pass, passIndex) => {
            const key = keyOf(panel.id, pass.id)
            return <details key={key} className="ocr-pass-reading">
              <summary>Reading {passIndex + 1} · {pass.provider || 'Provider unrecorded'} · {pass.strategy || 'Strategy unrecorded'} · {pass.text.length} characters</summary>
              <pre>{pass.text || '(no readable text)'}</pre>
              <label><input type="checkbox" disabled={!pass.text.trim()} checked={selected.includes(key)} onChange={event => { setSelected(current => event.target.checked ? [...current, key] : current.filter(item => item !== key)); setAcknowledged(false) }} />Use reading {passIndex + 1} from panel {panelIndex + 1} in the working transcript</label>
            </details>
          })}
          {!(panel.ocrPasses || []).some(pass => pass.text.trim()) && <p role="status">No nonempty raw OCR pass is available. This panel will be explicitly marked not assessed from OCR.</p>}
        </div>)}
        <label className="ocr-pass-reason">Reason for selecting and excluding these readings<textarea value={reason} minLength={12} maxLength={1000} rows={3} placeholder="Describe what you compared against the photograph and why the selected reading is better supported." onChange={event => { setReason(event.target.value); setAcknowledged(false) }} /></label>
        {preview.result ? <details open className="ocr-pass-preview"><summary>Exact proposed working transcript · {preview.result.text.length} characters</summary><pre>{preview.result.text}</pre></details> : <p className="ocr-pass-hint">{preview.error}</p>}
        <label className="ocr-pass-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I compared the selected readings with the photograph and understand that Apply replaces the working transcript and resets prior confirmations.</label>
        <button type="button" className="primary-action" disabled={busy || !acknowledged || !preview.result} onClick={apply}>{applying ? 'Recording officer selection…' : 'Apply selected readings to working transcript'}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <small>Raw OCR is never changed by this action. The system does not infer missing digits, units, dates, or confidence. Recapture an unreadable declaration instead of guessing it.</small>
    </div>}
  </section>
}
