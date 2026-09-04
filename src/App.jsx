import { useEffect, useMemo, useRef, useState } from 'react'
import { createWorker } from 'tesseract.js'
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Barcode,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  FileJson,
  Gauge,
  History,
  ImagePlus,
  Info,
  Languages,
  Layers3,
  LockKeyhole,
  Library,
  LoaderCircle,
  Menu,
  MousePointer2,
  Printer,
  RotateCcw,
  RotateCw,
  Ruler,
  ScanLine,
  SearchCheck,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Upload,
  UploadCloud,
  Users,
  Timer,
  WandSparkles,
  X,
  XCircle,
} from 'lucide-react'
import { DEMOS } from './lib/demoData.js'
import { detectBarcode, evidenceFromFile, processImage, rectifyEvidence, rectifyEvidenceFromBarcode, reprocessEvidence } from './lib/evidence.mjs'
import { extractDeclarations } from './lib/extraction.mjs'
import { appendAuditEvent, verifyAuditChain } from './lib/audit.mjs'
import { parseBenchmarkFile, runBenchmark, SEEDED_BENCHMARK } from './lib/benchmark.mjs'
import { APPROVAL_GATES, RULE_EDGE_CASES, RULE_MATRIX, RULE_MATRIX_VERSION } from './lib/ruleMatrix.mjs'
import { decryptBundle, encryptBundle } from './lib/secureBundle.mjs'
import { evaluateCompliance, FONT_TIERS, RULE_PACK } from './lib/rules.mjs'
import { createEvidenceStore } from './lib/storage.mjs'
import { appendReview, auditPresentation, effectiveStatus, normalizeCase } from './lib/caseRecords.mjs'
import { evaluateInspection, fieldCandidates } from './lib/inspectionSafety.mjs'
import { createOperation, createSyncEngine } from './lib/syncEngine.mjs'
import { mergeCloudRecord } from './lib/workspaceClient.mjs'
import { WorkspaceGate, SharedOperations } from './Workspace.jsx'
import FieldVerification from './FieldVerification.jsx'
import { analyzeImageQuality, calibrateOcrReliability, createOcrInputVariants, createOcrRegionVariant, createOcrTileVariants, detectReferenceCard, flattenOcrWords, matchDeclarationRegions, measureRegion, mergeOcrPassTexts, webXrDepthSupport } from './lib/vision.mjs'

const NAV_ITEMS = [
  { id: 'inspect', label: 'New inspection', icon: ScanLine },
  { id: 'challenge', label: 'Blind challenge', icon: Timer },
  { id: 'dashboard', label: 'Command view', icon: BarChart3 },
  { id: 'history', label: 'Inspection history', icon: History },
  { id: 'benchmark', label: 'Validation lab', icon: Database },
  { id: 'operations', label: 'Officer operations', icon: Users },
  { id: 'rules', label: 'Rule library', icon: Library },
]

const STATUS = {
  compliant: { label: 'PASS', className: 'pass', icon: BadgeCheck },
  non_compliant: { label: 'FLAG', className: 'fail', icon: XCircle },
  manual_review: { label: 'MANUAL REVIEW', className: 'review', icon: TriangleAlert },
  pass: { label: 'PASS', className: 'pass', icon: Check },
  fail: { label: 'FLAG', className: 'fail', icon: X },
  review: { label: 'REVIEW', className: 'review', icon: CircleHelp },
  exempt: { label: 'EXEMPT', className: 'exempt', icon: ShieldCheck },
  info: { label: 'INFO', className: 'info', icon: Info },
}

const statusLabel = (status) => STATUS[status]?.label || String(status || 'unknown').replaceAll('_', ' ').toUpperCase()
const panelMeasurement = (meta, panelId) => meta.panelMeasurements?.[panelId] || {}

const PANEL_ROLES = [
  { id: 'front', label: 'Front / identity', short: 'Front' },
  { id: 'price_date', label: 'MRP and pack date', short: 'MRP + date' },
  { id: 'responsible_care', label: 'Manufacturer and consumer care', short: 'Maker + care' },
  { id: 'quantity_barcode', label: 'Net quantity and barcode', short: 'Qty + barcode' },
  { id: 'full_declaration', label: 'Complete declaration panel', short: 'Full panel' },
  { id: 'other', label: 'Other evidence', short: 'Other' },
]

const CAPTURE_REQUIREMENTS = PANEL_ROLES.slice(0, 4)
const CORE_DECLARATIONS = [
  { id: 'mrp', label: 'MRP' },
  { id: 'netQuantity', label: 'Net quantity' },
  { id: 'packDate', label: 'Pack date' },
  { id: 'responsibleEntity', label: 'Responsible entity' },
  { id: 'consumerCare', label: 'Consumer care' },
]

const INITIAL_META = {
  productName: '',
  category: 'general',
  commodityClass: 'standard',
  perishable: false,
  quantity: '',
  unit: 'g',
  barcode: '',
  ocrLanguage: 'eng',
  translationLanguage: 'en',
  translationText: '',
  panelWidthCm: '',
  panelHeightCm: '',
  cylinderDiameterCm: '',
  cylinderHeightCm: '',
  cylinderCoverage: 40,
  pdpArea: '',
  pdpUncertainty: 5,
  formedText: false,
  referenceMm: 20,
  referencePx: '',
  glyphPx: '',
  glyphWidthPx: '',
  panelMeasurements: {},
  measurementUncertainty: 8,
  ocrConfidence: 100,
  ocrEngineConfidence: 100,
  ocrReliabilityReason: '',
  ocrSource: 'local',
}

const formatDate = (value) =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

const loadLegacyHistory = () => {
  try {
    return JSON.parse(localStorage.getItem('niyamlens:inspections') || '[]')
  } catch {
    return []
  }
}

const createInspectionId = () => {
  const date = new Date()
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `NLM-${stamp}-${crypto.randomUUID()}`
}

function StatusPill({ status, compact = false }) {
  const config = STATUS[status] || STATUS.info
  const Icon = config.icon
  return (
    <span className={`status-pill ${config.className} ${compact ? 'compact' : ''}`}>
      <Icon size={compact ? 13 : 16} strokeWidth={2.4} />
      {config.label}
    </span>
  )
}

function BrandMark({ compact = false }) {
  return (
    <div className={`brand-mark ${compact ? 'compact' : ''}`}>
      <div className="brand-icon" aria-hidden="true">
        <span className="paper-lines" />
        <span className="lens-ring" />
        <span className="lens-handle" />
      </div>
      <div>
        <strong>NiyamLens</strong>
        {!compact && <span>Inspection intelligence</span>}
      </div>
    </div>
  )
}

function Shell({ route, setRoute, children, historyCount, actor }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const current = NAV_ITEMS.find((item) => item.id === route)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <BrandMark />
        <div className="rail-caption">FIELD CONSOLE / 01</div>
        <nav aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                type="button"
                key={item.id}
                className={route === item.id ? 'active' : ''}
                onClick={() => {
                  setRoute(item.id)
                  setMenuOpen(false)
                }}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {item.id === 'history' && historyCount > 0 && <b>{historyCount}</b>}
              </button>
            )
          })}
        </nav>
        <div className="rule-pack-card">
          <div className="signal-dot" />
          <span>Rule pack online</span>
          <strong>{RULE_PACK.id}</strong>
          <small>Prototype interpretation</small>
        </div>
        <div className="sidebar-foot">
          <ShieldCheck size={17} />
          <span>Decisions remain officer-reviewed.</span>
        </div>
      </aside>

      <div className="page-frame">
        <header className="topbar">
          <button className="menu-button" type="button" aria-label="Open navigation" onClick={() => setMenuOpen((value) => !value)}>
            <Menu size={20} />
          </button>
          <div>
            <span className="eyebrow">SIH26034 / LEGAL METROLOGY</span>
            <h1>{current?.label}</h1>
          </div>
          <div className="topbar-status">
            {actor && <span><Users size={13} />{actor.name} · {actor.role}</span>}
            <span><span className="live-dot" />Local-first</span>
            <span>Evidence mode</span>
          </div>
        </header>
        <main>{children}</main>
      </div>
      {menuOpen && <button type="button" className="menu-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
    </div>
  )
}

function StepHeader({ number, icon: Icon, title, copy, complete }) {
  return (
    <div className="step-header">
      <div className={`step-number ${complete ? 'complete' : ''}`}>{complete ? <Check size={17} /> : number}</div>
      <div className="step-icon"><Icon size={19} /></div>
      <div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </div>
  )
}

function CaptureChecklist({ evidenceItems }) {
  const roles = new Set(evidenceItems.map((item) => item.panelRole))
  const completePanel = roles.has('full_declaration')
  return (
    <div className="capture-checklist" aria-label="Recommended package views">
      {CAPTURE_REQUIREMENTS.map((requirement) => {
        const covered = roles.has(requirement.id) || (completePanel && requirement.id !== 'front')
        return <span key={requirement.id} className={covered ? 'covered' : ''}>{covered ? <Check size={12} /> : <CircleHelp size={12} />}{requirement.short}</span>
      })}
      <small>{evidenceItems.length ? 'Assign each image its purpose. Missing views mean missing evidence, not an automatic violation.' : 'Capture all four views when declarations are split across the package.'}</small>
    </div>
  )
}

function DeclarationCoverage({ extraction, reliability, engineConfidence, reliabilityReason }) {
  if (!extraction.raw) return null
  const missing = CORE_DECLARATIONS.filter((item) => !extraction.byId[item.id]?.detected)
  const needsRetake = Number(reliability) < 55
  return (
    <div className={`declaration-coverage ${needsRetake ? 'retake' : missing.length ? 'incomplete' : 'complete'}`}>
      <header>
        <div><b>{needsRetake ? 'Retake or deep scan recommended' : missing.length ? 'Declaration coverage incomplete' : 'Core declarations located'}</b><small>{reliabilityReason || 'Verify every extracted value against its highlighted source.'}</small></div>
        <span>Reliability {Number(reliability || 0).toFixed(0)}% · engine {Number(engineConfidence || 0).toFixed(0)}%</span>
      </header>
      <div>
        {CORE_DECLARATIONS.map((item) => {
          const detected = extraction.byId[item.id]?.detected
          return <span key={item.id} className={detected ? 'covered' : ''}>{detected ? <Check size={12} /> : <CircleHelp size={12} />}{item.label}</span>
        })}
      </div>
      {missing.length > 0 && <p>Add or retake a panel containing: {missing.map((item) => item.label).join(', ')}. The system will abstain when evidence quality is insufficient.</p>}
    </div>
  )
}

