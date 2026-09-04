import { FIELD_RULES } from './lib/inspectionSafety.mjs'
export default function FieldVerification({ extraction, meta, onChange }) {
  const review = (field, change) => onChange('fieldReviews', { ...meta.fieldReviews, [field.id]: { state: 'unreviewed', ...meta.fieldReviews?.[field.id], ...change, value: field.value } })
  return <section className="evidence-verification"><h4>Verify against the physical label</h4><p>OCR agreement is a heuristic, not an accuracy probability. Confirm each decisive reading. “Not detected” is not proof that a declaration is absent. Correct the transcript above when needed; the original OCR remains separate.</p>
    {extraction.fields.filter((field) => FIELD_RULES[field.id]).map((field) => {
      const saved = meta.fieldReviews?.[field.id]
      const stale = saved?.value !== field.value
      const invalid = field.conflict || !field.value || ['invalid', 'conflict'].includes(field.validation?.status)
      return <div className="field-review-row" key={field.id}>
        <label htmlFor={`verify-${field.id}`}>{field.label}<br /><b>{field.conflict ? 'Conflicting values — resolve first' : field.value || (field.detected ? 'Invalid / incomplete reading' : 'Not detected')}</b></label>
        <select id={`verify-${field.id}`} value={stale ? 'unreviewed' : saved?.state || 'unreviewed'} onChange={(event) => review(field, { state: event.target.value })}><option value="unreviewed">Needs verification</option><option value="confirmed" disabled={invalid}>Confirmed on label</option><option value="absent" disabled={field.detected}>Physically absent</option><option value="unreadable">Unreadable — retake</option><option value="not_captured">Panel not captured</option></select>
        <input aria-label={`${field.label} verification note`} maxLength={2000} value={saved?.reason || ''} onChange={(event) => review(field, { reason: event.target.value, ...(stale ? { state: 'unreviewed' } : {}) })} placeholder="Source panel and evidence for this confirmation / absence" />
        {field.validation?.message && invalid && <small role="status">{field.validation.message}</small>}
        {field.conflict && <small role="status">Same-transcript candidates: {field.candidates?.map((candidate) => candidate.value || candidate.raw).join(' · ')}</small>}
        {meta.fieldCandidates?.[field.id]?.length > 1 && <small role="status">Conflicting OCR readings: {meta.fieldCandidates[field.id].map((candidate) => `${candidate.value} [${(candidate.sources || []).join(', ')}]`).join(' · ')}</small>}
      </div>
    })}
    <div className="safety-confirmations">{[
      ['allPanelsCaptured', 'I inspected all relevant package panels; an absent declaration was not merely outside the photograph.'],
      ['classificationConfirmed', 'I verified commodity class, category and exemption inputs against the actual package.'],
      ['pdpConfirmed', 'I verified the physical principal display panel area, not just the projected photo area.'],
      ['measurementConfirmed', 'I verified a same-plane physical scale and individual glyph measurements (not an OCR line box).'],
      ['widthCharacterConfirmed', 'I verified the measured character is subject to the width requirement, not an excepted narrow character.'],
    ].map(([id, label]) => <label key={id}><input type="checkbox" checked={meta[id] === true} onChange={(event) => onChange(id, event.target.checked)} />{label}</label>)}<label>Measurement surface<select aria-label="Measurement surface" value={meta.measurementSurface || 'unverified'} onChange={(event) => onChange('measurementSurface', event.target.value)}><option value="unverified">Not verified</option><option value="flat">Flat, same plane</option><option value="curved">Curved — abstain from geometry verdict</option></select></label></div>
  </section>
}
