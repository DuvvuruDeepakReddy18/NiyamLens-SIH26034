const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Unable to decode image evidence.'))
  image.src = url
})

const normalizeToken = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9₹@.]+/g, ' ').trim()

const renderOcrVariant = (image, { grayscale = false, invert = false, contrast = 112 } = {}) => {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const scale = Math.max(1, Math.min(2.4, 2400 / Math.max(sourceWidth, sourceHeight)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.filter = `${grayscale || invert ? 'grayscale(1)' : 'grayscale(0)'}${invert ? ' invert(1)' : ''} contrast(${contrast}%)`
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}

export async function createOcrInputVariants(sourceUrl) {
  const image = await loadImage(sourceUrl)
  return [
    { id: 'standard-sparse', pageSegmentationMode: '11', ...renderOcrVariant(image) },
    { id: 'grayscale-block', pageSegmentationMode: '6', ...renderOcrVariant(image, { grayscale: true, contrast: 132 }) },
    { id: 'reverse-sparse', pageSegmentationMode: '11', ...renderOcrVariant(image, { invert: true, contrast: 145 }) },
  ]
}

const renderOcrTile = (image, crop, index) => {
  const scale = Math.max(1, Math.min(3, 1800 / Math.max(crop.width, crop.height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(crop.width * scale))
  canvas.height = Math.max(1, Math.round(crop.height * scale))
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.filter = 'grayscale(1) contrast(138%)'
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
  return { id: `detail-tile-${index + 1}`, pageSegmentationMode: '6', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, spatial: false }
}

export async function createOcrTileVariants(sourceUrl) {
  const image = await loadImage(sourceUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const overlapX = Math.round(width * .08)
  const overlapY = Math.round(height * .08)
  const midpointX = Math.round(width / 2)
  const midpointY = Math.round(height / 2)
  const crops = [
    { x: 0, y: 0, width: midpointX + overlapX, height: midpointY + overlapY },
    { x: Math.max(0, midpointX - overlapX), y: 0, width: width - Math.max(0, midpointX - overlapX), height: midpointY + overlapY },
    { x: 0, y: Math.max(0, midpointY - overlapY), width: midpointX + overlapX, height: height - Math.max(0, midpointY - overlapY) },
    { x: Math.max(0, midpointX - overlapX), y: Math.max(0, midpointY - overlapY), width: width - Math.max(0, midpointX - overlapX), height: height - Math.max(0, midpointY - overlapY) },
  ]
  return crops.map((crop, index) => renderOcrTile(image, crop, index))
}

const agreementTokens = (value) => new Set(normalizeToken(value).split(' ').filter((token) => token.length >= 3))

const tokenAgreement = (left, right) => {
  if (!left.size || !right.size) return 0
  let intersection = 0
  left.forEach((token) => { if (right.has(token)) intersection += 1 })
  return intersection / new Set([...left, ...right]).size
}

export function calibrateOcrReliability(passes = [], qualityScore = 0) {
  const usable = passes.filter((pass) => pass?.spatial !== false && String(pass?.text || '').trim())
  if (!usable.length) return { score: 0, engineConfidence: 0, agreement: 0, reason: 'No readable OCR text.' }
  const engineConfidence = Math.max(...usable.map((pass) => Number(pass.confidence || 0)))
  const tokenSets = usable.map((pass) => agreementTokens(pass.text))
  const agreements = []
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) agreements.push(tokenAgreement(tokenSets[left], tokenSets[right]))
  }
  const agreement = agreements.length ? Math.max(...agreements) : 0
  const meaningfulTokens = new Set(tokenSets.flatMap((tokens) => [...tokens])).size
  const evidenceVolume = Math.min(1, meaningfulTokens / 35)
  const quality = Math.max(0, Math.min(100, Number(qualityScore || 0)))
  const score = Math.round(Math.min(99, engineConfidence * .47 + agreement * 100 * .28 + quality * .15 + evidenceVolume * 100 * .1))
  const reason = score >= 75
    ? 'OCR passes agree and the capture is suitable for verification.'
    : score >= 55
      ? 'Usable evidence, but verify highlighted fields against the package.'
      : 'Low-confidence evidence; retake or run a deep scan before deciding.'
  return { score, engineConfidence: Math.round(engineConfidence), agreement: Number(agreement.toFixed(2)), reason }
}

export async function createOcrRegionVariant(sourceUrl, bbox) {
  const image = await loadImage(sourceUrl)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const x0 = Math.max(0, Number(bbox?.x0) || 0)
  const y0 = Math.max(0, Number(bbox?.y0) || 0)
  const x1 = Math.min(sourceWidth, Number(bbox?.x1) || sourceWidth)
  const y1 = Math.min(sourceHeight, Number(bbox?.y1) || sourceHeight)
  const width = x1 - x0
  const height = y1 - y0
  if (width < 20 || height < 10) throw new Error('The OCR region is too small to read reliably.')
  const padding = Math.max(6, Math.round(Math.min(width, height) * .14))
  const sourceX = Math.max(0, x0 - padding)
  const sourceY = Math.max(0, y0 - padding)
  const cropWidth = Math.min(sourceWidth - sourceX, width + padding * 2)
  const cropHeight = Math.min(sourceHeight - sourceY, height + padding * 2)
  const scale = Math.max(2, Math.min(6, 1200 / cropWidth))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(cropWidth * scale))
  canvas.height = Math.max(1, Math.round(cropHeight * scale))
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.filter = 'grayscale(1) invert(1) contrast(165%)'
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
  return { id: 'reference-region', pageSegmentationMode: '7', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, spatial: false }
}

const normalizeOcrLine = (value) => String(value || '')
  .replace(/([A-Za-z])\$(?=\s|$)/g, '$1S')
  .replace(/^[^A-Za-z0-9]*(\d+(?:\.\d+)?)\s*mm\s*r[e3][rf][^A-Za-z0-9]*$/i, '$1 mm REF')
  .replace(/\s+/g, ' ')
  .trim()

const comparableOcrLine = (value) => normalizeOcrLine(value).toLowerCase().replace(/[^a-z0-9₹@.]+/g, ' ').trim()

const levenshteinDistance = (left, right) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[right.length]
}

const lineSimilarity = (left, right, budget) => {
  // Punctuation and short fragments are evidence around numeric fields too.
  // Fuzzy matching would treat "5?" and "5", or "MRP 50?" and "MRP 50", as the same
  // observation and silently discard a possible damaged/conflicting reading.
  // Only exact normalized-line duplicates may collapse when digits occur.
  if (/\d/.test(left) || /\d/.test(right)) return Number(left === right)
  const a = comparableOcrLine(left)
  const b = comparableOcrLine(right)
  if (!a || !b) return 0
  // Near-identical strings can contain different legal values. Never merge
  // those merely because their edit distance is small.
  const numbers = (text) => (text.match(/[-+]?\d+(?:[.,:/-]\d+)*/g) || []).join('|')
  const units = (text) => (text.toLowerCase().match(/\b(?:kg|g|gm|gms|ml|l|litre|litres|liter|liters|pcs)\b/g) || []).join('|')
  if (numbers(left) !== numbers(right) || units(left) !== units(right)) return 0
  if (a === b) return 1
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 5) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < .78 || a.length > 300 || b.length > 300) return 0
  const cost = a.length * b.length
  if (budget.remaining < cost) return 0
  budget.remaining -= cost
  return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length)
}

