import { useEffect, useMemo, useRef, useState } from 'react'
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
import { evaluateInspection, fieldCandidates, FIELD_RULES } from './lib/inspectionSafety.mjs'
import { EMPTY_OCR, MAX_EVIDENCE_TEXT, ocrProvenance, restoreEvidencePolicy, invalidateCapturedEvidence, validateSealableEvidence, nextPageOffset } from './lib/inspectionWorkflow.mjs'
import { runLocalOcr } from './lib/ocrRunner.mjs'
import { runPaddleOcr, preparePaddleAppend, createPaddleFocusInput } from './lib/paddleOcr.mjs'
import { createPaddleRetryInput } from './lib/paddleRetryInput.mjs'
import PaddleStampRecovery from './PaddleStampRecovery.jsx'
import { collectPaddleLayoutProposals } from './lib/paddleLayoutProposals.mjs'
import PaddleReview from './PaddleReview.jsx'
import PaddleFocusGuidance from './PaddleFocusGuidance.jsx'
import { resolvePaddleFocusSuggestion } from './lib/ocrFocusGuidance.mjs'
import OcrPassSelection from './OcrPassSelection.jsx'
import { prepareOcrPassSelection } from './lib/ocrPassSelection.mjs'
import { abortError, boundedOcr, throwIfAborted } from './lib/ocrLifecycle.mjs'
import { createFocusedVariants, appendFocusedTranscript } from './lib/focusOcr.mjs'
import { appendOcrHistory, validateOcrHistory } from './lib/ocrHistory.mjs'
import { createOperation, createSyncEngine } from './lib/syncEngine.mjs'
import { mergeCloudRecord } from './lib/workspaceClient.mjs'
import { WorkspaceGate, SharedOperations } from './Workspace.jsx'
import FieldVerification from './FieldVerification.jsx'
import CaptureCoach from './CaptureCoach.jsx'
import { CAPTURE_TARGET_IDS, validateCloseUpCapture } from './lib/captureCoach.mjs'
import MachineCandidateHistory from './MachineCandidateHistory.jsx'
import { singleFlight } from './lib/singleFlight.mjs'
import { beginRuleReassessment } from './lib/reassessment.mjs'
import { archiveReviewConflict } from './lib/reviewConflict.mjs'
import PlacementReview from './PlacementReview.jsx'
import ReportDownloads from './ReportDownloads.jsx'
import PackageEvidenceViewer from './PackageEvidenceViewer.jsx'
import { EvidenceTracePanel, InspectionProgress } from './InspectionClarity.jsx'
import SystemTrust from './SystemTrust.jsx'
import { qualityDecisionRequired, qualityIdentity } from './lib/inspectionPresentation.mjs'
import './placement.css'
import { analyzeImageQuality, detectReferenceCard, matchDeclarationRegions, mergeOcrPassTexts, webXrDepthSupport } from './lib/vision.mjs'

const NAV_ITEMS = [
  { id: 'inspect', label: 'New inspection', icon: ScanLine },
  { id: 'challenge', label: 'Blind challenge', icon: Timer },
  { id: 'dashboard', label: 'Command view', icon: BarChart3 },
  { id: 'history', label: 'Inspection history', icon: History },
  { id: 'benchmark', label: 'Validation lab', icon: Database },
  { id: 'operations', label: 'Officer operations', icon: Users },
  { id: 'rules', label: 'Rule library', icon: Library },
  { id: 'system', label: 'System & trust', icon: ShieldCheck },
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
  ...EMPTY_OCR,
  enforceEvidenceReview: true,
  productName: '',
  category: 'general',
  commodityClass: 'standard',
  rule3ConsumerScope: 'unknown',
  rule3CommodityClass: 'unknown',
  rule3ApplicabilityConfirmed: false,
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
  qualityAcknowledgements: {},
  measurementUncertainty: 8,
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

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected) }
  }, [])
  return online
}

const OFFLINE_WORKER_PROTOCOL = 2

function requestOfflineVerification(worker, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const finish = (callback, value) => {
      clearTimeout(timeout)
      channel.port1.close()
      callback(value)
    }
    const timeout = setTimeout(() => finish(reject, new Error('The current service worker did not answer the offline-readiness check.')), timeoutMs)
    channel.port1.onmessage = ({ data }) => {
      if (data?.type !== 'verification') return
      finish(resolve, data)
    }
    try { worker.postMessage({ type: 'NIYAMLENS_VERIFY_OFFLINE' }, [channel.port2]) }
    catch (error) { finish(reject, error) }
  })
}

async function compatibleOfflineWorker(waitMs = 12000) {
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker readiness timed out.')), 10000)),
  ])
  const deadline = Date.now() + waitMs
  do {
    const candidates = [...new Set([navigator.serviceWorker.controller, registration.active].filter(Boolean))]
    for (const worker of candidates) {
      try {
        const status = await requestOfflineVerification(worker)
        if (status.protocol === OFFLINE_WORKER_PROTOCOL) return { worker, status }
      } catch {
        // During an update the controlling worker can be one release behind.
      }
    }
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < deadline)
  throw new Error('The updated offline worker is not controlling this page yet. Reload and try again.')
}

function usePwaInstall() {
  const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
  const [promptEvent, setPromptEvent] = useState(null)
  const [installed, setInstalled] = useState(standalone)
  const [shell, setShell] = useState(import.meta.env.PROD ? 'checking' : 'unavailable')
  const [shellProgress, setShellProgress] = useState({ completed: 0, total: 0, error: '' })
  const [workerReady, setWorkerReady] = useState(false)
  useEffect(() => {
    const available = (event) => { event.preventDefault(); setPromptEvent(event) }
    const complete = () => { setInstalled(true); setPromptEvent(null) }
    let active = true
    const verifyShell = async () => {
      if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !('caches' in window)) { if (active) setShell('unavailable'); return }
      try {
        const { status } = await compatibleOfflineWorker()
        if (active) {
          setWorkerReady(true)
          setShellProgress({ completed: status.completed, total: status.total, error: '' })
          setShell(!status.shellReady ? 'unavailable' : status.ocrReady ? 'ready' : 'incomplete')
        }
      } catch { if (active) { setWorkerReady(false); setShell('unavailable') } }
    }
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', complete)
    navigator.serviceWorker?.addEventListener('controllerchange', verifyShell)
    verifyShell()
    return () => { active = false; window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', complete); navigator.serviceWorker?.removeEventListener('controllerchange', verifyShell) }
  }, [])
  return {
    installed,
    shell,
    shellProgress,
    canDownload: import.meta.env.PROD && workerReady,
    available: Boolean(promptEvent) && !installed,
    downloadOfflinePack: async () => {
      if (!navigator.onLine || !('serviceWorker' in navigator)) { setShellProgress((current) => ({ ...current, error: 'Reconnect before downloading the offline OCR pack.' })); return }
      setShell('downloading'); setShellProgress({ completed: 0, total: 0, error: '' })
      try {
        const { worker: target } = await compatibleOfflineWorker()
        setWorkerReady(true)
        await new Promise((resolve, reject) => {
          const channel = new MessageChannel()
          let inactivityTimeout
          let settled = false
          const overallTimeout = setTimeout(() => finish(reject, new Error('Offline OCR download exceeded 15 minutes. Keep this page open, then verify or retry.')), 900000)
          const finish = (callback, value) => {
            if (settled) return
            settled = true
            clearTimeout(inactivityTimeout)
            clearTimeout(overallTimeout)
            channel.port1.close()
            callback(value)
          }
          const resetInactivity = () => {
            clearTimeout(inactivityTimeout)
            inactivityTimeout = setTimeout(() => finish(reject, new Error('Offline OCR download made no progress for two minutes. Check the connection and retry.')), 120000)
          }
          resetInactivity()
          channel.port1.onmessage = ({ data }) => {
            if (data?.type === 'progress') { resetInactivity(); setShellProgress({ completed: data.completed, total: data.total, error: '' }) }
            if (data?.type === 'complete') { setShellProgress({ completed: data.completed, total: data.total, error: '' }); finish(resolve) }
            if (data?.type === 'error') finish(reject, new Error(data.message))
          }
          try { target.postMessage({ type: 'NIYAMLENS_CACHE_OCR_PACK' }, [channel.port2]) }
          catch (error) { finish(reject, error) }
        })
        const verified = await requestOfflineVerification(target, 5000)
        if (!verified.shellReady || !verified.ocrReady) throw new Error('Downloaded assets could not be fully verified in Cache Storage.')
        setShellProgress({ completed: verified.completed, total: verified.total, error: '' })
        setShell('ready')
      } catch (error) { setShell('incomplete'); setShellProgress((current) => ({ ...current, error: error.message || 'Offline OCR pack could not be cached.' })) }
    },
    prompt: async () => {
      if (!promptEvent || installed) return
      const current = promptEvent
      setPromptEvent(null)
      await current.prompt()
      const choice = await current.userChoice
      if (choice?.outcome === 'accepted') setInstalled(true)
    },
  }
}