function CalibrationBoard({ evidenceItems, activeEvidence, meta, onMeasure, onActive, onRemove, onTransform, onRectify, onRoleChange, processing, regions = [], activeRegionId, onRegionSelect, onDetectReference, onCheckDepth, depthState }) {
  const [mode, setMode] = useState('')
  const [points, setPoints] = useState({ reference: [], height: [], width: [], perspective: [] })
  const boardRef = useRef(null)
  const imageRef = useRef(null)
  const imageUrl = activeEvidence?.analysisUrl || ''
  const fileName = activeEvidence?.name || ''
  const measurement = panelMeasurement(meta, activeEvidence?.id)

  useEffect(() => {
    setPoints({ reference: [], height: [], width: [], perspective: [] })
    setMode('')
  }, [imageUrl])

  const modes = {
    reference: { field: 'referencePx', color: '#00a37a', label: 'Reference' },
    height: { field: 'glyphPx', color: '#e0a320', label: 'Glyph height' },
    width: { field: 'glyphWidthPx', color: '#c6493d', label: 'Glyph width' },
    perspective: { field: '', color: '#4f70d6', label: 'Flatten panel', points: 4 },
  }

  const handlePoint = (event) => {
    if (!mode || !boardRef.current || !imageRef.current || !imageUrl) return
    const rect = boardRef.current.getBoundingClientRect()
    const naturalScale = (imageRef.current.naturalWidth || rect.width) / Math.max(1, rect.width)
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
      pxX: (event.clientX - rect.left) * naturalScale,
      pxY: (event.clientY - rect.top) * naturalScale,
    }
    const needed = modes[mode].points || 2
    const next = [...points[mode], point].slice(-needed)
    setPoints((current) => ({ ...current, [mode]: next }))
    if (mode === 'perspective' && next.length === 4) {
      onRectify?.(next.map((item) => ({ x: item.pxX, y: item.pxY })))
      setMode('')
    } else if (mode !== 'perspective' && next.length === 2) {
      const distance = Math.hypot(next[1].pxX - next[0].pxX, next[1].pxY - next[0].pxY)
      onMeasure(modes[mode].field, Number(distance.toFixed(1)))
      setMode('')
    }
  }

  const reset = () => {
    setPoints({ reference: [], height: [], width: [], perspective: [] })
    onMeasure('referencePx', '')
    onMeasure('glyphPx', '')
    onMeasure('glyphWidthPx', '')
  }

  return (
    <div className="calibration-wrap">
      <div
        className={`image-board ${mode ? 'measuring' : ''} ${imageUrl ? '' : 'empty'}`}
        role="presentation"
      >
        {imageUrl ? (
          <div ref={boardRef} className="image-layer" onClick={handlePoint}>
            <img ref={imageRef} src={imageUrl} alt={fileName ? `Package image ${fileName}` : 'Uploaded package'} />
            <svg className="measure-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Detected declaration regions">
              {regions.filter((region) => region.panelId === activeEvidence?.id).map((region) => (
                <g key={region.id} className={`declaration-region ${activeRegionId === region.id ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); onRegionSelect?.(region.id) }}>
                  <rect
                    x={(region.bbox.x0 / region.pageWidth) * 100}
                    y={(region.bbox.y0 / region.pageHeight) * 100}
                    width={((region.bbox.x1 - region.bbox.x0) / region.pageWidth) * 100}
                    height={((region.bbox.y1 - region.bbox.y0) / region.pageHeight) * 100}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text x={(region.bbox.x0 / region.pageWidth) * 100} y={Math.max(2, (region.bbox.y0 / region.pageHeight) * 100 - 1)}>{region.label}</text>
                </g>
              ))}
              {Object.entries(points).map(([key, set]) => {
                const style = modes[key]
                return (
                  <g key={key}>
                    {key !== 'perspective' && set.length === 2 && (
                      <line x1={set[0].x} y1={set[0].y} x2={set[1].x} y2={set[1].y} stroke={style.color} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
                    )}
                    {key === 'perspective' && set.length > 1 && <polyline points={set.map((point) => `${point.x},${point.y}`).join(' ')} fill="rgba(79,112,214,.11)" stroke={style.color} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />}
                    {set.map((point, index) => (
                      <circle key={index} cx={point.x} cy={point.y} r="1.15" fill={style.color} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                )
              })}
            </svg>
            {mode && <div className="measurement-prompt"><MousePointer2 size={15} /> {mode === 'perspective' ? `Select corners TL → TR → BR → BL (${points.perspective.length}/4)` : `Select two endpoints for ${modes[mode].label.toLowerCase()}`}</div>}
          </div>
        ) : (
          <div className="empty-board">
            <ImagePlus size={36} />
            <strong>No package image</strong>
            <span>Capture the front, back or side panel to begin.</span>
          </div>
        )}
      </div>

      {evidenceItems.length > 0 && (
        <div className="evidence-strip" aria-label="Captured package panels">
          {evidenceItems.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={item.id === activeEvidence?.id ? 'active' : ''}
              onClick={() => onActive(item.id)}
            >
              <img src={item.analysisUrl} alt="" />
              <span><b>Panel {index + 1} · {PANEL_ROLES.find((role) => role.id === item.panelRole)?.short || 'Unassigned'}</b><small>{item.name}</small></span>
              <i title={item.sha256 ? `SHA-256 ${item.sha256}` : 'Controlled test asset'}>{item.sha256 ? item.sha256.slice(0, 8) : 'TEST'}</i>
            </button>
          ))}
        </div>
      )}

      {activeEvidence && (
        <div className="image-tools">
          <div>
            <button type="button" onClick={() => onTransform({ rotation: (activeEvidence.rotation + 90) % 360 })} disabled={processing}>
              <RotateCw size={14} /> Rotate
            </button>
            <button type="button" onClick={() => onTransform({ grayscale: !activeEvidence.grayscale })} className={activeEvidence.grayscale ? 'active' : ''} disabled={processing}>
              <WandSparkles size={14} /> OCR grayscale
            </button>
            <button type="button" onClick={onDetectReference} disabled={processing}><Ruler size={14} /> Detect 20 mm card</button>
            <button type="button" onClick={onCheckDepth}><Layers3 size={14} /> Depth capability</button>
            <button type="button" className="remove-panel" onClick={() => onRemove(activeEvidence.id)}>
              <X size={14} /> Remove panel
            </button>
          </div>
          <label>
            <span>OCR contrast</span>
            <input
              type="range"
              min="80"
              max="180"
              value={activeEvidence.contrast}
              onChange={(event) => onTransform({ contrast: Number(event.target.value) })}
              disabled={processing}
            />
            <b>{activeEvidence.contrast}%</b>
          </label>
          <label className="panel-role-field">
            <span>Panel purpose</span>
            <select value={activeEvidence.panelRole || 'other'} onChange={(event) => onRoleChange?.(activeEvidence.id, event.target.value)} aria-label="Active panel purpose">
              {PANEL_ROLES.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
            </select>
          </label>
          {depthState?.message && <small className={depthState.supported ? 'depth-ok' : 'depth-warn'}>{depthState.message}</small>}
        </div>
      )}

      {activeEvidence?.quality && (
        <div className={`quality-gate ${activeEvidence.quality.status}`}>
          <strong>Capture quality {activeEvidence.quality.score}/100</strong>
          <span>Sharpness {activeEvidence.quality.sharpness} · Contrast {activeEvidence.quality.contrast} · Glare {activeEvidence.quality.glarePercent}%</span>
          <small>{activeEvidence.quality.issues[0] || 'Image quality is suitable for OCR.'}</small>
        </div>
      )}

      <div className="measure-toolbar">
        {Object.entries(modes).map(([key, option]) => (
          <button
            type="button"
            key={key}
            className={mode === key ? 'active' : ''}
            onClick={() => setMode(mode === key ? '' : key)}
            disabled={!imageUrl}
          >
            <span style={{ background: option.color }} />
            {option.label}
          </button>
        ))}
        <button type="button" className="reset-measures" onClick={reset} disabled={!imageUrl}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="measure-readout">
        <span><b>Reference</b>{measurement.referencePx || '—'} px</span>
        <span><b>Height</b>{measurement.glyphPx || '—'} px</span>
        <span><b>Width</b>{measurement.glyphWidthPx || '—'} px</span>
        {activeEvidence?.sha256 && <span className="hash-readout"><b>SHA-256</b>{activeEvidence.sha256.slice(0, 16)}…</span>}
      </div>
    </div>
  )
}

function Field({ label, hint, children, wide = false }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function ExtractionWorkbench({ extraction, onApply, barcodeState, regions = [], onSelectRegion, meta }) {
  const visibleFields = extraction.fields.filter((item) => !['barcode'].includes(item.id))
  const found = visibleFields.filter((item) => item.detected).length
  const regionMap = Object.fromEntries(regions.map((region) => [region.id, region]))
  return (
    <div className="extraction-workbench">
      <header>
        <div>
          <span className="eyebrow">STRUCTURED EVIDENCE</span>
          <h4>{found} of {visibleFields.length} declaration signals detected</h4>
        </div>
        <button type="button" onClick={() => onApply(extraction)} disabled={!extraction.raw}>
          <WandSparkles size={15} /> Apply detected context
        </button>
      </header>
      <div className="extraction-grid">
        {visibleFields.map((item) => (
          <button type="button" key={item.id} className={item.detected ? 'detected' : 'missing'} onClick={() => regionMap[item.id] && onSelectRegion?.(item.id)} disabled={!regionMap[item.id]}>
            <span>{item.detected ? <Check size={13} /> : <CircleHelp size={13} />}{item.label}</span>
            <strong>{item.value || 'Not detected'}</strong>
            <small>{item.detected ? `${item.confidence}% parser${regionMap[item.id] ? ` · region ${regionMap[item.id].confidence}%` : ''}` : 'Correct OCR text or supply manually'}</small>
            {item.validation && <em className={item.validation.status.includes('invalid') ? 'field-invalid' : 'field-valid'}>{item.validation.message}</em>}
            {regionMap[item.id] && <i>{measureRegion(regionMap[item.id], panelMeasurement(meta, regionMap[item.id].panelId).referencePx, meta.referenceMm, meta.measurementUncertainty)?.valueMm.toFixed(2) || '—'} mm estimated line box</i>}
          </button>
        ))}
      </div>
      {barcodeState.message && (
        <div className={`barcode-state ${barcodeState.error ? 'error' : ''}`}>
          <Barcode size={15} /> {barcodeState.message}
        </div>
      )}
    </div>
  )
}

function VerdictPanel({ result, onSave, onReport, saved, saving, evidenceCount }) {
  const config = STATUS[result.status]
  const Icon = config.icon
  return (
    <aside className="verdict-panel">
      <div className={`verdict-hero ${config.className}`}>
        <div className="verdict-kicker">CURRENT ASSESSMENT</div>
        <Icon size={34} />
        <strong>{config.label}</strong>
        <p>
          {result.status === 'compliant' && (result.context.category === 'food'
            ? 'The Legal Metrology checks in this food-package profile passed; FSSAI requirements were not evaluated.'
            : 'All evaluated rules passed within supplied confidence bounds.')}
          {result.status === 'exempt' && 'The selected package profile is exempt under the encoded Rule 26 conditions.'}
          {result.status === 'non_compliant' && 'At least one violation remains outside the stated uncertainty bounds.'}
          {result.status === 'manual_review' && 'Evidence is incomplete or too close to a legal threshold for automation.'}
        </p>
        <div className="score-ring" style={{ '--score': `${result.score * 3.6}deg` }}>
          <span>{result.score}</span>
          <small>evidence score</small>
        </div>
      </div>

      <div className="verdict-counts">
        <span><b>{result.counts.pass}</b> passed</span>
        <span><b>{result.counts.fail}</b> flagged</span>
        <span><b>{result.counts.review}</b> review</span>
      </div>

      <div className="checks-list">
        {result.checks.map((check) => (
          <details key={check.id} className={`check-row ${check.status}`}>
            <summary>
              <StatusPill status={check.status} compact />
              <span>{check.label}</span>
              <ChevronRight size={15} />
            </summary>
            <div>
              <strong>{check.rule}</strong>
              <p>{check.reason}</p>
              <code>{check.evidence}</code>
            </div>
          </details>
        ))}
      </div>

      <div className="verdict-actions">
        <button type="button" className="primary-action" onClick={onSave} disabled={saved || saving}>
          {saving ? <LoaderCircle className="spin" size={17} /> : saved ? <Check size={17} /> : <Archive size={17} />}
          {saving ? 'Sealing evidence…' : saved ? 'Inspection saved' : 'Finalize inspection'}
        </button>
        <button type="button" className="secondary-action" onClick={onReport}>
          <FileCheck2 size={17} /> Evidence report
        </button>
      </div>
      <div className="evidence-integrity"><ShieldCheck size={14} />{evidenceCount || 0} captured panel{evidenceCount === 1 ? '' : 's'} · IndexedDB evidence register</div>
      <p className="legal-caveat">Decision support only. A Legal Metrology officer must verify the applicable rule version and physical evidence.</p>
    </aside>
  )
}

function ChallengeClock({ challenge }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!challenge?.active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [challenge?.active])
  if (!challenge?.active) return null
  const elapsed = Math.max(0, Math.floor((now - new Date(challenge.startedAt).getTime()) / 1000))
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const seconds = String(elapsed % 60).padStart(2, '0')
  return <div className="challenge-ribbon"><Timer size={18} /><span>Blind inspection <b>{challenge.code}</b></span><code>{minutes}:{seconds}</code><small>Controlled packets disabled · all actions audited</small></div>
}

function InspectionStudio({ onSaveRecord, onOpenReport, challenge, onChallengeComplete, actor, workspace, store, onNewInspection }) {
  const [inspectionId, setInspectionId] = useState(createInspectionId)
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString())
  const [evidenceItems, setEvidenceItems] = useState([])
  const [activeEvidenceId, setActiveEvidenceId] = useState('')
  const [text, setText] = useState('')
  const [rawOcrText, setRawOcrText] = useState('')
  const [draft, setDraft] = useState(null)
  const [draftReady, setDraftReady] = useState(false)
  const [draftMessage, setDraftMessage] = useState('')
  const [meta, setMeta] = useState(INITIAL_META)
  const [ocrState, setOcrState] = useState({ running: false, progress: 0, label: 'Ready', error: '' })
  const [processing, setProcessing] = useState(false)
  const [barcodeState, setBarcodeState] = useState({ message: '', error: false, candidate: null })
  const [ocrWords, setOcrWords] = useState([])
  const [activeRegionId, setActiveRegionId] = useState('')
  const [depthState, setDepthState] = useState({ supported: false, message: '' })
  const [auditChain, setAuditChain] = useState([])
  const auditRef = useRef([])
  const auditQueue = useRef(Promise.resolve())
  const [saved, setSaved] = useState(false)
  const [sealedRecord, setSealedRecord] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)

  const activeEvidence = evidenceItems.find((item) => item.id === activeEvidenceId) || evidenceItems[0] || null
  const extraction = useMemo(() => extractDeclarations(text), [text])
  const rawRegions = useMemo(() => matchDeclarationRegions(extraction, ocrWords), [extraction, ocrWords])
  const evaluationMeta = useMemo(() => ({ ...meta, evidencePanelIds: evidenceItems.map((item) => item.id) }), [meta, evidenceItems])
  const result = useMemo(() => evaluateInspection({ text, meta: evaluationMeta }), [text, evaluationMeta])
  const regions = useMemo(() => {
    const statuses = Object.fromEntries(result.checks.map((check) => [check.id, check.status]))
    return rawRegions.map((region) => ({ ...region, status: statuses[region.id] || 'info' }))
  }, [rawRegions, result])

  useEffect(() => {
    let active = true
    store.get('drafts', 'active').then((record) => { if (active) { setDraft(record); setDraftReady(true) } }).catch((error) => { if (active) { setDraftMessage(error.message); setDraftReady(true) } })
    return () => { active = false }
  }, [store])
  useEffect(() => {
    if (!draftReady || draft || saved || !evidenceItems.length) return
    const timer = setTimeout(() => {
      store.put('drafts', { id: 'active', inspectionId, startedAt, evidenceItems, activeEvidenceId, text, rawOcrText, meta, ocrWords, auditChain, challengeId: challenge?.id || null }).then(() => setDraftMessage('Draft saved on this device.')).catch((error) => setDraftMessage(`Draft NOT saved: ${error.message}`))
    }, 350)
    return () => clearTimeout(timer)
  }, [store, draftReady, draft, saved, inspectionId, startedAt, evidenceItems, activeEvidenceId, text, rawOcrText, meta, ocrWords, auditChain])
  const restoreDraft = () => {
    if (challenge?.active && draft.challengeId !== challenge.id) { setDraftMessage('This draft predates the blind challenge. It cannot be used as blind-run evidence. Discard it explicitly or exit the challenge to recover it.'); return }
    setInspectionId(draft.inspectionId); setStartedAt(draft.startedAt); setEvidenceItems(draft.evidenceItems); setActiveEvidenceId(draft.activeEvidenceId)
    setText(draft.text); setRawOcrText(draft.rawOcrText || ''); setMeta(draft.meta); setOcrWords(draft.ocrWords || []); auditRef.current = draft.auditChain || []; setAuditChain(auditRef.current); setDraft(null); setDraftMessage('Draft restored; verify before sealing.')
  }

  const updateMeta = (key, value) => setMeta((current) => ({ ...current, [key]: value,
    ...(['pdpArea', 'pdpUncertainty', 'formedText'].includes(key) ? { pdpConfirmed: false } : {}),
    ...(['referenceMm', 'measurementUncertainty'].includes(key) ? { measurementConfirmed: false, widthCharacterConfirmed: false } : {}),
    ...(['quantity', 'unit', 'category', 'commodityClass'].includes(key) ? { classificationConfirmed: false } : {}),
  }))
  const updatePanelMeasurement = (key, value) => {
    if (!activeEvidence?.id) return
    setMeta((current) => ({
      ...current,
      measurementConfirmed: false,
      widthCharacterConfirmed: false,
      panelMeasurements: {
        ...(current.panelMeasurements || {}),
        [activeEvidence.id]: { ...(current.panelMeasurements?.[activeEvidence.id] || {}), [key]: value },
      },
    }))
  }
  const invalidatePanelMeasurement = (panelId) => setMeta((current) => {
    const nextMeasurements = { ...(current.panelMeasurements || {}) }
    delete nextMeasurements[panelId]
    return { ...current, panelMeasurements: nextMeasurements }
  })

  const recordAudit = (type, payload = {}) => {
    const operation = auditQueue.current.then(async () => {
      const next = await appendAuditEvent(auditRef.current, type, payload, actor?.id || 'local-officer')
      auditRef.current = next; setAuditChain(next); return next
    })
    auditQueue.current = operation.catch(() => {})
    return operation
  }

  const updatePanelDimension = (key, value) => {
    setMeta((current) => {
      const next = { ...current, [key]: value, pdpConfirmed: false }
      const width = Number(key === 'panelWidthCm' ? value : next.panelWidthCm)
      const height = Number(key === 'panelHeightCm' ? value : next.panelHeightCm)
      if (width > 0 && height > 0) next.pdpArea = Number((width * height).toFixed(2))
      return next
    })
  }

  const updateCylinderDimension = (key, value) => {
    setMeta((current) => {
      const next = { ...current, [key]: value, pdpConfirmed: false }
      const diameter = Number(key === 'cylinderDiameterCm' ? value : next.cylinderDiameterCm)
      const height = Number(key === 'cylinderHeightCm' ? value : next.cylinderHeightCm)
      const coverage = Number(key === 'cylinderCoverage' ? value : next.cylinderCoverage)
      if (diameter > 0 && height > 0 && coverage > 0) next.pdpArea = Number((Math.PI * diameter * height * (coverage / 100)).toFixed(2))
      return next
    })
  }

  const beginEvidenceRecord = () => {
    setInspectionId(createInspectionId())
    setStartedAt(new Date().toISOString())
    setSaved(false)
    auditRef.current = []
    setAuditChain([])
  }

  const applyExtraction = (parsed) => {
    setMeta((current) => ({
      ...current,
      productName: parsed.suggestions.productName || current.productName,
      category: parsed.suggestions.category || current.category,
      commodityClass: parsed.suggestions.commodityClass || current.commodityClass,
      quantity: parsed.suggestions.quantity ?? current.quantity,
      unit: parsed.suggestions.unit || current.unit,
      barcode: parsed.suggestions.barcode || current.barcode,
    }))
  }

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, Math.max(0, 4 - evidenceItems.length))
    if (!files.length) return
    const firstPanel = evidenceItems.length === 0
    try {
      if (workspace && files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('Managed evidence accepts JPEG, PNG or WebP originals. Export other camera formats before capture.')
      setProcessing(true)
      setOcrState({ running: false, progress: 4, label: `Securing ${files.length} evidence panel${files.length > 1 ? 's' : ''}`, error: '' })
      const capturedItems = await Promise.all(files.map(evidenceFromFile))
      const guidedRoles = CAPTURE_REQUIREMENTS.map((item) => item.id)
      const nextItems = capturedItems.map((item, index) => ({
        ...item,
        panelRole: guidedRoles[evidenceItems.length + index] || 'other',
      }))
      if (firstPanel) {
        beginEvidenceRecord()
        setText('')
        setRawOcrText('')
        setMeta({ ...INITIAL_META, enforceEvidenceReview: true })
        setOcrWords([])
        setBarcodeState({ message: '', error: false, candidate: null })
        await recordAudit('inspection_started', { challengeId: challenge?.id || null })
      }
      setEvidenceItems((current) => [...current, ...nextItems].slice(0, 4))
      setActiveEvidenceId(nextItems[0].id)
      for (const item of nextItems) {
        await recordAudit('evidence_captured', { id: item.id, name: item.name, panelRole: item.panelRole, sha256: item.sha256, quality: item.quality?.score, capturedAt: item.capturedAt })
      }
      setOcrState({ running: false, progress: 8, label: `${nextItems.length} panel${nextItems.length > 1 ? 's' : ''} ready for OCR`, error: '' })
    } catch (error) {
      setOcrState({ running: false, progress: 0, label: 'Image rejected', error: error.message || 'The selected evidence could not be prepared.' })
    } finally {
      setProcessing(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const applyDemo = async (demo) => {
    beginEvidenceRecord()
    const id = `test-${Date.now()}`
    try {
      setProcessing(true)
      setOcrState({ running: false, progress: 5, label: 'Preparing controlled evidence for browser OCR', error: '' })
      const analysisUrl = await processImage(demo.imageUrl)
      const quality = await analyzeImageQuality(analysisUrl)
      setEvidenceItems([{
        id,
        name: demo.fileName,
        type: 'image/svg+xml',
        size: 0,
        width: quality.width,
        height: quality.height,
        quality,
        sha256: '',
        originalUrl: demo.imageUrl,
        analysisUrl,
        rotation: 0,
        grayscale: false,
        contrast: 112,
        panelRole: 'full_declaration',
        capturedAt: new Date().toISOString(),
      }])
      setActiveEvidenceId(id)
      setOcrWords([])
      setText(demo.text)
      setMeta({
        ...INITIAL_META,
        ...demo.meta,
        panelMeasurements: {
          [id]: {
            referencePx: demo.meta.referencePx,
            glyphPx: demo.meta.glyphPx,
            glyphWidthPx: demo.meta.glyphWidthPx,
          },
        },
      })
      setOcrState({ running: false, progress: 100, label: 'Controlled demo evidence loaded', error: '' })
      setBarcodeState({ message: '', error: false, candidate: null })
      await recordAudit('controlled_packet_loaded', { fileName: demo.fileName })
    } catch (error) {
      setOcrState({ running: false, progress: 0, label: 'Controlled evidence unavailable', error: error.message || 'The controlled packet could not be prepared.' })
    } finally {
      setProcessing(false)
    }
  }

  const transformActiveEvidence = async (changes) => {
    if (!activeEvidence || processing || activeEvidence.id.startsWith('test-')) return
    try {
      setProcessing(true)
      const updated = await reprocessEvidence(activeEvidence, changes)
      setEvidenceItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      invalidatePanelMeasurement(updated.id)
      setOcrWords((current) => current.filter((word) => word.panelId !== updated.id))
      await recordAudit('image_preprocessing_changed', { evidenceId: updated.id, rotation: updated.rotation, grayscale: updated.grayscale, contrast: updated.contrast })
      setOcrState((current) => ({ ...current, label: 'Image preprocessing updated' }))
    } catch (error) {
      setOcrState((current) => ({ ...current, error: error.message || 'Image preprocessing failed.' }))
    } finally {
      setProcessing(false)
    }
  }

  const rectifyActiveEvidence = async (points) => {
    if (!activeEvidence || processing || activeEvidence.id.startsWith('test-')) return
    try {
      setProcessing(true)
      setOcrState((current) => ({ ...current, label: 'Flattening selected panel plane', error: '' }))
      const updated = await rectifyEvidence(activeEvidence, points)
      setEvidenceItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      invalidatePanelMeasurement(updated.id)
      setOcrWords((current) => current.filter((word) => word.panelId !== updated.id))
      await recordAudit('perspective_rectified', { evidenceId: updated.id, method: updated.perspective.method, outputWidth: updated.width, outputHeight: updated.height, sourcePoints: updated.perspective.points })
      setOcrState((current) => ({ ...current, label: 'Perspective flattened — rerun OCR for this panel', error: '' }))
    } catch (error) {
      setOcrState((current) => ({ ...current, error: error.message || 'Perspective flattening failed.' }))
    } finally {
      setProcessing(false)
    }
  }

  const removeEvidence = (id) => {
    const remaining = evidenceItems.filter((item) => item.id !== id)
    setEvidenceItems(remaining)
    if (activeEvidenceId === id) setActiveEvidenceId(remaining[0]?.id || '')
    setOcrWords((current) => current.filter((word) => word.panelId !== id))
    invalidatePanelMeasurement(id)
    recordAudit('evidence_removed_before_seal', { evidenceId: id })
  }

  const updateEvidenceRole = (id, panelRole) => {
    setEvidenceItems((current) => current.map((item) => item.id === id ? { ...item, panelRole } : item))
    recordAudit('evidence_role_changed', { evidenceId: id, panelRole })
  }

  const scanBarcode = async () => {
    if (!activeEvidence) return
    try {
      setBarcodeState({ message: 'Scanning the active panel…', error: false })
      const detected = await detectBarcode(activeEvidence.analysisUrl)
      if (!detected.supported) {
        setBarcodeState({ message: 'Native barcode scanning is unavailable in this browser; enter GTIN manually.', error: true, candidate: null })
      } else if (!detected.values.length) {
        setBarcodeState({ message: 'No supported barcode detected on the active panel.', error: true, candidate: null })
      } else {
        const candidate = { ...detected.values[0], evidenceId: activeEvidence.id }
        updateMeta('barcode', candidate.value)
        setBarcodeState({
          message: `${candidate.format}: ${candidate.value}${candidate.cornerPoints?.length === 4 ? ' · geometry ready for card-free flattening (scale remains unverified)' : ''}`,
          error: false,
          candidate,
        })
      }
    } catch {
      setBarcodeState({ message: 'Barcode scan could not read this panel.', error: true, candidate: null })
    }
  }

  const rectifyFromBarcode = async () => {
    if (!activeEvidence || !barcodeState.candidate || barcodeState.candidate.evidenceId !== activeEvidence.id || processing) return
    try {
      setProcessing(true)
      setOcrState((current) => ({ ...current, label: 'Flattening package plane from barcode geometry', error: '' }))
      const updated = await rectifyEvidenceFromBarcode(activeEvidence, barcodeState.candidate)
      setEvidenceItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      invalidatePanelMeasurement(updated.id)
      setOcrWords((current) => current.filter((word) => word.panelId !== updated.id))
      await recordAudit('barcode_plane_rectified', { evidenceId: updated.id, format: barcodeState.candidate.format, sourcePoints: updated.perspective.points, absoluteScaleVerified: false })
      setBarcodeState((current) => ({ ...current, candidate: null, message: `${current.message.split(' · ')[0]} · panel flattened; add a physical reference for millimetres` }))
      setOcrState((current) => ({ ...current, label: 'Barcode plane flattened — rerun OCR and calibrate absolute scale', error: '' }))
    } catch (error) {
      setOcrState((current) => ({ ...current, error: error.message || 'Barcode-plane flattening failed.' }))
    } finally {
      setProcessing(false)
    }
  }

  const autoDetectReference = async () => {
    if (!activeEvidence) return
    try {
      setProcessing(true)
      const detected = await detectReferenceCard(activeEvidence.analysisUrl)
      if (!detected.detected) {
        setOcrState((current) => ({ ...current, error: 'No supported high-contrast reference card was detected. Use two-click calibration.' }))
        return
      }
      updatePanelMeasurement('referencePx', Number(detected.pixelWidth.toFixed(1)))
      setOcrState((current) => ({ ...current, label: `Reference detected at ${detected.confidence}% confidence`, error: '' }))
      await recordAudit('reference_card_detected', { evidenceId: activeEvidence.id, referencePx: detected.pixelWidth, confidence: detected.confidence, referenceMm: meta.referenceMm })
    } catch (error) {
      setOcrState((current) => ({ ...current, error: error.message || 'Reference-card detection failed.' }))
    } finally {
      setProcessing(false)
    }
  }

  const checkDepth = async () => {
    const state = await webXrDepthSupport()
    setDepthState({ supported: state.supported, message: state.reason })
    await recordAudit('depth_capability_checked', state)
  }

  const runOcr = async (scanMode = 'standard') => {
    if (!evidenceItems.length || ocrState.running) return
    const deepScan = scanMode === 'deep'
    let worker
    try {
      setOcrState({ running: true, progress: 2, label: deepScan ? 'Loading deep-scan OCR engine' : 'Loading OCR engine', error: '' })
      let panelIndex = 0
      let completedPasses = 0
      const referenceCandidates = await Promise.all(evidenceItems.map((item) => detectReferenceCard(item.analysisUrl).catch(() => ({ detected: false }))))
      const totalPasses = evidenceItems.length * (deepScan ? 7 : 3) + referenceCandidates.filter((candidate) => candidate.detected).length
      worker = await createWorker(meta.ocrLanguage || 'eng', 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/core',
        langPath: '/ocr/lang',
        logger: (message) => {
          const passProgress = message.progress || 0
          const progress = Math.round(((completedPasses + passProgress) / totalPasses) * 100)
          setOcrState({ running: true, progress, label: `Panel ${panelIndex + 1}/${evidenceItems.length} · ${message.status || 'reading label'}`, error: '' })
        },
      })
      const packets = []
      const reliabilities = []
      const engineConfidences = []
      const collectedWords = []
      const recognizedItems = []
      for (panelIndex = 0; panelIndex < evidenceItems.length; panelIndex += 1) {
        const item = evidenceItems[panelIndex]
        const variants = await createOcrInputVariants(item.analysisUrl)
        if (deepScan) variants.push(...await createOcrTileVariants(item.analysisUrl))
        const referenceCandidate = referenceCandidates[panelIndex]
        if (referenceCandidate?.detected) variants.push(await createOcrRegionVariant(item.analysisUrl, referenceCandidate.bbox))
        const passes = []
        for (const variant of variants) {
          await worker.setParameters({
            tessedit_pageseg_mode: variant.pageSegmentationMode,
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
          })
          const { data } = await worker.recognize(variant.dataUrl, {}, { text: true, blocks: true, tsv: true })
          const words = variant.spatial === false ? [] : flattenOcrWords(data.blocks, item.id, variant.width, variant.height)
          passes.push({ id: variant.id, text: String(data.text || ''), confidence: Number(data.confidence || 0), words, spatial: variant.spatial !== false })
          collectedWords.push(...words)
          completedPasses += 1
        }
        const mergedText = mergeOcrPassTexts(passes.map((pass) => pass.text))
        packets.push(`[PANEL ${panelIndex + 1}: ${item.name}]\n${mergedText}`)
        const fullPanelPasses = passes.filter((pass) => pass.spatial)
        const reliability = calibrateOcrReliability(fullPanelPasses, item.quality?.score)
        reliabilities.push(reliability.score)
        engineConfidences.push(reliability.engineConfidence)
        recognizedItems.push({ ...item, ocrText: mergedText, ocrConfidence: reliability.engineConfidence, ocrReliability: reliability.score, ocrAgreement: reliability.agreement, ocrWords: passes.flatMap((pass) => pass.words), ocrPasses: passes.map(({ id, text, confidence }) => ({ id: `${item.id}:${id}`, text, confidence: Number(confidence.toFixed(1)) })) })
      }
      const combinedText = packets.join('\n\n')
      const averageReliability = reliabilities.length ? reliabilities.reduce((sum, value) => sum + value, 0) / reliabilities.length : 0
      const averageEngineConfidence = engineConfidences.length ? engineConfidences.reduce((sum, value) => sum + value, 0) / engineConfidences.length : 0
      const reliabilityReason = averageReliability >= 75
        ? 'OCR passes agree and the capture is suitable for field verification.'
        : averageReliability >= 55
          ? 'Usable OCR evidence; verify highlighted values against the package.'
          : 'Low-confidence evidence; retake the panel or use deep scan before deciding.'
      setText(combinedText)
      setRawOcrText(combinedText)
      setOcrWords(collectedWords)
      setEvidenceItems(recognizedItems)
      setMeta((current) => ({ ...current, fieldReviews: {}, fieldCandidates: fieldCandidates(recognizedItems.flatMap((item) => item.ocrPasses)), ocrConfidence: Number(averageReliability.toFixed(1)), ocrEngineConfidence: Number(averageEngineConfidence.toFixed(1)), ocrReliabilityReason: reliabilityReason, ocrSource: deepScan ? 'local-deep' : 'local' }))
      applyExtraction(extractDeclarations(combinedText))
      await recordAudit('ocr_completed', { panels: evidenceItems.length, reliability: Number(averageReliability.toFixed(1)), engineConfidence: Number(averageEngineConfidence.toFixed(1)), wordBoxes: collectedWords.length, language: meta.ocrLanguage, strategy: deepScan ? 'three-pass-plus-four-detail-tiles' : 'three-pass-adaptive-layout' })
      setOcrState({ running: false, progress: 100, label: `${deepScan ? 'Deep scan' : 'OCR'} complete across ${evidenceItems.length} panel${evidenceItems.length > 1 ? 's' : ''} — verify evidence`, error: '' })
    } catch (error) {
      setOcrState({
        running: false,
        progress: 0,
        label: 'OCR unavailable',
        error: `OCR could not complete from the bundled offline engine: ${error.message || 'unknown OCR error'}. You can still enter verified evidence text manually.`,
      })
    } finally {
      if (worker) await worker.terminate()
    }
  }

  const runConnectedOcr = async () => {
    if (!evidenceItems.length || ocrState.running) return
    try {
      setOcrState({ running: true, progress: 3, label: 'Requesting opt-in connected OCR', error: '' })
      await recordAudit('connected_ocr_requested', { panels: evidenceItems.length, provider: 'google-vision', explicitOptIn: true })
      const packets = []
      const confidences = []
      const reliabilities = []
      const connectedWords = []
      const recognizedItems = []
      for (let index = 0; index < evidenceItems.length; index += 1) {
        const item = evidenceItems[index]
        setOcrState({ running: true, progress: Math.round((index / evidenceItems.length) * 85) + 5, label: `Connected OCR · panel ${index + 1}/${evidenceItems.length}`, error: '' })
        const response = await fetch('/api/ocr', {
          method: 'POST',
          headers: workspace ? await workspace.api.headers() : { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: item.analysisUrl, language: meta.ocrLanguage || 'eng' }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || `Connected OCR returned HTTP ${response.status}.`)
        const connectedText = String(payload.text || '').trim()
        const mergedText = mergeOcrPassTexts([item.ocrText || '', connectedText])
        const engineConfidence = Math.max(0, Math.min(100, Number(payload.confidence || 0)))
        const qualityScore = Math.max(0, Math.min(100, Number(item.quality?.score || 0)))
        const reliability = Number(Math.min(98, engineConfidence * .8 + qualityScore * .2).toFixed(1))
        const words = (payload.words || []).map((word) => ({ ...word, panelId: item.id }))
        packets.push(`[PANEL ${index + 1}: ${item.name}]\n${mergedText}`)
        confidences.push(engineConfidence)
        reliabilities.push(reliability)
        connectedWords.push(...words)
        recognizedItems.push({
          ...item,
          ocrText: mergedText,
          connectedOcrText: connectedText,
          ocrPasses: [...(item.ocrPasses || []), { id: `${item.id}:google-vision`, text: connectedText }],
          ocrProvider: payload.provider || 'google-vision',
          ocrConfidence: engineConfidence,
          ocrReliability: reliability,
          ocrWords: words,
        })
      }
      const combinedText = packets.join('\n\n')
      const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
      const engineConfidence = Number(average(confidences).toFixed(1))
      const reliability = Number(average(reliabilities).toFixed(1))
      const reliabilityReason = reliability >= 75
        ? 'Connected OCR and capture quality support field verification; compare every decisive value with the highlighted source.'
        : 'Connected OCR is uncertain on this capture; retake the declaration panel before deciding.'
      setText(combinedText)
      setOcrWords(connectedWords)
      setRawOcrText(combinedText)
      setEvidenceItems(recognizedItems)
      setMeta((current) => ({ ...current, fieldReviews: {}, fieldCandidates: fieldCandidates(recognizedItems.flatMap((item) => item.ocrPasses)), ocrConfidence: reliability, ocrEngineConfidence: engineConfidence, ocrReliabilityReason: reliabilityReason, ocrSource: 'google-vision' }))
      applyExtraction(extractDeclarations(combinedText))
      await recordAudit('connected_ocr_completed', { panels: evidenceItems.length, provider: 'google-vision', reliability, engineConfidence, wordBoxes: connectedWords.length })
      setOcrState({ running: false, progress: 100, label: `Connected OCR complete across ${evidenceItems.length} panel${evidenceItems.length > 1 ? 's' : ''} — verify evidence`, error: '' })
    } catch (error) {
      await recordAudit('connected_ocr_failed', { provider: 'google-vision', reason: error.message || 'unknown error' })
      setOcrState({ running: false, progress: 0, label: 'Connected OCR unavailable; local evidence preserved', error: `${error.message || 'Connected OCR failed.'} Run browser OCR or deep scan to remain fully offline.` })
    }
  }

  const buildRecord = (chain = auditChain) => ({
    id: inspectionId,
    createdAt: startedAt,
    sealedAt: new Date().toISOString(),
    imageUrl: evidenceItems[0]?.analysisUrl || '',
    fileName: evidenceItems[0]?.name || '',
    evidenceItems,
    text,
    rawOcrText,
    rulePack: RULE_PACK.id,
    extraction,
    regions,
    auditChain: chain,
    challenge: challenge ? { ...challenge, active: false, completedAt: new Date().toISOString() } : null,
    actor: actor || null,
    meta: evaluationMeta,
    result,
  })

  const save = async () => {
    if (saved) return
    try {
      setSaving(true)
      const finalChain = await recordAudit('inspection_sealed', { inspectionId, status: result.status, score: result.score, evidencePanels: evidenceItems.length })
      const record = { ...buildRecord(finalChain), auditVerified: await verifyAuditChain(finalChain) }
      await onSaveRecord(record)
      setSealedRecord(record)
      setSaved(true)
      await store.remove('drafts', 'active')
      setDraftMessage('Sealed record saved. Start a new inspection to capture new evidence.')
      if (challenge) onChallengeComplete?.(record)
    } catch (error) {
      setOcrState((current) => ({ ...current, error: error.message || 'The inspection could not be stored.' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="inspection-page page-enter">
      <div className="page-intro">
        <div>
          <span className="eyebrow">UNSEEN-PACKAGE TEST</span>
          <h2>Turn a label image into an inspectable decision.</h2>
          <p>Capture every package panel, extract real declarations, calibrate physical typography and seal the evidence locally.</p>
        </div>
        <div className="intro-stamp">
          <SearchCheck size={24} />
          <span>Evidence before verdict</span>
        </div>
      </div>
      <ChallengeClock challenge={challenge} />
      <div className="draft-bar" role="status">{draft ? <><span>An unfinished inspection is available.</span><button onClick={restoreDraft}>Restore draft</button><button onClick={async () => { try { await store.remove('drafts', 'active'); setDraft(null) } catch (error) { setDraftMessage(error.message) } }}>Discard unfinished draft</button></> : draftMessage || 'Drafts save automatically on this device after capture.'}{saved && <><button onClick={() => onOpenReport(sealedRecord)}>Open sealed report</button><button onClick={onNewInspection}>Start new inspection</button></>}</div>
      <fieldset className="studio-lock" disabled={saved || saving || processing || ocrState.running || Boolean(draft)}>
      <div className="studio-grid">
        <div className="workflow-column">
          <section className="workflow-step">
            <StepHeader
              number="01"
              icon={Camera}
              title="Capture every declaration panel"
              copy="Add up to four front, back or side images. Originals are hashed before OCR preprocessing."
              complete={Boolean(evidenceItems.length)}
            />
            <div className="capture-actions">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                onChange={(event) => handleFiles(event.target.files)}
              />
              <button type="button" className="upload-button" onClick={() => fileInput.current?.click()} disabled={evidenceItems.length >= 4 || processing}>
                {processing ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
                {evidenceItems.length ? `Add package panel (${evidenceItems.length}/4)` : 'Capture / upload package'}
              </button>
              <button type="button" className="barcode-button" onClick={scanBarcode} disabled={!activeEvidence}><Barcode size={16} /> Read barcode</button>
              {barcodeState.candidate?.evidenceId === activeEvidence?.id && barcodeState.candidate?.cornerPoints?.length === 4 && <button type="button" className="barcode-button" onClick={rectifyFromBarcode} disabled={processing}><Layers3 size={16} /> Flatten from barcode</button>}
            </div>
            <CaptureChecklist evidenceItems={evidenceItems} />
            <CalibrationBoard
              evidenceItems={evidenceItems}
              activeEvidence={activeEvidence}
              meta={meta}
              onMeasure={updatePanelMeasurement}
              onActive={setActiveEvidenceId}
              onRemove={removeEvidence}
              onTransform={transformActiveEvidence}
              onRectify={rectifyActiveEvidence}
              onRoleChange={updateEvidenceRole}
              processing={processing}
              regions={regions}
              activeRegionId={activeRegionId}
              onRegionSelect={setActiveRegionId}
              onDetectReference={autoDetectReference}
              onCheckDepth={checkDepth}
              depthState={depthState}
            />
            {!challenge?.active && !workspace && <details className="test-aids">
              <summary><Sparkles size={14} /> Controlled test packets</summary>
              <div className="demo-actions">
                <button type="button" onClick={() => applyDemo(DEMOS.risky)}>Violation packet</button>
                <button type="button" onClick={() => applyDemo(DEMOS.compliant)}>Compliant packet</button>
                <button type="button" onClick={() => applyDemo(DEMOS.exempt)}>Rule 26 exemption packet</button>
              </div>
            </details>}
          </section>

          <section className="workflow-step">
            <StepHeader
              number="02"
              icon={ScanLine}
              title="OCR and verify structured declarations"
              copy="All captured panels are read locally, merged and parsed into inspectable declaration evidence."
              complete={Boolean(text.trim())}
            />
            <div className="ocr-toolbar">
              <button type="button" className="ocr-button" onClick={() => runOcr('standard')} disabled={!evidenceItems.length || ocrState.running}>
                {ocrState.running ? <LoaderCircle className="spin" size={17} /> : <ScanLine size={17} />}
                {ocrState.running ? 'Reading label…' : 'Run browser OCR'}
              </button>
              <button type="button" className="deep-ocr-button" onClick={() => runOcr('deep')} disabled={!evidenceItems.length || ocrState.running}>
                <SearchCheck size={17} /> Deep scan small text
              </button>
              <button type="button" className="connected-ocr-button" onClick={runConnectedOcr} disabled={!evidenceItems.length || ocrState.running} title="Explicitly sends processed panels to the configured Google Vision backend">
                <WandSparkles size={17} /> Connected OCR
              </button>
              <label className="ocr-language">
                <Languages size={15} />
                <select value={meta.ocrLanguage} onChange={(event) => updateMeta('ocrLanguage', event.target.value)} aria-label="OCR language">
                  <option value="eng">English</option>
                  <option value="eng+hin">English + Hindi</option>
                  <option value="eng+tel">English + Telugu</option>
                  <option value="eng+tam">English + Tamil</option>
                </select>
              </label>
              <div className="ocr-progress">
                <div><span style={{ width: `${ocrState.progress}%` }} /></div>
                <small>{ocrState.label}</small>
              </div>
              <span className="confidence-chip">Reliability {Number(meta.ocrConfidence || 0).toFixed(0)}% · engine {Number(meta.ocrEngineConfidence || 0).toFixed(0)}%</span>
            </div>
            <p className="connected-ocr-disclosure"><LockKeyhole size={13} /> Browser OCR is the private default. Connected OCR sends processed panels to Google Vision only when you click it and requires workspace sign-in. Sealing in a managed workspace uploads evidence to private storage. Reliability percentages below are unvalidated heuristics, not accuracy probabilities.</p>
            {ocrState.error && <div className="inline-warning"><AlertTriangle size={17} />{ocrState.error}</div>}
            <DeclarationCoverage extraction={extraction} reliability={meta.ocrConfidence} engineConfidence={meta.ocrEngineConfidence} reliabilityReason={meta.ocrReliabilityReason} />
            <textarea
              className="evidence-editor"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Extracted label text will appear here. You may paste or correct evidence manually."
              spellCheck="false"
            />
            <ExtractionWorkbench extraction={extraction} onApply={applyExtraction} barcodeState={barcodeState} regions={regions} onSelectRegion={(id) => { const region = regions.find((item) => item.id === id); if (region) setActiveEvidenceId(region.panelId); setActiveRegionId(id) }} meta={meta} />
            {rawOcrText && <details><summary>Original OCR transcript (not edited)</summary><pre className="transcript-original">{rawOcrText}</pre></details>}
            {meta.enforceEvidenceReview && <FieldVerification extraction={extraction} meta={meta} onChange={updateMeta} />}
            <div className="translation-panel">
              <header><Languages size={17} /><div><strong>Officer interpretation</strong><small>Original OCR evidence is preserved; this note never replaces it.</small></div></header>
              <div>
                <select value={meta.translationLanguage} onChange={(event) => updateMeta('translationLanguage', event.target.value)} aria-label="Interpretation language">
                  <option value="en">English interpretation</option><option value="hi">Hindi interpretation</option><option value="te">Telugu interpretation</option><option value="ta">Tamil interpretation</option>
                </select>
                <textarea value={meta.translationText} onChange={(event) => updateMeta('translationText', event.target.value)} placeholder="Optional officer translation or clarification…" />
              </div>
            </div>
          </section>

          <section className="workflow-step">
            <StepHeader
              number="03"
              icon={Ruler}
              title="Apply product context and geometry"
              copy="The rule tier depends on the package profile, panel area and physical scale."
              complete={Boolean(meta.productName && meta.pdpArea && Object.values(meta.panelMeasurements || {}).some((measurement) => measurement.referencePx && measurement.glyphPx))}
            />
            <div className="field-grid">
              <Field label="Product / generic name" wide>
                <input value={meta.productName} onChange={(event) => updateMeta('productName', event.target.value)} placeholder="e.g. Turmeric powder" />
              </Field>
              <Field label="Package profile">
                <select value={meta.category} onChange={(event) => updateMeta('category', event.target.value)}>
                  <option value="general">General retail package</option>
                  <option value="food">Food product</option>
                  <option value="imported">Imported package</option>
                  <option value="medical">Medical device</option>
                </select>
              </Field>
              <Field label="Rule 26 commodity class">
                <select value={meta.commodityClass} onChange={(event) => updateMeta('commodityClass', event.target.value)}>
                  <option value="standard">Standard commodity</option>
                  <option value="tobacco">Tobacco / tobacco product</option>
                  <option value="pan_masala">Pan masala (2025 carve-out)</option>
                  <option value="fast_food">Restaurant / hotel fast food</option>
                  <option value="drug_formulation">Scheduled / non-scheduled drug</option>
                  <option value="medical_device">Medical device (specialist rules)</option>
                </select>
              </Field>
              <Field label="Net quantity">
                <div className="split-input">
                  <input type="number" min="0" value={meta.quantity} onChange={(event) => updateMeta('quantity', event.target.value)} placeholder="100" />
                  <select value={meta.unit} onChange={(event) => updateMeta('unit', event.target.value)}>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="l">l</option>
                    <option value="pcs">pcs</option>
                  </select>
                </div>
              </Field>
              <Field label="Barcode / GTIN">
                <input value={meta.barcode} onChange={(event) => updateMeta('barcode', event.target.value)} placeholder="Scan or enter 8–14 digits" inputMode="numeric" />
              </Field>
              <Field label="Flat panel dimensions" hint="Automatically computes area; use direct area for curved or irregular panels">
                <div className="dimension-input">
                  <input type="number" min="0" value={meta.panelWidthCm} onChange={(event) => updatePanelDimension('panelWidthCm', event.target.value)} placeholder="Width cm" />
                  <span>×</span>
                  <input type="number" min="0" value={meta.panelHeightCm} onChange={(event) => updatePanelDimension('panelHeightCm', event.target.value)} placeholder="Height cm" />
                </div>
              </Field>
              <Field label="Principal display panel" hint="Area in square centimetres">
                <div className="unit-input"><input type="number" min="0" value={meta.pdpArea} onChange={(event) => updateMeta('pdpArea', event.target.value)} placeholder="75" /><span>cm²</span></div>
              </Field>
              <Field label="Curved bottle estimate" hint="Diameter × label height × visible circumference; officer must confirm legal PDP">
                <div className="curve-input">
                  <input type="number" min="0" value={meta.cylinderDiameterCm} onChange={(event) => updateCylinderDimension('cylinderDiameterCm', event.target.value)} placeholder="Ø cm" />
                  <input type="number" min="0" value={meta.cylinderHeightCm} onChange={(event) => updateCylinderDimension('cylinderHeightCm', event.target.value)} placeholder="Height cm" />
                  <input type="number" min="1" max="100" value={meta.cylinderCoverage} onChange={(event) => updateCylinderDimension('cylinderCoverage', event.target.value)} title="Visible circumference percentage" />
                </div>
              </Field>
              <Field label="Panel-area uncertainty" hint="Triggers review if a Table-I boundary is crossed">
                <div className="range-field"><input type="range" min="0" max="25" value={meta.pdpUncertainty} onChange={(event) => updateMeta('pdpUncertainty', event.target.value)} /><b>±{meta.pdpUncertainty}%</b></div>
              </Field>
              <Field label="Known reference length">
                <div className="unit-input"><input type="number" min="0" value={meta.referenceMm} onChange={(event) => updateMeta('referenceMm', event.target.value)} /><span>mm</span></div>
              </Field>
              <Field label="Measurement uncertainty">
                <div className="range-field"><input type="range" min="0" max="25" value={meta.measurementUncertainty} onChange={(event) => updateMeta('measurementUncertainty', event.target.value)} /><b>±{meta.measurementUncertainty}%</b></div>
              </Field>
              <label className="toggle-field">
                <input type="checkbox" checked={meta.formedText} onChange={(event) => updateMeta('formedText', event.target.checked)} />
                <span><b>Formed / molded text</b><small>Uses the larger Table-I column.</small></span>
              </label>
              <label className="toggle-field">
                <input type="checkbox" checked={meta.perishable} onChange={(event) => updateMeta('perishable', event.target.checked)} />
                <span><b>Time-sensitive commodity</b><small>Adds best-before / use-by evaluation.</small></span>
              </label>
            </div>
          </section>
        </div>

        <VerdictPanel
          result={result}
          saved={saved}
          saving={saving}
          evidenceCount={evidenceItems.length}
          onSave={save}
          onReport={() => onOpenReport(buildRecord())}
        />
      </div>
      </fieldset>
    </section>
  )
}

function MetricCard({ icon: Icon, label, value, copy, tone = 'ink' }) {
  return (
    <article className={`metric-card ${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{copy}</p>
    </article>
  )
}

function Dashboard({ history, onNavigate, onOpenReport }) {
  const totals = history.reduce(
    (accumulator, item) => {
      const status = effectiveStatus(item)
      if (Object.hasOwn(accumulator, status)) accumulator[status] += 1
      else accumulator.unknown += 1
      return accumulator
    },
    { compliant: 0, exempt: 0, non_compliant: 0, manual_review: 0, unknown: 0 },
  )
  const total = history.length
  const passRate = total ? Math.round(((totals.compliant + totals.exempt) / total) * 100) : 0

  return (
    <section className="dashboard page-enter">
      <div className="page-intro dashboard-intro">
        <div>
          <span className="eyebrow">LOCAL INSPECTION REGISTER</span>
          <h2>What requires an officer’s attention?</h2>
          <p>Prototype metrics are derived only from inspections saved on this device—never from invented field data.</p>
        </div>
        <button type="button" className="primary-action fit" onClick={() => onNavigate('inspect')}>
          <ScanLine size={17} /> New inspection
        </button>
      </div>

      <div className="metrics-grid">
        <MetricCard icon={Archive} label="Saved inspections" value={total} copy="Local evidence records" />
        <MetricCard icon={BadgeCheck} label="Cleared / exempt" value={`${passRate}%`} copy="Across evaluated local records" tone="green" />
        <MetricCard icon={XCircle} label="Flagged" value={totals.non_compliant} copy="Evidence outside rule bounds" tone="red" />
        <MetricCard icon={TriangleAlert} label="Manual review" value={totals.manual_review} copy="Abstentions and threshold cases" tone="amber" />
      </div>

      <div className="dashboard-grid">
        <article className="dashboard-panel distribution-panel">
          <header><div><span className="eyebrow">VERDICT MIX</span><h3>Evidence distribution</h3></div><Gauge size={23} /></header>
          <div className="distribution-bar">
            {total === 0 ? <span className="empty-distribution" /> : (
              <>
                <span className="pass" style={{ flex: totals.compliant }} />
                <span className="exempt" style={{ flex: totals.exempt }} />
                <span className="review" style={{ flex: totals.manual_review }} />
                <span className="fail" style={{ flex: totals.non_compliant }} />
              </>
            )}
          </div>
          <div className="distribution-legend">
            <span><i className="pass" />Pass <b>{totals.compliant}</b></span>
            <span><i className="exempt" />Exempt <b>{totals.exempt}</b></span>
            <span><i className="review" />Review <b>{totals.manual_review}</b></span>
            <span><i className="fail" />Flag <b>{totals.non_compliant}</b></span>
          </div>
          {total === 0 && <div className="empty-panel"><ScanLine size={28} /><strong>No evidence saved yet</strong><span>Capture a real package inspection to populate this view.</span></div>}
        </article>

        <article className="dashboard-panel readiness-panel">
          <header><div><span className="eyebrow">SAH DEMO READINESS</span><h3>Prototype capabilities</h3></div><ShieldCheck size={23} /></header>
          {[
            ['Multi-panel capture + SHA-256 integrity', 'ready'],
            ['OCR + structured declaration extraction', 'ready'],
            ['Rule 7 calibration + uncertainty engine', 'ready'],
            ['IndexedDB evidence register + reports', 'ready'],
            ['Department-verified production rule pack', 'pending'],
          ].map(([label, state]) => (
            <div className="readiness-row" key={label}>
              {state === 'ready' ? <Check size={16} /> : <AlertTriangle size={16} />}
              <span>{label}</span>
              <b className={state}>{state}</b>
            </div>
          ))}
        </article>
      </div>

      <article className="dashboard-panel recent-panel">
        <header><div><span className="eyebrow">AUDIT TRAIL</span><h3>Recent inspections</h3></div><History size={23} /></header>
        {history.length ? (
          <div className="records-table">
            {history.slice(0, 6).map((item) => (
              <button key={item.id} type="button" onClick={() => onOpenReport(item)}>
                <code>{item.id}</code>
                <span><b>{item.meta.productName || 'Unnamed product'}</b><small>{formatDate(item.createdAt)}</small></span>
                <StatusPill status={item.result.status} compact />
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-panel compact"><span>Nothing saved on this device.</span></div>
        )}
      </article>
    </section>
  )
}

function HistoryPage({ history, onOpenReport, onNavigate }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const filtered = history.filter((item) => (filter === 'all' || effectiveStatus(item) === filter) && `${item.id} ${item.meta.productName || ''} ${item.meta.barcode || ''}`.toLowerCase().includes(search.toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * 20, (currentPage + 1) * 20)
  return (
    <section className="history-page page-enter">
      <div className="page-intro">
        <div>
          <span className="eyebrow">CHAIN OF EVIDENCE</span>
          <h2>Every saved verdict remains inspectable.</h2>
          <p>Open any record to see the supplied image, extracted text, rule checks and uncertainty statement.</p>
        </div>
      </div>
      <div className="filter-row">
        {[
          ['all', 'All'],
          ['compliant', 'Pass'],
          ['exempt', 'Exempt'],
          ['non_compliant', 'Flag'],
          ['manual_review', 'Manual review'],
        ].map(([value, label]) => (
          <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      <div className="history-search"><input aria-label="Search inspections" placeholder="Search product, case ID or barcode" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} / {pageCount} · {filtered.length} cases</span><button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>
      {visible.length ? (
        <div className="history-list">
          {visible.map((item) => (
            <article key={item.id}>
              <div className="record-id"><code>{item.id}</code><small>{formatDate(item.createdAt)}</small></div>
              <div className="record-product"><strong>{item.meta.productName || 'Unnamed product'}</strong><span>{item.meta.category} · {item.meta.quantity || '?'} {item.meta.unit}</span></div>
              <div className="record-score"><b>{item.result.score}</b><span>evidence score</span></div>
              <StatusPill status={effectiveStatus(item)} />
              <button type="button" className="open-record" onClick={() => onOpenReport(item)}>Open evidence <ArrowRight size={16} /></button>
            </article>
          ))}
        </div>
      ) : (
        <div className="large-empty">
          <Archive size={42} />
          <h3>No matching inspections</h3>
          <p>Finalize a live or controlled inspection to create an evidence record.</p>
          <button type="button" className="primary-action fit" onClick={() => onNavigate('inspect')}><ScanLine size={17} /> Start inspection</button>
        </div>
      )}
    </section>
  )
}

function BlindChallengePage({ challenge, onStart, onContinue, history }) {
  const completed = history.find((record) => record.challenge?.id && !record.challenge?.active)
  return (
    <section className="challenge-page page-enter">
      <div className="challenge-hero">
        <div><span className="eyebrow">JUDGE FALSIFICATION MODE</span><h2>No canned image. No hidden tuning. One sealed run.</h2><p>A blind run disables controlled packets, timestamps capture, hashes every original image and records every material action in a verifiable chain.</p></div>
        <ShieldAlert size={72} />
      </div>
      <div className="challenge-grid">
        <article className="challenge-card primary">
          <span>01 / ARM THE SESSION</span>
          <h3>{challenge?.active ? `Challenge ${challenge.code} is live` : 'Let the judge choose the packet'}</h3>
          <p>{challenge?.active ? `Started ${formatDate(challenge.startedAt)}. Continue without reloading or replacing the evidence.` : 'Ask the judge for any sealed packaged commodity, then start the timer before capture.'}</p>
          <button type="button" onClick={challenge?.active ? onContinue : onStart}>{challenge?.active ? <><ArrowRight size={17} /> Continue live inspection</> : <><Timer size={17} /> Start blind challenge</>}</button>
        </article>
        <article className="challenge-card"><span>02 / CONTROLS</span><h3>What becomes hash-linked</h3><ul><li>Start timestamp and challenge code</li><li>Original image SHA-256 digests</li><li>OCR language, confidence and regions</li><li>Preprocessing and calibration actions</li><li>Final verdict and evidence score</li></ul></article>
        <article className="challenge-card"><span>03 / LATEST RESULT</span>{completed ? <><StatusPill status={completed.result.status} /><h3>{completed.meta.productName || completed.id}</h3><p>{completed.result.score}/100 · {completed.auditChain?.length || 0} audit events · {completed.auditVerified ? 'chain verified' : 'verification pending'}</p></> : <><h3>No sealed challenge yet</h3><p>The first completed blind run will appear here as evidence—not as a slide claim.</p></>}</article>
      </div>
    </section>
  )
}

function ValidationLab() {
  const [samples, setSamples] = useState(SEEDED_BENCHMARK)
  const [message, setMessage] = useState('Synthetic regression fixtures loaded. Import real labelled records to claim field accuracy.')
  const inputRef = useRef(null)
  const metrics = useMemo(() => runBenchmark(samples), [samples])
  const percentage = (value) => `${Math.round(value * 100)}%`

  const importDataset = async (file) => {
    if (!file) return
    try {
      const parsed = parseBenchmarkFile(await file.text(), file.name)
      setSamples(parsed)
      setMessage(`${parsed.length} imported labelled records loaded. Metrics below are computed from this file.`)
    } catch (error) {
      setMessage(`Import failed: ${error.message}`)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([JSON.stringify(SEEDED_BENCHMARK.slice(0, 2), null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'niyamlens-benchmark-template.json'; anchor.click(); URL.revokeObjectURL(anchor.href)
  }

  return (
    <section className="validation-page page-enter">
      <div className="page-intro"><div><span className="eyebrow">MEASUREMENT BEFORE MARKETING</span><h2>Prove accuracy—or label the evidence gap.</h2><p>The validation lab computes field extraction and verdict metrics from labelled records. Synthetic fixtures are kept visibly separate from imported field data.</p></div><div className={`dataset-badge ${metrics.datasetKind}`}><Database size={20} /><b>{metrics.sampleCount}</b><span>{metrics.datasetKind}</span></div></div>
      <div className="validation-actions"><input ref={inputRef} hidden type="file" accept=".json,.csv" onChange={(event) => importDataset(event.target.files?.[0])} /><button type="button" onClick={() => inputRef.current?.click()}><UploadCloud size={16} /> Import labelled dataset</button><button type="button" onClick={downloadTemplate}><Download size={16} /> Dataset template</button><button type="button" onClick={() => { setSamples(SEEDED_BENCHMARK); setMessage('Synthetic regression fixtures restored. Do not present these as field accuracy.') }}><RotateCcw size={16} /> Reset fixtures</button></div>
      <div className="validation-notice"><AlertTriangle size={17} /><span>{message}</span></div>
      <div className="metrics-grid validation-metrics">
        <MetricCard icon={SearchCheck} label="Verdict accuracy" value={percentage(metrics.statusAccuracy)} copy={`${metrics.sampleCount} labelled records`} tone="green" />
        <MetricCard icon={BadgeCheck} label="Field detection F1" value={percentage(metrics.f1)} copy={`Presence only · P ${percentage(metrics.precision)} · R ${percentage(metrics.recall)}`} />
        <MetricCard icon={ClipboardCheck} label="Extracted-value accuracy" value={metrics.valueAccuracy === null ? 'N/A' : percentage(metrics.valueAccuracy)} copy={metrics.valueSamples ? `${metrics.valueSamples} labelled field values` : 'Add expectedValues labels to compute'} />
        <MetricCard icon={XCircle} label="False violations" value={percentage(metrics.falseViolationRate)} copy="Highest-risk model failure" tone="red" />
        <MetricCard icon={TriangleAlert} label="Abstention rate" value={percentage(metrics.abstentionRate)} copy={`${metrics.elapsedMs.toFixed(1)} ms parser runtime`} tone="amber" />
      </div>
      <article className="failure-panel"><header><div><span className="eyebrow">FAILURE ANALYSIS</span><h3>{metrics.failures.length ? `${metrics.failures.length} mismatched verdicts` : 'All expected verdicts matched'}</h3></div><ClipboardCheck size={22} /></header>{metrics.failures.length ? metrics.failures.map((failure) => <div key={failure.id}><code>{failure.id}</code><span>{failure.condition}</span><b>{failure.expected}</b><ArrowRight size={14} /><strong>{failure.actual}</strong></div>) : <p>No status mismatch in the active dataset. Field-level precision and recall still determine extraction quality.</p>}</article>
    </section>
  )
}

const LOCAL_ACTORS = [
  { id: 'officer-01', name: 'Field Officer 01', role: 'officer' },
  { id: 'supervisor-01', name: 'Supervising Officer', role: 'supervisor' },
]

function OfficerOperations({ history, actor, onActorChange, onOpenReport, onOverride, onImportRecord }) {
  const [assignments, setAssignments] = useState(() => {
    try { return JSON.parse(localStorage.getItem('niyamlens:assignments') || '[]') } catch { return [] }
  })
  const [packageRef, setPackageRef] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [message, setMessage] = useState('')
  const importRef = useRef(null)

  useEffect(() => { localStorage.setItem('niyamlens:assignments', JSON.stringify(assignments)) }, [assignments])

  const createAssignment = () => {
    if (!packageRef.trim()) return
    setAssignments((current) => [{ id: `ASN-${Date.now().toString(36).toUpperCase()}`, packageRef: packageRef.trim(), officerId: 'officer-01', status: 'assigned', createdAt: new Date().toISOString() }, ...current])
    setPackageRef('')
  }

  const exportEncrypted = async (record) => {
    try {
      const bundle = await encryptBundle(record, passphrase)
      const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
      const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `${record.id}.niyamlens.enc.json`; anchor.click(); URL.revokeObjectURL(anchor.href)
      setMessage(`Encrypted bundle created for ${record.id}.`)
    } catch (error) { setMessage(error.message) }
  }

  const importEncrypted = async (file) => {
    if (!file) return
    try {
      const record = await decryptBundle(JSON.parse(await file.text()), passphrase)
      await onImportRecord(record)
      setMessage(`${record.id} decrypted and imported into the local register.`)
    } catch (error) { setMessage(`Import failed: ${error.message}`) }
  }

  return (
    <section className="operations-page page-enter">
      <div className="page-intro"><div><span className="eyebrow">ROLE-GATED FIELD OPERATIONS</span><h2>Assign, inspect, review and transfer evidence.</h2><p>This local competition workflow demonstrates role separation and encrypted case transfer. Production identity must use departmental SSO.</p></div><div className="actor-switch"><Users size={18} /><select value={actor.id} onChange={(event) => onActorChange(LOCAL_ACTORS.find((item) => item.id === event.target.value))}>{LOCAL_ACTORS.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></div></div>
      <div className="operations-grid">
        <article className="ops-card"><header><span className="eyebrow">ASSIGNMENT QUEUE</span><h3>{assignments.length} local assignments</h3></header>{actor.role === 'supervisor' && <div className="assignment-form"><input value={packageRef} onChange={(event) => setPackageRef(event.target.value)} placeholder="Premises / package reference" /><button type="button" onClick={createAssignment}>Assign</button></div>}<div className="assignment-list">{assignments.length ? assignments.map((item) => <div key={item.id}><code>{item.id}</code><b>{item.packageRef}</b><span>{item.status}</span></div>) : <p>No assignments created.</p>}</div></article>
        <article className="ops-card"><header><span className="eyebrow">ENCRYPTED CASE TRANSFER</span><h3>AES-GCM evidence bundles</h3></header><label className="passphrase-field"><LockKeyhole size={16} /><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="Passphrase (8+ characters)" /></label><input ref={importRef} hidden type="file" accept=".json" onChange={(event) => importEncrypted(event.target.files?.[0])} /><button type="button" className="ops-import" onClick={() => importRef.current?.click()}><UploadCloud size={16} /> Import encrypted bundle</button><small>PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM. Legacy v1 imports remain supported. Share the passphrase separately.</small>{message && <p className="ops-message">{message}</p>}</article>
      </div>
      <article className="ops-card review-queue"><header><span className="eyebrow">SUPERVISOR REVIEW QUEUE</span><h3>Sealed local inspections</h3></header>{history.length ? history.map((record) => <div className="review-record" key={record.id}><code>{record.id}</code><span><b>{record.meta.productName || 'Unnamed product'}</b><small>{record.actor?.name || 'Local officer'} · {record.auditChain?.length || 0} audit events</small></span><StatusPill status={record.result.status} compact /><button type="button" onClick={() => onOpenReport(record)}>Evidence</button><button type="button" disabled={actor.role !== 'supervisor'} onClick={() => onOverride(record)}>Review / override</button><button type="button" disabled={!passphrase} onClick={() => exportEncrypted(record)}>Encrypt export</button></div>) : <p>No sealed inspections available.</p>}</article>
    </section>
  )
}

function RulesLibrary() {
  return (
    <section className="rules-page page-enter">
      <div className="page-intro">
        <div>
          <span className="eyebrow">VERSIONED RULES-AS-CODE</span>
          <h2>The law is the source of truth—not the language model.</h2>
          <p>This prototype exposes the rule tier, source, exception and confidence policy used in every verdict.</p>
        </div>
        <div className="version-plate"><code>{RULE_PACK.id}</code><span>Officer verification required</span></div>
      </div>

      <div className="rule-feature-grid">
        <article><FileCheck2 size={22} /><span>RULE 6 PROFILE</span><h3>Mandatory declarations</h3><p>MRP, net quantity, responsible entity, pack date, consumer contact, origin and unit price are selected by package profile.</p></article>
        <article><Ruler size={22} /><span>RULE 7 PROFILE</span><h3>Physical typography</h3><p>Panel-area tiers determine minimum text height. Measurement and area uncertainty can force an abstention.</p></article>
        <article><ShieldCheck size={22} /><span>RULE 26 PROFILE</span><h3>Explicit exemptions</h3><p>Eligible packages of 10 g / 10 ml or less are evaluated with the current tobacco applicability and 2025 pan masala carve-out.</p></article>
        <article><CircleHelp size={22} /><span>TRUST POLICY</span><h3>Calibrated abstention</h3><p>Low OCR confidence, incomplete geometry and tier-boundary uncertainty become MANUAL REVIEW—not guessed compliance.</p></article>
      </div>

      <article className="threshold-panel">
        <header><div><span className="eyebrow">RULE 7 / TABLE I</span><h3>Minimum height by principal display panel</h3></div><span className="source-chip">millimetres</span></header>
        <div className="threshold-table">
          <div className="threshold-head"><span>Panel area</span><span>Printed label</span><span>Formed / molded</span></div>
          {FONT_TIERS.map((tier) => (
            <div key={tier.label}><strong>{tier.label}</strong><span>{tier.normal.toFixed(1)} mm</span><span>{tier.formed.toFixed(1)} mm</span></div>
          ))}
        </div>
        <div className="rule-note"><Info size={16} />The application uses continuous bands for software evaluation and requests manual review whenever supplied area uncertainty crosses a band boundary.</div>
      </article>

      <article className="rule-matrix-panel">
        <header><div><span className="eyebrow">{RULE_MATRIX_VERSION}</span><h3>Review-ready applicability matrix</h3></div><span className="source-chip">{RULE_MATRIX.length} encoded rules</span></header>
        <div className="rule-matrix-table">
          {RULE_MATRIX.map((rule) => <div key={rule.id}><code>{rule.id}</code><span><b>{rule.title}</b><small>{rule.authority} · {rule.scope}</small></span><p>{rule.automation}</p><i className={rule.approval}>{rule.approval}</i></div>)}
        </div>
      </article>

      <div className="legal-gates-grid">
        <article className="approval-panel"><header><div><span className="eyebrow">NO FABRICATED APPROVAL</span><h3>External approval register</h3></div><ShieldAlert size={21} /></header>{APPROVAL_GATES.map((gate) => <div key={gate.id}><span>{gate.owner}</span><b>{gate.status}</b><p>{gate.requirement}</p></div>)}</article>
        <article className="edge-panel"><header><div><span className="eyebrow">BOUNDARY REGRESSION</span><h3>{RULE_EDGE_CASES.length} legal edge cases</h3></div><ClipboardCheck size={21} /></header>{RULE_EDGE_CASES.map((item) => <div key={item.id}><code>{item.id}</code><span>{item.title}</span><StatusPill status={item.expectedStatus} compact /></div>)}</article>
      </div>

      <article className="sources-panel">
        <header><div><span className="eyebrow">PRIMARY SOURCES</span><h3>Rule provenance</h3></div><ExternalLink size={21} /></header>
        {RULE_PACK.sources.map((source) => (
          <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><span>{source.label}</span><ExternalLink size={15} /></a>
        ))}
        <p>Production use requires an authoritative, amendment-complete ruleset approved by the sponsoring department.</p>
      </article>
    </section>
  )
}

function ReportModal({ record, onClose }) {
  if (!record) return null
  const audit = auditPresentation(record)
  const reportImages = record.evidenceItems?.length
    ? record.evidenceItems
    : record.imageUrl ? [{ id: 'legacy', name: record.fileName || 'Package evidence', analysisUrl: record.imageUrl, sha256: '' }] : []
  const calibratedPanels = Object.entries(record.meta.panelMeasurements || {}).filter(([, measurement]) => measurement.referencePx || measurement.glyphPx)
  const download = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `${record.id}-evidence.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  return (
    <div className="report-modal" role="dialog" aria-modal="true" aria-label="Evidence report">
      <div className="report-toolbar no-print">
        <BrandMark compact />
        <div>
          <button type="button" onClick={download}><FileJson size={16} /> Export JSON</button>
          <button type="button" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
          <button type="button" className="close-report" onClick={onClose}><X size={18} /> Close</button>
        </div>
      </div>
      <article className="evidence-report">
        <header>
          <BrandMark />
          <div><span>EVIDENCE PACKET</span><code>{record.id}</code></div>
        </header>
        <div className="report-title">
          <div>
            <span className="eyebrow">PACKAGE COMPLIANCE ASSESSMENT</span>
            <h1>{record.meta.productName || 'Unnamed packaged commodity'}</h1>
            <p>Created {formatDate(record.createdAt)} · Rule pack {record.result.context.rulePack}</p>
          </div>
          <StatusPill status={record.result.status} />
        </div>
        <div className="report-summary">
          <div><span>Evidence score</span><strong>{record.result.score}/100</strong></div>
          <div><span>Passed</span><strong>{record.result.counts.pass}</strong></div>
          <div><span>Flagged</span><strong>{record.result.counts.fail}</strong></div>
          <div><span>Manual review</span><strong>{record.result.counts.review}</strong></div>
        </div>
        {record.supervisorReview && (
          <section className="report-supervisor">
            <div><span>SUPERVISOR DISPOSITION</span><strong><StatusPill status={record.supervisorReview.status} compact /></strong></div>
            <p>{record.supervisorReview.reason}</p>
            <small>Automated status preserved as <b>{statusLabel(record.supervisorReview.automatedStatus)}</b> · Sealed by {record.supervisorReview.actor?.name || record.supervisorReview.actor?.id || 'supervisor'} · {formatDate(record.supervisorReview.at)}</small>
          </section>
        )}
        {record.reviewHistory?.length > 0 && <section className="report-text"><h2>Complete disposition history</h2>{record.reviewHistory.map((review, index) => <p key={review.id || index}><b>{index + 1}. {statusLabel(review.status)}</b> · {formatDate(review.at)} · {review.actor?.name || review.actor?.id}<br />{review.reason}</p>)}</section>}
        {record.serverVersion && <section className="report-text"><h2>Server receipt</h2><p>Version {record.serverVersion} · Received {formatDate(record.serverSealedAt)}</p><code>{record.serverPayloadHash}</code><p>Client observations are officer-supplied; server persistence and an internally hash-linked audit are not independent proof of the photographed package.</p></section>}
        <section className={`report-integrity ${audit.verified ? 'verified' : 'pending'}`}>
          <ShieldCheck size={22} />
          <div><span>CAPTURE AUDIT</span><strong>{audit.untrusted ? 'Officer-supplied timeline — not independently verified' : audit.verified ? 'Local audit chain verified' : 'Verification pending'}</strong><small>{audit.events.length} recorded events · {record.challenge?.id ? `Blind challenge ${record.challenge.code}` : 'Standard inspection'}</small></div>
          <code>{audit.events.at(-1)?.hash ? `${String(audit.events.at(-1).hash).slice(0, 24)}…` : 'NO SEALED HASH'}</code>
        </section>
        <section className="report-context">
          <div>
            <h2>Inspection context</h2>
            <dl>
              <div><dt>Profile</dt><dd>{record.meta.category}</dd></div>
              <div><dt>Net quantity</dt><dd>{record.meta.quantity || '—'} {record.meta.unit}</dd></div>
              <div><dt>Panel area</dt><dd>{record.meta.pdpArea || '—'} cm² ± {record.meta.pdpUncertainty}%</dd></div>
              <div><dt>OCR confidence</dt><dd>{Number(record.meta.ocrConfidence || 0).toFixed(1)}%</dd></div>
              <div><dt>Captured panels</dt><dd>{reportImages.length}</dd></div>
              <div><dt>Barcode / GTIN</dt><dd>{record.meta.barcode || '—'}</dd></div>
              <div><dt>Commodity class</dt><dd>{record.meta.commodityClass || 'standard'}</dd></div>
              <div><dt>Panel calibrations</dt><dd>{calibratedPanels.length || '—'} / {reportImages.length || '—'} panels</dd></div>
              <div><dt>Known reference</dt><dd>{record.meta.referenceMm || '—'} mm; measurements remain panel-scoped</dd></div>
            </dl>
          </div>
          {reportImages.length ? (
            <div className="report-images">
              {reportImages.map((item, index) => (
                <figure key={item.id || index}>
                  <img src={item.analysisUrl || item.imageUrl} alt={`Package evidence panel ${index + 1}`} />
                  <figcaption><b>Panel {index + 1}</b><span>{item.name}</span><code>{item.sha256 ? `${item.sha256.slice(0, 18)}…` : 'No file digest'}</code></figcaption>
                </figure>
              ))}
            </div>
          ) : <div className="missing-image">Image omitted from local record</div>}
        </section>
        {record.extraction?.fields?.length > 0 && (
          <section className="report-extraction">
            <h2>Structured declarations</h2>
            <div>
              {record.extraction.fields.filter((item) => item.detected).map((item) => (
                <article key={item.id}><span>{item.label}</span><strong>{item.value}</strong><small>{item.evidence}</small></article>
              ))}
            </div>
          </section>
        )}
        <section className="report-checks">
          <h2>Rule-by-rule findings</h2>
          <table>
            <thead><tr><th>Verdict</th><th>Check and authority</th><th>Finding</th><th>Evidence</th></tr></thead>
            <tbody>
              {record.result.checks.map((check) => (
                <tr key={check.id}>
                  <td><StatusPill status={check.status} compact /></td>
                  <td><strong>{check.label}</strong><small>{check.rule}</small></td>
                  <td>{check.reason}</td>
                  <td><code>{check.evidence}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="report-text">
          <h2>Officer-reviewed evidence text</h2>
          <pre>{record.text || 'No extracted text supplied.'}</pre>
        </section>
        <section className="report-text"><h2>Original OCR transcript before manual corrections</h2><pre>{record.rawOcrText || 'No original OCR transcript recorded; this may be manually entered or legacy evidence.'}</pre></section>
        {audit.events.length > 0 && <section className="report-audit"><h2>{audit.untrusted ? 'Officer-supplied capture timeline' : 'Hash-linked local audit timeline'}</h2>{audit.untrusted && <p>Preserved client observations, not an independently verified server audit. The server receipt is shown separately.</p>}{audit.events.map((event, index) => <div key={event.hash || index}><span>{event.index}</span><code>{event.type}</code><b>{event.actor}</b><time>{formatDate(event.at)}</time><small>{String(event.hash || '').slice(0, 16)}…</small></div>)}</section>}
        <footer>
          <strong>Decision-support notice</strong>
          <p>This prototype does not issue a statutory determination. The applicable law, amendment date, package classification and original physical evidence must be verified by an authorised Legal Metrology officer.</p>
        </footer>
      </article>
    </div>
  )
}

function OverrideModal({ record, onClose, onApply }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(record?.result.status || 'manual_review')
  const [reason, setReason] = useState('')
  useEffect(() => {
    setStatus(record?.result.status || 'manual_review')
    setReason('')
  }, [record?.id, record?.result.status])
  if (!record) return null
  return (
    <div className="override-modal" role="dialog" aria-modal="true" aria-label="Supervisor review">
      <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await onApply(status, reason.trim()) } catch (issue) { setError(issue.message) } finally { setBusy(false) } }}>
        <header><div><span className="eyebrow">SUPERVISOR REVIEW</span><h3>{record.id}</h3></div><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <p>The automated finding remains preserved. A supervisor disposition creates a new hash-linked audit event and never rewrites the original checks.</p>
        <label>Supervisor disposition<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="compliant">Pass</option><option value="non_compliant">Flag</option><option value="manual_review">Manual review</option><option value="exempt">Exempt</option></select></label>
        <label>Mandatory reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="State the physical evidence and legal basis for the disposition…" /></label>
        <p role="alert">{error}</p>
        <footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" disabled={busy || reason.trim().length < 12}><ShieldCheck size={16} /> {busy ? 'Saving…' : 'Seal supervisor disposition'}</button></footer>
      </form>
    </div>
  )
}

function InspectionApp({ workspace }) {
  const [route, setRoute] = useState('inspect')
  const [history, setHistory] = useState([])
  const [report, setReport] = useState(null)
  const [overrideRecord, setOverrideRecord] = useState(null)
  const [studioKey, setStudioKey] = useState(0)
  const [syncError, setSyncError] = useState('')
  const [operations, setOperations] = useState([])
  const [syncing, setSyncing] = useState(false)
  const store = useMemo(() => createEvidenceStore(workspace?.scope || 'local'), [workspace?.scope])
  const [localActor, setActor] = useState(() => {
    try { return JSON.parse(localStorage.getItem('niyamlens:actor') || 'null') || LOCAL_ACTORS[0] } catch { return LOCAL_ACTORS[0] }
  })
  const actor = workspace?.actor || localActor
  const challengeKey = workspace ? `niyamlens:challenge:${workspace.scope}` : 'niyamlens:challenge'
  const [challenge, setChallenge] = useState(() => {
    try { return JSON.parse(localStorage.getItem(challengeKey) || 'null') } catch { return null }
  })

  useEffect(() => { if (!workspace) localStorage.setItem('niyamlens:actor', JSON.stringify(actor)) }, [actor, workspace])
  useEffect(() => {
    if (challenge) localStorage.setItem(challengeKey, JSON.stringify(challenge))
    else localStorage.removeItem(challengeKey)
  }, [challenge, challengeKey])

  useEffect(() => {
    let active = true
    const hydrate = async () => {
      try {
        const records = await store.listInspections()
        if (!active) return
        if (records.length) {
          setHistory(records.map(normalizeCase))
          return
        }
        const legacy = workspace ? [] : loadLegacyHistory()
        setHistory(legacy.map(normalizeCase))
        await Promise.all(legacy.map(store.saveInspection))
      } catch (error) {
        if (active) setSyncError(`Local storage unavailable: ${error.message}`)
      }
    }
    hydrate()
    return () => { active = false }
  }, [store])

  const refreshLocal = async (signal) => {
    const records = (await store.listInspections()).map(normalizeCase)
    const queued = await store.all('outbox')
    if (signal) await workspace.api.ensureCurrent(signal)
    setHistory(records)
    setOperations(queued)
  }
  const syncEngine = useMemo(() => workspace && createSyncEngine({ store, transport: async (operation) => {
    const signal = workspace.api.signal
    const result = await workspace.api.transport(operation)
    if (result.record) result.record = mergeCloudRecord(await store.get('inspections', operation.recordId), result.record)
    await workspace.api.ensureCurrent(signal)
    return result
  }, onChange: refreshLocal }), [workspace?.api, store])
  const synchronize = async (force = false) => {
    if (!workspace || !navigator.onLine) { await refreshLocal(); return }
    const signal = workspace.api.signal
    setSyncing(true); setSyncError('')
    try {
      await syncEngine.run(force)
      await workspace.api.ensureCurrent(signal)
      let offset = 0
      do {
        const page = await workspace.api.request(`cases?offset=${offset}`, { signal })
        for (const record of page.records) {
          await workspace.api.ensureCurrent(signal)
          await store.mergeRemote(record, mergeCloudRecord)
        }
        offset = page.nextOffset
      } while (offset !== null)
      await refreshLocal(signal)
    } catch (error) { if (!signal.aborted) setSyncError(error.message) } finally { if (!signal.aborted) setSyncing(false) }
  }
  useEffect(() => {
    if (!workspace) return
    synchronize()
    const online = () => synchronize()
    window.addEventListener('online', online)
    const timer = setInterval(online, 30000)
    return () => { window.removeEventListener('online', online); clearInterval(timer); workspace.api.cancelPending() }
  }, [workspace?.api, store])

  const archiveConflictingReview = async (operation) => {
    const signal = workspace.api.signal
    try {
      const { record } = await workspace.api.request(`cases?id=${encodeURIComponent(operation.recordId)}`, { signal })
      const cached = await store.get('inspections', operation.recordId)
      await workspace.api.ensureCurrent(signal)
      await store.transact(['settings', 'outbox', 'inspections'], 'readwrite', (tx) => {
        tx.objectStore('settings').put({ id: `archived-review:${operation.id}`, operation, archivedAt: new Date().toISOString() })
        tx.objectStore('outbox').delete(operation.id)
        tx.objectStore('inspections').put(mergeCloudRecord(cached, record))
      })
      await refreshLocal(signal)
    } catch (error) { if (!signal.aborted) setSyncError(error.message) }
  }
  const openReport = async (record) => {
    const signal = workspace?.api.signal
    try {
      const opened = workspace && record.serverVersion ? await workspace.api.openRecord(record) : record
      if (signal) await workspace.api.ensureCurrent(signal)
      setReport(opened)
    } catch (error) { if (!signal?.aborted) setSyncError(`Evidence unavailable: ${error.message}`) }
  }

  const saveRecord = async (record) => {
    if (await store.get('inspections', record.id)) throw new Error('This case is already sealed. Start a new inspection to change evidence.')
    const normalized = normalizeCase({ ...record, syncState: workspace ? 'pending' : 'local' })
    if (workspace) await store.saveAndQueue(normalized, createOperation('seal', record.id, normalized))
    else await store.saveInspection(normalized)
    await refreshLocal()
    if (workspace) synchronize()
  }

  const startChallenge = () => {
    const id = crypto.randomUUID?.() || `challenge-${Date.now()}`
    setChallenge({ id, code: id.slice(0, 8).toUpperCase(), active: true, startedAt: new Date().toISOString(), actorId: actor.id })
    setRoute('inspect')
  }

  const completeChallenge = () => {
    setChallenge((current) => current ? { ...current, active: false, completedAt: new Date().toISOString() } : null)
    setRoute('challenge')
  }

  const applyOverride = async (status, reason) => {
    if (!overrideRecord) return
    const operation = createOperation('review', overrideRecord.id, { status, reason }, overrideRecord.serverVersion || 0)
    const updated = await appendReview(overrideRecord, { status, reason, actor, id: operation.id })
    if (workspace) await store.saveAndQueue({ ...updated, syncState: 'pending-review' }, operation)
    else await store.saveInspection(updated)
    await refreshLocal()
    setOverrideRecord(null)
    if (workspace) synchronize()
  }

  const importRecord = async (record) => {
    if (workspace) throw new Error('Imported bundles must be inspected locally; they cannot overwrite managed cases.')
    if (await store.get('inspections', record.id)) throw new Error('A record with this ID already exists. Import cannot overwrite it.')
    await store.saveInspection(normalizeCase(record))
    await refreshLocal()
  }

  return (
    <>
      <Shell route={route} setRoute={setRoute} historyCount={history.length} actor={actor}>
        {(workspace || syncError) && <div className="sync-status" role="status"><b>{syncing ? 'Synchronizing…' : `${operations.length} queued change(s)`}</b><span>{syncError || 'Local evidence is retained until the server acknowledges it.'}</span>{workspace && <button disabled={syncing} onClick={() => synchronize(true)}>Sync / retry</button>}{operations.map((operation) => <details key={operation.id}><summary>{operation.kind} · {operation.recordId} · {operation.state}</summary><p>{operation.lastError || 'Waiting for upload and server verification.'}</p>{operation.kind === 'review' && operation.state === 'conflict' && <><p>Your proposed disposition: {operation.payload.status}. {operation.payload.reason}</p><button onClick={() => archiveConflictingReview(operation)}>Keep server version; archive my unsent review locally</button><p>Then reopen Evidence and submit a new review against the latest version.</p></>}</details>)}</div>}
        {route === 'inspect' && <InspectionStudio key={studioKey} store={store} workspace={workspace} onNewInspection={() => setStudioKey((value) => value + 1)} onSaveRecord={saveRecord} onOpenReport={openReport} challenge={challenge?.active ? challenge : null} onChallengeComplete={completeChallenge} actor={actor} />}
        {route === 'challenge' && <BlindChallengePage challenge={challenge} onStart={startChallenge} onContinue={() => setRoute('inspect')} history={history} />}
        {route === 'dashboard' && <Dashboard history={history} onNavigate={setRoute} onOpenReport={openReport} />}
        {route === 'history' && <HistoryPage history={history} onOpenReport={openReport} onNavigate={setRoute} />}
        {route === 'benchmark' && <ValidationLab />}
        {route === 'operations' && (workspace ? <SharedOperations workspace={workspace} history={history} onOpenReport={openReport} onOverride={setOverrideRecord} /> : <OfficerOperations history={history} actor={actor} onActorChange={setActor} onOpenReport={openReport} onOverride={setOverrideRecord} onImportRecord={importRecord} />)}
        {route === 'rules' && <RulesLibrary />}
      </Shell>
      <ReportModal record={report} onClose={() => setReport(null)} />
      <OverrideModal record={overrideRecord} onClose={() => setOverrideRecord(null)} onApply={applyOverride} />
    </>
  )
}

export default function App() {
  return <WorkspaceGate>{(workspace) => <InspectionApp key={workspace?.scope || 'local'} workspace={workspace} />}</WorkspaceGate>
}
