const CARE_SIGNAL = /\b(?:CONSUMER|CUSTOMER)\s*(?:CARE|COMPLAINT)|\bHELPLINE\b|\bCOMPLAINTS?\b/i
const PHONE_LABEL = /\b(?:TELEPHONE|TEL\.?|PHONE|MOBILE|HELPLINE|CONTACT(?:\s+NO\.?)?|CONSUMER\s+CARE|CUSTOMER\s+CARE)\b/i
const TOLL_FREE = /\b1800[\s-]?\d{3}[\s-]?\d{3,4}\b/i
const MOBILE = /(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}\b/i
const LABELLED_LANDLINE = /(?:\+?91[\s-]?)?(?:0\d{2,4}[\s-]?)?\d{8}\b/i
const POSTAL_CODE = /\b[1-9]\d{5}\b/
const ADDRESS_TERM = /\b(?:ROAD|RD\.?|STREET|ST\.?|LANE|NAGAR|COLONY|BUILDING|BLDG|FLOOR|PLOT|SECTOR|VILLAGE|TALUK|TEHSIL|POST|PO\.?|CITY|DISTRICT|STATE|INDIA)\b/i

const cleanLines = (text) => String(text || '')
  .replace(/\r/g, '')
  .split('\n')
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter(Boolean)

const matchPhone = (line, allowUnlabelledLandline = false) => {
  const match = line.match(TOLL_FREE) || line.match(MOBILE) || (allowUnlabelledLandline ? line.match(LABELLED_LANDLINE) : null)
  return match ? { found: true, value: match[0], line } : null
}

export function findConsumerPhone(text) {
  const lines = cleanLines(text)
  const careIndexes = lines
    .map((line, index) => CARE_SIGNAL.test(line) ? index : -1)
    .filter((index) => index >= 0)

  for (const careIndex of careIndexes) {
    const nearby = lines.slice(careIndex, careIndex + 5)
    for (const line of nearby) {
      const contextual = matchPhone(line, PHONE_LABEL.test(line))
      if (contextual) return contextual
    }
  }

  return { found: false, value: '', line: '' }
}

export function findConsumerAddress(text) {
  const lines = cleanLines(text)
  const careIndexes = lines
    .map((line, index) => CARE_SIGNAL.test(line) ? index : -1)
    .filter((index) => index >= 0)

  for (const careIndex of careIndexes) {
    const nearby = lines.slice(Math.max(0, careIndex - 3), careIndex + 5)
    const candidate = nearby.find((line) => {
      const hasPostalCode = POSTAL_CODE.test(line)
      const hasAddressTerm = ADDRESS_TERM.test(line)
      const hasHouseOrPlotNumber = /\b(?:PLOT|HOUSE|DOOR|NO\.?)?\s*\d+[A-Z\/-]?\b/i.test(line)
      const hasLocalityStructure = /[A-Z]{3,}[^,]*,[^,]*[A-Z]{3,}/i.test(line)
      return (hasAddressTerm && (hasPostalCode || hasHouseOrPlotNumber || line.includes(',')))
        || (hasPostalCode && hasLocalityStructure)
    })
    if (candidate) return { found: true, value: candidate, line: candidate, careFound: true }
  }

  return { found: false, value: '', line: '', careFound: careIndexes.length > 0 }
}
