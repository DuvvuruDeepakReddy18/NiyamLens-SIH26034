// Keep the observation tied to the exact declaration and captured panel.
export function updatePlacementReview(field, saved = {}, change = {}) {
  const stale = saved.value !== field.value
  const panelChanged = Object.hasOwn(change, 'panelId') && change.panelId !== saved.panelId
  const next = { state: 'unreviewed', ...saved, ...(stale ? { state: 'unreviewed' } : {}), ...change, value: field.value }
  const invalid = !field.value || field.conflict || ['invalid', 'conflict'].includes(field.validation?.status)
  // A note edit cannot reconfirm a stale observation. A source-panel change
  // always needs another placement selection, even if a caller bundles fields.
  if (panelChanged || (invalid && ['inside_pdp', 'outside_pdp'].includes(next.state))) next.state = 'unreviewed'
  return next
}