function Shell({ route, setRoute, children, historyCount, actor, online, offlineOnly = false }) {
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
          <span>Rule pack active</span>
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
            <span className={online && !offlineOnly ? 'online-state' : 'offline-state'}><span className="live-dot" />{offlineOnly ? 'Local work only' : online ? 'Browser online' : 'Browser offline'}</span>
            <span>Decision support</span>
          </div>
        </header>
        <main>{children}</main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Mobile primary navigation">
        {NAV_ITEMS.filter((item) => ['inspect', 'history', 'dashboard', 'system'].includes(item.id)).map((item) => {
          const Icon = item.icon
          return <button type="button" key={item.id} className={route === item.id ? 'active' : ''} onClick={() => { setRoute(item.id); setMenuOpen(false) }}><Icon size={19} /><span>{item.label.replace('New ', '')}</span></button>
        })}
        <button type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><Menu size={19} /><span>More</span></button>
      </nav>
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

function DeclarationCoverage({ extraction, reliability, engineConfidence, reliabilityReason, hasOcrRun = false }) {
  if (!extraction.raw) return null
  const usable = (field) => Boolean(field?.detected && field.value && !field.conflict && !['invalid', 'conflict'].includes(field.validation?.status))
  const missing = CORE_DECLARATIONS.filter((item) => !usable(extraction.byId[item.id]))
  const scored = hasOcrRun && typeof reliability === 'number' && Number.isFinite(reliability) && typeof engineConfidence === 'number' && Number.isFinite(engineConfidence)
  const needsRetake = hasOcrRun && (!scored || reliability < 55)
  return (
    <div className={`declaration-coverage ${needsRetake ? 'retake' : missing.length ? 'incomplete' : 'complete'}`}>
      <header>
        <div><b>{needsRetake ? 'Retake or deep scan recommended' : missing.length ? 'Declaration coverage incomplete' : 'Core declarations located'}</b><small>{reliabilityReason || 'Verify every extracted value against its highlighted source.'}</small></div>
        <span>{scored ? `Heuristic ${reliability.toFixed(0)}/100 · engine ${engineConfidence.toFixed(0)}/100 · not accuracy` : 'No inspection-wide OCR score · verification required'}</span>
      </header>
      <div>
        {CORE_DECLARATIONS.map((item) => {
          const detected = usable(extraction.byId[item.id])
          return <span key={item.id} className={detected ? 'covered' : ''}>{detected ? <Check size={12} /> : <CircleHelp size={12} />}{item.label}</span>
        })}
      </div>
      {missing.length > 0 && <p>Add or retake a panel containing: {missing.map((item) => item.label).join(', ')}. The system will abstain when evidence quality is insufficient.</p>}
    </div>
  )
}

function CalibrationBoard({ evidenceItems, activeEvidence, meta, onMeasure, onActive, onRemove, onRetake, onQualityAcknowledge, qualityAcknowledged = false, onTransform, onRectify, onRoleChange, processing, locked = false, regions = [], activeRegionId, onRegionSelect, onDetectReference, onCheckDepth, depthState, onFocusSelect, focusRequest }) {
  const [mode, setMode] = useState('')
  const [points, setPoints] = useState({ reference: [], height: [], width: [], perspective: [], focus: [] })
  const boardRef = useRef(null)
  const imageRef = useRef(null)
  const imageUrl = activeEvidence?.analysisUrl || ''
  const fileName = activeEvidence?.name || ''
  const measurement = panelMeasurement(meta, activeEvidence?.id)

  useEffect(() => {
    setPoints({ reference: [], height: [], width: [], perspective: [], focus: [] })
    setMode('')
  }, [imageUrl])

  useEffect(() => {
    if (!focusRequest || !imageUrl || locked) return
    setPoints(current => ({ ...current, focus: [] })); setMode('focus')
    boardRef.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [focusRequest])

  const modes = {
    reference: { field: 'referencePx', color: '#00a37a', label: 'Reference' },
    height: { field: 'glyphPx', color: '#e0a320', label: 'Glyph height' },
    width: { field: 'glyphWidthPx', color: '#c6493d', label: 'Glyph width' },
    perspective: { field: '', color: '#4f70d6', label: 'Flatten panel', points: 4 },
    focus: { field: '', color: '#8b5fc7', label: 'Focus OCR' },
  }

  const handlePoint = (event) => {
    if (locked || processing || !mode || !boardRef.current || !imageRef.current || !imageUrl) return
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
    } else if (mode === 'focus' && next.length === 2) {
      onFocusSelect?.({ x0: Math.max(0, Math.min(1, next[0].x / 100)), y0: Math.max(0, Math.min(1, next[0].y / 100)), x1: Math.max(0, Math.min(1, next[1].x / 100)), y1: Math.max(0, Math.min(1, next[1].y / 100)) })
      setMode('')
    } else if (mode !== 'perspective' && next.length === 2) {
      const distance = Math.hypot(next[1].pxX - next[0].pxX, next[1].pxY - next[0].pxY)
      onMeasure(modes[mode].field, Number(distance.toFixed(1)))
      setMode('')
    }
  }

  const reset = () => {
    setPoints({ reference: [], height: [], width: [], perspective: [], focus: [] })
    setMode('')
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
                <g key={region.id} className={`declaration-region ${activeRegionId === region.id ? 'active' : ''}`} onClick={(event) => { if (locked || processing || mode) return; event.stopPropagation(); onRegionSelect?.(region.id) }}>
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
                    {key !== 'perspective' && key !== 'focus' && set.length === 2 && (
                      <line x1={set[0].x} y1={set[0].y} x2={set[1].x} y2={set[1].y} stroke={style.color} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
                    )}
                    {key === 'perspective' && set.length > 1 && <polyline points={set.map((point) => `${point.x},${point.y}`).join(' ')} fill="rgba(79,112,214,.11)" stroke={style.color} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />}
                    {key === 'focus' && set.length === 2 && <rect x={Math.min(set[0].x, set[1].x)} y={Math.min(set[0].y, set[1].y)} width={Math.abs(set[1].x - set[0].x)} height={Math.abs(set[1].y - set[0].y)} fill="rgba(139,95,199,.1)" stroke={style.color} strokeWidth="1" vectorEffect="non-scaling-stroke" />}
                    {set.map((point, index) => (
                      <circle key={index} cx={point.x} cy={point.y} r="1.15" fill={style.color} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                )
              })}
            </svg>
            {mode && <div className="measurement-prompt"><MousePointer2 size={15} /> {mode === 'perspective' ? `Select corners TL → TR → BR → BL (${points.perspective.length}/4)` : mode === 'focus' ? 'Select opposite corners around the complete declaration, including its heading' : `Select two endpoints for ${modes[mode].label.toLowerCase()}`}</div>}
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
          <strong>Image heuristic {activeEvidence.quality.score}/100 · not OCR accuracy</strong>
          <span>Sharpness {activeEvidence.quality.sharpness} · Contrast {activeEvidence.quality.contrast} · Glare {activeEvidence.quality.glarePercent}%</span>
          <small>{activeEvidence.quality.issues[0] || 'No gross image issue detected. Small, curved or low-contrast print can still be unreadable.'}</small>
          {['review', 'poor'].includes(activeEvidence.quality.status) && <div className="quality-actions">
            <button type="button" onClick={() => onRetake?.(activeEvidence.id)}><Camera size={14} /> Replace with new capture</button>
            {qualityAcknowledged ? <span><Check size={14} /> Continue-with-caution recorded</span> : <button type="button" onClick={() => onQualityAcknowledge?.(activeEvidence)}><ShieldAlert size={14} /> Continue with caution</button>}
          </div>}
        </div>
      )}

      <div className="measure-toolbar">
        {Object.entries(modes).map(([key, option]) => (
          <button
            type="button"
            key={key}
            className={mode === key ? 'active' : ''}
            onClick={() => { setPoints((current) => ({ ...current, [key]: [] })); setMode(mode === key ? '' : key) }}
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

function ExtractionWorkbench({ extraction, onApply, barcodeState, regions = [], evidenceItems = [], activeFieldId = '', onSelectRegion, meta }) {
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
        {visibleFields.map((item) => {
          const region = regionMap[item.id]
          const panelIndex = region ? evidenceItems.findIndex((panel) => panel.id === region.panelId) : -1
          return (
          <button type="button" key={item.id} className={`${item.detected ? 'detected' : 'missing'} ${activeFieldId === item.id ? 'active' : ''}`} onClick={() => region && onSelectRegion?.(item.id)} disabled={!region}>
            <span>{item.detected ? <Check size={13} /> : <CircleHelp size={13} />}{item.label}</span>
            <strong>{item.conflict ? 'Conflicting values' : item.value || (item.detected ? 'Invalid / incomplete reading' : 'Not detected')}</strong>
            <small>{item.detected ? `Detected, not certified${regionMap[item.id] ? ' · source region located' : ''}` : 'Correct OCR text or supply manually'}</small>
            {item.validation && <em className={item.validation.status.includes('invalid') ? 'field-invalid' : 'field-valid'}>{item.validation.message}</em>}
            {region && <i>View source · Panel {panelIndex + 1} · OCR geometry only</i>}
          </button>
        )})}
      </div>
      {barcodeState.message && (
        <div className={`barcode-state ${barcodeState.error ? 'error' : ''}`}>
          <Barcode size={15} /> {barcodeState.message}
        </div>
      )}
    </div>
  )
}

function VerdictPanel({ result, onSave, onReport, saved, saving, evidenceCount, pendingPreview = false }) {
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
          <small>checks passed</small>
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
        <button type="button" className="primary-action" onClick={onSave} disabled={saved || saving || !evidenceCount || pendingPreview}>
          {saving ? <LoaderCircle className="spin" size={17} /> : saved ? <Check size={17} /> : <Archive size={17} />}
          {saving ? 'Sealing evidence…' : saved ? 'Inspection saved' : 'Finalize inspection'}
        </button>
        <button type="button" className="secondary-action" onClick={onReport}>
          <FileCheck2 size={17} /> Evidence report
        </button>
      </div>
      {pendingPreview && <p role="status">Review the pending OCR preview before finalizing. Unappended readings are not part of this report.</p>}
      <div className="evidence-integrity"><ShieldCheck size={14} />{evidenceCount || 0} captured panel{evidenceCount === 1 ? '' : 's'} · IndexedDB evidence register</div>
      {!evidenceCount && <p className="legal-caveat">Capture a package photograph before finalizing. A text-only assessment is not image-supported evidence.</p>}
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
  const auditGeneration = useRef(0)
  const [saved, setSaved] = useState(false)
  const [sealedRecord, setSealedRecord] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)
  const pendingRetakeId = useRef('')
  const pendingCaptureTarget = useRef('')
  const activeJob = useRef(null)
  const [focusSelection, setFocusSelection] = useState(null)
  const [focusRequest, setFocusRequest] = useState(null)
  const [focusResult, setFocusResult] = useState(null)
  const [paddlePreview, setPaddlePreview] = useState(null)
  const [paddleGuidance, setPaddleGuidance] = useState([])
  const ocrPreviewPending = Boolean(focusResult || paddlePreview)
  const focusCardRef = useRef(null)
  useEffect(() => {
    if (!focusSelection) return
    focusCardRef.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    focusCardRef.current?.focus({ preventScroll: true })
  }, [focusSelection])
  useEffect(() => () => { activeJob.current?.abort(); activeJob.current = null; auditGeneration.current += 1 }, [])

  const cancelActiveJob = () => {
    activeJob.current?.abort()
    activeJob.current = null
    setProcessing(false)
    setOcrState({ running: false, progress: 0, label: 'Cancelled; previous evidence preserved', error: '' })
    recordAudit('processing_cancelled', { reason: 'Officer cancelled capture or OCR' })
  }

  const activeEvidence = evidenceItems.find((item) => item.id === activeEvidenceId) || evidenceItems[0] || null
  useEffect(() => { setFocusSelection(null); setFocusResult(null) }, [activeEvidence?.id, activeEvidence?.analysisUrl])
  const paddleImageIdentity = evidenceItems.map(item => `${item.id}:${item.analysisUrl}`).join('|')
  useEffect(() => { setPaddlePreview(null); setPaddleGuidance([]) }, [paddleImageIdentity])
  const extraction = useMemo(() => extractDeclarations(text), [text])
  const rawRegions = useMemo(() => matchDeclarationRegions(extraction, ocrWords), [extraction, ocrWords])
  const provenance = useMemo(() => ocrProvenance({ meta, rawOcrText, auditChain }), [meta, rawOcrText, auditChain])
  const evaluationMeta = useMemo(() => ({ ...restoreEvidencePolicy({ meta, rawOcrText, auditChain }), evidencePanelIds: evidenceItems.map((item) => item.id) }), [meta, rawOcrText, auditChain, evidenceItems])
  const result = useMemo(() => evaluateInspection({ text, meta: evaluationMeta }), [text, evaluationMeta])
  const regions = useMemo(() => {
    const statuses = Object.fromEntries(result.checks.map((check) => [check.id, check.status]))
    return rawRegions.map((region) => ({ ...region, status: statuses[region.id] || 'info' }))
  }, [rawRegions, result])
  const qualityBlocked = qualityDecisionRequired(evidenceItems, meta.qualityAcknowledgements)

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
    if (!draft || activeJob.current || processing || ocrState.running || saving) { setDraftMessage('Finish or cancel the current operation before restoring a draft.'); return }
    if (challenge?.active && draft.challengeId !== challenge.id) { setDraftMessage('This draft predates the blind challenge. It cannot be used as blind-run evidence. Discard it explicitly or exit the challenge to recover it.'); return }
    auditGeneration.current += 1
    setFocusResult(null); setFocusSelection(null); setPaddlePreview(null); setPaddleGuidance([])
    setInspectionId(draft.inspectionId); setStartedAt(draft.startedAt); setEvidenceItems(draft.evidenceItems); setActiveEvidenceId(draft.activeEvidenceId)
    setText(draft.text); setRawOcrText(draft.rawOcrText || ''); setMeta({ ...INITIAL_META, ...restoreEvidencePolicy(draft) }); setOcrWords(draft.ocrWords || []); auditRef.current = draft.auditChain || []; setAuditChain(auditRef.current); setDraft(null); setDraftMessage('Draft restored under the current evidence policy; verify before sealing.')
  }

  const updateMeta = (key, value) => setMeta((current) => ({ ...current, [key]: value,
    ...(['pdpArea', 'pdpUncertainty', 'formedText'].includes(key) ? { pdpConfirmed: false, placementPdpConfirmed: false } : {}),
    ...(['referenceMm', 'measurementUncertainty'].includes(key) ? { measurementConfirmed: false, widthCharacterConfirmed: false } : {}),
    ...(['quantity', 'unit', 'category', 'commodityClass'].includes(key) ? { classificationConfirmed: false, placementPdpConfirmed: false } : {}),
    ...(['quantity', 'unit', 'category', 'commodityClass', 'rule3ConsumerScope', 'rule3CommodityClass'].includes(key) ? { rule3ApplicabilityConfirmed: false } : {}),
    ...(['placementScope', 'measurementSurface'].includes(key) ? { placementPdpConfirmed: false, quantitySpacing: { ...current.quantitySpacing, confirmed: false } } : {}),
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
    const nextQuality = { ...(current.qualityAcknowledgements || {}) }
    delete nextMeasurements[panelId]
    delete nextQuality[panelId]
    return { ...invalidateCapturedEvidence(current), panelMeasurements: nextMeasurements, qualityAcknowledgements: nextQuality }
  })

  const recordAudit = (type, payload = {}) => {
    const generation = auditGeneration.current
    const controller = activeJob.current
    const current = () => generation === auditGeneration.current && (!controller || activeJob.current === controller && !controller.signal.aborted)
    const operation = auditQueue.current.then(async () => {
      if (!current()) throw abortError()
      const next = await appendAuditEvent(auditRef.current, type, payload, actor?.id || 'local-officer')
      if (!current()) throw abortError()
      auditRef.current = next; setAuditChain(next); return next
    })
    auditQueue.current = operation.catch(() => {})
    return operation
  }

  const updatePanelDimension = (key, value) => {
    setMeta((current) => {
      const next = { ...current, [key]: value, pdpConfirmed: false, placementPdpConfirmed: false }
      const width = Number(key === 'panelWidthCm' ? value : next.panelWidthCm)
      const height = Number(key === 'panelHeightCm' ? value : next.panelHeightCm)
      if (width > 0 && height > 0) next.pdpArea = Number((width * height).toFixed(2))
      return next
    })
  }

  const updateCylinderDimension = (key, value) => {
    setMeta((current) => {
      const next = { ...current, [key]: value, pdpConfirmed: false, placementPdpConfirmed: false }
      const diameter = Number(key === 'cylinderDiameterCm' ? value : next.cylinderDiameterCm)
      const height = Number(key === 'cylinderHeightCm' ? value : next.cylinderHeightCm)
      const coverage = Number(key === 'cylinderCoverage' ? value : next.cylinderCoverage)
      if (diameter > 0 && height > 0 && coverage > 0) next.pdpArea = Number((Math.PI * diameter * height * (coverage / 100)).toFixed(2))
      return next
    })
  }

  const beginEvidenceRecord = () => {
    auditGeneration.current += 1
    setInspectionId(createInspectionId())
    setStartedAt(new Date().toISOString())
    setSaved(false)
    auditRef.current = []
    setAuditChain([])
  }

  const applyExtraction = (parsed) => {
    setMeta((current) => ({
      ...current,
      classificationConfirmed: false,
      rule3ApplicabilityConfirmed: false,
      productName: parsed.suggestions.productName || current.productName,
      category: parsed.suggestions.category || current.category,
      commodityClass: parsed.suggestions.commodityClass || current.commodityClass,
      quantity: parsed.byId.netQuantity?.detected ? (parsed.suggestions.quantity ?? '') : current.quantity,
      unit: parsed.suggestions.unit || current.unit,
      barcode: parsed.suggestions.barcode || current.barcode,
    }))
  }

  const openEvidencePicker = (replaceId = '', captureTarget = '') => {
    if (activeJob.current || saved || saving || ocrPreviewPending) return
    if (captureTarget && (!CAPTURE_TARGET_IDS.includes(captureTarget) || replaceId || !evidenceItems.length || evidenceItems.length >= 4)) return
    pendingRetakeId.current = replaceId
    pendingCaptureTarget.current = captureTarget
    if (fileInput.current) fileInput.current.value = ''
    fileInput.current?.click()
  }

  const handleFiles = async (fileList, { replaceId = '', captureTarget = '' } = {}) => {
    if (activeJob.current || saved || saving || ocrPreviewPending) return
    const replaced = replaceId ? evidenceItems.find((item) => item.id === replaceId) : null
    if (replaceId && !replaced) { setOcrState((current) => ({ ...current, error: 'The panel selected for replacement is no longer available.' })); return }
    const files = Array.from(fileList || []).slice(0, replaceId ? 1 : Math.max(0, 4 - evidenceItems.length))
    if (!files.length) return
    const controller = new AbortController()
    activeJob.current = controller
    const firstPanel = evidenceItems.length === 0
    try {
      const capturePurpose = validateCloseUpCapture({ target: captureTarget, replaceId, panelCount: evidenceItems.length, fileCount: Array.from(fileList || []).length })
      if (workspace && files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('Managed evidence accepts JPEG, PNG or WebP originals. Export other camera formats before capture.')
      setProcessing(true)
      setOcrState({ running: false, progress: 4, label: `Securing ${files.length} evidence panel${files.length > 1 ? 's' : ''}`, error: '' })
      const capturedItems = await Promise.all(files.map((file) => evidenceFromFile(file, { signal: controller.signal })))
      throwIfAborted(controller.signal)
      const guidedRoles = CAPTURE_REQUIREMENTS.map((item) => item.id)
      const nextItems = capturedItems.map((item, index) => ({
        ...item,
        panelRole: replaced?.panelRole || guidedRoles[evidenceItems.length + index] || 'other',
      }))
      let preparedChain = firstPanel ? await appendAuditEvent([], 'inspection_started', { challengeId: challenge?.id || null }, actor?.id || 'local-officer') : null
      for (const item of nextItems) {
        throwIfAborted(controller.signal)
        const payload = { id: item.id, name: item.name, panelRole: item.panelRole, sha256: item.sha256, quality: item.quality?.score, capturedAt: item.capturedAt, ...(capturePurpose ? { capturePurpose } : {}) }
        if (firstPanel) preparedChain = await appendAuditEvent(preparedChain, 'evidence_captured', payload, actor?.id || 'local-officer')
        else if (replaced) await recordAudit('evidence_replaced_before_seal', { previousEvidenceId: replaced.id, previousSha256: replaced.sha256, replacement: payload })
        else await recordAudit('evidence_captured', payload)
      }
      throwIfAborted(controller.signal)
      if (firstPanel) {
        beginEvidenceRecord()
        auditRef.current = preparedChain; setAuditChain(preparedChain)
        setText('')
        setRawOcrText('')
        setMeta({ ...INITIAL_META, enforceEvidenceReview: true })
        setOcrWords([])
        setBarcodeState({ message: '', error: false, candidate: null })
      } else {
        setMeta((current) => {
          const next = invalidateCapturedEvidence(current)
          if (!replaced) return next
          const panelMeasurements = { ...(next.panelMeasurements || {}) }
          const qualityAcknowledgements = { ...(next.qualityAcknowledgements || {}) }
          delete panelMeasurements[replaced.id]
          delete qualityAcknowledgements[replaced.id]
          return { ...next, panelMeasurements, qualityAcknowledgements }
        })
        setOcrWords([])
      }
      throwIfAborted(controller.signal)
      setEvidenceItems((current) => replaced
        ? current.map((item) => item.id === replaced.id ? nextItems[0] : item)
        : [...current, ...nextItems].slice(0, 4))
      setActiveEvidenceId(nextItems[0].id)
      if (!controller.signal.aborted) setOcrState({ running: false, progress: 8, label: capturePurpose ? 'Close-up panel ready for OCR; previous photographs and readings retained. Read the new photo and review any conflict.' : replaced ? 'Replacement panel validated and ready for OCR' : `${nextItems.length} panel${nextItems.length > 1 ? 's' : ''} ready for OCR`, error: '' })
    } catch (error) {
      if (activeJob.current === controller) setOcrState({ running: false, progress: 0, label: 'Image rejected', error: error.message || 'The selected evidence could not be prepared.' })
    } finally {
      if (activeJob.current === controller) { activeJob.current = null; setProcessing(false); if (fileInput.current) fileInput.current.value = '' }
    }
  }

  const applyDemo = async (demo) => {
    if (activeJob.current || saved || saving || ocrPreviewPending) return
    const controller = new AbortController()
    activeJob.current = controller
    const id = `test-${Date.now()}`
    try {
      setProcessing(true)
      setOcrState({ running: false, progress: 5, label: 'Preparing controlled evidence for browser OCR', error: '' })
      const analysisUrl = await processImage(demo.imageUrl, { signal: controller.signal })
      const quality = await boundedOcr(analyzeImageQuality(analysisUrl), { signal: controller.signal, timeoutMs: 20000, label: 'Image quality check' })
      throwIfAborted(controller.signal)
      const preparedChain = await appendAuditEvent([], 'controlled_packet_loaded', { fileName: demo.fileName }, actor?.id || 'local-officer')
      throwIfAborted(controller.signal)
      beginEvidenceRecord()
      auditRef.current = preparedChain; setAuditChain(preparedChain)
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
      setRawOcrText('')
      setMeta({
        ...INITIAL_META,
        ...demo.meta,
        ...EMPTY_OCR,
        enforceEvidenceReview: true,
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
    } catch (error) {
      if (activeJob.current === controller) setOcrState({ running: false, progress: 0, label: 'Controlled evidence unavailable', error: error.message || 'The controlled packet could not be prepared.' })
    } finally {
      if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) }
    }
  }

  const transformActiveEvidence = async (changes) => {
    if (!activeEvidence || activeJob.current || activeEvidence.id.startsWith('test-') || ocrPreviewPending) return
    const controller = new AbortController()
    activeJob.current = controller
    try {
      setProcessing(true)
      const updated = await reprocessEvidence(activeEvidence, changes, { signal: controller.signal })
      throwIfAborted(controller.signal)
      await recordAudit('image_preprocessing_changed', { evidenceId: updated.id, rotation: updated.rotation, grayscale: updated.grayscale, contrast: updated.contrast })
      throwIfAborted(controller.signal)
      setEvidenceItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      invalidatePanelMeasurement(updated.id)
      setOcrWords((current) => current.filter((word) => word.panelId !== updated.id))
      if (!controller.signal.aborted) setOcrState((current) => ({ ...current, label: 'Image changed — previous text retained for reference; rerun OCR and verification.' }))
    } catch (error) {
      if (activeJob.current === controller) setOcrState((current) => ({ ...current, error: error.message || 'Image preprocessing failed.' }))
    } finally {
      if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) }
    }
  }

  const rectifyActiveEvidence = async (points) => {
    if (!activeEvidence || activeJob.current || activeEvidence.id.startsWith('test-') || ocrPreviewPending) return
    const controller = new AbortController()
    activeJob.current = controller
    try {
      setProcessing(true)
      setOcrState((current) => ({ ...current, label: 'Flattening selected panel plane', error: '' }))
      const updated = await rectifyEvidence(activeEvidence, points, { signal: controller.signal })
      throwIfAborted(controller.signal)
      await recordAudit('perspective_rectified', { evidenceId: updated.id, method: updated.perspective.method, outputWidth: updated.width, outputHeight: updated.height, sourcePoints: updated.perspective.points })
      throwIfAborted(controller.signal)
      setEvidenceItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      invalidatePanelMeasurement(updated.id)
      setOcrWords((current) => current.filter((word) => word.panelId !== updated.id))
      if (!controller.signal.aborted) setOcrState((current) => ({ ...current, label: 'Perspective flattened — rerun OCR for this panel', error: '' }))
    } catch (error) {
      if (activeJob.current === controller) setOcrState((current) => ({ ...current, error: error.message || 'Perspective flattening failed.' }))
    } finally {
      if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) }
    }
  }

  const removeEvidence = (id) => {
    if (activeJob.current || saved || saving || ocrPreviewPending) return
    const remaining = evidenceItems.filter((item) => item.id !== id)
    setEvidenceItems(remaining)
    if (activeEvidenceId === id) setActiveEvidenceId(remaining[0]?.id || '')
      setOcrWords((current) => current.filter((word) => word.panelId !== id))
    invalidatePanelMeasurement(id)
    recordAudit('evidence_removed_before_seal', { evidenceId: id })
  }

  const acknowledgeImageQuality = async (item) => {
    if (!item || !['review', 'poor'].includes(item.quality?.status)) return
    try {
      const identity = qualityIdentity(item)
      const at = new Date().toISOString()
      await recordAudit('image_quality_acknowledged', { evidenceId: item.id, originalSha256: item.sha256, qualityStatus: item.quality.status, qualityScore: item.quality.score, action: 'continue_with_caution', identity })
      setMeta((current) => ({ ...current, qualityAcknowledgements: { ...(current.qualityAcknowledgements || {}), [item.id]: { identity, status: item.quality.status, score: item.quality.score, action: 'continue_with_caution', at } } }))
      setOcrState((current) => ({ ...current, label: 'Image-quality caution recorded · OCR remains evidence for officer verification', error: '' }))
    } catch (error) { setOcrState((current) => ({ ...current, error: error.message || 'The quality acknowledgement could not be recorded.' })) }
  }

  const updateEvidenceRole = (id, panelRole) => {
    if (activeJob.current || saved || saving || ocrPreviewPending) return
    setEvidenceItems((current) => current.map((item) => item.id === id ? { ...item, panelRole } : item))
    recordAudit('evidence_role_changed', { evidenceId: id, panelRole })
  }

  const scanBarcode = async () => {
    if (!activeEvidence || activeJob.current) return
    const controller = new AbortController()
    activeJob.current = controller
    setProcessing(true)
    try {
      setBarcodeState({ message: 'Scanning the active panel…', error: false })
      const detected = await boundedOcr(detectBarcode(activeEvidence.analysisUrl), { signal: controller.signal, timeoutMs: 20000, label: 'Barcode detection' })
      throwIfAborted(controller.signal)
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
      if (activeJob.current === controller) setBarcodeState({ message: 'Barcode scan could not read this panel.', error: true, candidate: null })
    } finally {
      if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) }
    }
  }

  const rectifyFromBarcode = async () => {
    if (!activeEvidence || !barcodeState.candidate || barcodeState.candidate.evidenceId !== activeEvidence.id || activeJob.current || ocrPreviewPending) return
    const controller = new AbortController()
    activeJob.current = controller
    try {
      setProcessing(true)
      setOcrState((current) => ({ ...current, label: 'Flattening package plane from barcode geometry', error: '' }))
      const updated = await rectifyEvidenceFromBarcode(activeEvidence, barcodeState.candidate, { signal: controller.signal })
      throwIfAborted(controller.signal)
      await recordAudit('barcode_plane_rectified', { evidenceId: updated.id, format: barcodeState.candidate.format, sourcePoints: updated.perspective.points, absoluteScaleVerified: false })
      throwIfAborted(controller.signal)
      setEvidenceItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      invalidatePanelMeasurement(updated.id)
      setOcrWords((current) => current.filter((word) => word.panelId !== updated.id))
      throwIfAborted(controller.signal)
      setBarcodeState((current) => ({ ...current, candidate: null, message: `${current.message.split(' · ')[0]} · panel flattened; add a physical reference for millimetres` }))
      setOcrState((current) => ({ ...current, label: 'Barcode plane flattened — rerun OCR and calibrate absolute scale', error: '' }))
    } catch (error) {
      if (activeJob.current === controller) setOcrState((current) => ({ ...current, error: error.message || 'Barcode-plane flattening failed.' }))
    } finally {
      if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) }
    }
  }

  const autoDetectReference = async () => {
    if (!activeEvidence || activeJob.current) return
    const controller = new AbortController()
    activeJob.current = controller
    try {
      setProcessing(true)
      const detected = await boundedOcr(detectReferenceCard(activeEvidence.analysisUrl), { signal: controller.signal, timeoutMs: 20000, label: 'Reference detection' })
      throwIfAborted(controller.signal)
      if (!detected.detected) {
        setOcrState((current) => ({ ...current, error: 'No supported high-contrast reference card was detected. Use two-click calibration.' }))
        return
      }
      await recordAudit('reference_card_detected', { evidenceId: activeEvidence.id, referencePx: detected.pixelWidth, confidence: detected.confidence, referenceMm: meta.referenceMm })
      throwIfAborted(controller.signal)
      updatePanelMeasurement('referencePx', Number(detected.pixelWidth.toFixed(1)))
      setOcrState((current) => ({ ...current, label: `Reference detected at ${detected.confidence}% confidence`, error: '' }))
    } catch (error) {
      if (activeJob.current === controller) setOcrState((current) => ({ ...current, error: error.message || 'Reference-card detection failed.' }))
    } finally {
      if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) }
    }
  }

  const checkDepth = async () => {
    const state = await webXrDepthSupport()
    setDepthState({ supported: state.supported, message: state.reason })
    await recordAudit('depth_capability_checked', state)
  }

  const runStructuredOcr = async () => {
    if (!evidenceItems.length || qualityBlocked || ocrState.running || activeJob.current || ocrPreviewPending) return
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      setOcrState({ running: true, progress: 1, label: 'Preparing local label reading', error: '' })
      await recordAudit('ocr_requested', { panels: evidenceItems.length, provider: 'paddleocr-js', strategy: 'machine-structured-candidates-v1', imagesLeaveDevice: false })
      if (!current()) return
      const output = await runPaddleOcr({ evidenceItems, signal: controller.signal, onProgress: state => { if (current()) setOcrState(state) } })
      if (!current()) return
      const runId = crypto.randomUUID()
      const next = preparePaddleAppend({ evidenceItems, text, rawOcrText, output, runId, structured: true })
      await recordAudit('ocr_completed', { provider: 'paddleocr-js', model: output.model, detectionProfile: output.detectionProfile || 'baseline', detectionThresholds: output.detectionThresholds || null, strategy: 'machine-structured-candidates-v1', runId, reliability: null, engineConfidence: null, previousTranscriptPreserved: true, reviewedRows: [], candidateRows: next.candidateRows, workingMappings: next.workingMappings, warnings: next.warnings, requiresOfficerReview: true, rawHistoryUnchanged: true, rawPasses: output.items.map(item => ({ panelId: item.id, characters: item.text.length, lines: item.lines.length, source: item.source, crop: item.crop, detectionProfile: item.detectionProfile || 'baseline' })) })
      if (!current()) return
      setText(next.text); setRawOcrText(next.rawOcrText); setEvidenceItems(next.evidenceItems); setOcrWords(next.words)
      setMeta(previous => ({ ...invalidateCapturedEvidence(previous), fieldCandidates: fieldCandidates(next.evidenceItems.flatMap(item => item.ocrPasses || [])), ocrCompletedAt: new Date().toISOString(), ocrSource: 'local-paddle-structured', ocrReliabilityReason: 'Machine-generated heading/value candidates, not officer-verified readings. Raw characters are unchanged; spatial associations are heuristic. No validated accuracy score is available.' }))
      applyExtraction(extractDeclarations(next.text))
      setPaddleGuidance(output.items.flatMap(item => item.focusGuidance?.suggestions || []))
      setOcrState({ running: false, progress: 100, label: `Label fields ready · ${next.candidateRows.length} automatic layout association(s). Verify each value against the photo; unresolved readings stay unresolved.`, error: '' })
    } catch (error) {
      if (current()) setOcrState({ running: false, progress: 0, label: 'Label reading unavailable; previous evidence preserved', error: error.name === 'AbortError' ? '' : error.message })
    } finally { if (activeJob.current === controller) activeJob.current = null }
  }

  const runOcr = async (scanMode = 'standard') => {
    if (!evidenceItems.length || qualityBlocked || ocrState.running || activeJob.current || ocrPreviewPending) return
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      setOcrState({ running: true, progress: 1, label: 'Preparing local OCR', error: '' })
      await recordAudit('ocr_requested', { panels: evidenceItems.length, language: meta.ocrLanguage, strategy: scanMode })
      const output = await runLocalOcr({ evidenceItems, language: meta.ocrLanguage || 'eng', mode: scanMode, model: meta.ocrModel || 'fast', signal: controller.signal, onProgress: (state) => { if (current()) setOcrState(state) } })
      if (!current()) return
      validateOcrHistory(output.items)
      await recordAudit('ocr_completed', { panels: evidenceItems.length, reliability: output.reliability, engineConfidence: output.engineConfidence, wordBoxes: output.words.length, language: meta.ocrLanguage, strategy: output.strategy, model: output.model })
      if (!current()) return
      setText(output.text)
      setRawOcrText(output.text)
      setOcrWords(output.words)
      setEvidenceItems(output.items)
      setMeta((previous) => ({ ...invalidateCapturedEvidence(previous), fieldCandidates: fieldCandidates(output.items.flatMap((item) => item.ocrPasses)), ocrConfidence: output.reliability, ocrEngineConfidence: output.engineConfidence, ocrCompletedAt: new Date().toISOString(), ocrReliabilityReason: 'Unvalidated OCR heuristic. Compare each field with its image; repeated readings can share the same error.', ocrSource: scanMode === 'deep' ? 'local-deep' : 'local' }))
      applyExtraction(extractDeclarations(output.text))
      if (current()) setOcrState({ running: false, progress: 100, label: `${scanMode === 'deep' ? 'Deep scan' : 'OCR'} complete across ${evidenceItems.length} panel${evidenceItems.length > 1 ? 's' : ''} — verify evidence`, error: '' })
    } catch (error) {
      if (activeJob.current === controller) setOcrState({ running: false, progress: 0, label: error.name === 'AbortError' ? 'OCR cancelled; previous evidence preserved' : 'OCR unavailable; previous evidence preserved', error: error.name === 'AbortError' ? '' : error.message })
    } finally {
      if (activeJob.current === controller) activeJob.current = null
    }
  }

  const runConnectedOcr = async () => {
    if (workspace?.offlineOnly) return
    if (!evidenceItems.length || qualityBlocked || ocrState.running || activeJob.current || ocrPreviewPending) return
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      setOcrState({ running: true, progress: 3, label: 'Requesting opt-in connected OCR', error: '' })
      await recordAudit('connected_ocr_requested', { panels: evidenceItems.length, provider: 'google-vision', explicitOptIn: true })
      const packets = []
      const confidences = []
      const reliabilities = []
      const connectedWords = []
      const recognizedItems = []
      const connectedRunId = crypto.randomUUID()
      for (let index = 0; index < evidenceItems.length; index += 1) {
        throwIfAborted(controller.signal)
        const item = evidenceItems[index]
        setOcrState({ running: true, progress: Math.round((index / evidenceItems.length) * 85) + 5, label: `Connected OCR · panel ${index + 1}/${evidenceItems.length}`, error: '' })
        const headers = workspace ? await boundedOcr(workspace.api.headers(), { signal: controller.signal, timeoutMs: 15000, label: 'Workspace authorization' }) : { 'Content-Type': 'application/json' }
        const response = await boundedOcr(fetch('/api/ocr', {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({ image: item.analysisUrl, language: meta.ocrLanguage || 'eng' }),
        }), { signal: controller.signal, timeoutMs: 35000, label: 'Connected OCR' })
        const payload = await boundedOcr(response.json(), { signal: controller.signal, timeoutMs: 10000, label: 'Connected OCR response' }).catch((error) => { if (error instanceof SyntaxError) throw new Error('OCR backend is not configured on this server.'); throw error })
        throwIfAborted(controller.signal)
        if (!response.ok) throw new Error(payload.error || `Connected OCR returned HTTP ${response.status}.`)
        const connectedText = String(payload.text || '').trim()
        if (!connectedText || connectedText.length > MAX_EVIDENCE_TEXT || !Array.isArray(payload.words) || payload.words.length > 20000) throw new Error('OCR provider returned empty or oversized evidence.')
        const mergedText = mergeOcrPassTexts([item.ocrText || '', connectedText])
        const engineConfidence = payload.confidenceAvailable !== false && typeof payload.confidence === 'number' && Number.isFinite(payload.confidence) ? Math.max(0, Math.min(100, payload.confidence)) : null
        const qualityScore = Math.max(0, Math.min(100, Number(item.quality?.score || 0)))
        const reliability = engineConfidence === null ? null : Number(Math.min(98, engineConfidence * .8 + qualityScore * .2).toFixed(1))
        const words = (payload.words || []).map((word) => ({ ...word, panelId: item.id }))
        packets.push(`[PANEL ${index + 1}: ${item.name}]\n${mergedText}`)
        confidences.push(engineConfidence)
        reliabilities.push(reliability)
        connectedWords.push(...words)
        const panel = appendOcrHistory(item, { text: mergedText, passes: [{ id: `${item.id}:google-vision:${connectedRunId}`, text: connectedText, confidence: engineConfidence, provider: 'google-vision', strategy: 'connected' }], words })
        recognizedItems.push({
          ...panel,
          connectedOcrText: connectedText,
          ocrProvider: payload.provider || 'google-vision',
          ocrConfidence: engineConfidence,
          ocrReliability: reliability,
          ocrWords: panel.ocrWords,
        })
      }
      const combinedText = packets.join('\n\n')
      validateOcrHistory(recognizedItems)
      if (combinedText.length > MAX_EVIDENCE_TEXT) throw new Error('Combined OCR exceeds the evidence text limit.')
      const average = (values) => values.length && values.every((value) => typeof value === 'number' && Number.isFinite(value)) ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null
      const engineConfidence = average(confidences)
      const reliability = average(reliabilities)
      const reliabilityReason = reliability === null ? 'Provider confidence is unavailable; no inspection-wide OCR score can be established.' : 'Unvalidated provider/capture heuristic, not accuracy. Verify each decisive value against its photograph.'
      if (!current()) return
      await recordAudit('connected_ocr_completed', { panels: evidenceItems.length, provider: 'google-vision', reliability, engineConfidence, wordBoxes: connectedWords.length })
      if (!current()) return
      setText(combinedText)
      setOcrWords(recognizedItems.flatMap((item) => item.ocrWords))
      setRawOcrText(combinedText)
      setEvidenceItems(recognizedItems)
      setMeta((previous) => ({ ...invalidateCapturedEvidence(previous), fieldCandidates: fieldCandidates(recognizedItems.flatMap((item) => item.ocrPasses)), ocrConfidence: reliability, ocrEngineConfidence: engineConfidence, ocrCompletedAt: new Date().toISOString(), ocrReliabilityReason: reliabilityReason, ocrSource: 'google-vision' }))
      applyExtraction(extractDeclarations(combinedText))
      if (current()) setOcrState({ running: false, progress: 100, label: `Connected OCR complete across ${evidenceItems.length} panel${evidenceItems.length > 1 ? 's' : ''} — verify evidence`, error: '' })
    } catch (error) {
      if (current()) {
        await recordAudit('connected_ocr_failed', { provider: 'google-vision', reason: error.message || 'unknown error' })
        if (current()) setOcrState({ running: false, progress: 0, label: 'Connected OCR unavailable; local evidence preserved', error: `${error.message || 'Connected OCR failed.'} Run browser OCR or deep scan to remain fully offline.` })
      }
    } finally {
      controller.abort()
      if (activeJob.current === controller) activeJob.current = null
    }
  }

  const runFocusedOcr = async () => {
    if (qualityBlocked || !activeEvidence || !focusSelection || activeJob.current || ocrPreviewPending || focusSelection.imageUrl !== activeEvidence.analysisUrl || focusSelection.panelId !== activeEvidence.id) return
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      setFocusResult(null)
      setOcrState({ running: true, progress: 1, label: 'Preparing high-resolution declaration crop', error: '' })
      await recordAudit('focus_ocr_requested', { evidenceId: activeEvidence.id, crop: focusSelection.rect, originalSha256: activeEvidence.sha256, officerSelected: true })
      const variants = await boundedOcr(createFocusedVariants(activeEvidence, focusSelection.rect), { signal: controller.signal, timeoutMs: 25000, label: 'Focus crop preparation' })
      const output = await runLocalOcr({ evidenceItems: [activeEvidence], language: meta.ocrLanguage || 'eng', mode: 'focused', signal: controller.signal, variantFactory: () => variants, onProgress: (state) => { if (current()) setOcrState(state) } })
      if (!current()) return
      setFocusResult({ panelId: activeEvidence.id, imageUrl: activeEvidence.analysisUrl, crop: focusSelection.rect, source: variants[0].source, preview: variants[0].dataUrl, output, runId: crypto.randomUUID() })
      setOcrState({ running: false, progress: 100, label: 'Focus OCR ready for review — transcript not changed', error: '' })
    } catch (error) {
      if (current()) setOcrState({ running: false, progress: 0, label: 'Focus OCR unavailable; previous evidence preserved', error: error.message })
    } finally {
      if (activeJob.current === controller) activeJob.current = null
    }
  }

  const appendFocusResult = async () => {
    if (!focusResult || activeJob.current || focusResult.panelId !== activeEvidence?.id || focusResult.imageUrl !== activeEvidence?.analysisUrl) return
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      setProcessing(true)
      const item = focusResult.output.items[0]
      const next = appendFocusedTranscript({ text, rawOcrText, focusedText: item.ocrText, panelIndex: evidenceItems.findIndex((panel) => panel.id === item.id) })
      const passes = item.ocrPasses.map((pass) => ({ ...pass, id: `${pass.id}:${focusResult.runId}` }))
      const nextItems = evidenceItems.map((panel) => panel.id === item.id ? appendOcrHistory(panel, { text: [panel.ocrText, item.ocrText].filter(Boolean).join('\n\n'), passes, words: item.ocrWords }) : panel)
      validateOcrHistory(nextItems)
      await recordAudit('ocr_completed', { strategy: 'officer-selected-focus-append', evidenceId: item.id, crop: focusResult.crop, source: focusResult.source, runId: focusResult.runId, reliability: null, engineConfidence: null, cropEngineConfidence: item.ocrConfidence, previousTranscriptPreserved: true, rawPasses: passes.map(({ id, text }) => ({ id, characters: text.length })) })
      if (!current()) return
      setText(next.text); setRawOcrText(next.rawOcrText); setEvidenceItems(nextItems)
      setOcrWords((words) => [...words, ...item.ocrWords])
      setMeta((previous) => ({ ...invalidateCapturedEvidence(previous), fieldCandidates: fieldCandidates(nextItems.flatMap((panel) => panel.ocrPasses || [])), ocrCompletedAt: new Date().toISOString(), ocrSource: 'local-focus', ocrReliabilityReason: 'Focused OCR covers only the selected crop. No full-inspection score is inferred; verify every field against its original panel.' }))
      applyExtraction(extractDeclarations(next.text))
      setFocusResult(null)
      setOcrState({ running: false, progress: 100, label: 'Crop OCR appended without rewriting earlier text. Reverify fields and resolve conflicts.', error: '' })
    } catch (error) { if (current()) setOcrState((state) => ({ ...state, error: error.message })) }
    finally { if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) } }
  }

  const runAlternativeOcr = async (focused = false, suggestion = null, retryMode = null, detectionProfile = 'baseline') => {
    if (!evidenceItems.length || qualityBlocked || activeJob.current || ocrPreviewPending) return
    if (suggestion && (!focused || paddlePreview)) return
    if (focused && !suggestion && (!activeEvidence || !focusSelection || focusSelection.panelId !== activeEvidence.id || focusSelection.imageUrl !== activeEvidence.analysisUrl)) return
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      const resolvedFocus = suggestion ? resolvePaddleFocusSuggestion({ suggestions: paddleGuidance, suggestionId: suggestion.id, evidenceItems }) : null
      const selectedSuggestion = resolvedFocus?.suggestion || null
      const focusPanel = resolvedFocus?.panel || activeEvidence
      const selection = selectedSuggestion || focusSelection
      setPaddlePreview(null)
      setOcrState({ running: true, progress: 1, label: 'Preparing optional local Paddle OCR', error: '' })
      await recordAudit('alternative_ocr_requested', { provider: 'paddleocr-js', panels: focused ? 1 : evidenceItems.length, imagesLeaveDevice: false, crop: focused ? selection.rect : null, retryMode, detectionProfile, focusMethod: selectedSuggestion ? 'heading-guided-focus-v1-officer-selected' : focused ? 'officer-selected-rectangle' : null, headingIds: selectedSuggestion?.headingIds || [] })
      const inputOptions = retryMode ? { inputFactory: item => createPaddleRetryInput(item, retryMode, focused ? selection.rect : null) } : focused ? { inputFactory: item => createPaddleFocusInput(item, selection.rect) } : {}
      const output = await runPaddleOcr({ evidenceItems: focused ? [focusPanel] : evidenceItems, ...inputOptions, detectionProfile, signal: controller.signal, onProgress: state => { if (current()) setOcrState(state) } })
      if (!current()) return
      const { proposals, warnings } = collectPaddleLayoutProposals(output.items)
      setPaddlePreview({ output, proposals, layoutWarning: warnings.join(' '), runId: crypto.randomUUID(), guidedSuggestionId: selectedSuggestion?.id || null })
      setOcrState({ running: false, progress: 100, label: 'Paddle preview ready — earlier evidence is unchanged', error: '' })
    } catch (error) {
      if (current()) setOcrState({ running: false, progress: 0, label: 'Alternative OCR unavailable; previous evidence preserved', error: error.name === 'AbortError' ? '' : error.message })
    } finally { if (activeJob.current === controller) activeJob.current = null }
  }

  const appendAlternativeOcr = async (proposedRows = []) => {
    if (!paddlePreview || activeJob.current) return
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      setProcessing(true)
      const next = preparePaddleAppend({ evidenceItems, text, rawOcrText, output: paddlePreview.output, runId: paddlePreview.runId, proposedRows })
      await recordAudit('ocr_completed', { provider: 'paddleocr-js', model: paddlePreview.output.model, detectionProfile: paddlePreview.output.detectionProfile || 'baseline', detectionThresholds: paddlePreview.output.detectionThresholds || null, strategy: 'officer-reviewed-alternative-append', runId: paddlePreview.runId, reliability: null, engineConfidence: null, previousTranscriptPreserved: true, reviewedRows: next.reviewedRows, workingMappings: next.workingMappings, rawHistoryUnchanged: true, rawPasses: paddlePreview.output.items.map(item => ({ panelId: item.id, characters: item.text.length, lines: item.lines.length, crop: item.crop, source: item.source })) })
      if (!current()) return
      setText(next.text); setRawOcrText(next.rawOcrText); setEvidenceItems(next.evidenceItems); setOcrWords(next.words)
      setMeta(previous => ({ ...invalidateCapturedEvidence(previous), fieldCandidates: fieldCandidates(next.evidenceItems.flatMap(item => item.ocrPasses || [])), ocrCompletedAt: new Date().toISOString(), ocrSource: 'local-paddle', ocrReliabilityReason: 'Alternative engine reading appended. Raw transcripts and selected layout derivations remain separate. No validated inspection-wide accuracy score is available.' }))
      applyExtraction(extractDeclarations(next.text))
      if (paddlePreview.guidedSuggestionId) setPaddleGuidance(previous => previous.filter(item => item.id !== paddlePreview.guidedSuggestionId))
      else if (paddlePreview.output.items.some(item => !item.crop)) setPaddleGuidance(paddlePreview.output.items.flatMap(item => item.focusGuidance?.suggestions || []))
      setPaddlePreview(null)
      setOcrState({ running: false, progress: 100, label: 'Paddle reading appended. Reverify each field and resolve any conflicts.', error: '' })
    } catch (error) { if (current()) setOcrState(state => ({ ...state, error: error.message })) }
    finally { if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) } }
  }

  const applyRawPassSelection = async ({ selections, reason }) => {
    if (activeJob.current || saved || saving || ocrPreviewPending) return false
    const controller = new AbortController()
    activeJob.current = controller
    const current = () => activeJob.current === controller && !controller.signal.aborted
    try {
      setProcessing(true)
      const next = prepareOcrPassSelection({ evidenceItems, selections, reason })
      await recordAudit('working_ocr_passes_selected', { ...next.auditPayload, previousWorkingText: text })
      if (!current()) return false
      setText(next.text)
      setMeta(previous => ({ ...invalidateCapturedEvidence(previous), fieldCandidates: fieldCandidates(evidenceItems.flatMap(item => item.ocrPasses || [])), ocrSource: 'officer-selected-raw-passes', ocrCompletedAt: previous.ocrCompletedAt, ocrReliabilityReason: 'An officer selected existing raw readings for the working transcript. Excluded readings remain in raw history; no new OCR inference or accuracy score is claimed.' }))
      applyExtraction(extractDeclarations(next.text))
      setOcrState({ running: false, progress: 100, label: 'Working readings selected. Raw history preserved; reverify every decisive field.', error: '' })
      return true
    } catch (error) {
      if (current()) setOcrState(state => ({ ...state, error: error.message }))
      return false
    } finally { if (activeJob.current === controller) { activeJob.current = null; setProcessing(false) } }
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
      if (ocrPreviewPending) throw new Error('Append or dismiss the pending OCR preview before finalizing this inspection.')
      validateSealableEvidence({ evidenceItems, text, processing, ocrRunning: ocrState.running })
      setSaving(true)
      const finalChain = await recordAudit('inspection_sealed', { inspectionId, status: result.status, score: result.score, evidencePanels: evidenceItems.length })
      const record = { ...buildRecord(finalChain), auditVerified: await verifyAuditChain(finalChain) }
      const storedRecord = await onSaveRecord(record)
      setSealedRecord(storedRecord || record)
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
          <span className="eyebrow">EVIDENCE-GRADE INSPECTION</span>
          <h2>From package image to defensible evidence.</h2>
          <p>Capture real panels, preserve OCR alternatives, verify every decisive field, measure physical typography and seal a reviewable record.</p>
        </div>
        <div className="intro-stamp">
          <SearchCheck size={24} />
          <span>OCR proposes<br />Officer decides</span>
        </div>
      </div>
      <ChallengeClock challenge={challenge} />
      <div className="draft-bar" role="status">{draft ? <><span>An unfinished inspection is available.</span><button onClick={restoreDraft}>Restore draft</button><button onClick={async () => { try { await store.remove('drafts', 'active'); setDraft(null) } catch (error) { setDraftMessage(error.message) } }}>Discard unfinished draft</button></> : draftMessage || 'Drafts save automatically on this device after capture.'}{saved && <><button onClick={() => onOpenReport(sealedRecord)}>Open sealed report</button><button onClick={onNewInspection}>Start new inspection</button></>}</div>
      <InspectionProgress evidenceItems={evidenceItems} extraction={extraction} provenance={provenance} meta={meta} result={result} saved={saved} />
      {(processing || ocrState.running) && <div className="processing-banner" role="status"><LoaderCircle className="spin" size={18} /><span>{ocrState.label}<small>Work is time-limited. Cancellation prevents pending results from replacing evidence.</small></span><button type="button" onClick={cancelActiveJob}>Cancel current operation</button></div>}
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
                onChange={(event) => {
                  const replaceId = pendingRetakeId.current
                  const captureTarget = pendingCaptureTarget.current
                  pendingRetakeId.current = ''
                  pendingCaptureTarget.current = ''
                  handleFiles(event.target.files, { replaceId, captureTarget })
                }}
              />
              <button type="button" className="upload-button" onClick={() => openEvidencePicker()} disabled={evidenceItems.length >= 4 || processing || ocrPreviewPending}>
                {processing ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
                {evidenceItems.length ? `Add package panel (${evidenceItems.length}/4)` : 'Capture / upload package'}
              </button>
              <button type="button" className="barcode-button" onClick={scanBarcode} disabled={!activeEvidence}><Barcode size={16} /> Read barcode</button>
              {barcodeState.candidate?.evidenceId === activeEvidence?.id && barcodeState.candidate?.cornerPoints?.length === 4 && <button type="button" className="barcode-button" onClick={rectifyFromBarcode} disabled={processing || ocrPreviewPending}><Layers3 size={16} /> Flatten from barcode</button>}
            </div>
            <CaptureChecklist evidenceItems={evidenceItems} />
            <CaptureCoach hasImage={Boolean(evidenceItems.length)} hasText={Boolean(text.trim())} extraction={extraction} disabled={saved || saving || processing || ocrState.running || Boolean(draft)} pendingPreview={ocrPreviewPending} canAddPhoto={evidenceItems.length < 4} onRecapture={target => openEvidencePicker('', target.id)} onFocus={(target) => { setFocusSelection(null); setActiveRegionId(target.id); setFocusRequest({ id: crypto.randomUUID(), fieldId: target.id }) }} />
            {evidenceItems.length > 0 && <PackageEvidenceViewer
              evidenceItems={evidenceItems}
              activeEvidenceId={activeEvidence?.id || ''}
              processing={processing || ocrState.running}
              locked={saved || saving || processing || ocrState.running || Boolean(draft) || ocrPreviewPending}
              sealed={saved}
              onSelectEvidence={(id) => { if (!activeJob.current && !ocrPreviewPending) setActiveEvidenceId(id) }}
              onCapture={() => openEvidencePicker()}
            />}
            {evidenceItems.length > 0 && <fieldset className="studio-lock" disabled={ocrPreviewPending}><CalibrationBoard
              evidenceItems={evidenceItems}
              activeEvidence={activeEvidence}
              meta={meta}
              onMeasure={updatePanelMeasurement}
              onActive={(id) => { if (!activeJob.current && !ocrPreviewPending) setActiveEvidenceId(id) }}
              onRemove={removeEvidence}
              onRetake={(id) => openEvidencePicker(id)}
              onQualityAcknowledge={acknowledgeImageQuality}
              qualityAcknowledged={Boolean(activeEvidence && meta.qualityAcknowledgements?.[activeEvidence.id]?.identity === qualityIdentity(activeEvidence))}
              onTransform={transformActiveEvidence}
              onRectify={rectifyActiveEvidence}
              onRoleChange={updateEvidenceRole}
              processing={processing}
              locked={saved || saving || processing || ocrState.running || Boolean(draft) || ocrPreviewPending}
              regions={regions}
              activeRegionId={activeRegionId}
              onRegionSelect={setActiveRegionId}
              onDetectReference={autoDetectReference}
              onCheckDepth={checkDepth}
              depthState={depthState}
              onFocusSelect={(rect) => { setFocusSelection({ panelId: activeEvidence.id, imageUrl: activeEvidence.analysisUrl, rect }); setFocusResult(null) }}
              focusRequest={focusRequest}
            /></fieldset>}
            {focusSelection && <section ref={focusCardRef} tabIndex={-1} className="focus-ocr-card" aria-label="Focused OCR rescan">
              <h4>Read one declaration at full resolution</h4>
              <p>Include the heading, value and unit. Three real OCR passes keep conflicting readings visible. This does not replace the original photo or certify the result.</p>
              <button type="button" className="secondary-action" onClick={runFocusedOcr} disabled={qualityBlocked || ocrState.running || ocrPreviewPending}>Scan selected region</button>
              <button type="button" className="secondary-action" onClick={() => runAlternativeOcr(true)} disabled={qualityBlocked || ocrState.running || ocrPreviewPending}>Try Paddle on selected region</button>
              <button type="button" className="secondary-action" onClick={() => runAlternativeOcr(true, null, null, 'sensitive')} disabled={qualityBlocked || ocrState.running || ocrPreviewPending}>Retry faint text in selected region</button>
              <PaddleStampRecovery onlyRegion disabled={qualityBlocked || ocrState.running || ocrPreviewPending} hasRegion onRun={(focused, mode) => runAlternativeOcr(focused, null, mode)} />
              {ocrPreviewPending && <p role="status">Append or dismiss the pending preview before scanning again. Your current transcript has not changed.</p>}
              {focusResult && <>
                <img src={focusResult.preview} alt="Selected declaration crop used for OCR" />
                <small>Source: {focusResult.source} · merged crop reading below; unedited passes in details.</small>
                <pre>{focusResult.output.items[0].ocrText}</pre>
                <details><summary>Inspect all three raw OCR passes</summary>{focusResult.output.items[0].ocrPasses.map((pass) => <div key={pass.id}><b>{pass.id.split(':')[1]}</b><pre>{pass.text || '(no text)'}</pre></div>)}</details>
                <button type="button" className="primary-action" onClick={appendFocusResult}>Append crop OCR to evidence</button>
                <button type="button" className="secondary-action" onClick={() => setFocusResult(null)}>Dismiss crop preview</button>
                <p>Earlier text and corrections are retained. Field, placement and measurement confirmations are reset. A partial crop cannot establish full-package compliance.</p>
              </>}
            </section>}
            {!challenge?.active && !workspace && <details className="test-aids">
              <summary><Sparkles size={14} /> Controlled test packets</summary>
              <div className="demo-actions">
                <button type="button" onClick={() => applyDemo(DEMOS.risky)} disabled={processing || ocrState.running || ocrPreviewPending}>Violation packet</button>
                <button type="button" onClick={() => applyDemo(DEMOS.compliant)} disabled={processing || ocrState.running || ocrPreviewPending}>Compliant packet</button>
                <button type="button" onClick={() => applyDemo(DEMOS.exempt)} disabled={processing || ocrState.running || ocrPreviewPending}>Rule 26 exemption packet</button>
              </div>
            </details>}
          </section>

          {evidenceItems.length > 0 && <section className="workflow-step">
            <StepHeader
              number="02"
              icon={ScanLine}
              title="OCR and verify structured declarations"
              copy="Read the original panels locally, associate headings with values, then verify the machine candidates against the photos."
              complete={Boolean(text.trim())}
            />
            <div className="ocr-toolbar">
              <button type="button" className="ocr-button" onClick={runStructuredOcr} disabled={!evidenceItems.length || qualityBlocked || ocrState.running || ocrPreviewPending} title="On-device Paddle recognition and unverified geometric field candidates. Load model assets online before use; the verified offline pack covers classic Run browser OCR, not Paddle.">
                {ocrState.running ? <LoaderCircle className="spin" size={17} /> : <ScanLine size={17} />}
                {ocrState.running ? 'Reading label…' : 'Read label fields'}
              </button>
              <button type="button" className="deep-ocr-button" onClick={() => runOcr('standard')} disabled={!evidenceItems.length || qualityBlocked || ocrState.running || ocrPreviewPending} title="Classic Tesseract transcript scan using the language selected in More OCR options. This replaces the working transcript; raw pass history remains in captured evidence.">Run browser OCR</button>
              <details className="ocr-advanced"><summary>More OCR options</summary><div className="ocr-advanced-actions">
              <button type="button" className="deep-ocr-button" onClick={() => runOcr('deep')} disabled={!evidenceItems.length || qualityBlocked || ocrState.running || ocrPreviewPending}>
                <SearchCheck size={17} /> Deep scan small text
              </button>
              <button type="button" className="deep-ocr-button" onClick={() => runAlternativeOcr(false)} disabled={!evidenceItems.length || qualityBlocked || ocrState.running || ocrPreviewPending} title="Optional local PP-OCRv6 small model. First use loads additional assets; output is previewed before append. Not a validated accuracy upgrade."><Layers3 size={17} /> Try Paddle OCR · local</button>
              <button type="button" className="deep-ocr-button" onClick={() => runAlternativeOcr(false, null, null, 'sensitive')} disabled={!evidenceItems.length || qualityBlocked || ocrState.running || ocrPreviewPending} title="Lower detection thresholds can find faint stamps but also add noise. Preview the new reading before appending; previous evidence is retained."><SearchCheck size={17} /> Retry faint stamp detection</button>
              <button type="button" className="connected-ocr-button" onClick={runConnectedOcr} disabled={!evidenceItems.length || qualityBlocked || ocrState.running || ocrPreviewPending || workspace?.offlineOnly} title="Explicitly sends processed panels to the configured Google Vision backend">
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
              </div><small>Read label fields uses the local Paddle model and geometry; first load downloads model assets. Language selection applies to classic browser OCR and deep scan. Sensitive detection adds noise and requires preview review. Connected OCR needs a configured provider and explicit upload consent.</small>
              <PaddleStampRecovery disabled={!evidenceItems.length || qualityBlocked || ocrState.running || ocrPreviewPending} hasRegion={Boolean(activeEvidence && focusSelection?.panelId === activeEvidence.id && focusSelection?.imageUrl === activeEvidence.analysisUrl)} onRun={(focused, mode) => runAlternativeOcr(focused, null, mode)} />
              </details>
              <div className="ocr-progress">
                <div><span style={{ width: `${ocrState.progress}%` }} /></div>
                <small>{ocrState.label}</small>
              </div>
              <span className="confidence-chip">{provenance.hasRun ? `Reliability ${provenance.reliability?.toFixed(0) ?? '—'}% · engine ${provenance.engineConfidence?.toFixed(0) ?? '—'}%` : 'OCR not run · confidence unavailable'}</span>
            </div>
            {qualityBlocked && <div className="inline-warning quality-blocked"><ShieldAlert size={17} /><span>OCR is paused because one or more panels need an explicit image-quality decision. Retake the panel or record “Continue with caution”; the choice becomes part of the audit trail.</span></div>}
            <p className="connected-ocr-disclosure"><LockKeyhole size={13} /> Browser OCR is the private default. Connected OCR sends processed panels to Google Vision only when you click it and requires workspace sign-in. Sealing in a managed workspace uploads evidence to private storage. Reliability percentages below are unvalidated heuristics, not accuracy probabilities.</p>
            {ocrState.error && <div className="inline-warning"><AlertTriangle size={17} />{ocrState.error}</div>}
            <MachineCandidateHistory auditChain={auditChain} />
            {paddlePreview && <PaddleReview key={paddlePreview.runId} preview={paddlePreview} currentText={text} onAppend={appendAlternativeOcr} onDismiss={() => setPaddlePreview(null)} />}
            <PaddleFocusGuidance suggestions={paddleGuidance} onScan={suggestion => runAlternativeOcr(true, suggestion)} pendingPreview={ocrPreviewPending} />
            <DeclarationCoverage extraction={extraction} reliability={provenance.reliability} engineConfidence={provenance.engineConfidence} reliabilityReason={meta.ocrReliabilityReason} hasOcrRun={provenance.hasRun} />
            <textarea
              className="evidence-editor"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MAX_EVIDENCE_TEXT}
              aria-label="Declaration evidence text"
              placeholder="Extracted label text will appear here. You may paste or correct evidence manually."
              spellCheck="false"
            />
            <ExtractionWorkbench extraction={extraction} onApply={applyExtraction} barcodeState={barcodeState} regions={regions} evidenceItems={evidenceItems} activeFieldId={activeRegionId} onSelectRegion={(id) => { const region = regions.find((item) => item.id === id); if (region) setActiveEvidenceId(region.panelId); setActiveRegionId(id) }} meta={meta} />
            <EvidenceTracePanel fieldId={activeRegionId} extraction={extraction} regions={regions} evidenceItems={evidenceItems} result={result} meta={meta} onLocate={(id) => { const region = regions.find((item) => item.id === id); if (region) setActiveEvidenceId(region.panelId); setActiveRegionId(id) }} />
            {rawOcrText && <details><summary>Original OCR transcript (not edited)</summary><pre className="transcript-original">{rawOcrText}</pre></details>}
            <OcrPassSelection evidenceItems={evidenceItems} onApply={applyRawPassSelection} disabled={ocrPreviewPending || saved || saving || processing || ocrState.running} />
            {text.trim() && <FieldVerification extraction={extraction} meta={meta} onChange={updateMeta} />}
            {text.trim() && <PlacementReview extraction={extraction} meta={meta} evidenceItems={evidenceItems} onChange={updateMeta} result={result} />}
            <details className="optional-notes"><summary>Optional interpretation note</summary><div className="translation-panel">
              <header><Languages size={17} /><div><strong>Officer interpretation</strong><small>Original OCR evidence is preserved; this note never replaces it.</small></div></header>
              <div>
                <select value={meta.translationLanguage} onChange={(event) => updateMeta('translationLanguage', event.target.value)} aria-label="Interpretation language">
                  <option value="en">English interpretation</option><option value="hi">Hindi interpretation</option><option value="te">Telugu interpretation</option><option value="ta">Tamil interpretation</option>
                </select>
                <textarea value={meta.translationText} onChange={(event) => updateMeta('translationText', event.target.value)} placeholder="Optional officer translation or clarification…" />
              </div>
            </div></details>
          </section>}

          {evidenceItems.length > 0 && <section className="workflow-step">
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
              <Field label="Chapter II consumer scope">
                <select aria-label="Chapter II consumer scope" value={meta.rule3ConsumerScope || 'unknown'} onChange={event => updateMeta('rule3ConsumerScope', event.target.value)}>
                  <option value="unknown">Not established — review</option><option value="retail">Retail consumer</option><option value="industrial">Industrial consumer</option><option value="institutional">Institutional consumer</option>
                </select>
              </Field>
              <Field label="Rule 3 commodity group">
                <select aria-label="Rule 3 commodity group" value={meta.rule3CommodityClass || 'unknown'} onChange={event => updateMeta('rule3CommodityClass', event.target.value)}>
                  <option value="unknown">Not established — review if relevant</option><option value="ordinary">Ordinary commodity</option><option value="cement">Cement</option><option value="fertilizer">Fertilizer</option><option value="agricultural_farm_produce">Agricultural farm produce</option>
                </select>
              </Field>
              <label className="toggle-field rule-scope-note"><input type="checkbox" checked={meta.rule3ApplicabilityConfirmed === true} onChange={event => updateMeta('rule3ApplicabilityConfirmed', event.target.checked)} /><span>I checked Rule 3 scope, quantity and purchase context against the package. An industrial/institutional buyer name alone does not establish the statutory exclusion. Outside Chapter II is not clearance under other laws.</span></label>
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
          </section>}
        </div>

        {evidenceItems.length > 0 ? <VerdictPanel
          result={result}
          saved={saved}
          saving={saving}
          pendingPreview={ocrPreviewPending}
          evidenceCount={evidenceItems.length}
          onSave={save}
          onReport={() => onOpenReport(buildRecord())}
        /> : <aside className="inspection-empty-next"><span className="eyebrow">YOUR NEXT STEP</span><h3>Capture first. Review what the image says.</h3><p>OCR, field verification and rule controls appear after a photograph is attached. No package verdict is issued from an empty form.</p><p>Have the physical package ready. Tiny price/date print may need a separate close-up.</p></aside>}
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
  const passRate = total ? `${Math.round(((totals.compliant + totals.exempt) / total) * 100)}%` : '—'

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
        <MetricCard icon={BadgeCheck} label="Cleared / exempt" value={passRate} copy={total ? 'Across evaluated local records' : 'Unavailable · no recorded denominator'} tone="green" />
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
          <header><div><span className="eyebrow">SYSTEM CAPABILITIES</span><h3>Implemented prototype scope</h3></div><ShieldCheck size={23} /></header>
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

function HistoryPage({ history, onOpenReport, onVerifyCloud, reportBusy, onNavigate }) {
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
          {onVerifyCloud && <p>Verify cloud copy downloads a fresh server snapshot and both images without using or deleting the local image cache.</p>}
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
              <div className="record-score"><b>{item.result.score}%</b><span>checks passed</span></div>
              <StatusPill status={effectiveStatus(item)} />
              <div className="record-actions">
                <button type="button" className="open-record" disabled={reportBusy} onClick={() => onOpenReport(item)}>Open evidence <ArrowRight size={16} /></button>
                {onVerifyCloud && item.serverVersion > 0 && <button type="button" className="verify-cloud-record" disabled={reportBusy || item.syncState !== 'synced'} title="Fetch fresh server metadata and original/analysis images. Local evidence and unsent reviews are left untouched." onClick={() => onVerifyCloud(item)}><ShieldCheck size={16} /> Verify cloud copy</button>}
              </div>
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
  const [message, setMessage] = useState('Synthetic rule/parser fixtures loaded. Field-accuracy claims require independently checked labels and an untouched product-level holdout; importing a file does not prove either.')
  const inputRef = useRef(null)
  const metrics = useMemo(() => runBenchmark(samples), [samples])
  const percentage = (value) => value == null ? 'N/A' : `${Math.round(value * 100)}%`

  const importDataset = async (file) => {
    if (!file) return
    try {
      if (file.size > 5_000_000) throw new Error('Benchmark upload exceeds the 5 MB file limit.')
      const parsed = parseBenchmarkFile(await file.text(), file.name)
      setSamples(parsed)
      setMessage(`${parsed.length} imported records loaded. Only supplied labels contribute to accuracy; their correctness and independence have not been verified.`)
    } catch (error) {
      setMessage(`Import failed: ${error.message}`)
    } finally { if (inputRef.current) inputRef.current.value = '' }
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
        <MetricCard icon={SearchCheck} label="Verdict accuracy" value={percentage(metrics.statusAccuracy)} copy={`${metrics.statusSamples ?? metrics.sampleCount} verdict-labelled records`} tone="green" />
        <MetricCard icon={BadgeCheck} label="Field detection F1" value={percentage(metrics.f1)} copy={`Presence only · P ${percentage(metrics.precision)} · R ${percentage(metrics.recall)}`} />
        <MetricCard icon={ClipboardCheck} label="Extracted-value accuracy" value={metrics.valueAccuracy === null ? 'N/A' : percentage(metrics.valueAccuracy)} copy={metrics.valueSamples ? `${metrics.valueSamples} labelled field values` : 'Add expectedValues labels to compute'} />
        <MetricCard icon={XCircle} label="False violations" value={percentage(metrics.falseViolationRate)} copy={`${metrics.falseViolations ?? 0} / ${metrics.falseViolationSamples ?? 0} labelled clear, exempt or review cases`} tone="red" />
        <MetricCard icon={ShieldAlert} label="False clearances" value={percentage(metrics.falseClearRate)} copy={`${metrics.falseClears ?? 0} / ${metrics.falseClearSamples ?? 0} labelled flag or review cases`} tone="red" />
        <MetricCard icon={TriangleAlert} label="Abstention rate" value={percentage(metrics.abstentionRate)} copy={`${metrics.elapsedMs.toFixed(1)} ms parser runtime`} tone="amber" />
      </div>
      <article className="failure-panel"><header><div><span className="eyebrow">FAILURE ANALYSIS</span><h3>{!metrics.statusSamples ? 'No verdict ground truth supplied' : metrics.failures.length ? `${metrics.failures.length} mismatched verdicts` : 'All labelled verdicts matched'}</h3></div><ClipboardCheck size={22} /></header>{metrics.failures.length ? metrics.failures.map((failure) => <div key={failure.id}><code>{failure.id}</code><span>{failure.condition}</span><b>{failure.expected}</b><ArrowRight size={14} /><strong>{failure.actual}</strong></div>) : <p>{metrics.statusSamples ? 'No mismatch among verdict-labelled records. This is not proof of OCR accuracy or legal validity.' : 'Add expectedStatus labels before interpreting verdict accuracy. Unlabelled records are excluded.'}</p>}</article>
      <article className="failure-panel"><header><div><span className="eyebrow">FIELD VALUE EVIDENCE</span><h3>Exact readings, explicit denominators</h3></div></header><p>Supplied transcripts only; this view does not run OCR. Matching normalizes case and whitespace, not numeric values. Imported labels are not independently verified or a proven held-out dataset.</p><div className="benchmark-field-table"><table><thead><tr><th>Field</th><th>Exact matches</th><th>Labelled values</th><th>Rate</th></tr></thead><tbody>{Object.entries(metrics.perField || {}).map(([id, field]) => <tr key={id}><td>{field.label || id}</td><td>{field.exactMatchCorrect}</td><td>{field.exactMatchSamples}</td><td>{percentage(field.exactMatchRate)}</td></tr>)}</tbody></table></div></article>
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
        <article><CircleHelp size={22} /><span>TRUST POLICY</span><h3>Explicit uncertainty</h3><p>Low OCR confidence, incomplete geometry and tier-boundary uncertainty become MANUAL REVIEW. Reliability scores are not statistically calibrated.</p></article>
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

function ReportSourceReplay({ record, reportImages }) {
  const regions = Array.isArray(record.regions) ? record.regions : []
  const [selectedId, setSelectedId] = useState(regions[0]?.id || '')
  useEffect(() => { setSelectedId(regions[0]?.id || '') }, [record.id])
  if (!regions.length) return null
  const selected = regions.find((region) => region.id === selectedId) || regions[0]
  const imageIndex = reportImages.findIndex((item) => item.id === selected.panelId)
  const panel = imageIndex >= 0 ? reportImages[imageIndex] : null
  const field = record.extraction?.byId?.[selected.id] || record.extraction?.fields?.find((item) => item.id === selected.id)
  const checkIds = FIELD_RULES[selected.id] || []
  const checks = record.result?.checks?.filter((check) => checkIds.includes(check.id)) || []
  const sourceRows = regions.map((region) => {
    const item = record.extraction?.byId?.[region.id] || record.extraction?.fields?.find((candidate) => candidate.id === region.id)
    const regionPanelIndex = reportImages.findIndex((image) => image.id === region.panelId)
    const regionPanel = regionPanelIndex >= 0 ? reportImages[regionPanelIndex] : null
    const regionChecks = record.result?.checks?.filter((check) => (FIELD_RULES[region.id] || []).includes(check.id)) || []
    return { region, item, regionPanelIndex, regionPanel, regionChecks }
  })
  return <section className="report-source-replay">
    <header><div><span className="eyebrow">SEALED SOURCE REPLAY</span><h2>Trace a parsed value to its captured pixels.</h2><p>Client-reported OCR geometry is preserved for review. It is not independent proof that the printed declaration is correct.</p></div><span>{regions.length} located field{regions.length === 1 ? '' : 's'}</span></header>
    <div className="source-replay-layout">
      <ul className="source-replay-fields" aria-label="Located declaration fields">
        {regions.map((region) => {
          const item = record.extraction?.byId?.[region.id] || record.extraction?.fields?.find((candidate) => candidate.id === region.id)
          return <li key={region.id}><button type="button" className={selected.id === region.id ? 'active' : ''} onClick={() => setSelectedId(region.id)}><span>{region.label}</span><strong>{item?.conflict ? 'Conflicting working values' : item?.value || 'No working value'}</strong><small>Panel {Math.max(0, reportImages.findIndex((image) => image.id === region.panelId)) + 1} · candidate source geometry</small></button></li>
        })}
      </ul>
      <div className="source-replay-evidence">
        {panel?.analysisUrl ? <figure><div><img src={panel.analysisUrl} alt={`Captured evidence panel ${imageIndex + 1} with source highlight`} /><svg viewBox={`0 0 ${selected.pageWidth} ${selected.pageHeight}`} preserveAspectRatio="none" aria-label={`Highlighted source region for ${selected.label}`}><rect x={selected.bbox.x0} y={selected.bbox.y0} width={selected.bbox.x1 - selected.bbox.x0} height={selected.bbox.y1 - selected.bbox.y0} vectorEffect="non-scaling-stroke" /></svg></div><figcaption>Panel {imageIndex + 1} · {panel.name || panel.panelRole}<code>{panel.sha256 ? `${panel.sha256.slice(0, 18)}…` : 'No digest available'}</code></figcaption></figure> : <div className="missing-image">Source image unavailable in this opened record</div>}
        <div className="source-reading-comparison"><span><b>OCR SOURCE LINE</b>{selected.text || 'No OCR line retained'}</span><span><b>WORKING PARSED VALUE</b>{field?.value || 'not detected'}</span><small>Candidate link only. Manual edits can differ from the OCR line; verify the highlighted pixels before relying on the working value.</small></div>
        <div className="source-replay-chain"><span><b>FIELD</b>{field?.label}: {field?.value || 'not detected'}</span><ChevronRight size={15} /><span><b>RULE</b>{checks.length ? [...new Set(checks.map((check) => check.rule))].join(' · ') : 'No applicable check emitted'}</span><ChevronRight size={15} /><span><b>RESULT</b>{checks.length ? checks.map((check) => statusLabel(check.status)).join(' · ') : 'Not evaluated'}</span><ChevronRight size={15} /><span><b>OFFICER</b>{record.meta.fieldReviews?.[selected.id]?.state?.replaceAll('_', ' ') || 'verification pending'}</span></div>
      </div>
    </div>
    <table className="source-replay-print">
      <caption>Complete sealed source-region index · client-reported OCR geometry</caption>
      <thead><tr><th>Field / panel</th><th>OCR source / working value</th><th>Pixel geometry</th><th>Rule / assessment / officer</th></tr></thead>
      <tbody>{sourceRows.map(({ region, item, regionPanelIndex, regionPanel, regionChecks }) => <tr key={`print-${region.id}`}>
        <td><b>{region.label}</b><br />{regionPanelIndex >= 0 ? `Panel ${regionPanelIndex + 1}` : 'Panel unavailable'} · {regionPanel?.name || region.panelId}<br /><code>{regionPanel?.sha256 || 'No panel digest available'}</code></td>
        <td><b>OCR:</b> {region.text || 'No OCR line retained'}<br /><b>Working:</b> {item?.conflict ? 'Conflicting values' : item?.value || 'Not detected'}</td>
        <td>x {Math.round(region.bbox.x0)}–{Math.round(region.bbox.x1)} · y {Math.round(region.bbox.y0)}–{Math.round(region.bbox.y1)} px<br />Frame {Math.round(region.pageWidth)} × {Math.round(region.pageHeight)} px</td>
        <td><b>{regionChecks.length ? [...new Set(regionChecks.map((check) => check.rule))].join(' · ') : 'No applicable check emitted'}</b><br />{regionChecks.length ? regionChecks.map((check) => `${check.label}: ${statusLabel(check.status)}`).join(' · ') : 'Not evaluated'}<br />Officer: {record.meta.fieldReviews?.[region.id]?.state?.replaceAll('_', ' ') || 'verification pending'}</td>
      </tr>)}</tbody>
    </table>
  </section>
}

function ReportOfficerObservations({ record }) {
  const fields = Object.entries(record.meta.fieldReviews || {}).filter(([, review]) => review?.state && review.state !== 'unreviewed')
  const placements = Object.entries(record.meta.placementReviews || {}).filter(([, review]) => review?.state && review.state !== 'unreviewed')
  const qualityDecisions = Object.entries(record.meta.qualityAcknowledgements || {})
  const spacing = record.meta.quantitySpacing || {}
  const confirmations = [
    ['Classification checked', record.meta.classificationConfirmed],
    ['All relevant panels checked', record.meta.allPanelsCaptured],
    ['Physical PDP checked', record.meta.pdpConfirmed],
    ['Same-plane measurement checked', record.meta.measurementConfirmed],
    ['Width-character applicability checked', record.meta.widthCharacterConfirmed],
  ].filter(([, value]) => value === true)
  if (!fields.length && !placements.length && !qualityDecisions.length && !spacing.reason && !confirmations.length) return null
  const fieldLabel = (id) => record.extraction?.byId?.[id]?.label || record.extraction?.fields?.find((field) => field.id === id)?.label || id
  return <section className="report-officer-observations">
    <h2>Officer-supplied observations</h2>
    <p>These statements are recorded human observations—not image-model certifications. The original automated finding and source evidence remain separate.</p>
    {confirmations.length > 0 && <div className="observation-confirmations">{confirmations.map(([label]) => <span key={label}><Check size={13} />{label}</span>)}</div>}
    <div className="observation-grid">
      {fields.map(([id, review]) => <article key={`field-${id}`}><span>FIELD VERIFICATION · {review.state.replaceAll('_', ' ')}</span><strong>{fieldLabel(id)} · {review.value || 'No value'}</strong><p>{review.reason || 'No source note recorded.'}</p></article>)}
      {placements.map(([id, review]) => <article key={`placement-${id}`}><span>PLACEMENT · {review.state.replaceAll('_', ' ')}</span><strong>{fieldLabel(id)} · {review.panelId ? `panel ${review.panelId.slice(0, 8)}…` : 'panel not recorded'}</strong><p>{review.reason || 'No placement note recorded.'}</p></article>)}
      {qualityDecisions.map(([id, decision]) => <article key={`quality-${id}`}><span>IMAGE QUALITY · CONTINUE WITH CAUTION</span><strong>Panel {id.slice(0, 8)}… · {decision.status} ({decision.score}/100)</strong><p>Officer accepted the recorded image-quality limitation at {formatDate(decision.at)}. OCR still required source inspection and field verification.</p></article>)}
      {spacing.reason && <article><span>RULE 8 CLEAR SPACE · {spacing.confirmed ? 'confirmed' : 'unconfirmed'}</span><strong>Height {spacing.numeralHeightPx || '—'} px · gaps {['abovePx', 'belowPx', 'leftPx', 'rightPx'].map((key) => spacing[key] || '—').join(' / ')} px</strong><p>{spacing.reason}</p></article>}
    </div>
  </section>
}

function ReportMeasurementIntervals({ record }) {
  const checks = (record.result?.checks || []).filter((check) => Number.isFinite(check.measured) && Number.isFinite(check.minimum))
  if (!checks.length) return null
  const uncertainty = Math.max(0, Number(record.meta.measurementUncertainty) || 0) / 100
  return <section className="report-measurements"><h2>Rule 7 measurement intervals</h2><p>Bars show the officer-supplied measurement interval against the encoded minimum. They do not validate the selected reference or glyph.</p>{checks.map((check) => {
    const lower = Math.max(0, check.measured * (1 - uncertainty)); const upper = check.measured * (1 + uncertainty); const scale = Math.max(upper, check.minimum) * 1.25
    return <article key={check.id} className={check.status}><header><span>{check.label}</span><StatusPill status={check.status} compact /></header><div className="measurement-axis"><span className="measurement-requirement" style={{ left: `${check.minimum / scale * 100}%` }} /><span className="measurement-interval" style={{ left: `${lower / scale * 100}%`, width: `${Math.max(.8, (upper - lower) / scale * 100)}%` }} /><i style={{ left: `${check.measured / scale * 100}%` }} /></div><footer><span>{lower.toFixed(2)}–{upper.toFixed(2)} mm observed</span><b>{check.minimum.toFixed(2)} mm minimum</b></footer></article>
  })}</section>
}

function ReportModal({ record, cloudCheck, onClose }) {
  if (!record) return null
  const audit = auditPresentation(record)
  const provenance = ocrProvenance(record)
  const reportImages = record.evidenceItems?.length
    ? record.evidenceItems
    : record.imageUrl ? [{ id: 'legacy', name: record.fileName || 'Package evidence', analysisUrl: record.imageUrl, sha256: '' }] : []
  const calibratedPanels = Object.entries(record.meta.panelMeasurements || {}).filter(([, measurement]) => measurement.referencePx || measurement.glyphPx)
  return (
    <div className="report-modal" role="dialog" aria-modal="true" aria-label="Evidence report">
      <div className="report-toolbar no-print">
        <BrandMark compact />
        <div>
          <button type="button" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
          <button type="button" className="close-report" onClick={onClose}><X size={18} /> Close</button>
        </div>
      </div>
      {cloudCheck && <section className="cloud-copy-check no-print" role="status"><ShieldCheck size={22} /><div><strong>Fresh cloud copy checked</strong><p>Server version {cloudCheck.version} · {cloudCheck.panels * 2} original/analysis images downloaded and SHA-256 checked · {formatDate(cloudCheck.at)}</p><small>Local image cache bypassed. This session check does not certify OCR accuracy or the physical package and is not part of the sealed server receipt.</small></div></section>}
      <ReportDownloads key={record.id} record={record} />
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
          <div><span>Checks passed (not accuracy)</span><strong>{record.result.score}%</strong></div>
          <div><span>Passed</span><strong>{record.result.counts.pass}</strong></div>
          <div><span>Flagged</span><strong>{record.result.counts.fail}</strong></div>
          <div><span>Manual review</span><strong>{record.result.counts.review}</strong></div>
        </div>
        {(!reportImages.length || record.result.context.rulePack !== RULE_PACK.id) && <section className="report-text"><h2>Reassessment required</h2><p>This is a historical or incomplete record. Its original verdict is retained for audit history, not endorsed under the current evidence policy. Create a new inspection with current photographs and rule checks.</p></section>}
        <section className="report-text"><h2>Text provenance</h2><p>{provenance.description} A recorded client timeline is not independent certification of image authenticity.</p></section>
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
              <div><dt>OCR reliability heuristic</dt><dd>{provenance.hasRun && provenance.reliability !== null ? `${provenance.reliability.toFixed(1)}% (not accuracy)` : 'Unavailable — no verified run score'}</dd></div>
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
        <ReportSourceReplay record={record} reportImages={reportImages} />
        {record.extraction?.fields?.length > 0 && (
          <section className="report-extraction">
            <h2>Structured declarations</h2>
            <div>
              {record.extraction.fields.filter((item) => item.detected).map((item) => (
                <article key={item.id}><span>{item.label}</span><strong>{item.conflict ? 'Conflicting values' : item.value || 'Invalid / incomplete reading'}</strong><small>{item.validation?.message || item.evidence}</small></article>
              ))}
            </div>
          </section>
        )}
        <ReportOfficerObservations record={record} />
        <ReportMeasurementIntervals record={record} />
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
          <h2>Working declaration text (corrections, if any)</h2>
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
  const online = useOnlineStatus()
  const install = usePwaInstall()
  const [history, setHistory] = useState([])
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(null)
  const [reportCloudCheck, setReportCloudCheck] = useState(null)
  const reportRequest = useRef(null)
  const [overrideRecord, setOverrideRecord] = useState(null)
  const [studioKey, setStudioKey] = useState(0)
  const [syncError, setSyncError] = useState('')
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [operations, setOperations] = useState([])
  const [syncing, setSyncing] = useState(false)
  const store = useMemo(() => createEvidenceStore(workspace?.scope || 'local'), [workspace?.scope])
  useEffect(() => () => reportRequest.current?.abort(), [])
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
  const syncEngine = useMemo(() => workspace && !workspace.offlineOnly && createSyncEngine({ store, transport: async (operation) => {
    const signal = workspace.api.signal
    const result = await workspace.api.transport(operation)
    if (result.record) result.record = mergeCloudRecord(await store.get('inspections', operation.recordId), result.record)
    await workspace.api.ensureCurrent(signal)
    return result
  }, onChange: refreshLocal }), [workspace?.api, store])
  const synchronize = useMemo(() => singleFlight(async (force = false) => {
    if (!workspace || workspace.offlineOnly || !navigator.onLine) { await refreshLocal(); return }
    const signal = workspace.api.signal
    setSyncing(true); setSyncError('')
    try {
      await syncEngine.run(force)
      await workspace.api.ensureCurrent(signal)
      let offset = 0; let pageNumber = 0
      do {
        const page = await workspace.api.request(`cases?offset=${offset}`, { signal })
        for (const record of page.records) {
          await workspace.api.ensureCurrent(signal)
          await store.mergeRemote(record, mergeCloudRecord)
        }
        if (page.paginationLimited) setSyncError('History reached the server page limit. These results are partial; narrow the search or contact your administrator.')
        offset = nextPageOffset(offset, page.nextOffset, pageNumber++)
      } while (offset !== null)
      await refreshLocal(signal)
      setLastSyncAt(new Date().toISOString())
    } catch (error) { if (!signal.aborted) setSyncError(error.message) } finally { if (!signal.aborted) setSyncing(false) }
  }), [workspace?.api, store, syncEngine])
  useEffect(() => {
    if (!workspace || workspace.offlineOnly) { refreshLocal(); return }
    synchronize()
    const online = () => synchronize()
    window.addEventListener('online', online)
    const timer = setInterval(online, 30000)
    return () => { window.removeEventListener('online', online); clearInterval(timer); workspace.api.cancelPending() }
  }, [workspace?.api, store])

  const archiveConflictingReview = async (operation) => {
    if (!workspace || workspace.offlineOnly) return
    const signal = workspace.api.signal
    try {
      const { record } = await workspace.api.request(`cases?id=${encodeURIComponent(operation.recordId)}`, { signal })
      await workspace.api.ensureCurrent(signal)
      const archived = await archiveReviewConflict(store, operation, record)
      await refreshLocal(signal)
      if (!archived) setSyncError('This queued review was already handled or changed in another tab. Its current evidence and review were not overwritten.')
    } catch (error) { if (!signal.aborted) setSyncError(error.message) }
  }
  const openReport = async (record, { source = 'available' } = {}) => {
    reportRequest.current?.abort()
    const request = new AbortController()
    reportRequest.current = request
    const signal = request.signal
    setReport(null); setReportCloudCheck(null); setSyncError('')
    setReportLoading({ id: record.id, source })
    try {
      if (source === 'cloud' && (!workspace || workspace.offlineOnly || !record.serverVersion || record.syncState !== 'synced')) throw new Error('Reconnect and synchronize this managed case before verifying its cloud copy.')
      if (workspace?.offlineOnly && (record.recordKind === 'summary' || record.detailsStale || !record.evidenceItems?.length || record.evidenceItems.some(panel => !panel.originalUrl?.startsWith('data:image/') || !panel.analysisUrl?.startsWith('data:image/')))) throw new Error('This complete evidence report is not cached. Reconnect and authenticate to retrieve it; a partial report was not substituted.')
      const opened = workspace && !workspace.offlineOnly && record.serverVersion ? await workspace.api.openRecord(record, { source, signal }) : record
      if (workspace && !workspace.offlineOnly) await workspace.api.ensureCurrent(signal)
      if (signal.aborted || reportRequest.current !== request) return
      setReport(opened)
      if (source === 'cloud') setReportCloudCheck({ at: new Date().toISOString(), version: opened.serverVersion, panels: opened.evidenceItems.length })
    } catch (error) { if (!signal.aborted && reportRequest.current === request) setSyncError(`Evidence unavailable: ${error.message}`) }
    finally { if (reportRequest.current === request) { reportRequest.current = null; setReportLoading(null) } }
  }

  const saveRecord = async (record) => {
    if (await store.get('inspections', record.id)) throw new Error('This case is already sealed. Start a new inspection to change evidence.')
    const normalized = normalizeCase({ ...record, syncState: workspace ? 'pending' : 'local' })
    if (workspace) await store.saveAndQueue(normalized, createOperation('seal', record.id, normalized))
    else await store.saveInspection(normalized)
    await refreshLocal()
    if (workspace) synchronize()
    return normalized
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
    if (workspace?.offlineOnly) throw new Error('Supervisor review requires fresh server authentication.')
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

  const openOverride = async record => {
    if (workspace?.offlineOnly) { setSyncError('Reconnect and authenticate before supervisor review.'); return }
    try { setOverrideRecord(workspace ? await workspace.api.getRecordMetadata(record) : record) }
    catch (error) { setSyncError(`Review unavailable: ${error.message}`) }
  }
  const startReassessment = async operation => {
    try {
      if (syncing) throw new Error('Wait for current synchronization to finish before reassessment.')
      await beginRuleReassessment(store, operation, actor.id)
      setChallenge(null); setStudioKey(value => value + 1); setRoute('inspect')
      await refreshLocal()
      setSyncError('Original seal retained locally; its unsent upload is archived. Restore the new draft, rerun OCR and reconfirm the evidence under current rules before sealing.')
    } catch (error) { setSyncError(error.message) }
  }

  return (
    <>
      <Shell route={route} setRoute={setRoute} historyCount={history.length} actor={actor} online={online} offlineOnly={workspace?.offlineOnly}>
        {reportLoading && <div className="processing-banner" role="status"><LoaderCircle size={20} /><span><b>{reportLoading.source === 'cloud' ? 'Checking fresh cloud evidence…' : 'Opening evidence…'}</b><small>{reportLoading.source === 'cloud' ? 'Fetching server metadata and hash-checking original/analysis images. No cached image fallback.' : 'Checking image bytes before opening the report.'}</small></span><button type="button" onClick={() => { reportRequest.current?.abort(); reportRequest.current = null; setReportLoading(null) }}>Cancel evidence check</button></div>}
        {(workspace || syncError) && <div className="sync-status" role="status"><b>{syncing ? 'Synchronizing…' : `${operations.length} queued change(s)`}</b><span>{syncError || (workspace?.offlineOnly ? 'Limited offline access. Captures remain local until fresh authentication and server permission checks.' : 'Local evidence is retained until the server acknowledges it.')}</span>{workspace && <button disabled={syncing || workspace.offlineOnly} onClick={() => synchronize(true)}>Sync / retry</button>}{operations.map((operation) => <details key={operation.id}><summary>{operation.kind} · {operation.recordId} · {operation.state}</summary><p>{operation.lastError || 'Waiting for upload and server verification.'}</p>{operation.lastErrorCode === 'RULE_PACK_MISMATCH' && <button disabled={syncing} onClick={() => startReassessment(operation)}>Archive unsent upload and start linked reassessment</button>}{operation.kind === 'review' && operation.state === 'conflict' && <><p>Your proposed disposition: {operation.payload.status}. {operation.payload.reason}</p><button disabled={workspace?.offlineOnly} onClick={() => archiveConflictingReview(operation)}>Keep server version; archive my unsent review locally</button><p>Then reopen Evidence and submit a new review against the latest version.</p></>}</details>)}</div>}
        {route === 'inspect' && <InspectionStudio key={studioKey} store={store} workspace={workspace} onNewInspection={() => setStudioKey((value) => value + 1)} onSaveRecord={saveRecord} onOpenReport={openReport} challenge={challenge?.active ? challenge : null} onChallengeComplete={completeChallenge} actor={actor} />}
        {route === 'challenge' && <BlindChallengePage challenge={challenge} onStart={startChallenge} onContinue={() => setRoute('inspect')} history={history} />}
        {route === 'dashboard' && <Dashboard history={history} onNavigate={setRoute} onOpenReport={openReport} />}
        {route === 'history' && <HistoryPage history={history} onOpenReport={openReport} onVerifyCloud={workspace && !workspace.offlineOnly ? (record) => openReport(record, { source: 'cloud' }) : null} reportBusy={Boolean(reportLoading)} onNavigate={setRoute} />}
        {route === 'benchmark' && <ValidationLab />}
        {route === 'operations' && (workspace ? <SharedOperations workspace={workspace} history={history} onOpenReport={openReport} onOverride={openOverride} /> : <OfficerOperations history={history} actor={actor} onActorChange={setActor} onOpenReport={openReport} onOverride={openOverride} onImportRecord={importRecord} />)}
        {route === 'rules' && <RulesLibrary />}
        {route === 'system' && <SystemTrust workspace={workspace} online={online} install={install} historyCount={history.length} lastSyncAt={lastSyncAt} onNavigate={setRoute} />}
      </Shell>
      <ReportModal record={report} cloudCheck={reportCloudCheck} onClose={() => { setReport(null); setReportCloudCheck(null) }} />
      <OverrideModal record={overrideRecord} onClose={() => setOverrideRecord(null)} onApply={applyOverride} />
    </>
  )
}

export default function App() {
  return <WorkspaceGate>{(workspace) => <InspectionApp key={workspace?.scope || 'local'} workspace={workspace} />}</WorkspaceGate>
}
