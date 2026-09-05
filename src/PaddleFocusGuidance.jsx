export default function PaddleFocusGuidance({ suggestions, onScan, pendingPreview }) {
  if (!suggestions.length) return null
  return <section className="paddle-review" aria-label="Suggested declaration close-ups">
    <span className="eyebrow">READ THE LABEL AGAIN · DO NOT GUESS</span>
    <h3>Suggested declaration close-ups</h3>
    <p>These regions come from literal headings in the previous OCR run. Check that the rectangle includes the complete heading, value and unit, then request a new reading. This never joins or corrects the previous OCR text.</p>
    {pendingPreview && <p role="status">Append or dismiss the current OCR preview before requesting another close-up.</p>}
    <div className="paddle-proposals">
      {suggestions.map(suggestion => <article key={suggestion.id}>
        <div className="proposal-photo" style={{ aspectRatio: `${suggestion.sourceFrame.width} / ${suggestion.sourceFrame.height}` }}>
          <img src={suggestion.imageUrl} alt={`${suggestion.label} suggested close-up on original captured panel`} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect className="focus-suggestion-box" x={suggestion.rect.x0 * 100} y={suggestion.rect.y0 * 100} width={(suggestion.rect.x1 - suggestion.rect.x0) * 100} height={(suggestion.rect.y1 - suggestion.rect.y0) * 100} /></svg>
        </div>
        <div><h4>{suggestion.label}</h4><p>The raw heading and value were not complete on one line. A machine layout candidate may already be shown above; use this optional close-up if its value is still unclear in the photo.</p><small>Heading read: {suggestion.headingTexts.join(' · ')}</small><button type="button" className="secondary-action" disabled={pendingPreview} onClick={() => onScan(suggestion)}>Read {{ mrp: 'MRP', netQuantity: 'net quantity', packDate: 'date' }[suggestion.field]} close-up</button><small>New raw reading is previewed before append. Earlier readings and unresolved conflicts remain preserved.</small></div>
      </article>)}
    </div>
  </section>
}
