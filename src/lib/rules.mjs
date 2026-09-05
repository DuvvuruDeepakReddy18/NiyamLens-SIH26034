import { findConsumerAddress, findConsumerPhone } from './consumerContact.mjs'
import { extractDeclarations } from './extraction.mjs'
import { findBoundedEmail, normalizeUnit, parseLabelNumbers, MAX_LABEL_TEXT } from './labelParser.mjs'
import { finiteNumber, validateInspectionMetadata, INSPECTION_LIMITS } from './inspectionMetadata.mjs'
import { evaluateRule3Applicability, rule3ApplicabilityCheck } from './applicability.mjs'

export const RULE_PACK = {
  id: 'LMPC-RC-2026.09-RC6',
  title: 'Legal Metrology (Packaged Commodities) Rules, 2011',
  status: 'Prototype rule pack — officer verification required',
  sources: [
    {
      label: 'Kerala Legal Metrology Department — Rule 6/7/8 declarations, unit-price provisos and placement (specialist scopes remain review)',
      url: 'https://lmd.kerala.gov.in/service-registration/',
    },
    {
      label: 'Department of Consumer Affairs — consolidated rules',
      url: 'https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/Book_on_Legal_Metrology_Packaged_Commodities_Rules%2C2011_with_all_amendments_whatsnews.pdf',
    },
    {
      label: 'Department of Consumer Affairs — Legal Metrology overview',
      url: 'https://consumeraffairs.gov.in/pages/legal-metrology-overview',
    },
    {
      label: 'Department of Consumer Affairs — Packaged Commodities FAQs',
      url: 'https://consumeraffairs.nic.in/sites/default/files/file-uploads/latestnews/LM_FAQs.pdf',
    },
    {
      label: 'Department of Consumer Affairs — 2025 medical-device amendment',
      url: 'https://consumeraffairs.gov.in/public/upload/files/267107_1761404707.pdf',
    },
    {
      label: 'Department of Consumer Affairs — 2025 pan masala amendment',
      url: 'https://consumeraffairs.gov.in/public/upload/files/2nd%20PCR%20Pan%20Masala_1764736734.pdf',
    },
    {
      label: 'Department of Consumer Affairs — current Acts and Rules index',
      url: 'https://consumeraffairs.gov.in/pages/legal-metrology-act',
    },
    {
      label: 'Department of Consumer Affairs — Second Amendment Rules, 2026 (country-of-origin filter effective 1 July 2027)',
      url: 'https://consumeraffairs.gov.in/public/upload/files/2026.4.27%20PCR%202nd%20COO%20from%201.7.2027_1777348487.pdf',
    },
    {
      label: 'e-Gazette — Third Amendment Rules, 2026 (AEO bonded-warehouse declarations)',
      url: 'https://egazette.gov.in/WriteReadData/2026/273053.pdf',
    },
  ],
}

export const FONT_TIERS = [
  { max: 50, label: 'A <= 50 cm²', normal: 1.0, formed: 2.0 },
  { max: 100, label: '50 < A <= 100 cm²', normal: 1.5, formed: 3.0 },
  { max: 500, label: '100 < A <= 500 cm²', normal: 2.5, formed: 4.0 },
  { max: 2500, label: '500 < A <= 2500 cm²', normal: 4.0, formed: 6.0 },
  { max: Number.POSITIVE_INFINITY, label: 'A > 2500 cm²', normal: 6.0, formed: 6.0 },
]