const lineQuality = (value) => {
  const line = normalizeOcrLine(value)
  const meaningful = (line.match(/[A-Za-z0-9₹@]/g) || []).length
  const noise = (line.match(/[^A-Za-z0-9₹@.,:/()&+\-\s]/g) || []).length
  return meaningful - noise * 2
}

export function mergeOcrPassTexts(texts = []) {
  if (!Array.isArray(texts) || texts.length > 64 || texts.some((text) => typeof text !== 'string') || texts.reduce((total, text) => total + text.length, 0) > 500000) throw new Error('OCR output is too large to merge safely. Capture a tighter declaration panel.')
  const merged = []
  const budget = { remaining: 5000000 }
  let comparisons = 0
  for (const text of texts) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(normalizeOcrLine).filter(Boolean)
    for (const line of lines) {
      let bestIndex = -1
      let bestSimilarity = 0
      merged.forEach((existing, index) => {
        const similarity = ++comparisons <= 200000 ? lineSimilarity(existing, line, budget) : Number(existing === line)
        if (similarity > bestSimilarity) { bestIndex = index; bestSimilarity = similarity }
      })
      if (bestIndex >= 0 && bestSimilarity >= .78) {
        if (lineQuality(line) > lineQuality(merged[bestIndex])) merged[bestIndex] = line
      } else if (/\d/.test(line) || (lineQuality(line) >= 3 && !(/^.{1,8}$/.test(line) && !/[A-Z]{2}/.test(line)))) {
        // A short numeric observation may be the entire declaration value
        // (1L, 5g, 27, 0), or a damaged/conflicting reading that an officer must
        // inspect. Length/noise scoring must not silently erase these tokens.
        // Keeping a fragment does not assign it a heading or repair its text.
        merged.push(line)
        if (merged.length > 3000) throw new Error('OCR produced too many lines. Select a smaller declaration region.')
      }
    }
  }
  return merged.join('\n')
}

