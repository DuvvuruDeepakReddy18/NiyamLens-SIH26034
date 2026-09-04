// Export lifecycle, separate from document generation. A download link is a request,
// not proof that a browser persisted a file. Only read-back comparison is verified.
export const EXPORT_LIMIT_BYTES = 128 * 1024 * 1024
export const EXPORT_URL_GRACE_MS = 60_000

function validateBlob(blob) {
  if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > EXPORT_LIMIT_BYTES || typeof blob.arrayBuffer !== 'function') {
    throw new Error('The generated report is empty, invalid or exceeds the 128 MiB export limit.')
  }
}

export function reportFileName(recordId, format) {
  const id = String(recordId || 'inspection').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'inspection'
  return format === 'docx' ? `${id}-inspection.docx` : `${id}-evidence.json`
}

export async function verifyReportCopy(expected, copy) {
  validateBlob(expected)
  if (!copy || copy.size !== expected.size || typeof copy.arrayBuffer !== 'function') return false
  const [left, right] = await Promise.all([expected.arrayBuffer(), copy.arrayBuffer()])
  if (left.byteLength !== right.byteLength || left.byteLength !== expected.size) return false
  const a = new Uint8Array(left); const b = new Uint8Array(right)
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false
  return true
}

const busy = (phase) => ['generating', 'saving', 'verifying'].includes(phase)
const errorText = (error) => error?.message || 'An unknown file operation failed.'

export function createReportExport({ onChange = () => {}, urlApi = globalThis.URL, schedule = globalThis.setTimeout } = {}) {
  let generation = 0
  let disposed = false
  let state = { phase: 'idle', artifact: null, message: '' }
  const current = (ticket, artifact) => !disposed && ticket === generation && (!artifact || state.artifact === artifact)
  const publish = (next) => { if (!disposed) { state = { ...state, ...next }; onChange(state) } }
  const release = (artifact) => {
    if (!artifact?.url) return
    // Let a browser consume an already-clicked link even if the dialog closes.
    const timer = schedule(() => urlApi.revokeObjectURL(artifact.url), EXPORT_URL_GRACE_MS)
    timer?.unref?.()
  }

  return {
    getState: () => state,
    async prepare({ recordId, format, build }) {
      if (disposed || busy(state.phase)) return false
      if (!['json', 'docx'].includes(format)) throw new Error('Unsupported report format.')
      const ticket = ++generation
      release(state.artifact)
      publish({ phase: 'generating', artifact: null, message: `Preparing ${format === 'docx' ? 'Word' : 'JSON'} report…` })
      try {
        const blob = await build()
        if (!current(ticket)) return false
        validateBlob(blob)
        const artifact = { blob, url: urlApi.createObjectURL(blob), name: reportFileName(recordId, format), format, recordId, size: blob.size }
        publish({ phase: 'ready', artifact, message: 'Report prepared. Choose Save as to select a location, or use the browser download link.' })
        return true
      } catch (error) {
        if (current(ticket)) publish({ phase: 'error', message: `Report could not be prepared: ${errorText(error)}` })
        return false
      }
    },
    async save(showSaveFilePicker) {
      const artifact = state.artifact
      if (disposed || !artifact || busy(state.phase)) return false
      if (typeof showSaveFilePicker !== 'function') {
        publish({ phase: 'ready', message: 'Save as is unavailable in this browser. Use the browser download link, then verify the saved copy.' })
        return false
      }
      const ticket = generation
      let writable; let committed = false
      publish({ phase: 'saving', message: 'Choose a save location. This report has not been verified on disk yet.' })
      try {
        // Call the picker before ANY await: this method is invoked directly from
        // the Save as click and must preserve transient user activation.
        const handlePromise = showSaveFilePicker({ suggestedName: artifact.name, types: [{ description: artifact.format === 'docx' ? 'Word document' : 'JSON evidence bundle', accept: { [artifact.blob.type || 'application/octet-stream']: [artifact.format === 'docx' ? '.docx' : '.json'] } }] })
        const handle = await handlePromise
        if (!current(ticket, artifact)) return false
        writable = await handle.createWritable()
        if (!current(ticket, artifact)) { await writable.abort(); return false }
        await writable.write(artifact.blob)
        if (!current(ticket, artifact)) { await writable.abort(); return false }
        await writable.close()
        committed = true
        if (!current(ticket, artifact)) return false
        const copy = await handle.getFile()
        const matches = await verifyReportCopy(artifact.blob, copy)
        if (!current(ticket, artifact)) return false
        if (!matches) throw new Error('The saved copy did not match the generated report. Retry Save as with a different filename.')
        publish({ phase: 'saved', message: `Saved copy read back and matched byte-for-byte (${artifact.size.toLocaleString()} bytes).` })
        return true
      } catch (error) {
        if (writable && !committed) { try { await writable.abort() } catch { /* Original write error stays visible. */ } }
        if (!current(ticket, artifact)) return false
        if (error?.name === 'AbortError' && !writable) publish({ phase: 'cancelled', message: 'Save cancelled. The prepared report is still available; no download was started automatically.' })
        else publish({ phase: 'error', message: `${committed ? 'File write finished, but saved-copy verification failed' : 'Report could not be saved'}: ${errorText(error)} The prepared report is still available.` })
        return false
      }
    },
    noteDownloadRequested() {
      if (!disposed && state.artifact && !busy(state.phase)) publish({ phase: 'download_requested', message: 'Browser download requested; completion is not verified. Check Chrome Downloads, then select Verify saved copy.' })
    },
    async verify(copy) {
      const artifact = state.artifact
      if (disposed || !artifact || !copy || busy(state.phase)) return false
      const ticket = generation
      publish({ phase: 'verifying', message: 'Comparing the selected file with the prepared report…' })
      try {
        const matches = await verifyReportCopy(artifact.blob, copy)
        if (!current(ticket, artifact)) return false
        publish({ phase: matches ? 'verified' : 'error', message: matches ? `Selected saved copy matches byte-for-byte (${artifact.size.toLocaleString()} bytes).` : 'Selected file does not match this report. Choose the file you just downloaded; the evidence record has not changed.' })
        return matches
      } catch (error) {
        if (current(ticket, artifact)) publish({ phase: 'error', message: `Saved copy could not be verified: ${errorText(error)}` })
        return false
      }
    },
    reset() {
      if (disposed) return
      generation++
      release(state.artifact)
      publish({ phase: 'idle', artifact: null, message: '' })
    },
    dispose() {
      if (disposed) return
      generation++
      release(state.artifact)
      disposed = true
      state = { phase: 'idle', artifact: null, message: '' }
    },
  }
}