const FIELD_RULES = {
  genericName: {
    label: 'Common / generic name',
    rule: 'Rule 6 — common or generic name of the commodity',
    pattern: /\b(?:COMMON|GENERIC)\s+NAME\b|\b(?:SHAMPOO|POWDER|SOAP|DETERGENT|OIL|JUICE|BISCUITS?|TOOTHPASTE|CREAM|LOTION|SPICE|RICE|FLOUR|SALT)\b/i,
  },
  mrp: {
    label: 'Maximum Retail Price',
    rule: 'Rule 6 — retail sale price declaration',
    pattern: /\b(?:MRP|MAXIMUM\s+RETAIL\s+PRICE)\b[^\n]{0,28}?(?:₹|RS\.?|INR)?\s*[:\-]?\s*\d+(?:\.\d{1,2})?/i,
  },
  mrpFormat: {
    label: 'MRP includes tax wording',
    rule: 'Rule 6 — price inclusive of all taxes',
    pattern: /\bINCLUSIVE\s+(?:OF\s+)?ALL\s+TAX(?:ES)?\b/i,
  },
  netQuantity: {
    label: 'Net quantity',
    rule: 'Rule 6 — net quantity in standard units',
    pattern: /\b(?:NET\s*(?:QTY|QUANTITY|WT\.?|WEIGHT)|CONTENTS?)\s*[:\-]?\s*\d+(?:\.\d+)?\s*(?:KG|KGS|G|GM|GMS|GRAMS?|ML|L|LTR|LITRES?|LITERS?|PCS?|N)\b/i,
  },
  packDate: {
    label: 'Month and year',
    rule: 'Rule 6 — month/year of manufacture, packing or import',
    pattern: /\b(?:MFG|MFD|MANUFACTURED|PACKED|PKD|IMPORTED)(?:\s+(?:ON|DATE))?\s*[:\-]?\s*(?:(?:0?[1-9]|[12]\d|3[01])\s*[\/\-.]\s*)?(?:0?[1-9]|1[0-2])\s*[\/\-.]\s*(?:20)?\d{2}\b|\b(?:MFG|MFD|MANUFACTURED|PACKED|PKD|IMPORTED)(?:\s+(?:ON|DATE))?\s*[:\-]?\s*(?:(?:0?[1-9]|[12]\d|3[01])\s+)?(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(?:20)?\d{2}\b/i,
  },
  manufacturer: {
    label: 'Manufacturer / packer / importer',
    rule: 'Rule 6 — responsible entity name and address',
    pattern: /\b(?:MANUFACTURED|MFD|PACKED|IMPORTED)\s+BY\b|\b(?:MANUFACTURER|PACKER|IMPORTER)\s*[:\-]/i,
  },
  consumerCare: {
    label: 'Consumer-care details',
    rule: 'Rule 6 — consumer complaint contact',
    pattern: /\b(?:CONSUMER|CUSTOMER)\s*(?:CARE|COMPLAINT)|\bHELPLINE\b|\bCOMPLAINTS?\b/i,
  },
  consumerEmail: {
    label: 'Consumer-care email',
    rule: 'Rule 6 / Department FAQ — electronic complaint channel',
    pattern: /$^/,
  },
  consumerPhone: {
    label: 'Consumer-care telephone',
    rule: 'Rule 6(2) — telephone number of the consumer-complaint contact',
    pattern: /$^/,
  },
  consumerAddress: {
    label: 'Consumer-care address',
    rule: 'Rule 6(2) — name and address of the consumer-complaint contact',
    pattern: /$^/,
  },
  countryOrigin: {
    label: 'Country of origin',
    rule: 'Rule 6 — country of origin for imported package',
    pattern: /\b(?:COUNTRY\s+OF\s+ORIGIN|MADE\s+IN|PRODUCT\s+OF)\b/i,
  },
  unitSalePrice: {
    label: 'Unit sale price',
    rule: 'Rule 6 — unit sale price; small-pack exemption profile',
    pattern: /\b(?:UNIT\s+SALE\s+PRICE|UNIT\s+PRICE|USP)\b|(?:₹|RS\.?)\s*\d+(?:\.\d+)?\s*\/\s*(?:KG|G|ML|L|UNIT)/i,
  },
  bestBefore: {
    label: 'Best before / use by',
    rule: 'Rule 6 — time-sensitive commodity declaration',
    pattern: /\b(?:BEST\s+BEFORE|USE\s+BY|EXPIRY|EXP)\b/i,
  },
}

const cleanNumber = finiteNumber

const lineForMatch = (text, match) => {
  if (!match) return ''
  const index = match.index ?? text.indexOf(match[0])
  const before = text.lastIndexOf('\n', index)
  const after = text.indexOf('\n', index + match[0].length)
  return text.slice(before + 1, after === -1 ? undefined : after).trim()
}

const findEvidence = (text, pattern) => {
  const match = pattern.exec(text)
  return match ? { found: true, value: match[0].trim(), line: lineForMatch(text, match) } : { found: false, value: '', line: '' }
}

export function getFontRequirement(area, formed = false) {
  const numericArea = cleanNumber(area)
  if (numericArea === null || numericArea <= 0 || numericArea > INSPECTION_LIMITS.dimension) return null
  const tier = FONT_TIERS.find((candidate) => numericArea <= candidate.max) ?? FONT_TIERS.at(-1)
  return { ...tier, minimum: formed ? tier.formed : tier.normal }
}

export function inferQuantity(text, explicitQuantity, explicitUnit) {
  const quantity = cleanNumber(explicitQuantity)
  const unit = normalizeUnit(explicitUnit)
  const candidates = parseLabelNumbers(text).netQuantity
  if (candidates.length > 1 || candidates.some(c => !c.valid)) return { quantity: null, unit: '', conflict: true }
  const parsed = candidates[0]
  if (parsed && quantity !== null && quantity > 0 && unit && (quantity !== parsed.quantity || unit !== parsed.unit)) return { quantity: null, unit: '', conflict: true }
  if (quantity !== null && quantity > 0 && quantity <= INSPECTION_LIMITS.quantity && ['g', 'kg', 'ml', 'l', 'pcs'].includes(unit)) return { quantity, unit }
  return parsed ? { quantity: parsed.quantity, unit: parsed.unit } : { quantity: null, unit: '' }
}

export function isSmallPack(quantity, unit) {
  if (!Number.isFinite(quantity) || quantity <= 0) return false
  const normalized = normalizeUnit(unit)
  if (['g', 'gm', 'gms', 'ml'].includes(normalized)) return quantity <= 10
  if (['kg', 'l', 'ltr'].includes(normalized)) return quantity * 1000 <= 10
  return false
}

function requiredFieldIds(category, perishable = false) {
  const fields = ['genericName', 'mrp', 'mrpFormat', 'netQuantity', 'packDate', 'manufacturer', 'consumerCare', 'consumerAddress', 'consumerPhone', 'consumerEmail', 'unitSalePrice']
  if (category === 'imported') fields.push('countryOrigin')
  if (perishable) fields.push('bestBefore')
  return fields
}

export function getExemptionProfile(quantity, unit, meta = {}) {
  const commodityClass = meta.commodityClass || 'standard'
  if (commodityClass === 'fast_food') {
    return { exempt: true, code: 'rule26-fast-food', reason: 'Restaurant / hotel fast-food package profile selected.' }
  }
  if (commodityClass === 'drug_formulation') {
    return { exempt: true, code: 'rule26-drug-formulation', reason: 'Scheduled / non-scheduled drug formulation profile selected.' }
  }
  if (isSmallPack(quantity, unit) && commodityClass === 'standard') {
    return { exempt: true, code: 'rule26-small-package', reason: 'Net quantity is 10 g / 10 ml or less and no encoded carve-out applies.' }
  }
  return { exempt: false, code: '', reason: '' }
}

const countryNames = new Set(['UK', 'USA', 'US', 'UAE', 'UNITED STATES OF AMERICA', 'SOUTH KOREA', 'NORTH KOREA', 'RUSSIA', 'VIETNAM', 'TAIWAN'])
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b), label = regionNames.of(code)
  if (label && label !== code && !['ZZ', 'EU', 'UN', 'EZ'].includes(code)) { countryNames.add(label.toUpperCase()); countryNames.add(code) }
}
function responsibleEntityValidity(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const index = lines.findIndex(l => /\b(?:(?:MANUFACTURED|MFD|PACKED|IMPORTED)\s+BY|(?:MANUFACTURER|PACKER|IMPORTER)\s*[:\-])/i.test(l))
  if (index < 0) return false
  const tail = lines[index].replace(/^.*?\b(?:(?:MANUFACTURED|MFD|PACKED|IMPORTED)\s+BY|(?:MANUFACTURER|PACKER|IMPORTER)\s*[:\-])\s*:?/i, '').trim()
  if (tail.length < 2 || /^(?:N\/?A|UNKNOWN|NOT\s+AVAILABLE|NONE|[-:.]+)$/i.test(tail)) return false
  const block = [tail]
  for (let i = index + 1; i < Math.min(lines.length, index + 4); i++) {
    if (/^(?:CONSUMER|CUSTOMER|MRP|M[.]R[.]P|NET\s|PACKED\s|MFG\s|UNIT\s|COUNTRY\s|MADE\s|BEST\s)/i.test(lines[i])) break
    block.push(lines[i])
  }
  const address = block.join(' ')
  return /[A-Z]{2,}/i.test(tail) && (/\b[1-9]\d{5}\b/.test(address) || /\b(?:ROAD|STREET|LANE|PLOT|HOUSE|BUILDING|SECTOR|VILLAGE|NAGAR|COLONY)\b/i.test(address) && /\d/.test(address))
}
function declarationCheck(id, text, lowConfidence, meta = {}, extraction = extractDeclarations(text)) {
  const definition = FIELD_RULES[id]
  let evidence = findEvidence(text, definition.pattern)
  const review = (reason, proof = evidence.line || evidence.value || 'Unresolved declaration') => ({ id, label: definition.label, rule: definition.rule, status: 'review', reason, evidence: proof })
  const foodProfile = meta.category === 'food' || /\b(?:FSSAI|INGREDIENTS?|NUTRITION(?:AL)?)\b/i.test(text)
  const cosmeticsProfile = /\b(?:SOAP|SHAMPOO|TOOTHPASTE|COSMETICS?|TOILETRIES)\b/i.test(text)
  if (foodProfile && ['manufacturer', 'packDate', 'bestBefore'].includes(id)) return review('This food declaration is governed by the applicable food-law proviso. Presence may be recorded, but this rule pack does not certify FSSAI compliance.')
  if (cosmeticsProfile && id === 'packDate') return review('Cosmetic/toiletry date declarations require the applicable specialist rules; the general date rule cannot decide this field.')
  if (/\b(?:BIDI|BEEDI|INCENSE\s+STICKS)\b/i.test(text) && (id === 'packDate' || id === 'mrp' || id === 'mrpFormat')) return review('Potential bidi/incense-specific declaration exception: verify the exact commodity and current rule applicability before deciding this field.')
  const fieldId = ({ mrp: 'mrp', netQuantity: 'netQuantity', packDate: 'packDate', unitSalePrice: 'unitSalePrice' })[id]
  if (fieldId) {
    const candidates = extraction.candidates[fieldId] || []
    if (candidates.length > 1) return review('Conflicting declarations are present in this transcript. Resolve their package/panel scope before deciding compliance.', candidates.map(c => c.evidence).join(' | ').slice(0, 2000))
    if (candidates.length && !candidates[0].valid) return review(candidates[0].validation.message, candidates[0].evidence)
    evidence = candidates[0] ? { found: true, value: candidates[0].value, line: candidates[0].evidence } : { found: false, value: '', line: '' }
  }
  if (id === 'consumerPhone') evidence = findConsumerPhone(text)
  if (id === 'consumerEmail') evidence = findBoundedEmail(text)
  const addressEvidence = id === 'consumerAddress' ? findConsumerAddress(text) : null
  if (addressEvidence) evidence = addressEvidence
  if (id === 'genericName' && evidence.found && !/[A-Z]{2,}/i.test(extraction.byId.productName.value.replace(/\b(?:COMMON|GENERIC)\s+NAME\s*:?/gi, ''))) return review('A common/generic name needs a substantive value, not an empty declaration heading.')
  if (id === 'manufacturer' && evidence.found && !responsibleEntityValidity(text)) return review('A responsible entity name and distinguishable postal address have not both been established. Confirm the full declaration; a heading alone is insufficient.')
  if (id === 'countryOrigin' && evidence.found) {
    const origin = extraction.byId.countryOrigin.value.replace(/[.]+$/, '').trim().toUpperCase()
    if (!countryNames.has(origin)) return review('Country of origin is missing, a placeholder, or not recognized unambiguously. Confirm the actual country; a heading alone is insufficient.')
  }
  if (id === 'unitSalePrice') {
    if (/\b(?:COMBINATION|MULTI[ -]?PACK|MULTI[ -]?PIECE|COMBO|GROUP\s+PACKAGE|ALCOHOLIC\s+BEVERAGE|SPIRITUOUS\s+LIQUOR)\b/i.test(text)) return review('Combination/group/multi-piece or excise-specific unit-price applicability requires officer review; the single-package formula is withheld.')
    const q = extraction.candidates.netQuantity, prices = extraction.candidates.mrp
    if (q.length === 1 && q[0].valid && prices.length === 1 && prices[0].valid) {
      const quantity = q[0], usp = extraction.candidates.unitSalePrice[0]
      const baseUnit = ['g', 'kg'].includes(quantity.unit) ? 'g' : ['ml', 'l'].includes(quantity.unit) ? 'ml' : 'pcs'
      const total = quantity.quantity * (['kg', 'l'].includes(quantity.unit) ? 1000 : 1)
      const requiredUnit = baseUnit === 'g' ? total < 1000 ? 'g' : 'kg' : baseUnit === 'ml' ? total < 1000 ? 'ml' : 'l' : 'pcs'
      const per = ['kg', 'l'].includes(requiredUnit) ? 1000 : 1
      const expectedCents = Math.round(prices[0].minorUnits / total * per)
      if (!evidence.found && total === per) return { id, label: definition.label, rule: definition.rule, status: 'info', reason: 'For this single-package quantity the unit sale price equals MRP; the encoded Rule 6(11) equal-price proviso does not require a separate USP declaration. Confirm package scope.', evidence: `${quantity.quantity} ${quantity.unit}; MRP ${prices[0].value}` }
      if (evidence.found && (usp.unit !== requiredUnit || usp.denominator !== 1 || usp.minorUnits !== expectedCents)) return review(`Unit price does not match the supported single-package basis: expected ${(expectedCents / 100).toFixed(2)} rupees/${requiredUnit}. Verify scope, rounding and the printed values.`, evidence.line)
    } else if (evidence.found) return review('Unit-price arithmetic requires one unambiguous positive MRP and net quantity.')
  }
  if (evidence.found) {
    return {
      id,
      label: definition.label,
      rule: definition.rule,
      status: 'pass',
      reason: 'Required declaration detected.',
      evidence: evidence.line || evidence.value,
    }
  }

  if (id === 'mrpFormat') {
    const abbreviated = text.match(/\bINCL\.?\s+(?:OF\s+)?ALL\s+TAX(?:ES)?\b/i)
    if (abbreviated) {
      return {
        id,
        label: definition.label,
        rule: definition.rule,
        status: 'review',
        reason: 'Abbreviated tax wording was detected; verify that the printed declaration satisfies the prescribed wording.',
        evidence: lineForMatch(text, abbreviated) || abbreviated[0],
      }
    }
  }

  if (id === 'genericName' && String(meta.productName || '').trim()) {
    return {
      id,
      label: definition.label,
      rule: definition.rule,
      status: 'pass',
      reason: 'Inspector-verified product / generic name supplied in the structured context.',
      evidence: String(meta.productName).trim(),
    }
  }

  if (id === 'consumerAddress' && addressEvidence?.careFound) {
    return {
      id,
      label: definition.label,
      rule: definition.rule,
      status: 'review',
      reason: 'A consumer-care channel was detected, but its postal address could not be distinguished reliably from other label text.',
      evidence: 'Consumer-care address requires officer confirmation',
    }
  }

  return {
    id,
    label: definition.label,
    rule: definition.rule,
    status: lowConfidence ? 'review' : 'fail',
    reason: lowConfidence
      ? 'Not detected, but OCR confidence is too low for an automatic violation.'
      : 'Required declaration was not detected in the extracted label text.',
    evidence: 'No matching evidence region',
  }
}

