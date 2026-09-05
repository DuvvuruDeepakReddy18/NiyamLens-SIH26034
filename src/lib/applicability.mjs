export const RULE3_CONSUMER_SCOPES = ['unknown', 'retail', 'industrial', 'institutional']
export const RULE3_COMMODITY_CLASSES = ['unknown', 'ordinary', 'cement', 'fertilizer', 'agricultural_farm_produce']

const finite = (value) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const normalizedQuantity = (quantity, unit) => {
  const value = finite(quantity)
  if (value === null) return null
  const normalizedUnit = String(unit || '').trim().toLowerCase()
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(normalizedUnit)) return { kind: 'mass', value: value / 1000, unit: 'kg' }
  if (['kg', 'kgs'].includes(normalizedUnit)) return { kind: 'mass', value, unit: 'kg' }
  if (normalizedUnit === 'ml') return { kind: 'volume', value: value / 1000, unit: 'l' }
  if (['l', 'ltr'].includes(normalizedUnit)) return { kind: 'volume', value, unit: 'l' }
  return null
}

const evidenceCommodityClass = (text) => {
  const signals = []
  if (/\bCEMENT\b/i.test(text)) signals.push('cement')
  if (/\bFERTILI[ZS]ER\b/i.test(text)) signals.push('fertilizer')
  if (/\bAGRICULTURAL\s+FARM\s+PRODUCE\b/i.test(text)) signals.push('agricultural_farm_produce')
  return signals.length === 1 ? signals[0] : signals.length > 1 ? 'conflict' : ''
}

const result = (state, code, reason, evidence, context) => ({ state, code, reason, evidence, ...context })

export function evaluateRule3Applicability({ quantity, unit, text = '', meta = {} } = {}) {
  const consumerScope = meta.rule3ConsumerScope || 'unknown'
  const commodityClass = meta.rule3CommodityClass || 'unknown'
  const confirmed = meta.rule3ApplicabilityConfirmed === true
  const normalized = normalizedQuantity(quantity, unit)
  const aboveOrdinaryLimit = normalized?.value > 25
  const explicitInput = meta.rule3ConsumerScope !== undefined || meta.rule3CommodityClass !== undefined || meta.rule3ApplicabilityConfirmed !== undefined
  const shouldEvaluate = explicitInput || aboveOrdinaryLimit || (meta.enforceEvidenceReview === true && normalized !== null)
  const context = {
    consumerScope,
    commodityClass,
    confirmed,
    normalizedQuantity: normalized ? `${normalized.value} ${normalized.unit}` : '',
  }

  if (!shouldEvaluate) return result('not_evaluated', '', 'Rule 3 applicability was not evaluated in this isolated rule check.', '', context)

  if (!confirmed) {
    return result(
      'review',
      'rule3-unconfirmed',
      'Confirm the purchaser context against the statutory industrial/institutional definitions and, for a large mass/volume package, confirm the commodity class. A buyer name alone is not sufficient.',
      normalized ? `${normalized.value} ${normalized.unit}; purchaser context unconfirmed` : 'Purchaser context unconfirmed',
      context,
    )
  }

  if (consumerScope === 'unknown') {
    return result('review', 'rule3-consumer-unknown', 'The purchaser context is unknown. Verify whether this is a retail package or a direct manufacturer sale for use by an industrial or institutional consumer.', 'Purchaser context unresolved', context)
  }

  if (consumerScope === 'industrial' || consumerScope === 'institutional') {
    return result(
      'outside_chapter_ii',
      `rule3-${consumerScope}`,
      `Recorded as a confirmed direct manufacturer purchase for use by an ${consumerScope} consumer under the encoded Rule 3 scope. This is outside the supported Chapter II retail checks, not certification of compliance with any other law.`,
      `${consumerScope} purchase context; officer confirmation required by workflow`,
      context,
    )
  }

  if (!normalized) {
    return result('in_scope', 'rule3-retail-non-mass-volume', 'Retail purchaser context is confirmed; no Rule 3 mass/volume threshold can be applied to the recorded unit.', `Retail; unit ${String(unit || 'not supplied')}`, context)
  }

  if (normalized.value <= 25) {
    return result('in_scope', 'rule3-retail-within-25', 'Confirmed retail mass/volume package does not exceed the encoded 25 kg/litre threshold.', `${normalized.value} ${normalized.unit}`, context)
  }

  if (commodityClass === 'unknown') {
    return result('review', 'rule3-large-class-unknown', 'This package exceeds 25 kg/litre. Confirm whether it is ordinary goods or cement, fertilizer or agricultural farm produce before applying the Rule 3 threshold.', `${normalized.value} ${normalized.unit}; commodity class unresolved`, context)
  }

  const evidenceClass = evidenceCommodityClass(String(text || ''))
  if (normalized.value <= 50 && evidenceClass && (evidenceClass === 'conflict' || evidenceClass !== commodityClass)) {
    return result('review', 'rule3-classification-conflict', 'The recorded large-package commodity class conflicts with explicit label text. Resolve the class and package form before applying Rule 3.', `${normalized.value} ${normalized.unit}; recorded ${commodityClass}; label signal ${evidenceClass}`, context)
  }

  if (commodityClass === 'ordinary') {
    return result(
      'outside_chapter_ii',
      'rule3-ordinary-above-25',
      'A confirmed ordinary retail package exceeds 25 kg/litre under the encoded Rule 3 scope. This is outside the supported Chapter II retail checks, not certification of compliance with any other law.',
      `${normalized.value} ${normalized.unit}; ordinary goods`,
      context,
    )
  }

  if (normalized.kind !== 'mass') {
    return result(
      'review',
      'rule3-special-non-mass',
      'The special Rule 3 threshold for cement, fertilizer and agricultural farm produce is expressed for bags by mass. A volume-based record needs specialist confirmation before Chapter II checks proceed.',
      `${normalized.value} ${normalized.unit}; ${commodityClass}; package form unresolved`,
      context,
    )
  }

  if (normalized.value > 50) {
    return result(
      'outside_chapter_ii',
      'rule3-special-above-50',
      'A confirmed cement, fertilizer or agricultural-farm-produce package exceeds 50 kg under the encoded Rule 3 scope. This is outside the supported Chapter II retail checks, not certification of compliance with any other law.',
      `${normalized.value} ${normalized.unit}; ${commodityClass}`,
      context,
    )
  }

  return result(
    'review',
    'rule3-special-25-to-50',
    'A cement, fertilizer or agricultural-farm-produce package above 25 kg and not above 50 kg needs specialist confirmation of the Rule 3 wording, package form and applicability before Chapter II checks proceed.',
    `${normalized.value} ${normalized.unit}; ${commodityClass}`,
    context,
  )
}

export function rule3ApplicabilityCheck(applicability) {
  if (!applicability || applicability.state === 'not_evaluated') return null
  return {
    id: 'rule3Applicability',
    label: 'Chapter II retail applicability',
    rule: 'Rule 3 — application of Chapter II',
    status: applicability.state === 'outside_chapter_ii' ? 'exempt' : applicability.state === 'in_scope' ? 'info' : 'review',
    reason: applicability.reason,
    evidence: applicability.evidence,
  }
}
