import { useState } from 'react'

export default function PaddleStampRecovery({ disabled, hasRegion, onRun, onlyRegion = false }) {
  const [mode, setMode] = useState('dark-ink')
  return <details className="paddle-stamp-recovery">
    <summary>{onlyRegion ? 'Recover this selected stamp' : 'Recover an overprinted or sideways dark stamp'}</summary>
    <p>Optional local pixel treatment for dark ink over a coloured label. It can lose coloured text: compare the exact input and raw reading before appending. No hidden characters are reconstructed.</p>
    <div className="ocr-advanced-actions">
      <label>Stamp direction <select aria-label={onlyRegion ? 'Selected stamp recovery direction' : 'Stamp recovery direction'} value={mode} disabled={disabled} onChange={event => setMode(event.target.value)}>
        <option value="dark-ink">Already upright</option>
        <option value="dark-ink-90">Turn 90° clockwise</option>
        <option value="dark-ink-180">Turn 180° · upside down</option>
        <option value="dark-ink-270">Turn 270° clockwise · 90° anticlockwise</option>
      </select></label>
      {!onlyRegion && <button type="button" className="secondary-action" disabled={disabled} onClick={() => onRun(false, mode)}>Read dark stamp · whole panels</button>}
      <button type="button" className="secondary-action" disabled={disabled || !hasRegion} onClick={() => onRun(true, mode)}>{onlyRegion ? 'Read selected dark stamp' : 'Read dark stamp · selected region'}</button>
    </div>
    <small>For a stamp only, select its complete heading and value on the image first. Earlier observations stay in history; contradictory readings still require review.</small>
  </details>
}