export function flattenOcrWords(blocks, panelId, fallbackWidth = 1, fallbackHeight = 1) {
  if (!Array.isArray(blocks)) return []
  const words = []
  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          const box = word.bbox || {}
          words.push({
            panelId,
            text: String(word.text || '').trim(),
            confidence: Number(word.confidence || 0),
            confidenceSource: typeof word.confidence === 'number' && Number.isFinite(word.confidence) && word.confidence >= 0 && word.confidence <= 100 ? 'engine' : 'unavailable',
            lineText: String(line.text || '').trim(),
            bbox: {
              x0: Number(box.x0 || 0), y0: Number(box.y0 || 0),
              x1: Number(box.x1 || 0), y1: Number(box.y1 || 0),
            },
            pageWidth: Number(block.page?.width || fallbackWidth || 1),
            pageHeight: Number(block.page?.height || fallbackHeight || 1),
          })
        }
      }
    }
  }
  return words.filter((word) => word.text)
}

const overlapScore = (evidence, lineText) => {
  const target = new Set(normalizeToken(evidence).split(' ').filter((token) => token.length > 1))
  const candidate = new Set(normalizeToken(lineText).split(' ').filter((token) => token.length > 1))
  if (!target.size || !candidate.size) return 0
  let overlap = 0
  target.forEach((token) => { if (candidate.has(token)) overlap += 1 })
  return overlap / Math.max(target.size, candidate.size)
}

export function matchDeclarationRegions(extraction, words = []) {
  if (!extraction?.fields?.length || !words.length) return []
  const lines = new Map()
  words.forEach((word) => {
    // OCR engines/crops can retain different coordinate frames for the same
    // panel and line. Union only within one frame and one geometry type: a
    // line polygon is not interchangeable with a set of glyph/word boxes.
    // Do not guess a scale or transform for mixed observations.
    const key = JSON.stringify([word.panelId, word.lineText, word.pageWidth, word.pageHeight, word.geometryKind ?? 'unspecified'])
    if (!lines.has(key)) lines.set(key, [])
    lines.get(key).push(word)
  })

  const regions = []
  extraction.fields.filter((field) => field.detected && field.evidence).forEach((field) => {
    let best = null
    for (const lineWords of lines.values()) {
      const score = overlapScore(field.evidence, lineWords[0]?.lineText)
      if (!best || score > best.score) best = { score, words: lineWords }
    }
    if (!best || best.score < 0.22) return
    const box = best.words.reduce((acc, word) => ({
      x0: Math.min(acc.x0, word.bbox.x0), y0: Math.min(acc.y0, word.bbox.y0),
      x1: Math.max(acc.x1, word.bbox.x1), y1: Math.max(acc.y1, word.bbox.y1),
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
    const first = best.words[0]
    regions.push({
      id: field.id,
      label: field.label,
      panelId: first.panelId,
      bbox: box,
      pageWidth: first.pageWidth,
      pageHeight: first.pageHeight,
      confidence: Math.round(best.words.reduce((sum, word) => sum + word.confidence, 0) / best.words.length),
      matchScore: Number(best.score.toFixed(2)),
      text: first.lineText,
      pixelHeight: Math.max(0, box.y1 - box.y0),
    })
  })
  return regions
}

export function measureRegion(region, referencePx, referenceMm, uncertaintyPercent = 0) {
  const px = Number(region?.pixelHeight)
  const refPx = Number(referencePx)
  const refMm = Number(referenceMm)
  if (!(px > 0 && refPx > 0 && refMm > 0)) return null
  const valueMm = (px / refPx) * refMm
  const uncertaintyMm = valueMm * (Math.max(0, Number(uncertaintyPercent) || 0) / 100)
  return { valueMm, uncertaintyMm, lower: valueMm - uncertaintyMm, upper: valueMm + uncertaintyMm }
}

export async function analyzeImageQuality(sourceUrl) {
  const image = await loadImage(sourceUrl)
  const max = 520
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const luminance = new Float32Array(canvas.width * canvas.height)
  let sum = 0; let sumSquares = 0; let glare = 0; let dark = 0
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    luminance[p] = value; sum += value; sumSquares += value * value
    if (value > 245) glare += 1
    if (value < 24) dark += 1
  }
  const count = luminance.length
  const brightness = sum / count
  const contrast = Math.sqrt(Math.max(0, sumSquares / count - brightness * brightness))
  let edgeSum = 0; let edgeCount = 0
  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const p = y * canvas.width + x
      const laplacian = Math.abs(4 * luminance[p] - luminance[p - 1] - luminance[p + 1] - luminance[p - canvas.width] - luminance[p + canvas.width])
      edgeSum += laplacian; edgeCount += 1
    }
  }
  const sharpness = edgeCount ? edgeSum / edgeCount : 0
  const glareRatio = glare / count
  const darkRatio = dark / count
  const brightnessScore = Math.max(0, 100 - Math.abs(brightness - 142) * 0.9)
  const contrastScore = Math.min(100, contrast * 2.4)
  const sharpnessScore = Math.min(100, sharpness * 9)
  const glareScore = Math.max(0, 100 - glareRatio * 700)
  const score = Math.round(brightnessScore * .2 + contrastScore * .25 + sharpnessScore * .35 + glareScore * .2)
  const issues = []
  if (brightness < 70 || darkRatio > .42) issues.push('Scene is too dark; add diffuse light.')
  if (brightness > 215) issues.push('Scene is overexposed; reduce direct light.')
  if (glareRatio > .08) issues.push('Specular glare may hide declarations; tilt the package.')
  if (sharpness < 5.5) issues.push('Image appears soft; hold the camera steady and move closer.')
  if (contrast < 24) issues.push('Low text contrast; enable OCR grayscale or increase contrast.')
  return {
    score,
    status: score >= 76 ? 'good' : score >= 52 ? 'review' : 'poor',
    brightness: Number(brightness.toFixed(1)), contrast: Number(contrast.toFixed(1)),
    sharpness: Number(sharpness.toFixed(1)), glarePercent: Number((glareRatio * 100).toFixed(1)),
    width: image.naturalWidth, height: image.naturalHeight, issues,
  }
}

