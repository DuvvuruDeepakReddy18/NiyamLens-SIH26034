const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function normalizeSourceRegions(regions, evidenceItems = [], extraction = {}) {
  if (!Array.isArray(regions)) return []
  const panels = new Set((Array.isArray(evidenceItems) ? evidenceItems : []).map((item) => item?.id).filter(Boolean))
  const fields = new Map((Array.isArray(extraction?.fields) ? extraction.fields : [])
    .filter((field) => field?.detected && typeof field.id === 'string')
    .map((field) => [field.id, field]))
  const seen = new Set()
  const retained = []
  for (const region of regions.slice(0, 30)) {
    if (!region || typeof region !== 'object' || Array.isArray(region)) continue
    const field = fields.get(region.id)
    const box = region.bbox
    const width = region.pageWidth
    const height = region.pageHeight
    if (!field || seen.has(region.id) || !panels.has(region.panelId)
      || !box || typeof box !== 'object' || Array.isArray(box)
      || ![box.x0, box.y0, box.x1, box.y1, width, height].every(finite)
      || width <= 0 || height <= 0 || width > 10000 || height > 10000
      || box.x0 < 0 || box.y0 < 0 || box.x1 <= box.x0 || box.y1 <= box.y0 || box.x1 > width || box.y1 > height) continue
    seen.add(region.id)
    const next = {
      id: region.id,
      label: String(field.label || region.id).slice(0, 200),
      panelId: region.panelId,
      bbox: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
      pageWidth: width,
      pageHeight: height,
    }
    if (typeof region.text === 'string') next.text = region.text.slice(0, 4000)
    if (finite(region.confidence) && region.confidence >= 0 && region.confidence <= 100) next.confidence = region.confidence
    if (finite(region.matchScore) && region.matchScore >= 0 && region.matchScore <= 1) next.matchScore = region.matchScore
    if (finite(region.pixelHeight) && region.pixelHeight >= 0 && region.pixelHeight <= height) next.pixelHeight = region.pixelHeight
    retained.push(next)
  }
  return retained
}
