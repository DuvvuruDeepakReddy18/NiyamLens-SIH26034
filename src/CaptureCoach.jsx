import { Camera, ScanLine } from 'lucide-react'
import { captureTargets } from './lib/captureCoach.mjs'
import './capture-coach.css'

export default function CaptureCoach({ hasImage, hasText, extraction, onFocus, disabled = false, pendingPreview = false }) {
  return <section className="capture-coach" aria-label="Capture guidance">
    <header><Camera size={19} /><div><strong>{hasImage ? 'Small print needs a close look' : 'Start with the declaration panel'}</strong><p>{hasImage ? 'Use the original photo to check each critical reading. A crop improves focus, not certainty.' : 'Use even light, hold the phone parallel, and fill the frame with readable print. Capture other sides separately.'}</p></div></header>
    {!hasImage && <ol><li>Include the label heading, value and unit.</li><li>Tilt the light to remove glare; keep the package still.</li><li>Keep the whole panel, then add a close-up if print is tiny.</li></ol>}
    {hasImage && !hasText && <p>Select one complete declaration below to read a close-up first, or use “Read label fields” for the whole package. Selection never supplies a heading or an answer to the OCR engine.</p>}
    {pendingPreview && <p role="status">Append or dismiss the pending OCR preview before selecting another region or starting a new scan.</p>}
    {hasImage && <div className="capture-targets">{captureTargets(extraction, { hasReading: hasText }).map(target => <article key={target.id} className={target.needsCapture ? 'needs-capture' : ''}><span>{target.label} · {target.issue}</span><strong>{target.value || (hasText ? 'Retake or inspect the source' : 'Select the heading, value and unit')}</strong><p>{target.guidance}</p><button type="button" disabled={disabled || pendingPreview} onClick={() => onFocus(target)}><ScanLine size={14} /> Select {target.label} region</button></article>)}</div>}
  </section>
}
