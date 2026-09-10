import { findConsumerAddress, findConsumerPhone } from './consumerContact.mjs'
import { normalizeUnit, parseLabelNumbers, parsePackingDates, findBoundedEmail, MAX_LABEL_TEXT } from './labelParser.mjs'
import { wrappedDeclaration } from './wrappedDeclarations.mjs'
export { normalizeUnit } from './labelParser.mjs'

const cleanLines = (text) =>
  String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !/^\[PANEL\s+\d+/i.test(line))

const lineContaining = (lines, match) => {
  if (!match) return ''
  const needle = String(match[0] || match).toLowerCase()
  return lines.find((line) => line.toLowerCase().includes(needle)) || ''
}

const field = (id, label, value = '', evidence = '', confidence = 0, validation = null) => ({
  id,
  label,
  value: value ? String(value).trim() : '',
  evidence: evidence ? String(evidence).trim() : '',
  confidence: Math.max(0, Math.min(100, Math.round(confidence))),
  detected: Boolean(value || evidence),
  validation,
})

export function isValidGtin(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (![8, 12, 13, 14].includes(digits.length)) return false
  const checkDigit = Number(digits.at(-1))
  const body = digits.slice(0, -1).split('').reverse().map(Number)
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === checkDigit
}

export function extractDeclarations(text) {
  const supplied = String(text || '')
  const raw = supplied.slice(0, MAX_LABEL_TEXT).replace(/\r/g, '').trim()
  const lines = cleanLines(raw)
  const candidates = { ...parseLabelNumbers(raw), packDate: parsePackingDates(raw) }
  const resolved = id => candidates[id].length === 1 && candidates[id][0].valid ? candidates[id][0] : null
  const bestBeforeMatch = raw.match(/\b(?:BEST\s+BEFORE|USE\s+BY|EXPIRY|EXP)\s*[:\-]?\s*([^\n]{3,30})/i)
  const manufacturerMatch = raw.match(/\b(?:MANUFACTURED|MFD|PACKED|IMPORTED)\s+BY\b[^\n]*|\b(?:MANUFACTURER|PACKER|IMPORTER)\s*[:\-][^\n]*/i)
  const careMatch = raw.match(/\b(?:CONSUMER|CUSTOMER)\s*(?:CARE|COMPLAINT)[^\n]*|\bHELPLINE\b[^\n]*|\bCOMPLAINTS?\b[^\n]*/i)
  const emailMatch = findBoundedEmail(raw)
  const phoneMatch = findConsumerPhone(raw)
  const originMatch = raw.match(/\b(?:COUNTRY[ \t]+OF[ \t]+ORIGIN|MADE[ \t]+IN|PRODUCT[ \t]+OF)[ \t]*[:\-]?[ \t]*([^\n]{2,80})/i)
  const genericMatch = raw.match(/\b(?:COMMON|GENERIC)[ \t]+NAME[ \t]*[:\-]?[ \t]*([^\n]{2,60})/i)
  const barcodeMatch = raw.match(/\b(?:EAN|GTIN|BARCODE)\s*[:\-]?\s*(\d{8,14})\b/i)
  const fssaiMatch = raw.match(/\bFSSAI\b[^\d\n]{0,35}(?:LIC(?:ENCE)?\.?\s*(?:NO\.?)?)?[^\d\n]{0,12}(\d(?:[\s-]?\d){13})\b/i)
  const fssaiLicense = fssaiMatch?.[1]?.replace(/\D/g, '') || ''
  const wrappedName = wrappedDeclaration(raw, /^(?:COMMON|GENERIC)[ \t]+NAME[ \t]*[:\-]?[ \t]*$/i)
  const wrappedOrigin = wrappedDeclaration(raw, /^(?:COUNTRY[ \t]+OF[ \t]+ORIGIN|MADE[ \t]+IN|PRODUCT[ \t]+OF)[ \t]*[:\-]?[ \t]*$/i)
  const wrappedMaker = wrappedDeclaration(raw, /^(?:(?:MANUFACTURED|MFD|PACKED|IMPORTED)[ \t]+BY|MANUFACTURER|PACKER|IMPORTER)[ \t]*[:\-]?[ \t]*$/i, { maxLines: 3 })
  const wrappedExpiry = wrappedDeclaration(raw, /^(?:BEST[ \t]+BEFORE|USE[ \t]+BY|EXPIRY|EXP)[ \t]*[:\-]?[ \t]*$/i, { kind: 'date' })
  const wrappedField = (id, label, block, includeHeading = false) => field(id, label, block.value ? (includeHeading ? `${block.heading} ${block.value}` : block.value) : '', block.evidence, block.value ? 75 : 0, block.value ? { status: 'layout_candidate', message: 'Literal heading and adjacent text lines associated; verify their layout on the package.' } : { status: 'invalid', message: 'Heading detected without an adjacent readable value. Capture the declaration close-up.' })

  const excludedFirstLine = /^(?:MRP|NET\s|PACKED|MFG|MFD|MANUFACTURED|CONSUMER|CUSTOMER|HELPLINE|UNIT\s|COUNTRY\s|MADE\s|INGREDIENTS?|NUTRITION|\[)/i
  // A title heuristic may inspect the first label line only. Searching past a
  // declaration heading invents names such as "500ml" or a customer-care phone.
  // Explicit COMMON/GENERIC NAME labels still take precedence anywhere below.
  const firstLabelLine = lines.find(line => !line.startsWith('[')) || ''
  const productFallback = firstLabelLine.length >= 3 && firstLabelLine.length <= 70 && !excludedFirstLine.test(firstLabelLine)
    && /[A-Z]{3}/i.test(firstLabelLine) && !/^[\d\s+().,/\-]+$/.test(firstLabelLine)
    && !/^[\d,.]+\s*(?:KG|KGS|G|GM|GMS|GRAMS?|ML|L|LTR|LITRES?|LITERS?|PCS?|PIECES?)$/i.test(firstLabelLine) ? firstLabelLine : ''

  const manufacturerLine = lineContaining(lines, manufacturerMatch)
  const manufacturerIndex = manufacturerLine ? lines.indexOf(manufacturerLine) : -1
  const responsibleEvidence = manufacturerIndex >= 0
    ? [manufacturerLine, lines[manufacturerIndex + 1]].filter(Boolean).join(' · ')
    : ''
  const careAddress = findConsumerAddress(raw)
  const numericField = (id, label, confidence) => {
    const choices = candidates[id]
    const conflict = choices.length > 1
    const selected = choices[0]
    const validation = conflict ? { status: 'conflict', message: 'Distinct declarations occur in this transcript; resolve their package/panel scope before deciding compliance.' } : selected?.validation || null
    return { ...field(id, label, conflict ? '' : selected?.value, choices.map(c => c.evidence).join(' | ').slice(0, 2000), resolved(id) ? confidence : 0, validation), candidates: choices, conflict }
  }

  const fields = [
    wrappedName ? wrappedField('productName', 'Product / generic name', wrappedName) : field('productName', 'Product / generic name', genericMatch?.[1] || productFallback, genericMatch ? lineContaining(lines, genericMatch) : productFallback, genericMatch ? 94 : productFallback ? 72 : 0),
    numericField('mrp', 'Maximum Retail Price', 96),
    numericField('netQuantity', 'Net quantity', 96),
    numericField('packDate', 'Month / year', 92),
    wrappedExpiry ? wrappedField('bestBefore', 'Best before / use by', wrappedExpiry) : field('bestBefore', 'Best before / use by', bestBeforeMatch?.[1], lineContaining(lines, bestBeforeMatch), bestBeforeMatch ? 88 : 0),
    wrappedMaker ? wrappedField('responsibleEntity', 'Manufacturer / packer / importer', wrappedMaker, true) : field('responsibleEntity', 'Manufacturer / packer / importer', manufacturerMatch?.[0], responsibleEvidence, manufacturerMatch ? 89 : 0),
    field('consumerCare', 'Consumer-care channel', careMatch?.[0], lineContaining(lines, careMatch), careMatch ? 90 : 0),
    field('consumerAddress', 'Consumer-care address', careAddress.value, careAddress.line, careAddress.found ? 86 : 0),
    field('email', 'Consumer-care email', emailMatch.value, emailMatch.line, emailMatch.found ? 98 : 0),
    field('phone', 'Consumer-care phone', phoneMatch.value, phoneMatch.line, phoneMatch.found ? 94 : 0),
    wrappedOrigin ? wrappedField('countryOrigin', 'Country of origin', wrappedOrigin) : field('countryOrigin', 'Country of origin', originMatch?.[1], lineContaining(lines, originMatch), originMatch ? 92 : 0),
    numericField('unitSalePrice', 'Unit sale price', 90),
    field('fssaiLicense', 'FSSAI licence', fssaiLicense, lineContaining(lines, fssaiMatch), fssaiMatch ? 95 : 0, fssaiLicense ? { status: 'format_valid', message: '14-digit licence format detected; registry validity is not inferred.' } : null),
    field('barcode', 'Barcode / GTIN', barcodeMatch?.[1], lineContaining(lines, barcodeMatch), barcodeMatch ? 96 : 0, barcodeMatch ? { status: isValidGtin(barcodeMatch[1]) ? 'check_digit_valid' : 'check_digit_invalid', message: isValidGtin(barcodeMatch[1]) ? 'GTIN check digit is valid.' : 'GTIN check digit failed; verify OCR or scan the barcode.' } : null),
  ]

  const byId = Object.fromEntries(fields.map((item) => [item.id, item]))
  const category = /\b(?:MEDICAL\s+DEVICE|STERILE|UDI)\b/i.test(raw)
    ? 'medical'
    : /\b(?:IMPORTED\s+BY|COUNTRY\s+OF\s+ORIGIN)\b/i.test(raw)
      ? 'imported'
      : /\b(?:FSSAI|INGREDIENTS?|NUTRITION(?:AL)?|VEG\s*LOGO)\b/i.test(raw)
        ? 'food'
        : 'general'
  const commodityClass = /\bPAN\s*MASALA\b/i.test(raw)
    ? 'pan_masala'
    : /\b(?:TOBACCO|CIGARETTE|CIGAR|BIDI|BEEDI|GUTKHA)\b/i.test(raw)
      ? 'tobacco'
      : /\b(?:RESTAURANT|HOTEL)\s+PACKED\b/i.test(raw)
        ? 'fast_food'
        : 'standard'

  const detected = fields.filter((item) => item.detected).length
  return {
    raw,
    inputTooLarge: supplied.length > MAX_LABEL_TEXT,
    candidates,
    conflicts: Object.fromEntries(Object.entries(candidates).filter(([, values]) => values.length > 1)),
    fields,
    byId,
    coverage: fields.length ? Math.round((detected / fields.length) * 100) : 0,
    suggestions: {
      productName: byId.productName.value,
      category,
      commodityClass,
      quantity: resolved('netQuantity')?.quantity ?? null,
      unit: resolved('netQuantity')?.unit || '',
      barcode: byId.barcode.value,
    },
  }
}
