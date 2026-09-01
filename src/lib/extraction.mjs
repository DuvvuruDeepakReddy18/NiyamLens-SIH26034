import { findConsumerAddress, findConsumerPhone } from './consumerContact.mjs'

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

const field = (id, label, value = '', evidence = '', confidence = 0) => ({
  id,
  label,
  value: value ? String(value).trim() : '',
  evidence: evidence ? String(evidence).trim() : '',
  confidence: Math.max(0, Math.min(100, Math.round(confidence))),
  detected: Boolean(value || evidence),
})

export const normalizeUnit = (unit) => {
  const normalized = String(unit || '').toLowerCase().replace(/\./g, '')
  if (['gm', 'gms', 'gram', 'grams'].includes(normalized)) return 'g'
  if (['kgs', 'kilogram', 'kilograms'].includes(normalized)) return 'kg'
  if (['ltr', 'litre', 'litres', 'liter', 'liters'].includes(normalized)) return 'l'
  if (['pc', 'pcs', 'piece', 'pieces', 'n', 'nos'].includes(normalized)) return 'pcs'
  return normalized
}

export function extractDeclarations(text) {
  const raw = String(text || '').replace(/\r/g, '').trim()
  const lines = cleanLines(raw)

  const mrpMatch = raw.match(/\b(?:MRP|MAXIMUM\s+RETAIL\s+PRICE)\b[^\d\n]{0,28}(?:₹|RS\.?|INR)?\s*[:\-]?\s*(\d+(?:\.\d{1,2})?)/i)
  const quantityMatch = raw.match(/\b(?:NET\s*(?:QTY|QUANTITY|WT\.?|WEIGHT)|CONTENTS?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GMS|GRAMS?|ML|L|LTR|LITRES?|LITERS?|PCS?|PIECES?|N|NOS)\b/i)
  const dateMatch = raw.match(/\b(?:MFG|MFD|MANUFACTURED|PACKED|PKD|IMPORTED)(?:\s+(?:ON|DATE))?\s*[:\-]?\s*((?:(?:0?[1-9]|[12]\d|3[01])\s*[\/\-.]\s*)?(?:0?[1-9]|1[0-2])\s*[\/\-.]\s*(?:20)?\d{2}|(?:(?:0?[1-9]|[12]\d|3[01])\s+)?(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(?:20)?\d{2})\b/i)
  const bestBeforeMatch = raw.match(/\b(?:BEST\s+BEFORE|USE\s+BY|EXPIRY|EXP)\s*[:\-]?\s*([^\n]{3,30})/i)
  const manufacturerMatch = raw.match(/\b(?:MANUFACTURED|MFD|PACKED|IMPORTED)\s+BY\b[^\n]*|\b(?:MANUFACTURER|PACKER|IMPORTER)\s*[:\-][^\n]*/i)
  const careMatch = raw.match(/\b(?:CONSUMER|CUSTOMER)\s*(?:CARE|COMPLAINT)[^\n]*|\bHELPLINE\b[^\n]*|\bCOMPLAINTS?\b[^\n]*/i)
  const emailMatch = raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)
  const phoneMatch = findConsumerPhone(raw)
  const originMatch = raw.match(/\b(?:COUNTRY\s+OF\s+ORIGIN|MADE\s+IN|PRODUCT\s+OF)\s*[:\-]?\s*([^\n]{2,40})/i)
  const unitPriceMatch = raw.match(/\b(?:UNIT\s+SALE\s+PRICE|UNIT\s+PRICE|USP)\b[^\n]*|(?:₹|RS\.?)\s*\d+(?:\.\d+)?\s*\/\s*(?:KG|G|ML|L|UNIT)/i)
  const genericMatch = raw.match(/\b(?:COMMON|GENERIC)\s+NAME\s*[:\-]?\s*([^\n]{2,60})/i)
  const barcodeMatch = raw.match(/\b(?:EAN|GTIN|BARCODE)\s*[:\-]?\s*(\d{8,14})\b/i)

  const excludedFirstLine = /^(?:MRP|NET\s|PACKED|MFG|MFD|MANUFACTURED|CONSUMER|CUSTOMER|HELPLINE|UNIT\s|COUNTRY\s|MADE\s|INGREDIENTS?|NUTRITION|\[)/i
  const productFallback = lines.find((line) => line.length >= 3 && line.length <= 70 && !excludedFirstLine.test(line)) || ''

  const manufacturerLine = lineContaining(lines, manufacturerMatch)
  const manufacturerIndex = manufacturerLine ? lines.indexOf(manufacturerLine) : -1
  const responsibleEvidence = manufacturerIndex >= 0
    ? [manufacturerLine, lines[manufacturerIndex + 1]].filter(Boolean).join(' · ')
    : ''
  const careAddress = findConsumerAddress(raw)

  const fields = [
    field('productName', 'Product / generic name', genericMatch?.[1] || productFallback, genericMatch ? lineContaining(lines, genericMatch) : productFallback, genericMatch ? 94 : productFallback ? 72 : 0),
    field('mrp', 'Maximum Retail Price', mrpMatch?.[1], lineContaining(lines, mrpMatch), mrpMatch ? 96 : 0),
    field('netQuantity', 'Net quantity', quantityMatch ? `${quantityMatch[1]} ${normalizeUnit(quantityMatch[2])}` : '', lineContaining(lines, quantityMatch), quantityMatch ? 96 : 0),
    field('packDate', 'Month / year', dateMatch?.[1], lineContaining(lines, dateMatch), dateMatch ? 92 : 0),
    field('bestBefore', 'Best before / use by', bestBeforeMatch?.[1], lineContaining(lines, bestBeforeMatch), bestBeforeMatch ? 88 : 0),
    field('responsibleEntity', 'Manufacturer / packer / importer', manufacturerMatch?.[0], responsibleEvidence, manufacturerMatch ? 89 : 0),
    field('consumerCare', 'Consumer-care channel', careMatch?.[0], lineContaining(lines, careMatch), careMatch ? 90 : 0),
    field('consumerAddress', 'Consumer-care address', careAddress.value, careAddress.line, careAddress.found ? 86 : 0),
    field('email', 'Consumer-care email', emailMatch?.[0], lineContaining(lines, emailMatch), emailMatch ? 98 : 0),
    field('phone', 'Consumer-care phone', phoneMatch.value, phoneMatch.line, phoneMatch.found ? 94 : 0),
    field('countryOrigin', 'Country of origin', originMatch?.[1], lineContaining(lines, originMatch), originMatch ? 92 : 0),
    field('unitSalePrice', 'Unit sale price', unitPriceMatch?.[0], lineContaining(lines, unitPriceMatch), unitPriceMatch ? 90 : 0),
    field('barcode', 'Barcode / GTIN', barcodeMatch?.[1], lineContaining(lines, barcodeMatch), barcodeMatch ? 96 : 0),
  ]

  const byId = Object.fromEntries(fields.map((item) => [item.id, item]))
  const category = /\b(?:FSSAI|INGREDIENTS?|NUTRITION(?:AL)?|VEG\s*LOGO)\b/i.test(raw)
    ? 'food'
    : /\b(?:IMPORTED\s+BY|COUNTRY\s+OF\s+ORIGIN)\b/i.test(raw)
      ? 'imported'
      : /\b(?:MEDICAL\s+DEVICE|STERILE|UDI)\b/i.test(raw)
        ? 'medical'
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
    fields,
    byId,
    coverage: fields.length ? Math.round((detected / fields.length) * 100) : 0,
    suggestions: {
      productName: byId.productName.value,
      category,
      commodityClass,
      quantity: quantityMatch ? Number(quantityMatch[1]) : null,
      unit: quantityMatch ? normalizeUnit(quantityMatch[2]) : '',
      barcode: byId.barcode.value,
    },
  }
}
