import { useState } from 'react'
import { CORE_DECLARATIONS } from './lib/inspectionInsights.mjs'

const colors = { high: '#087c66', review: '#ad670b', low: '#ba3e53', unavailable: '#687786' }
export default function InspectionInsights({ analysis, onInspect }) {
  const [selected, setSelected] = useState('mrp')
  const data = analysis.insights
  if (!data || !analysis.hasEvidence) return null
  const field = data.explanations.find(item => item.id === selected) || data.explanations[0]
  const chartFields = data.explanations.filter(item => CORE_DECLARATIONS.includes(item.id))
  return <div className="inspection-insights">
    <article className="current-chart inspection-journey" aria-label="Actual inspection workflow counts">
      <span className="eyebrow">FROM CAPTURE TO DECISION</span><h3>What has actually happened?</h3>
      <p>Current-package counts only. Units change from photos to fields to rule checks to records—this is a workflow, not a conversion-rate funnel.</p>
      <ol>{data.stages.map(stage => <li key={stage.id}><span>{stage.label}</span><b>{stage.count} <small>{stage.unit}</small></b><p>{stage.detail}</p></li>)}</ol>
    </article>
    <div className="current-chart-grid">
      <article className="current-chart mandatory-presence"><span className="eyebrow">DECLARATION COVERAGE</span><h3>Mandatory declarations · evidence status</h3>
        <p>Presence in this working transcript, not a completeness percentage. Applicability follows the current rule checks; an uncaptured field is not a violation.</p>
        <ul>{data.mandatory.map(item => {
          const present = item.hasUsableReading
          return <li key={item.id}><button onClick={() => setSelected(item.id)}>{item.label}</button><div role="img" aria-label={`${item.label}: ${item.presence}`}><i style={{ width: present ? '100%' : '0%', background: analysis.distribution.find(state => state.id === item.status).color }} /></div><small>{item.presence} · {item.humanReview.startsWith('Required') ? 'verify' : 'review recorded'}</small></li>
        })}</ul>
      </article>
      <article className="current-chart extraction-confidence"><span className="eyebrow">OCR / EXTRACTION CONFIDENCE</span><h3>Reported OCR scores—not accuracy</h3>
        <p>Only retained engine scores matching the exact current value and its source line are shown. Parser constants and scores belonging to an earlier, different value are never used.</p>
        <ul>{chartFields.map(item => <li key={item.id}><button onClick={() => setSelected(item.id)}>{item.label}</button><strong>{item.reportedScore.value === null ? 'Unavailable' : `${item.reportedScore.value}/100`}</strong><div role="img" aria-label={`${item.label}: ${item.reportedScore.value === null ? 'score unavailable' : `reported engine score ${item.reportedScore.value} of 100; not accuracy`}`}><i style={{ width: `${item.reportedScore.value ?? 0}%`, background: colors[item.reportedScore.band] }} /></div><small style={{ color: colors[item.reportedScore.band] }}>{item.reportedScore.label}</small></li>)}</ul>
        <p className="chart-footnote">Zero-based 0–100 engine scale. Minimum across matching retained observations, not an average across engines. Display bands: high ≥90, review 70–&lt;90, low &lt;70. These uncalibrated thresholds do not decide PASS or waive human review.</p>
      </article>
    </div>
    <article className="current-chart result-explanation" aria-label="Why this result">
      <header><div><span className="eyebrow">WHY THIS RESULT?</span><h3>A traceable explanation for each field</h3></div><label>Declaration <select value={field.id} onChange={event => setSelected(event.target.value)}>{data.explanations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></header>
      <dl>
        <div><dt>Evidence</dt><dd>{field.panel}<small>Source matching is heuristic; an assigned back-panel role is not proof that this declaration is visible.</small><blockquote>{field.evidence || 'No source declaration located.'}</blockquote></dd></div>
        <div><dt>Rule</dt><dd>{field.relatedChecks.length ? field.relatedChecks.map(check => <p key={check.id}><b>{check.label} · {check.rule}</b><small>{check.reason}</small></p>) : 'No field-specific rule was evaluated in the current scope. Resolve applicability first.'}<small>Rule pack: {field.rulePack}</small></dd></div>
        <div><dt>Validation</dt><dd>{field.presence}<small>{field.validation}</small></dd></div>
        <div><dt>OCR score</dt><dd>{field.reportedScore.value === null ? 'Unavailable' : `${field.reportedScore.value}/100 · uncalibrated engine score`}<small>{field.reportedScore.reason}</small></dd></div>
        <div><dt>Decision</dt><dd><strong>{field.decision}</strong><small>Field-linked checks only; the overall package assessment is shown above. No inferred PASS from presence alone.</small></dd></div>
        <div><dt>Human review</dt><dd>{field.humanReview}<button onClick={() => onInspect(field.id)}>Verify / correct this field →</button></dd></div>
      </dl>
    </article>
    <details className="current-chart ocr-error-policy"><summary>OCR verification & error handling</summary>
      <p><b>OCR proposes the evidence; rules and officers decide.</b></p>
      <p>IMAGE → OCR → SCORE / CONFLICT CHECK → VERIFY / CORRECT → RULE EVALUATION → FINAL VERDICT</p>
      <ul><li>Unverified, low-scoring or conflicting readings require officer verification. Even a high engine score is not proof.</li><li>Retained OCR passes expose disagreements. Missing text prompts recapture or a close-up, not automatic absence.</li><li>Open the original photograph, edit the working transcript, then confirm the corrected value. Original OCR and photographs remain retained; uncertain field-to-photo matching is labelled.</li><li>Corrections immediately re-run the rule assessment and reset stale field confirmations. Current scores are withheld when the corrected value is not in the retained OCR observations.</li><li>Uncertain checks remain MANUAL REVIEW. A confirmed violation elsewhere can still make the package FLAG; uncertainty is not hidden and does not erase a genuine flag.</li></ul>
    </details>
  </div>
}
