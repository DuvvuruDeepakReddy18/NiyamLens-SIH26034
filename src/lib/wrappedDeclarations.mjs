// Bounded text-line association for literal headings whose value is printed on
// the next line. Do not jump across panels, declaration headings or blank gaps.
const STOP = /^(?:\[|M\s*\.?\s*R\s*\.?\s*P\b|MAXIMUM\s+RETAIL|NET\b|PACKED\b|PKD\b|MFG\b|MFD\b|MANUFACTURED\b|IMPORTED\b|CONSUMER\b|CUSTOMER\b|COUNTRY\b|COMMON\b|GENERIC\b|BEST\b|EXPIRY\b|FSSAI\b|INGREDIENTS?\b|NUTRITION\b|BARCODE\b|BATCH\b|LOT\b|UNIT\s+(?:SALE|PRICE))/i
export function wrappedDeclaration(text, heading, { kind = 'text', maxLines = 1 } = {}) {
  const lines = String(text || '').slice(0, 100000).replace(/\r/g, '').split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (!heading.test(lines[index].trim())) continue
    const collected = []
    for (let offset = 1; offset <= maxLines; offset++) {
      const line = lines[index + offset]?.trim()
      if (!line || line.length > 300 || STOP.test(line)) break
      if (kind === 'date' && !/\d/.test(line)) break
      if (kind === 'text' && (!/[a-z]{2}/i.test(line) || /^(?:N\/?A|UNKNOWN|NONE|NOT AVAILABLE|[-:.]+)$/i.test(line) || /^[\d,.]+\s*(?:KG|KGS|G|GM|GMS|GRAMS?|ML|L|LTR|LITRES?|LITERS?|PCS?|PIECES?)$/i.test(line))) break
      collected.push(line)
    }
    return { heading: lines[index].trim(), value: collected.join(' '), evidence: [lines[index].trim(), ...collected].join(' · '), wrapped: collected.length > 0 }
  }
  return null
}
