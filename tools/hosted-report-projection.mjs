import { createHash } from 'node:crypto'

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const digest = value => /^[a-f0-9]{64}$/.test(value || '') ? value : null
const errorCode = value => /^[A-Z][A-Z0-9_]{2,100}$/.test(value || '') ? value : null
const stages = new Set(['planned', 'actual-capture-and-OCR', 'one-finalize-and-cloud-sync-attempt', 'fresh-context-cloud-retrieval', 'complete'])
const apiPaths = new Set(['/api/cases', '/api/evidence', '/api/assignments'])
const methods = new Set(['GET', 'POST', 'HEAD', 'OPTIONS'])
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) ? value : null

// Allowlists, not a shallow spread: the private observation intentionally has
// IDs, evidence paths and complete local backups that must not enter reports.
export function publicHostedSealReport(report) {
  const verification = report.finalExportVerification
  let origin = null
  try { const parsed = new URL(report.origin); if (parsed.protocol === 'https:') origin = parsed.origin } catch { /* invalid source */ }
  return {
    schemaVersion: 1,
    kind: 'ONE-ACTUAL-BROWSER-SYNTHETIC-SEAL-ATTEMPT',
    runRef: createHash('sha256').update(String(report.runId || '')).digest('hex').slice(0, 12),
    startedAt: timestamp(report.startedAt), finishedAt: timestamp(report.finishedAt), origin,
    stage: stages.has(report.stage) ? report.stage : 'unknown', passed: report.passed === true,
    caseCreated: Boolean(report.createdCase), casePostAttempts: count(report.casePostAttempts),
    source: { fixture: 'public/sample-real-label.png', syntheticOnly: true, sha256: digest(report.source?.sha256), bytes: count(report.source?.bytes) },
    appModules: [...new Set((report.appModules || []).filter(value => /^\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(value)))],
    apiRequests: (report.apiRequests || []).filter(item => apiPaths.has(item.path) && methods.has(item.method)).map(item => ({ path: item.path, method: item.method, status: count(item.status) })),
    pageErrorCount: count(report.pageErrorCount), blockedMutations: count(report.blockedMutations),
    failureCode: errorCode(report.failureCode),
    serverFailure: report.serverFailure && apiPaths.has(report.serverFailure.path) ? { path: report.serverFailure.path, status: count(report.serverFailure.status) } : null,
    localCheckpoints: (report.snapshots || []).filter(item => ['before-seal', 'after-seal', 'failure-preserved'].includes(item.label)).map(item => ({ label: item.label, inspections: count(item.inspections), drafts: count(item.drafts), outbox: count(item.outbox) })),
    originalOcr: report.originalOcr ? { characters: count(report.originalOcr.characters), sha256: digest(report.originalOcr.sha256), typedCorrections: report.originalOcr.typedCorrections === true, engine: 'actual-browser-Tesseract-standard' } : null,
    fieldReviewsUnconfirmed: report.fieldReviewsUnconfirmed === true,
    physicalConfirmationsUnconfirmed: report.physicalConfirmationsUnconfirmed === true,
    exportVerification: verification ? {
      passed: verification.passed === true, panels: count(verification.panels),
      images: (verification.images || []).map(item => ({ panel: count(item.panel), kind: ['original', 'analysis'].includes(item.kind) ? item.kind : null, bytes: count(item.bytes), sha256: digest(item.sha256), hashMatchesRegisteredMetadata: item.hashMatchesRegisteredMetadata === true })),
      totalImageBytes: count(verification.totalImageBytes), sourceOriginalMatched: verification.sourceOriginalMatched === true,
      serverReceiptWellFormed: verification.receipt?.presentAndWellFormed === true, serverVersion: count(verification.receipt?.version),
      receiptAuthenticityIndependentlyVerified: false, serverPayloadHashRecomputed: false,
      clientAuditEvents: count(verification.audit?.events), clientAuditInternallyHashLinked: verification.audit?.internallyHashLinked === true, clientAuditIndependentlyAuthentic: false,
      rawOcrPassCount: count(verification.ocr?.rawPassCount), workingDiffersFromRaw: verification.ocr?.workingDiffersFromRaw === true, recognitionAccuracyVerified: false,
    } : null,
    limitations: [
      'One generated package image only; not real-label accuracy, independent ground truth, or human field validation.',
      'Actual UI capture and standard OCR were used. No OCR corrections, field confirmations or physical measurements were entered.',
      'Client audit history came from the actual UI. Image hashes and audit linkage prove internal consistency, not physical truth or official legal approval.',
      'Export verification does not recompute or independently authenticate the server receipt; original private evidence is retained separately.',
      'Test account identifiers, storage paths, raw transcripts, and local private paths are intentionally omitted from this shareable projection.',
    ],
  }
}
