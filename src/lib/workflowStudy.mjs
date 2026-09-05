const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const seconds = value => Number.isFinite(value) && value >= 0 && value <= 86400
const median = values => { if (!values.length) return null; const v = [...values].sort((a, b) => a - b); const mid = Math.floor(v.length / 2); return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2 }
export const STUDY_STAGES = ['capture', 'read_or_transcribe', 'verify_and_correct', 'measure', 'export']

export function validateStudy(input) {
  if (input?.schemaVersion !== 1 || input.kind !== 'paired-inspection-time-study' || !Array.isArray(input.trials) || input.trials.length > 500) throw new Error('Expected a bounded paired-inspection-time-study.')
  const seen = new Set()
  for (const trial of input.trials) {
    if (![trial.id, trial.participantId, trial.packageId].every(id) || seen.has(trial.id)) throw new Error('Trial IDs must be present and unique; use anonymous participant IDs.')
    seen.add(trial.id)
    if (!['manual', 'niyamlens'].includes(trial.method) || ![1, 2].includes(trial.order) || !['complete', 'failed', 'abandoned'].includes(trial.outcome)) throw new Error('Record method, actual order and outcome for every attempt.')
    if (!seconds(trial.totalSeconds) || !Number.isSafeInteger(trial.corrections) || trial.corrections < 0 || trial.corrections > 1000) throw new Error('Timing and correction counts must be measured, finite and bounded.')
    if (!trial.stages || STUDY_STAGES.some(stage => !seconds(trial.stages[stage]))) throw new Error('Record every stage, including zero seconds when a stage was genuinely not attempted.')
    const accounted = STUDY_STAGES.reduce((sum, stage) => sum + trial.stages[stage], 0)
    if (accounted > trial.totalSeconds + 1) throw new Error('Stage durations exceed the total observation time.')
    if (typeof trial.notes !== 'string' || trial.notes.length > 4000) throw new Error('Bounded notes are required, including failures and interruptions.')
    if (trial.outcome !== 'complete' && !trial.notes.trim()) throw new Error('Retain a reason for failed and abandoned attempts.')
    if (trial.qualityReview != null) {
      const review = trial.qualityReview
      if (!id(review.reviewerId) || review.reviewerId === trial.participantId || typeof review.reportCorrect !== 'boolean' || review.independentPhysicalCheck !== true || typeof review.notes !== 'string' || !review.notes.trim() || review.notes.length > 4000) throw new Error('Quality adjudication needs another reviewer, a physical check and its reasoning.')
    }
  }
  return input
}

export function scoreWorkflowStudy(input) {
  validateStudy(input)
  const pairs = new Map()
  for (const trial of input.trials) {
    const key = `${trial.participantId}:${trial.packageId}`
    const pair = pairs.get(key) || []; pair.push(trial); pairs.set(key, pair)
  }
  const validPairs = []; const excludedPairs = []
  for (const [key, rows] of pairs) {
    const manual = rows.find(row => row.method === 'manual'); const assisted = rows.find(row => row.method === 'niyamlens')
    let reason = null
    if (rows.length !== 2 || !manual || !assisted) reason = 'Missing or repeated method; no best-attempt selection.'
    else if (manual.order === assisted.order) reason = 'Observation order is invalid.'
    else if (rows.some(row => row.outcome !== 'complete')) reason = 'At least one attempt failed or was abandoned.'
    else if (rows.some(row => row.qualityReview?.reportCorrect !== true)) reason = 'Independent report correctness has not been established for both methods.'
    if (reason) excludedPairs.push({ pair: key, reason })
    else validPairs.push({ pair: key, manualSeconds: manual.totalSeconds, niyamlensSeconds: assisted.totalSeconds, savedSeconds: manual.totalSeconds - assisted.totalSeconds, niyamlensFirst: assisted.order === 1 })
  }
  return { kind: 'inspection-time-study-score', trials: input.trials.length, outcomes: Object.fromEntries(['complete', 'failed', 'abandoned'].map(outcome => [outcome, input.trials.filter(row => row.outcome === outcome).length])), qualityReviewedTrials: input.trials.filter(row => row.qualityReview).length, validPairs, excludedPairs,
    medianVerifiedSecondsSaved: median(validPairs.map(pair => pair.savedSeconds)),
    counterbalancedObserved: validPairs.some(pair => pair.niyamlensFirst) && validPairs.some(pair => !pair.niyamlensFirst),
    claim: 'Descriptive paired observations only; not a representative field-efficiency estimate or evidence of causation. Timing and reviewer independence are self-attested.' }
}