export function selectReferenceCandidate(candidates = []) {
  return candidates
    .map((candidate) => {
      const boxArea = Math.max(1, candidate.width * candidate.height)
      const fillRatio = candidate.pixels / boxArea
      const ratio = candidate.width / Math.max(1, candidate.height)
      const aspectScore = Math.max(0, 1 - Math.abs(ratio - 4.5) / 3)
      const confidence = Math.round(Math.min(99, 45 + fillRatio * 35 + aspectScore * 19))
      return { ...candidate, ratio, fillRatio, confidence }
    })
    .filter((candidate) => candidate.ratio >= 3 && candidate.ratio <= 6.5 && candidate.fillRatio >= .68 && candidate.areaRatio >= .0007 && candidate.areaRatio <= .12)
    .sort((left, right) => right.confidence - left.confidence)[0] || null
}

export async function detectReferenceCard(sourceUrl) {
  const image = await loadImage(sourceUrl)
  const max = 420
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const visited = new Uint8Array(canvas.width * canvas.height)
  const matches = (p) => {
    const i = p * 4; const r = data[i]; const g = data[i + 1]; const b = data[i + 2]
    return g > 90 && g > r * 1.25 && g > b * 1.08
  }
  const candidates = []
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || !matches(start)) continue
    const queue = [start]; visited[start] = 1
    let minX = canvas.width; let minY = canvas.height; let maxX = 0; let maxY = 0; let pixels = 0
    for (let q = 0; q < queue.length; q += 1) {
      const p = queue[q]; const x = p % canvas.width; const y = Math.floor(p / canvas.width)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); pixels += 1
      for (const neighbor of [p - 1, p + 1, p - canvas.width, p + canvas.width]) {
        if (neighbor < 0 || neighbor >= visited.length || visited[neighbor] || !matches(neighbor)) continue
        const nx = neighbor % canvas.width
        if (Math.abs(nx - x) > 1) continue
        visited[neighbor] = 1; queue.push(neighbor)
      }
    }
    const width = maxX - minX + 1; const height = maxY - minY + 1
    const areaRatio = pixels / visited.length
    candidates.push({ minX, minY, maxX, maxY, width, height, pixels, areaRatio })
  }
  const best = selectReferenceCandidate(candidates)
  if (!best) return { detected: false, confidence: 0 }
  const factor = 1 / scale
  return {
    detected: true, confidence: best.confidence,
    bbox: { x0: best.minX * factor, y0: best.minY * factor, x1: best.maxX * factor, y1: best.maxY * factor },
    pixelWidth: best.width * factor,
    pixelHeight: best.height * factor,
    aspectRatio: Number(best.ratio.toFixed(2)),
    fillRatio: Number(best.fillRatio.toFixed(2)),
  }
}