function geometryChecks(meta) {
  const checks = []
  const area = cleanNumber(meta.pdpArea)
  const areaUncertainty = cleanNumber(meta.pdpUncertainty)
  const requirement = getFontRequirement(area, Boolean(meta.formedText))

  if (!requirement || areaUncertainty === null) {
    checks.push({
      id: 'panelArea',
      label: 'Principal display panel area',
      rule: 'Rule 7 and Table I',
      status: 'review',
      reason: 'Panel area and an explicit uncertainty estimate are required to select the applicable font-height tier.',
      evidence: 'Area or uncertainty not supplied',
    })
  } else {
    const lowerArea = Math.max(0.01, area * (1 - areaUncertainty / 100))
    const upperArea = area * (1 + areaUncertainty / 100)
    const lowTier = getFontRequirement(lowerArea, Boolean(meta.formedText))
    const highTier = getFontRequirement(upperArea, Boolean(meta.formedText))
    const crossesTier = !lowTier || !highTier || lowTier.minimum !== highTier.minimum
    checks.push({
      id: 'panelArea',
      label: 'Principal display panel tier',
      rule: 'Rule 7 and Table I',
      status: crossesTier ? 'review' : 'pass',
      reason: crossesTier
        ? 'Area uncertainty crosses a Table-I boundary; an officer must confirm the applicable tier.'
        : `Area maps to ${requirement.label}.`,
      evidence: `${area.toFixed(1)} cm² ± ${areaUncertainty.toFixed(1)}%`,
    })
  }

  const referenceMm = cleanNumber(meta.referenceMm)
  const measurementUncertainty = cleanNumber(meta.measurementUncertainty)
  const panelIds = Array.from(new Set([
    ...(Array.isArray(meta.evidencePanelIds) ? meta.evidencePanelIds : []),
    ...Object.keys(meta.panelMeasurements || {}),
  ])).filter(Boolean)
  const measurementSets = panelIds.length
    ? panelIds.map((panelId) => ({ panelId, ...(meta.panelMeasurements?.[panelId] || {}) }))
    : [{ panelId: '', referencePx: meta.referencePx, glyphPx: meta.glyphPx, glyphWidthPx: meta.glyphWidthPx }]

  measurementSets.forEach((measurement) => {
    const suffix = measurement.panelId ? `:${measurement.panelId}` : ''
    const panelLabel = measurement.panelId ? ` — panel ${measurement.panelId}` : ''
    const referencePx = cleanNumber(measurement.referencePx)
    const glyphPx = cleanNumber(measurement.glyphPx)
    const glyphWidthPx = cleanNumber(measurement.glyphWidthPx)
    if (!requirement || measurementUncertainty === null || !(referenceMm > 0) || !(referencePx > 0) || !(glyphPx > 0)) {
      checks.push({
        id: `fontHeight${suffix}`,
        label: `Measured declaration height${panelLabel}`,
        rule: 'Rule 7 — minimum numeral and letter height',
        status: 'review',
        reason: 'A reference and glyph measurement from this same image plane are required for a physical font-height verdict.',
        evidence: 'Panel calibration incomplete',
      })
    } else {
      const measured = (glyphPx / referencePx) * referenceMm
      const uncertaintyMm = measured * (measurementUncertainty / 100)
      const lower = measured - uncertaintyMm
      const upper = measured + uncertaintyMm
      let status = 'review'
      let reason = `Measurement interval overlaps the ${requirement.minimum.toFixed(1)} mm requirement.`
      if (lower >= requirement.minimum) { status = 'pass'; reason = `Even the lower confidence bound meets the ${requirement.minimum.toFixed(1)} mm requirement.` }
      else if (upper < requirement.minimum) { status = 'fail'; reason = `Even the upper confidence bound is below the ${requirement.minimum.toFixed(1)} mm requirement.` }
      checks.push({
        id: `fontHeight${suffix}`,
        label: `Measured declaration height${panelLabel}`,
        rule: 'Rule 7 — minimum numeral and letter height',
        status,
        reason,
        evidence: `${measured.toFixed(2)} mm ± ${uncertaintyMm.toFixed(2)} mm`,
        measured,
        minimum: requirement.minimum,
        panelId: measurement.panelId || null,
      })
    }

    if (measurementUncertainty === null || !(glyphPx > 0) || !(glyphWidthPx > 0)) {
      checks.push({
        id: `fontWidth${suffix}`,
        label: `Letter / numeral width ratio${panelLabel}`,
        rule: 'Rule 7 — width not less than one-third of height (with stated exceptions)',
        status: 'review',
        reason: 'A width measurement from the same glyph and image plane was not supplied.',
        evidence: 'Width-to-height ratio unavailable',
      })
    } else {
      const ratio = glyphWidthPx / glyphPx
      const relativeUncertainty = measurementUncertainty / 100
      const ratioLow = ratio * (1 - relativeUncertainty) / (1 + relativeUncertainty)
      const ratioHigh = relativeUncertainty < 1 ? ratio * (1 + relativeUncertainty) / (1 - relativeUncertainty) : Infinity
      const status = ratioLow >= 1 / 3 ? 'pass' : ratioHigh < 1 / 3 ? 'fail' : 'review'
      checks.push({
        id: `fontWidth${suffix}`,
        label: `Letter / numeral width ratio${panelLabel}`,
        rule: 'Rule 7 — width not less than one-third of height (with stated exceptions)',
        status,
        reason: status === 'pass'
          ? 'The lower width/height bound meets the one-third rule.'
          : status === 'fail' ? 'The upper width/height bound is below one-third; confirm the sampled character is not an exempt “1”, “i”, “I” or “l”.' : 'Width/height uncertainty overlaps the one-third requirement; improve the measurement or retain review.',
        evidence: `${ratio.toFixed(2)} width / height`,
        panelId: measurement.panelId || null,
      })
    }
  })

  return checks
}

