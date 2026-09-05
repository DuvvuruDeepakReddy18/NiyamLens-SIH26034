// Canonical bounded text parsers shared by extraction and deterministic rules.
export const MAX_LABEL_TEXT = 100000
export const normalizeUnit = unit => {
  const u = String(unit || '').toLowerCase().replace(/\./g, '')
  if (['gm', 'gms', 'gram', 'grams'].includes(u)) return 'g'
  if (['kgs', 'kilogram', 'kilograms'].includes(u)) return 'kg'
  if (['ltr', 'litre', 'litres', 'liter', 'liters', 'ℓ'].includes(u)) return 'l'
  if (['pc', 'pcs', 'piece', 'pieces', 'n', 'nos', 'unit', 'units'].includes(u)) return 'pcs'
  return u
}
export function parsePositiveNumber(token, precision = 6) {
  const raw = String(token || '').trim()
  if (!raw || raw.length > 40 || !/^[\d,.]+$/.test(raw)) return null
  const parts = raw.split('.')
  if (parts.length > 2 || (parts.length === 2 && (!parts[1] || parts[1].length > precision))) return null
  const whole = parts[0]
  if (whole.includes(',') && !/^\d{1,3}(?:,\d{3})+$/.test(whole) && !/^\d{1,2}(?:,\d{2})*,\d{3}$/.test(whole)) return null
  if (!whole.replace(/,/g, '') || !/^\d+$/.test(whole.replace(/,/g, '')) || (parts[1] && !/^\d+$/.test(parts[1]))) return null
  const normalized = raw.replace(/,/g, '')
  const number = Number(normalized)
  if (!Number.isFinite(number) || number <= 0 || number > 1e12) return null
  return { number, normalized, minorUnits: precision === 2 ? Math.round(number * 100) : null }
}
const unique = list => [...new Map(list.map(c => [c.key, c])).values()]
const candidate = (value, line, typed, valid, message = '') => ({ value, evidence: line.slice(0, 2000), ...typed, valid, key: valid ? JSON.stringify(typed) : `invalid:${value}`, validation: { status: valid ? 'format_valid' : 'invalid', message } })
// Compact stamps often print MRP27 without a separator. A word boundary after
// P rejects the digit (both are word characters); explicitly allow that digit,
// but never a larger word such as MRPENDING or a preceding batch-code letter.
const MONEY_HEADING = /\b(?:M[ \t]*[.·]?[ \t]*R[ \t]*[.·]?[ \t]*P|MAXIMUM[ \t]+RETAIL[ \t]+PRICE)(?=\b|\d)/gi
const QUANTITY_HEADING = /\bNET[ \t]*(?:QTY|QUANTITY|WT|WEIGHT|VOL(?:UME)?|CONTENTS?)\b\.?|\bCONTENTS?\b(?=[ \t]*:|[ \t]+[+-]?[\d,.])/gi
const UNIT_PRICE_HEADING = /\b(?:UNIT[ \t]+SALE[ \t]+PRICE|UNIT[ \t]+PRICE|USP)\b/gi
const PACKING_HEADING = /\b(?:MFG|MFD|MANUFACTURED|PACKED|PKD|IMPORTED)\b\.?(?:[ \t]+(?:ON|DATE)\b\.?)?/gi
const UNIT_TOKEN = '(KG|KGS|G|GM|GMS|GRAMS?|ML|L|LTR|LITRES?|LITERS?|ℓ|PCS?|PIECES?|N|NOS)'
function valuesAfterHeadings(line, regex, parse) {
  const found = [...line.matchAll(new RegExp(regex.source, regex.flags))]
  return found.map((match, i) => parse(line.slice(match.index + match[0].length, found[i + 1]?.index).trim(), line))
}
export function parseLabelNumbers(text) {
  const raw = String(text || '').slice(0, MAX_LABEL_TEXT).replace(/\r/g, '')
  const mrp = [], netQuantity = [], unitSalePrice = []
  const lines = raw.split('\n')
  for (const [lineIndex, line] of lines.entries()) {
    mrp.push(...valuesAfterHeadings(line, MONEY_HEADING, (tail, evidence) => {
      tail = tail.replace(/^\.(?=[ \t]|₹|RS\.?|INR)/i, '').trimStart()
      // A literal tax qualifier may appear before the amount. Never skip an
      // arbitrary parenthesis or rewrite digits/currency to obtain a reading.
      tail = tail.replace(/^\([ \t]*(?:INCLUSIVE|INCL\.?)\s+OF\s+ALL\s+TAXES[ \t]*\)[ \t]*/i, '')
      const match = /^[ \t]*[:]?\s*(?:₹|RS\.?|INR)?[ \t]*[:]?\s*([+-]?[ \t]*[\d,.]+)/i.exec(tail)
      const token = match?.[1]?.replace(/[ \t]/g, '') || ''
      const parsed = parsePositiveNumber(token, 2)
      const valid = Boolean(parsed) && !/^[A-Z\d,.+\-]/i.test(tail.slice(match?.[0]?.length || 0))
      return candidate(valid ? parsed.normalized : token, evidence, { amount: valid ? parsed.number : null, minorUnits: valid ? parsed.minorUnits : null }, valid, valid ? 'Price amount parsed; legal applicability is evaluated separately.' : 'Missing or invalid price: grouping, sign and precision require correction.')
    }))
    // A standalone quantity heading may be immediately followed by one whole
    // numeric+unit line. Preserve both original lines as evidence. Do not jump
    // over text, panel markers, serving qualifiers or infer dates this way.
    const quantityHeadings = [...line.matchAll(new RegExp(QUANTITY_HEADING.source, QUANTITY_HEADING.flags))]
    const heading = quantityHeadings.length === 1 ? quantityHeadings[0] : null
    const nextLine = lines[lineIndex + 1] || ''
    const stackedQuantity = heading && !line.slice(0, heading.index).trim() && /^[.:\s]*$/.test(line.slice(heading.index + heading[0].length))
      && new RegExp(`^[ \\t]*[+-]?[ \\t]*[\\d,.]+[ \\t]*${UNIT_TOKEN}[ \\t]*$`, 'i').test(nextLine)
    const quantityLine = stackedQuantity ? `${line} ${nextLine.trim()}` : line
    netQuantity.push(...valuesAfterHeadings(quantityLine, QUANTITY_HEADING, (tail, evidence) => {
      if (stackedQuantity) evidence = `${line}\n${nextLine}`
      const match = new RegExp(`^[ \\t]*[:]?[ \\t]*([+-]?[ \\t]*[\\d,.]+)[ \\t]*${UNIT_TOKEN}(?![\\p{L}\\p{N}_])`, 'iu').exec(tail)
      const parsed = parsePositiveNumber(match?.[1]?.replace(/[ \t]/g, ''))
      const unit = normalizeUnit(match?.[2])
      const trailing = tail.slice(match?.[0]?.length || 0).trimStart()
      const composite = /^[\/+×x\-]/i.test(trailing)
      const valid = Boolean(parsed && unit) && !composite && (unit !== 'pcs' || Number.isInteger(parsed.number))
      return candidate(valid ? `${parsed.number} ${unit}` : tail.slice(0, 100), evidence, { quantity: valid ? parsed.number : null, unit }, valid, valid ? 'Positive net quantity parsed.' : 'Quantity must be a finite positive value with a supported unit.')
    }))
    const parseUnitPrice = (source, evidence) => {
      const tail = source.replace(/^[ \t]*:[ \t]*/, '').trim()
      const match = /^(?:₹|RS\.?|INR)?\s*([+-]?[\d,.]+)\s*\/\s*(?:(\d+)\s*)?(KG|G|ML|L|UNIT|PCS?)\b/i.exec(tail)
      const amount = parsePositiveNumber(match?.[1], 2)
      const denominator = match?.[2] ? Number(match[2]) : 1
      const valid = Boolean(amount && match && Number.isSafeInteger(denominator) && denominator > 0)
      return candidate(`UNIT SALE PRICE ${tail}`.trim(), evidence, { amount: valid ? amount.number : null, minorUnits: valid ? amount.minorUnits : null, unit: normalizeUnit(match?.[3]), denominator }, valid, valid ? 'Unit-price amount and denominator parsed.' : 'A numeric unit sale price and explicit denominator are required.')
    }
    const headed = valuesAfterHeadings(line, UNIT_PRICE_HEADING, parseUnitPrice)
    if (headed.length) unitSalePrice.push(...headed)
    else if (/^(?:₹|RS\.?|INR)\s*[\d,.]+\s*\//i.test(line.trim())) unitSalePrice.push(parseUnitPrice(line, line))
  }
  return { mrp: unique(mrp), netQuantity: unique(netQuantity), unitSalePrice: unique(unitSalePrice) }
}
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
export function parsePackingDates(text) {
  const result = []
  for (const line of String(text || '').slice(0, MAX_LABEL_TEXT).split('\n')) {
    result.push(...valuesAfterHeadings(line, PACKING_HEADING, (source, evidence) => {
    const tail = source.replace(/^[ \t]*:[ \t]*/, '').trim().slice(0, 80)
    // Role/address references (MFD BY, or a standalone MFD & continuation)
    // are not date values. Keep arbitrary damaged dates/empty headings invalid;
    // this narrow conjunction case must not manufacture a conflicting date.
    if (/^BY\b/i.test(tail) || /^(?:&|AND)\s*$/i.test(tail)) return null
    // Require the whole date token. Otherwise optional-day backtracking can
    // accept a clipped DD/MM/Y as MM/YY (02/08/2 -> February 2008), or accept
    // the prefix of an extra component. A trailing separator is unresolved,
    // even when it could be punctuation; never repair an OCR date by omission.
    const numeric = /^(?:(\d{1,2})\s*[\/.-]\s*)?(\d{1,2})\s*[\/.-]\s*(\d{4}|\d{2})\b(?![ \t]*[\/.-])/.exec(tail)
    const named = /^(?:(\d{1,2})\s+)?([A-Z]+)\s+(\d{4}|\d{2})\b(?![ \t]*[\/.-])/i.exec(tail)
    const match = numeric || named
    const day = Number(match?.[1] || 1)
    const name = named?.[2].toUpperCase()
    const month = numeric ? Number(numeric[2]) : named ? MONTHS.findIndex(m => name === m || name === m.slice(0, 3) || m === 'SEPTEMBER' && name === 'SEPT') + 1 : 0
    const yearRaw = match?.[3] || ''
    const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw)
    const date = new Date(Date.UTC(year, month - 1, day))
    const valid = Boolean(match) && year >= 1900 && year <= 2199 && month >= 1 && month <= 12 && day >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    return candidate(match?.[0] || tail, evidence, { year, month, day: match?.[1] ? day : null }, valid, valid ? 'Calendar-valid date; product-specific date rules may still require review.' : 'Date is not a valid calendar date.')
    }).filter(Boolean))
  }
  return unique(result)
}
// Split maximal email-character runs in one pass. Overlong malformed runs are
// rejected as one token: no unanchored quantifier repeatedly rescans its suffix.
export function findBoundedEmail(text) {
  const raw = String(text || '').slice(0, MAX_LABEL_TEXT)
  const char = c => /[A-Za-z0-9._%+@-]/.test(c)
  let start = -1
  for (let i = 0; i <= raw.length; i++) {
    if (i < raw.length && char(raw[i])) { if (start < 0) start = i; continue }
    if (start < 0) continue
    const length = i - start
    if (length >= 6 && length <= 254) {
      const token = raw.slice(start, i).replace(/\.$/, '')
      const parts = token.split('@')
      if (parts.length === 2 && parts[0].length <= 64 && !parts[0].startsWith('.') && !parts[0].endsWith('.') && !parts[0].includes('..') && /^[A-Z0-9._%+-]+$/i.test(parts[0])) {
        const labels = parts[1].split('.')
        if (labels.length > 1 && labels.every(l => l.length >= 1 && l.length <= 63 && /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(l)) && /^[A-Z]{2,63}$/i.test(labels.at(-1))) {
          const left = raw.lastIndexOf('\n', start) + 1, end = raw.indexOf('\n', i)
          return { found: true, value: token, line: raw.slice(left, end < 0 ? undefined : end).slice(0, 2000).trim() }
        }
      }
    }
    start = -1
  }
  return { found: false, value: '', line: '' }
}