const solveLinearSystem = (matrix, vector) => {
  const rows = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < rows.length; column += 1) {
    let pivot = column
    for (let row = column + 1; row < rows.length; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-9) throw new Error('The selected panel corners do not form a valid plane.')
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const divisor = rows[column][column]
    for (let entry = column; entry <= rows.length; entry += 1) rows[column][entry] /= divisor
    for (let row = 0; row < rows.length; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let entry = column; entry <= rows.length; entry += 1) rows[row][entry] -= factor * rows[column][entry]
    }
  }
  return rows.map((row) => row.at(-1))
}

const orderQuad = (points) => {
  const source = points.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
  if (source.length !== 4 || source.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('Four valid reference corners are required.')
  }
  const topLeft = source.reduce((best, point) => point.x + point.y < best.x + best.y ? point : best)
  const bottomRight = source.reduce((best, point) => point.x + point.y > best.x + best.y ? point : best)
  const topRight = source.reduce((best, point) => point.x - point.y > best.x - best.y ? point : best)
  const bottomLeft = source.reduce((best, point) => point.x - point.y < best.x - best.y ? point : best)
  const ordered = [topLeft, topRight, bottomRight, bottomLeft]
  if (new Set(ordered).size !== 4) throw new Error('Reference corners could not be ordered reliably.')
  return ordered
}

const solveHomography = (from, to) => {
  const matrix = []; const vector = []
  from.forEach((point, index) => {
    const target = to[index]
    matrix.push([point.x, point.y, 1, 0, 0, 0, -target.x * point.x, -target.x * point.y]); vector.push(target.x)
    matrix.push([0, 0, 0, point.x, point.y, 1, -target.y * point.x, -target.y * point.y]); vector.push(target.y)
  })
  return solveLinearSystem(matrix, vector)
}

const projectPoint = ([a, b, c, d, e, f, g, h], point) => {
  const denominator = g * point.x + h * point.y + 1
  if (Math.abs(denominator) < 1e-8) throw new Error('Reference plane is too oblique to flatten reliably.')
  return { x: (a * point.x + b * point.y + c) / denominator, y: (d * point.x + e * point.y + f) / denominator }
}

const renderHomography = (image, outputToSource, width, height) => {
  const [a, b, c, d, e, f, g, h] = outputToSource
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth; sourceCanvas.height = image.naturalHeight
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  sourceContext.drawImage(image, 0, 0)
  const sourcePixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width; outputCanvas.height = height
  const outputContext = outputCanvas.getContext('2d')
  const outputPixels = outputContext.createImageData(width, height)
  outputPixels.data.fill(255)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator = g * x + h * y + 1
      const sourceX = Math.round((a * x + b * y + c) / denominator)
      const sourceY = Math.round((d * x + e * y + f) / denominator)
      if (sourceX < 0 || sourceY < 0 || sourceX >= sourceCanvas.width || sourceY >= sourceCanvas.height) continue
      const from = (sourceY * sourceCanvas.width + sourceX) * 4
      const to = (y * width + x) * 4
      outputPixels.data[to] = sourcePixels.data[from]
      outputPixels.data[to + 1] = sourcePixels.data[from + 1]
      outputPixels.data[to + 2] = sourcePixels.data[from + 2]
      outputPixels.data[to + 3] = 255
    }
  }
  outputContext.putImageData(outputPixels, 0, 0)
  return outputCanvas.toDataURL('image/jpeg', .92)
}

