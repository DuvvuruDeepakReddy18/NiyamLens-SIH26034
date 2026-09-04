import { PLACEMENT_FIELDS } from './lib/placement.mjs'

// Officer observations are linked to both a captured panel and the exact reading.
// These controls do not claim to detect the legal PDP automatically.
export default function PlacementReview({ extraction, meta, evidenceItems, onChange, result }) {
  const panels = <><option value="">Select captured panel</option>{evidenceItems.map((item, i) => <option key={item.id} value={item.id}>Panel {i + 1} · {item.name}</option>)}</>
  const review = (field, change) => onChange('placementReviews', { ...meta.placementReviews, [field.id]: { state: 'unreviewed', ...meta.placementReviews?.[field.id], ...change, value: field.value } })
  const spacing = meta.quantitySpacing || {}
  const changeSpacing = (key, value) => onChange('quantitySpacing', { ...spacing, [key]: value, value: extraction.byId.netQuantity?.value || '', ...(key !== 'confirmed' ? { confirmed: false } : {}) })
  return <details className="evidence-verification placement-review">
    <summary>Declaration placement & quantity clear space <span>Officer-assisted · Rule 8</span></summary>
    <p>Use this only after identifying the physical principal display panel (PDP). Food, curved packs and other specialist profiles remain manual review. Observations are not an automated image certification.</p>
    <label className="placement-control">Placement scope<select aria-label="Placement scope" value={meta.placementScope || 'unknown'} onChange={(e) => onChange('placementScope', e.target.value)}><option value="unknown">Not assessed</option><option value="general_flat">General retail · flat package</option><option value="specialist">Specialist / curved package — review</option></select></label>
    <label className="placement-confirm"><input type="checkbox" checked={meta.placementPdpConfirmed === true} onChange={(e) => onChange('placementPdpConfirmed', e.target.checked)} />I identified the legal PDP and verified that this flat-package scope applies.</label>
    {extraction.fields.filter((field) => PLACEMENT_FIELDS.includes(field.id) && !(field.id === 'unitSalePrice' && result?.checks.some((check) => check.id === 'unitSalePrice' && check.status === 'info'))).map((field) => {
      const observed = meta.placementReviews?.[field.id] || {}
      const stale = observed.state && observed.state !== 'unreviewed' && observed.value !== field.value
      return <div className="field-review-row" key={field.id}>
        <label>{field.label}<br /><b>{field.conflict ? 'Conflicting values — resolve first' : field.value || 'Not detected / may be inapplicable'}</b></label>
        <select aria-label={`${field.label} placement`} value={stale ? 'unreviewed' : observed.state || 'unreviewed'} onChange={(e) => review(field, { state: e.target.value })}><option value="unreviewed">Not located</option><option value="inside_pdp" disabled={!field.value || field.conflict}>On verified PDP</option><option value="outside_pdp" disabled={!field.value || field.conflict}>Outside verified PDP</option><option value="unreadable">Unreadable / retake</option></select>
        <select className="placement-full" aria-label={`${field.label} source panel`} value={observed.panelId || ''} onChange={(e) => review(field, { panelId: e.target.value, state: 'unreviewed' })}>{panels}</select>
        <input aria-label={`${field.label} placement note`} maxLength={2000} value={observed.reason || ''} onChange={(e) => review(field, { reason: e.target.value })} placeholder="Where on the panel? Record at least 12 characters of evidence." />
        {stale && <small role="status">Reading changed. Reconfirm placement for the new value.</small>}
      </div>
    })}
    <h4>Net-quantity clear-space measurements</h4>
    <p>Measure on the same flat image plane at one zoom: numeral height (not the OCR line box), then the nearest printed-information gaps above, below, left and right. Absolute millimetre calibration is not needed for these ratios. The calculation includes your stated uncertainty; it cannot verify your measurement.</p>
    <label className="placement-control">Quantity source panel<select aria-label="Quantity clear-space source panel" value={spacing.panelId || ''} onChange={(e) => changeSpacing('panelId', e.target.value)}>{panels}</select></label>
    <div className="placement-measures">{[['numeralHeightPx', 'Quantity numeral height (px)'], ['abovePx', 'Clear space above (px)'], ['belowPx', 'Clear space below (px)'], ['leftPx', 'Clear space left (px)'], ['rightPx', 'Clear space right (px)'], ['uncertaintyPercent', 'Clear-space uncertainty (%)']].map(([key, label]) => <label key={key}>{label}<input type="number" aria-label={label} min={key === 'numeralHeightPx' ? '0.01' : '0'} max={key === 'uncertaintyPercent' ? '50' : '100000'} step="any" value={spacing[key] ?? ''} onChange={(e) => changeSpacing(key, e.target.value)} /></label>)}</div>
    <label className="placement-control">Measurement source note<input aria-label="Clear-space measurement note" maxLength={2000} value={spacing.reason || ''} onChange={(e) => changeSpacing('reason', e.target.value)} placeholder="Describe the numeral and nearest printed items, at least 12 characters." /></label>
    <label className="placement-confirm"><input type="checkbox" checked={spacing.confirmed === true && spacing.value === extraction.byId.netQuantity?.value} onChange={(e) => changeSpacing('confirmed', e.target.checked)} />I verified these measurements against the captured quantity declaration.</label>
    <p>Only applicable declarations are assessed. A missing separate unit sale price can be inapplicable under the encoded equal-price exception; other exceptions require officer review. <a href="https://lmd.kerala.gov.in/service-registration/" target="_blank" rel="noreferrer">Department rule reference</a></p>
  </details>
}
