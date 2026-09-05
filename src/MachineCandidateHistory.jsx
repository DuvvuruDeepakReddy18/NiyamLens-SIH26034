import { machineCandidateHistory } from './lib/machineCandidateHistory.mjs'

export default function MachineCandidateHistory({ auditChain }) {
  const history = machineCandidateHistory(auditChain)
  if (history.status === 'none') return null
  return <details className="optional-notes" data-testid="machine-layout-candidates">
    <summary>Machine field associations · not officer verification</summary>
    <p>These are historical machine candidates, not your current review status. Source fragments were joined using their recorded positions; no characters were corrected. Compare every value with the original photograph.</p>
    {history.status === 'unavailable'
      ? <p role="status">Association summary unavailable. {history.reason} No verification or clean-scan result is implied.</p>
      : <>
        {history.laterOcrCompletions > 0 && <p>A later OCR run is recorded. These associations belong to the earlier structured scan and may not describe the current transcript.</p>}
        {history.rows.length
          ? <ul>{history.rows.map((row, index) => <li key={`${row.panelId}:${index}`}><strong>{row.label}</strong>: {row.text}<small> · {row.sourceIds.join(' + ')} · unverified at scan time</small></li>)}</ul>
          : <p>The recorded scan found no unambiguous geometric associations. Complete text may still parse; missing or ambiguous declarations need a closer photo or manual review. This does not mean that the label passed inspection.</p>}
        {history.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      </>}
  </details>
}
