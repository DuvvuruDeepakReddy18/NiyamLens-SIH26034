import { Archive, ImagePlus, LoaderCircle } from 'lucide-react'
import './inspectionDrafts.css'

export default function InspectionDrafts({ pending, rows, message, ready, busy, blocked, previewPending, challengeActive, hasEvidence, saved, onNew, onRestore, onOpenReport, onReload }) {
  const locked = !ready || busy || blocked || previewPending
  return <section className="inspection-drafts" aria-label="Inspection drafts" aria-busy={busy}>
    <div className="inspection-draft-toolbar">
      <div className="inspection-draft-copy">
        <strong>{pending ? 'Continue your unfinished inspection' : saved ? 'Inspection sealed' : 'One package. One inspection.'}</strong>
        <p role="status">{message || (pending ? `${pending.evidenceItems?.[0]?.name || 'Your previous package'} is saved on this device.` : 'Save this package as a draft before starting another. Drafts stay on this device, not in cloud backup.')}</p>
      </div>
      <div className="inspection-draft-actions">
        {!ready && <button type="button" onClick={onReload} disabled={busy}>Retry draft loading</button>}
        {pending && <button type="button" disabled={locked} onClick={() => onRestore(pending)}>Restore draft</button>}
        {saved && <button type="button" onClick={onOpenReport} disabled={busy}>Open sealed report</button>}
        <button type="button" className="new-inspection-action" onClick={onNew} disabled={locked || challengeActive || (!saved && !pending && !hasEvidence)}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <ImagePlus size={17} />}
          {busy ? 'Saving draft…' : saved ? 'Start new inspection' : pending || hasEvidence ? 'Save draft & new inspection' : 'New inspection'}
        </button>
      </div>
    </div>
    {(previewPending || challengeActive || blocked) && <p className="draft-switch-hint">{previewPending ? 'Append or dismiss the OCR preview before switching packages.' : challengeActive ? 'Complete the blind challenge before starting a different inspection.' : 'Finish or cancel the current operation before switching packages.'}</p>}
    <details className="saved-drafts" key={rows.length ? 'available' : 'empty'}>
      <summary><Archive size={16} /><span>Saved drafts ({rows.length})</span><small>On this device only</small></summary>
      {rows.length ? <ul>{rows.map(row => <li key={row.id}>
        {row.evidenceItems?.[0]?.analysisUrl && <img src={row.evidenceItems[0].analysisUrl} alt="" loading="lazy" />}
        <div><strong>{row.evidenceItems?.[0]?.name || 'Untitled package'}</strong><span>{row.evidenceItems?.length || 0} panel(s) · {new Date(row.savedAt || row.startedAt).toLocaleString()}</span><small>{row.inspectionId}</small></div>
        <button type="button" disabled={locked || challengeActive} onClick={() => onRestore(row)}>Resume draft</button>
      </li>)}</ul> : <p>No saved drafts yet. Use “Save draft & new inspection” to keep a package here.</p>}
      {rows.length > 0 && <p>Resuming a draft first saves any current package. Photos, OCR text, review notes and measurements are kept separate.</p>}
    </details>
  </section>
}