export function evaluateCompliance({ text = '', meta = {} }) {
  const metadataIssues = validateInspectionMetadata(meta)
  if (typeof text !== 'string' || text.length > MAX_LABEL_TEXT) metadataIssues.push({ field: 'text', reason: 'Label text must be a string no longer than 100000 characters.' })
  if (metadataIssues.length) {
    const checks = metadataIssues.map(issue => ({ id: `invalidInput:${issue.field}`, label: 'Invalid inspection input', rule: 'Evidence safety policy', status: 'review', reason: issue.reason, evidence: issue.field }))
    return { status: 'manual_review', score: 0, counts: { pass: 0, fail: 0, review: checks.length }, checks, context: { category: 'general', quantity: null, unit: '', smallPack: false, confidence: 0, rulePack: RULE_PACK.id, applicability: { state: 'review', code: 'invalid-input', reason: 'Inspection metadata must be corrected before Rule 3 applicability can be assessed.' }, exemption: { exempt: false, code: '', reason: '' } } }
  }
  const normalizedText = String(text).replace(/\r/g, '').trim()
  const extraction = extractDeclarations(normalizedText)
  const confidence = meta.ocrSource === 'none' ? 0 : cleanNumber(meta.ocrConfidence) ?? 0
  const confidenceAvailable = meta.ocrSource !== 'none' && typeof meta.ocrConfidence === 'number' && Number.isFinite(meta.ocrConfidence)
  const noEvidenceText = normalizedText.length < 3
  const latinLetters = (normalizedText.match(/[A-Z]/gi) || []).length
  const indicLetters = (normalizedText.match(/[\u0900-\u097f\u0b80-\u0bff\u0c00-\u0c7f]/g) || []).length
  const parserLanguageRisk = indicLetters > latinLetters && indicLetters > 10
  const lowConfidence = confidence < 75 || noEvidenceText || parserLanguageRisk
  const quantityInfo = inferQuantity(normalizedText, meta.quantity, meta.unit)
  const smallPack = isSmallPack(quantityInfo.quantity, quantityInfo.unit)
  const category = meta.category || 'general'
  const applicability = quantityInfo.conflict
    ? { state: 'review', code: 'rule3-quantity-conflict', reason: 'Resolve conflicting quantity evidence before applying Chapter II scope or an exclusion.', evidence: extraction.byId.netQuantity.evidence, consumerScope: meta.rule3ConsumerScope || 'unknown' }
    : evaluateRule3Applicability({ quantity: quantityInfo.quantity, unit: quantityInfo.unit, text: normalizedText, meta })
  const applicabilityCheck = rule3ApplicabilityCheck(applicability)
  const quantityConflictCheck = quantityInfo.conflict ? { id: 'quantityConflict', label: 'Quantity evidence conflict', rule: 'Evidence safety policy', status: 'review', reason: 'The quantity is invalid, ambiguous or inconsistent with structured metadata. Resolve the source declaration before applying an exemption.', evidence: extraction.byId.netQuantity.evidence } : null
  if (applicability.state === 'review' || applicability.state === 'outside_chapter_ii') {
    const review = applicability.state === 'review'
    const scopeChecks = [applicabilityCheck, quantityConflictCheck].filter(Boolean)
    return {
      status: review ? 'manual_review' : 'exempt',
      score: 0,
      counts: { pass: 0, fail: 0, review: scopeChecks.filter(check => check.status === 'review').length },
      checks: scopeChecks,
      context: {
        category,
        quantity: quantityInfo.quantity,
        unit: quantityInfo.unit,
        smallPack,
        confidence,
        rulePack: RULE_PACK.id,
        applicability,
        exemption: { exempt: false, code: '', reason: '' },
      },
    }
  }
  const specialistMedical = category === 'medical' || meta.commodityClass === 'medical_device' || extraction.suggestions.category === 'medical'
  const classificationConflict = (['tobacco', 'pan_masala'].includes(extraction.suggestions.commodityClass) && meta.commodityClass !== extraction.suggestions.commodityClass) || (['imported', 'medical'].includes(extraction.suggestions.category) && category !== extraction.suggestions.category)
  const exemption = quantityInfo.conflict || classificationConflict || specialistMedical ? { exempt: false, code: '', reason: '' } : getExemptionProfile(quantityInfo.quantity, quantityInfo.unit, meta)
  const checks = applicabilityCheck ? [applicabilityCheck] : []
  if (classificationConflict) checks.push({ id: 'classificationConflict', label: 'Commodity classification conflict', rule: 'Evidence safety policy', status: 'review', reason: 'The transcript contains an imported, medical, tobacco or pan-masala signal inconsistent with the selected profile. Resolve classification before a decisive verdict.', evidence: `${extraction.suggestions.category} / ${extraction.suggestions.commodityClass}` })

  if (exemption.exempt) {
    checks.push({
      id: 'rule26Exemption',
      label: 'Rule 26 exemption profile',
      rule: 'Rule 26 — exemption in respect of certain packages',
      status: 'exempt',
      reason: exemption.reason,
      evidence: quantityInfo.quantity !== null ? `${quantityInfo.quantity} ${quantityInfo.unit}` : meta.commodityClass,
    })
  } else if (!specialistMedical) {
    checks.push(...requiredFieldIds(extraction.suggestions.category === 'imported' ? 'imported' : category, Boolean(meta.perishable)).map((id) => declarationCheck(id, normalizedText, lowConfidence, meta, extraction)))
  }
  if (meta.commodityClass === 'drug_formulation') checks.push({ id: 'drugSpecialistReview', label: 'Drug-formulation applicability', rule: 'Rule 26(c) specialist scope', status: 'review', reason: 'The referenced drug-formulation exemption requires specialist classification; this prototype cannot certify its applicability.', evidence: 'Specialist sign-off required' })

  if (smallPack && meta.commodityClass === 'tobacco') {
    checks.push({
      id: 'tobaccoApplicability',
      label: 'Tobacco small-pack applicability',
      rule: 'Rule 26(a) proviso — tobacco and tobacco products',
      status: 'info',
      reason: 'The small-package exemption is not applied: the Rule 26(a) proviso excludes tobacco and tobacco products from that exemption.',
      evidence: `${quantityInfo.quantity} ${quantityInfo.unit}`,
    })
  }

  if (smallPack && meta.commodityClass === 'pan_masala') {
    checks.push({
      id: 'panMasalaCarveout',
      label: 'Pan masala small-pack carve-out',
      rule: 'Legal Metrology (Packaged Commodities) Second (Amendment) Rules, 2025',
      status: 'info',
      reason: 'The small-package exemption is not applied; pan masala packages of every size must carry the applicable declarations.',
      evidence: `${quantityInfo.quantity} ${quantityInfo.unit}`,
    })
  }

  if (category === 'food') {
    checks.push({
      id: 'foodScope',
      label: 'Food-package scope',
      rule: 'Department FAQ — Legal Metrology / food-label split',
      status: 'info',
      reason: 'This profile evaluates the encoded Legal Metrology declarations and typography checks; food-law declarations remain outside this rule pack.',
      evidence: 'Category selected: food product',
    })
  }

  if (specialistMedical) {
    checks.push({
      id: 'medicalProfile',
      label: 'Medical-device special profile',
      rule: 'Legal Metrology (Packaged Commodities) Amendment Rules, 2025 / Medical Devices Rules, 2017',
      status: 'review',
      reason: 'Automatic LMPC declaration and typography checks are withheld because the 2025 provisos defer medical-device declarations, letter height and width to the Medical Devices Rules, 2017.',
      evidence: 'Medical-device specialist profile required',
    })
  }

  if (!exemption.exempt && !specialistMedical) {
    const geometry = geometryChecks(meta)
    if (category === 'food') {
      for (const check of geometry) {
        check.status = 'review'
        check.reason = `Food-package Rule 7 applicability is pending qualified cross-regime review under Rule 7(4); the recorded measurement is retained but cannot decide compliance. ${check.reason}`
      }
    }
    checks.push(...geometry)
  }

  if (lowConfidence) {
    checks.push({
      id: 'ocrConfidence',
      label: 'OCR confidence gate',
      rule: 'NiyamLens trust policy',
      status: 'review',
      reason: noEvidenceText
        ? 'No extracted evidence text is available; declaration checks must remain in manual review.'
        : parserLanguageRisk
          ? 'The extracted evidence is predominantly in an Indic script not yet covered by the deterministic declaration parser; missing fields cannot become automatic violations.'
        : !confidenceAvailable ? 'No inspection-wide OCR score is available. Missing text cannot establish an automatic violation.'
        : 'The OCR heuristic is below the evaluation threshold; missing text cannot establish an automatic violation.',
      evidence: noEvidenceText ? 'Evidence text not supplied' : parserLanguageRisk ? `${indicLetters} Indic-script characters · ${latinLetters} Latin characters` : !confidenceAvailable ? 'OCR score unavailable; no accuracy probability asserted' : `${confidence.toFixed(1)}/100 OCR heuristic; not accuracy`,
    })
  } else {
    checks.push({
      id: 'ocrConfidence',
      label: 'OCR confidence gate',
      rule: 'NiyamLens trust policy',
      status: 'pass',
      reason: 'The OCR heuristic is above the evaluation threshold; individual field verification is still required.',
      evidence: `${confidence.toFixed(1)}/100 OCR heuristic; not accuracy`,
    })
  }

  const countable = checks.filter((check) => !['info', 'exempt'].includes(check.status))
  const counts = countable.reduce(
    (accumulator, check) => ({ ...accumulator, [check.status]: accumulator[check.status] + 1 }),
    { pass: 0, fail: 0, review: 0 },
  )
  const status = counts.fail > 0
    ? 'non_compliant'
    : counts.review > 0
      ? 'manual_review'
      : exemption.exempt ? 'exempt' : 'compliant'
  const score = countable.length ? Math.round((counts.pass / countable.length) * 100) : 0

  return {
    status,
    score,
    counts,
    checks,
    context: {
      category,
      quantity: quantityInfo.quantity,
      unit: quantityInfo.unit,
      smallPack,
      confidence,
      rulePack: RULE_PACK.id,
      applicability,
      exemption,
    },
  }
}
