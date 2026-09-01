import { findConsumerAddress, findConsumerPhone } from './consumerContact.mjs'

export const RULE_PACK = {
  id: 'LMPC-RC-2026.09',
  title: 'Legal Metrology (Packaged Commodities) Rules, 2011',
  status: 'Prototype rule pack — officer verification required',
  sources: [
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
      label: 'e-Gazette — Third Amendment Rules, 2026',
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
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
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

const cleanNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

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
  if (numericArea === null || numericArea <= 0) return null
  const tier = FONT_TIERS.find((candidate) => numericArea <= candidate.max) ?? FONT_TIERS.at(-1)
  return { ...tier, minimum: formed ? tier.formed : tier.normal }
}

export function inferQuantity(text, explicitQuantity, explicitUnit) {
  const quantity = cleanNumber(explicitQuantity)
  const unit = String(explicitUnit || '').toLowerCase()
  if (quantity !== null && unit) return { quantity, unit }

  const match = text.match(/\b(?:NET\s*(?:QTY|QUANTITY|WT\.?|WEIGHT)|CONTENTS?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(KG|G|GM|GMS|ML|L|LTR|PCS?|N)\b/i)
  if (!match) return { quantity: null, unit: '' }
  return { quantity: Number(match[1]), unit: match[2].toLowerCase() }
}

export function isSmallPack(quantity, unit) {
  if (!Number.isFinite(quantity)) return false
  const normalized = String(unit).toLowerCase()
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
  if (isSmallPack(quantity, unit) && !['tobacco', 'pan_masala', 'medical_device'].includes(commodityClass)) {
    return { exempt: true, code: 'rule26-small-package', reason: 'Net quantity is 10 g / 10 ml or less and no encoded carve-out applies.' }
  }
  return { exempt: false, code: '', reason: '' }
}

function declarationCheck(id, text, lowConfidence, meta = {}) {
  const definition = FIELD_RULES[id]
  let evidence = findEvidence(text, definition.pattern)
  if (id === 'consumerPhone') evidence = findConsumerPhone(text)
  const addressEvidence = id === 'consumerAddress' ? findConsumerAddress(text) : null
  if (addressEvidence) evidence = addressEvidence
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
  const areaUncertainty = Math.max(0, cleanNumber(meta.pdpUncertainty) ?? 0)
  const requirement = getFontRequirement(area, Boolean(meta.formedText))

  if (!requirement) {
    checks.push({
      id: 'panelArea',
      label: 'Principal display panel area',
      rule: 'Rule 7 and Table I',
      status: 'review',
      reason: 'Panel area is required to select the applicable font-height tier.',
      evidence: 'Area not supplied',
    })
  } else {
    const lowerArea = Math.max(0.01, area * (1 - areaUncertainty / 100))
    const upperArea = area * (1 + areaUncertainty / 100)
    const lowTier = getFontRequirement(lowerArea, Boolean(meta.formedText))
    const highTier = getFontRequirement(upperArea, Boolean(meta.formedText))
    const crossesTier = lowTier.minimum !== highTier.minimum
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
  const measurementUncertainty = Math.max(0, cleanNumber(meta.measurementUncertainty) ?? 0)
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
    if (!requirement || !referenceMm || !referencePx || !glyphPx) {
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

    if (!glyphPx || !glyphWidthPx) {
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
      checks.push({
        id: `fontWidth${suffix}`,
        label: `Letter / numeral width ratio${panelLabel}`,
        rule: 'Rule 7 — width not less than one-third of height (with stated exceptions)',
        status: ratio >= 1 / 3 ? 'pass' : 'fail',
        reason: ratio >= 1 / 3
          ? 'Measured ratio meets the one-third width rule.'
          : 'Measured ratio is below one-third; confirm the sampled character is not an exempt “1”, “i”, “I” or “l”.',
        evidence: `${ratio.toFixed(2)} width / height`,
        panelId: measurement.panelId || null,
      })
    }
  })

  return checks
}

export function evaluateCompliance({ text = '', meta = {} }) {
  const normalizedText = String(text).replace(/\r/g, '').trim()
  const confidence = cleanNumber(meta.ocrConfidence) ?? 100
  const noEvidenceText = normalizedText.length < 3
  const latinLetters = (normalizedText.match(/[A-Z]/gi) || []).length
  const indicLetters = (normalizedText.match(/[\u0900-\u097f\u0b80-\u0bff\u0c00-\u0c7f]/g) || []).length
  const parserLanguageRisk = indicLetters > latinLetters && indicLetters > 10
  const lowConfidence = confidence < 75 || noEvidenceText || parserLanguageRisk
  const quantityInfo = inferQuantity(normalizedText, meta.quantity, meta.unit)
  const smallPack = isSmallPack(quantityInfo.quantity, quantityInfo.unit)
  const category = meta.category || 'general'
  const specialistMedical = category === 'medical' || meta.commodityClass === 'medical_device'
  const exemption = getExemptionProfile(quantityInfo.quantity, quantityInfo.unit, meta)
  const checks = []

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
    checks.push(...requiredFieldIds(category, Boolean(meta.perishable)).map((id) => declarationCheck(id, normalizedText, lowConfidence, meta)))
  }

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

  if (!exemption.exempt && !specialistMedical) checks.push(...geometryChecks(meta))

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
        : 'OCR confidence is below 75%; the system must not issue an automatic non-compliance verdict from missing text.',
      evidence: noEvidenceText ? 'Evidence text not supplied' : parserLanguageRisk ? `${indicLetters} Indic-script characters · ${latinLetters} Latin characters` : `${confidence.toFixed(1)}% OCR confidence`,
    })
  } else {
    checks.push({
      id: 'ocrConfidence',
      label: 'OCR confidence gate',
      rule: 'NiyamLens trust policy',
      status: 'pass',
      reason: 'OCR confidence is above the automatic-evaluation threshold.',
      evidence: `${confidence.toFixed(1)}% OCR confidence`,
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
      exemption,
    },
  }
}