export async function rectifyPlaneFromReference(sourceUrl, points = [], aspectRatio = 0) {
  const image = await loadImage(sourceUrl)
  const source = orderQuad(points)
  const distance = (left, right) => Math.hypot(right.x - left.x, right.y - left.y)
  const referenceWidth = (distance(source[0], source[1]) + distance(source[3], source[2])) / 2
  const observedHeight = (distance(source[0], source[3]) + distance(source[1], source[2])) / 2
  if (referenceWidth < 30 || observedHeight < 18) throw new Error('The detected reference is too small for reliable plane correction.')
  const ratio = Number(aspectRatio) > 0 ? Number(aspectRatio) : referenceWidth / observedHeight
  const referenceHeight = referenceWidth / ratio
  const planeReference = [{ x: 0, y: 0 }, { x: referenceWidth, y: 0 }, { x: referenceWidth, y: referenceHeight }, { x: 0, y: referenceHeight }]
  const sourceToPlane = solveHomography(source, planeReference)
  const projectedCorners = [
    { x: 0, y: 0 }, { x: image.naturalWidth, y: 0 },
    { x: image.naturalWidth, y: image.naturalHeight }, { x: 0, y: image.naturalHeight },
  ].map((point) => projectPoint(sourceToPlane, point))
  const minX = Math.min(...projectedCorners.map((point) => point.x)); const maxX = Math.max(...projectedCorners.map((point) => point.x))
  const minY = Math.min(...projectedCorners.map((point) => point.y)); const maxY = Math.max(...projectedCorners.map((point) => point.y))
  const spanX = maxX - minX; const spanY = maxY - minY
  if (!(spanX > 80 && spanY > 80) || spanX > image.naturalWidth * 6 || spanY > image.naturalHeight * 6) throw new Error('Barcode perspective is too extreme for a stable full-panel correction.')
  const scale = Math.min(1, 1800 / Math.max(spanX, spanY))
  const width = Math.max(80, Math.round(spanX * scale)); const height = Math.max(80, Math.round(spanY * scale))
  const outputReference = planeReference.map((point) => ({ x: (point.x - minX) * scale, y: (point.y - minY) * scale }))
  const outputToSource = solveHomography(outputReference, source)
  return { dataUrl: renderHomography(image, outputToSource, width, height), width, height, sourcePoints: source }
}

export async function rectifyPerspective(sourceUrl, points = []) {
  if (points.length !== 4) throw new Error('Select four panel corners in order: top-left, top-right, bottom-right, bottom-left.')
  const image = await loadImage(sourceUrl)
  const source = points.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
  if (source.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Perspective points are invalid.')
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
  const rawWidth = (distance(source[0], source[1]) + distance(source[3], source[2])) / 2
  const rawHeight = (distance(source[0], source[3]) + distance(source[1], source[2])) / 2
  if (rawWidth < 80 || rawHeight < 80) throw new Error('The selected panel is too small to flatten reliably.')
  const scale = Math.min(1, 1800 / Math.max(rawWidth, rawHeight))
  const width = Math.max(80, Math.round(rawWidth * scale))
  const height = Math.max(80, Math.round(rawHeight * scale))
  const destination = [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }]
  const matrix = []; const vector = []
  destination.forEach((point, index) => {
    const target = source[index]
    matrix.push([point.x, point.y, 1, 0, 0, 0, -target.x * point.x, -target.x * point.y]); vector.push(target.x)
    matrix.push([0, 0, 0, point.x, point.y, 1, -target.y * point.x, -target.y * point.y]); vector.push(target.y)
  })
  const [a, b, c, d, e, f, g, h] = solveLinearSystem(matrix, vector)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth; sourceCanvas.height = image.naturalHeight
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  sourceContext.drawImage(image, 0, 0)
  const sourcePixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = width; outputCanvas.height = height
  const outputContext = outputCanvas.getContext('2d')
  const outputPixels = outputContext.createImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator = g * x + h * y + 1
      const sourceX = Math.max(0, Math.min(sourceCanvas.width - 1, Math.round((a * x + b * y + c) / denominator)))
      const sourceY = Math.max(0, Math.min(sourceCanvas.height - 1, Math.round((d * x + e * y + f) / denominator)))
      const from = (sourceY * sourceCanvas.width + sourceX) * 4
      const to = (y * width + x) * 4
      outputPixels.data[to] = sourcePixels.data[from]
      outputPixels.data[to + 1] = sourcePixels.data[from + 1]
      outputPixels.data[to + 2] = sourcePixels.data[from + 2]
      outputPixels.data[to + 3] = 255
    }
  }
  outputContext.putImageData(outputPixels, 0, 0)
  return { dataUrl: outputCanvas.toDataURL('image/jpeg', .92), width, height, sourcePoints: source }
}

export async function webXrDepthSupport() {
  if (!navigator.xr?.isSessionSupported) return { supported: false, reason: 'WebXR is unavailable in this browser.' }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar')
    return { supported, reason: supported ? 'AR session available; device depth still requires runtime permission.' : 'Immersive AR is not supported on this device.' }
  } catch (error) {
    return { supported: false, reason: error.message || 'Depth capability check failed.' }
  }
}
