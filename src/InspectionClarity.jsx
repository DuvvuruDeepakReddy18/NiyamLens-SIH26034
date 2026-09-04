import { Check, ChevronRight, CircleHelp, FileSearch, Image, LockKeyhole, Ruler, ScanLine, ShieldCheck } from 'lucide-react'
import { evidenceTrace, inspectionProgress } from './lib/inspectionPresentation.mjs'

const STAGE_ICONS = { capture: Image, recognize: ScanLine, verify: FileSearch, measure: Ruler, evaluate: ShieldCheck, seal: LockKeyhole }

export function InspectionProgress({ evidenceItems, extraction, provenance, meta, result, saved }) {
  const stages = inspectionProgress({ evidenceItems, extraction, provenance, meta, result, saved })
  return (
    <nav className="inspection-progress" aria-label="Current inspection progress">
      <div className="inspection-progress-heading"><span className="eyebrow">LIVE CASE PROGRESS</span><strong>Image → evidence → rule → decision</strong></div>
      <ol>
        {stages.map((stage, index) => {
          const Icon = STAGE_ICONS[stage.id]
          return <li key={stage.id} className={stage.state} aria-current={stage.state === 'current' ? 'step' : undefined}>
            <span className="progress-node">{stage.complete ? <Check size={15} /> : <Icon size={15} />}</span>
            <span><b>{stage.label}</b><small>{stage.summary}</small></span>
            {index < stages.length - 1 && <ChevronRight size={14} aria-hidden="true" />}
          </li>
        })}
      </ol>
    </nav>
  )
}

const reviewLabel = (review) => {
  if (!review || review.state === 'unreviewed') return 'Officer verification pending'
  return review.state.replaceAll('_', ' ')
}

export function EvidenceTracePanel({ fieldId, extraction, regions, evidenceItems, result, meta, onLocate }) {
  const trace = evidenceTrace({ fieldId, extraction, regions, evidenceItems, result, meta })
  if (!trace) return (
    <aside className="evidence-trace empty" aria-label="Evidence traceability">
      <CircleHelp size={19} />
      <div><strong>Trace a decision back to the photograph</strong><p>Choose “View source” on a detected field. NiyamLens will expose the real panel, OCR region, parsed value, applicable rule and officer-review state.</p></div>
    </aside>
  )

  const regionDetail = trace.region?.bbox
    ? `x ${Math.round(trace.region.bbox.x0)} · y ${Math.round(trace.region.bbox.y0)} · ${Math.round(trace.region.bbox.x1 - trace.region.bbox.x0)}×${Math.round(trace.region.bbox.y1 - trace.region.bbox.y0)} px`
    : 'No OCR bounding box available'
  const nodes = [
    { kind: 'IMAGE', value: trace.panel ? `Panel ${trace.panelIndex + 1} · ${trace.panel.name || trace.panel.panelRole || 'captured evidence'}` : 'Source panel unavailable', detail: trace.panel?.sha256 ? `SHA-256 ${trace.panel.sha256.slice(0, 12)}…` : 'No captured digest shown' },
    { kind: 'OCR REGION', value: trace.region ? 'Located in the source image' : 'Not geometrically located', detail: regionDetail },
    { kind: 'FIELD', value: `${trace.field.label}: ${trace.field.conflict ? 'conflicting values' : trace.field.value || 'not detected'}`, detail: trace.field.validation?.message || 'Parser output · not certified' },
    { kind: 'RULE', value: trace.checks.length ? [...new Set(trace.checks.map((check) => check.rule))].join(' · ') : trace.ruleIds.join(' · '), detail: `${trace.checks.length} applicable encoded check${trace.checks.length === 1 ? '' : 's'}` },
    { kind: 'ASSESSMENT', value: trace.checks.length ? trace.checks.map((check) => `${check.label}: ${check.status}`).join(' · ') : 'No check emitted for this profile', detail: 'Rules engine output; not an officer order' },
    { kind: 'HUMAN REVIEW', value: reviewLabel(trace.review), detail: trace.review?.reason || 'A decisive field requires verification against the physical label' },
  ]

  return (
    <aside className="evidence-trace" aria-label={`Evidence trace for ${trace.field.label}`}>
      <header><div><span className="eyebrow">EVIDENCE TRACE</span><h4>Why does this field affect the assessment?</h4></div>{trace.region && <button type="button" onClick={() => onLocate?.(fieldId)}><FileSearch size={15} /> Show on photo</button>}</header>
      <div className="trace-chain">
        {nodes.map((node, index) => <div className="trace-node" key={node.kind}>
          <span>{index + 1}</span>
          <div><small>{node.kind}</small><strong>{node.value}</strong><p>{node.detail}</p></div>
          {index < nodes.length - 1 && <ChevronRight size={15} aria-hidden="true" />}
        </div>)}
      </div>
      <footer><LockKeyhole size={14} /> OCR proposes evidence. Encoded rules evaluate supplied facts. A human officer verifies and decides.</footer>
    </aside>
  )
}
