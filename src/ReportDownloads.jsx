import { useEffect, useRef, useState } from 'react'
import { Download, FileJson, FolderDown, ShieldCheck } from 'lucide-react'
import { createReportExport } from './lib/reportExport.mjs'
import './report-downloads.css'

export default function ReportDownloads({ record }) {
  const [state, setState] = useState({ phase: 'idle', artifact: null, message: '' })
  const controllerRef = useRef(null)
  const verifyInputRef = useRef(null)
  useEffect(() => {
    const controller = createReportExport({ onChange: setState })
    controllerRef.current = controller
    setState(controller.getState())
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null }
  }, [record])
  const busy = ['generating', 'saving', 'verifying'].includes(state.phase)
  const artifact = state.artifact?.recordId === record.id ? state.artifact : null
  const prepare = (format) => controllerRef.current?.prepare({ recordId: record.id, format, build: format === 'json'
    ? () => new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
    : async () => { const { buildInspectionDocx } = await import('./lib/reportDocument.mjs'); return buildInspectionDocx(record) },
  })
  const save = () => controllerRef.current?.save(typeof window.showSaveFilePicker === 'function' ? window.showSaveFilePicker.bind(window) : undefined)

  return <section className="report-downloads no-print" aria-label="Save evidence reports">
    <div className="report-download-actions">
      <button type="button" onClick={() => prepare('json')} disabled={busy}><FileJson size={16} /> Export JSON</button>
      <button type="button" onClick={() => prepare('docx')} disabled={busy}><Download size={16} /> Export Word (.docx)</button>
      <small>Prepare a report, then choose where to save it. Exports preserve the sealed evidence record.</small>
    </div>
    {state.message && <p className={`report-save-status ${state.phase === 'error' ? 'has-error' : ''}`} role={state.phase === 'error' ? 'alert' : 'status'}>{state.message}</p>}
    {artifact && <div className="report-download-ready">
      <div><strong>{artifact.name}</strong><span>{Math.ceil(artifact.size / 1024)} KB · {artifact.format === 'docx' ? 'Editable native Word document' : 'Complete JSON evidence bundle'}</span></div>
      <div className="report-download-actions">
        <button type="button" disabled={busy} onClick={save}><FolderDown size={16} /> Save as…</button>
        <a href={artifact.url} download={artifact.name} aria-disabled={busy || undefined} onClick={(event) => { if (busy) event.preventDefault(); else controllerRef.current?.noteDownloadRequested() }}>Download with browser</a>
        <button type="button" disabled={busy} onClick={() => verifyInputRef.current?.click()}><ShieldCheck size={16} /> Verify saved copy</button>
        <input ref={verifyInputRef} type="file" hidden accept={artifact.format === 'docx' ? '.docx' : '.json'} aria-label="Choose saved report to verify" onChange={(event) => { const copy = event.target.files?.[0]; event.target.value = ''; if (copy) void controllerRef.current?.verify(copy) }} />
      </div>
      <small>The browser-download link stays available for retry. Closing this report does not prove a download completed.</small>
    </div>}
  </section>
}
