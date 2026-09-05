import { useState } from 'react'

export default function PaddleStampRecovery({ disabled, hasRegion, onRun }) {
  const [mode, setMode] = useState('dark-ink')
  return <details className="paddle-stamp-recovery">
    <summary>Recover an overprinted or sideways dark stamp</summary>
    <p>Optional local pixel treatment for dark ink over a coloured label. It can lose coloured text: compare the exact input and raw reading before appending. No hidden characters are reconstructed.</p>
    <div className="ocr-advanced-actions">
      <label>Stamp direction <select aria-label="Stamp recovery direction" value={mode} disabled={disabled} onChange={event => setMode(event.target.value)}>
        <option value="dark-ink">Already upright</option>
        <option value="dark-ink-90">Turn 90° clockwise</option>
      </select></label>
      <button type="button" className="secondary-action" disabled={disabled} onClick={() => onRun(false, mode)}>Read dark stamp · whole panels</button>
      <button type="button" className="secondary-action" disabled={disabled || !hasRegion} onClick={() => onRun(true, mode)}>Read dark stamp · selected region</button>
    </div>
    <small>For a stamp only, select its complete heading and value on the image first. Earlier observations stay in history; contradictory readings still require review.</small>
  </details>
}
