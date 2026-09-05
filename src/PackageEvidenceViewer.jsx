import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Camera, Check, CircleHelp, RotateCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { evidenceCoverage } from './lib/inspectionPresentation.mjs'

const QUALITY_COPY = {
  good: ['Capture accepted', 'good', Check],
  review: ['Verify image quality', 'review', TriangleAlert],
  poor: ['Retake recommended', 'poor', TriangleAlert],
  unknown: ['Captured · quality unscored', 'review', CircleHelp],
}

const normalizeIndex = (value) => ((value % 4) + 4) % 4

export default function PackageEvidenceViewer({ evidenceItems, activeEvidenceId, processing = false, sealed = false, locked = false, onSelectEvidence, onCapture }) {
  const coverage = useMemo(() => evidenceCoverage(evidenceItems), [evidenceItems])
  const activeIndex = coverage.findIndex((item) => item.evidence?.id === activeEvidenceId)
  const [selected, setSelected] = useState(activeIndex >= 0 ? activeIndex : 0)
  const [rotation, setRotation] = useState((activeIndex >= 0 ? activeIndex : 0) * -90)
  const drag = useRef(null)
  const cuboid = useRef(null)
  const clearDragListeners = useRef(null)

  useEffect(() => {
    if (activeIndex < 0) return
    setSelected(activeIndex)
    setRotation(activeIndex * -90)
  }, [activeIndex])
  useEffect(() => () => clearDragListeners.current?.(), [])
  useEffect(() => {
    if (!locked) return
    clearDragListeners.current?.()
    drag.current = null
    cuboid.current?.style.setProperty('--package-y', `${selected * -90}deg`)
  }, [locked, selected])

  const choose = (index) => {
    if (locked) return
    const next = normalizeIndex(index)
    setSelected(next)
    setRotation(next * -90)
    if (coverage[next].evidence) onSelectEvidence?.(coverage[next].evidence.id)
  }

  const beginDrag = (event) => {
    if (locked) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    clearDragListeners.current?.()
    const origin = { x: event.clientX, rotation, selected }
    drag.current = origin
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      clearDragListeners.current = null
    }
    const move = (nextEvent) => {
      if (!drag.current) return
      cuboid.current?.style.setProperty('--package-y', `${origin.rotation + (nextEvent.clientX - origin.x) * .45}deg`)
    }
    const finish = (nextEvent) => {
      const delta = nextEvent.clientX - origin.x
      const step = Math.abs(delta) > 34 ? (delta > 0 ? -1 : 1) : 0
      const next = normalizeIndex(origin.selected + step)
      drag.current = null
      cleanup()
      cuboid.current?.style.setProperty('--package-y', `${next * -90}deg`)
      choose(next)
    }
    const cancel = () => {
      drag.current = null
      cleanup()
      cuboid.current?.style.setProperty('--package-y', `${origin.selected * -90}deg`)
      setRotation(origin.selected * -90)
    }
    clearDragListeners.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const active = coverage[selected]
  const capturedCount = coverage.filter((item) => item.covered).length

  return (
    <section className={`package-navigator ${processing ? 'is-processing' : ''} ${sealed ? 'is-sealed' : ''}`} aria-labelledby="package-navigator-title">
      <div className="package-navigator-copy">
        <span className="eyebrow">EVIDENCE COVERAGE VIEW</span>
        <h4 id="package-navigator-title">Inspect the package as one evidence object.</h4>
        <p>This is a navigator for assigned photo roles—not a generated 3D reconstruction. Select a face to open its real image on the measurement board.</p>
        <div className="coverage-counter"><Box size={16} /><strong>{capturedCount}/4</strong><span>declaration views covered</span></div>
        <div className="package-face-controls" aria-label="Package evidence panels">
          {coverage.map((face, index) => {
            const quality = QUALITY_COPY[face.quality] || QUALITY_COPY.unknown
            const StatusIcon = face.covered ? quality[2] : Camera
            return (
              <button
                type="button"
                key={face.id}
                className={`${selected === index ? 'active' : ''} ${face.covered ? quality[1] : 'missing'}`}
                onClick={() => choose(index)}
                disabled={locked}
                aria-pressed={selected === index}
              >
                <StatusIcon size={15} />
                <span><b>{face.short}</b><small>{face.covered ? quality[0] : 'Capture required'}</small></span>
              </button>
            )
          })}
        </div>
        {!evidenceItems.length && <button type="button" className="navigator-capture" onClick={onCapture}><Camera size={16} /> Capture first package panel</button>}
      </div>

      <div className="package-stage">
        <div
          className="package-scene"
          tabIndex={locked ? -1 : 0}
          aria-disabled={locked}
          role="group"
          aria-label={`Package panel navigator. Selected: ${active.label}. Use left and right arrow keys to rotate.`}
          onKeyDown={(event) => {
            if (locked) return
            if (event.key === 'ArrowLeft') { event.preventDefault(); choose(selected - 1) }
            if (event.key === 'ArrowRight') { event.preventDefault(); choose(selected + 1) }
            if (event.key === 'Enter' && active.evidence) onSelectEvidence?.(active.evidence.id)
          }}
          onPointerDown={beginDrag}
        >
          <div ref={cuboid} className="package-cuboid" style={{ '--package-y': `${rotation}deg` }} aria-hidden="true">
            {coverage.map((face, index) => (
              <div className={`package-face package-face-${index + 1} ${face.covered ? 'covered' : 'missing'}`} key={face.id}>
                {face.evidence?.analysisUrl && face.coverage === 'assigned' ? <img src={face.evidence.analysisUrl} alt="" loading="lazy" decoding="async" /> : <div className="empty-face">{face.coverage === 'complete-panel' ? <Check size={24} /> : <Camera size={24} />}<span>{face.coverage === 'complete-panel' ? 'Covered by one complete panel' : 'Awaiting panel'}</span></div>}
                <span className="face-shade" />
                {processing && selected === index && <span className="face-scan-line" />}
                <div className="face-label"><b>{face.short}</b><small>{face.coverage === 'complete-panel' ? 'Covered by complete panel' : face.covered ? `Evidence ${String(face.evidence.id).slice(0, 8)}` : 'No assigned image'}</small></div>
              </div>
            ))}
            <div className="package-face package-face-top"><span>NiyamLens</span></div>
            <div className="package-face package-face-bottom" />
          </div>
        </div>
        <div className="navigator-readout" aria-live="polite">
          <RotateCw size={14} />
          <span><b>{active.label}</b><small>{active.covered ? (QUALITY_COPY[active.quality] || QUALITY_COPY.unknown)[0] : 'No image assigned to this evidence role'}</small></span>
          {sealed && <ShieldCheck size={17} aria-label="Evidence sealed" />}
        </div>
      </div>
    </section>
  )
}
