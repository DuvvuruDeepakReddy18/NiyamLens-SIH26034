import { createElement as h, useMemo, useState } from 'react'
import { compoundTableReview } from './lib/compoundTableReview.mjs'
import './compound-table-review.css'

// Plain createElement keeps this read-only view directly SSR-testable without
// launching a browser or adding a JSX compiler dependency to the test runner.
export default function CompoundTableReview({ items }) {
  const review = useMemo(() => compoundTableReview(items), [items])
  const [failedFrames, setFailedFrames] = useState([])
  if (review.status === 'none') return null
  const failed = card => failedFrames.some(frame => frame.panelId === card.panelId && frame.previewUrl === card.previewUrl)
  const onImageError = card => setFailedFrames(current => current.some(frame => frame.panelId === card.panelId && frame.previewUrl === card.previewUrl) ? current : [...current.slice(-3), { panelId: card.panelId, previewUrl: card.previewUrl }])
  const figure = (card, region, parts, label) => h('svg', { className: 'compound-table-source', viewBox: `${region.x} ${region.y} ${region.width} ${region.height}`, role: 'img', 'aria-label': label },
    h('image', { href: card.previewUrl, width: card.width, height: card.height, onError: () => onImageError(card) }),
    ...parts.map(part => h('polygon', { key: part.id, points: part.box.map(point => point.join(',')).join(' '), className: card.row[0].id === part.id || card.anchors.some(pair => pair.heading.id === part.id) ? 'compound-heading' : 'compound-value' })))
  return h('section', { className: 'compound-table-review', 'aria-label': 'Compound declaration diagnostic', 'data-testid': 'compound-table-review' },
    h('h4', null, 'Compound declaration table · inspect the source'),
    h('p', null, 'Read-only diagnostic, not automatic extraction. The table layout may support an MRP candidate even though the normal parser cannot resolve this compound row. Nothing here changes the transcript, comparison, or field verification.'),
    review.status === 'unavailable'
      ? h('p', { role: 'status' }, `Table aid withheld. ${review.reason} Inspect the original photograph or take a closer photo.`)
      : review.cards.map(card => h('article', { key: card.id },
        failed(card) ? h('p', { role: 'status' }, 'Table aid withheld because its exact source image could not be displayed. No value is verified.') : h('div', null,
          h('p', { className: 'compound-candidate' }, h('strong', null, `Unverified MRP candidate: ${card.value}`)),
          h('p', null, 'Full compound OCR row — all characters unchanged:'), h('pre', null, card.rowText),
          figure(card, card.rowRegion, card.row, 'Original OCR fragments for the compound MRP and USP row'),
          h('p', null, 'Orange outlines: headings. Blue outlines: value fragments. These are OCR line boxes, not physical glyph measurements. The photograph below is the exact OCR input frame', card.transformed ? ' after the selected dark-ink transform.' : '.'),
          h('p', { className: card.unitPriceFormatValid ? '' : 'compound-unresolved' }, card.unitPriceFormatValid ? 'USP format parsed, still unverified. ' : 'USP remains unresolved: its unit or denominator was not read in a valid format. ', 'No characters have been repaired.'),
          h('pre', null, card.unitPriceText),
          h('h5', null, 'Three supporting table rows'),
          h('p', null, 'These literal heading/value pairs support the row-spacing model. They do not establish that the price is correct.'),
          h('ol', null, ...card.anchors.map(pair => h('li', { key: pair.heading.id }, h('strong', null, `${pair.label}: `), h('code', null, pair.heading.text), ' → ', h('code', null, pair.value.text)))),
          figure(card, card.tableRegion, card.all, 'Compound row and all three supporting anchor pairs'),
          h('details', null, h('summary', null, 'Show full exact OCR source frame'), figure(card, { x: 0, y: 0, width: card.width, height: card.height }, card.all, 'Full exact OCR source frame with table evidence boxes')),
          h('p', null, 'If you confirm the printed value from the physical label or original photograph, use the existing explicit field review/correction workflow after closing or appending the raw preview. This diagnostic does not fill or confirm anything for you.')))))
}
