import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvidenceStore } from '../src/lib/storage.mjs'
import { activateInspectionDraft, archivedDraftId, createDraftWriter, parkInspectionDraft, removeInspectionDraft, saveActiveDraft } from '../src/lib/inspectionDrafts.mjs'

const fixture = id => ({ id: 'active', inspectionId: id, startedAt: '2026-09-09T10:00:00Z', evidenceItems: [{ id: `${id}-panel`, name: `${id}.jpg`, originalUrl: `original-${id}`, analysisUrl: `analysis-${id}`, sha256: `${id}-hash`, ocrPasses: [{ text: `${id} raw pass` }] }], activeEvidenceId: `${id}-panel`, text: `${id} working text`, rawOcrText: `${id} unchanged OCR`, meta: { fieldReviews: { mrp: { state: 'confirmed', reason: `${id} photo note` } }, panelMeasurements: { [`${id}-panel`]: { referencePx: 50 } } }, ocrWords: [{ text: id, panelId: `${id}-panel` }], auditChain: [{ hash: `${id}-audit` }], challengeId: null })
const store = () => createEvidenceStore(`draft-test-${crypto.randomUUID()}`)
const evidenceEqual = (actual, expected) => {
  for (const key of ['inspectionId', 'startedAt', 'evidenceItems', 'activeEvidenceId', 'text', 'rawOcrText', 'meta', 'ocrWords', 'auditChain', 'challengeId']) assert.deepEqual(actual[key], expected[key], key)
}

test('new inspection parks complete current evidence before releasing the active slot', async () => {
  const db = store(); const original = fixture('one')
  await saveActiveDraft(db, original)
  const parked = await parkInspectionDraft(db, original)
  assert.equal(parked.id, archivedDraftId('one'))
  assert.equal(await db.get('drafts', 'active'), null)
  evidenceEqual(await db.get('drafts', parked.id), original)
  assert.equal((await db.all('inspections')).length, 0)
  assert.equal((await db.all('outbox')).length, 0, 'drafts are local, not queued as sealed cloud cases')
})

test('multiple parked packages survive reopening and never merge evidence', async () => {
  const scope = `draft-reopen-${crypto.randomUUID()}`; const db = createEvidenceStore(scope)
  for (const id of ['one', 'two', 'three']) {
    await saveActiveDraft(db, fixture(id)); await parkInspectionDraft(db, fixture(id))
  }
  const reopened = createEvidenceStore(scope)
  assert.equal((await reopened.all('drafts')).length, 3)
  for (const id of ['one', 'two', 'three']) evidenceEqual(await reopened.get('drafts', archivedDraftId(id)), fixture(id))
  assert.equal((await store().all('drafts')).length, 0, 'another workspace cannot see these drafts')
})

test('resuming a saved package atomically parks the latest current notes and OCR', async () => {
  const db = store(); const one = fixture('one'); const two = fixture('two')
  const selected = await parkInspectionDraft(db, one)
  await saveActiveDraft(db, two)
  two.text = 'LATEST NOT YET AUTOSAVED'; two.meta.fieldReviews.mrp.reason = 'Latest typed note'
  const restored = await activateInspectionDraft(db, selected, two)
  evidenceEqual(restored, one)
  evidenceEqual(await db.get('drafts', 'active'), one)
  evidenceEqual(await db.get('drafts', archivedDraftId('two')), two)
  assert.equal(await db.get('drafts', selected.id), null)
})

test('legacy active draft can be resumed or kept without forced deletion', async () => {
  const db = store(); const legacy = fixture('legacy')
  await db.put('drafts', legacy)
  evidenceEqual(await activateInspectionDraft(db, legacy), legacy)
  evidenceEqual(await parkInspectionDraft(db, legacy), legacy)
  assert.equal(await db.get('drafts', 'active'), null)
})

test('archive transaction failure leaves active evidence intact and creates no partial draft', async () => {
  const db = store(); const original = fixture('one'); await saveActiveDraft(db, original)
  const aborting = { ...db, transact: (stores, mode, action) => db.transact(stores, mode, (tx, done) => action(tx, value => { done(value); tx.abort() })) }
  await assert.rejects(parkInspectionDraft(aborting, original), /aborted/)
  evidenceEqual(await db.get('drafts', 'active'), original)
  assert.equal(await db.get('drafts', archivedDraftId('one')), null)
})

test('failed resume preserves both packages without swapping or deleting either', async () => {
  const db = store(); const one = fixture('one'); const two = fixture('two')
  const selected = await parkInspectionDraft(db, one); await saveActiveDraft(db, two)
  const aborting = { ...db, transact: (stores, mode, action) => db.transact(stores, mode, (tx, done) => action(tx, value => { done(value); tx.abort() })) }
  await assert.rejects(activateInspectionDraft(aborting, selected, two), /aborted/)
  evidenceEqual(await db.get('drafts', selected.id), one)
  evidenceEqual(await db.get('drafts', 'active'), two)
  assert.equal(await db.get('drafts', archivedDraftId('two')), null)
})

test('missing or changed target cannot clear the current package', async () => {
  const db = store(); const current = fixture('current'); await saveActiveDraft(db, current)
  await assert.rejects(activateInspectionDraft(db, { ...fixture('gone'), id: archivedDraftId('gone') }, current), /changed in another tab/)
  evidenceEqual(await db.get('drafts', 'active'), current)
})

test('another tab active slot cannot be overwritten or cleared by a stale studio', async () => {
  const db = store(); const other = fixture('other'); await saveActiveDraft(db, other)
  await assert.rejects(saveActiveDraft(db, fixture('stale')), /Another inspection is active/)
  await assert.rejects(parkInspectionDraft(db, fixture('stale')), /Another inspection is active/)
  evidenceEqual(await db.get('drafts', 'active'), other)
})

test('a stale tab cannot resurrect or overwrite an already parked draft', async () => {
  const db = store(); const latest = { ...fixture('one'), text: 'LATEST SAVED CONTENT' }
  await parkInspectionDraft(db, latest)
  await assert.rejects(saveActiveDraft(db, fixture('one')), /saved separately/)
  await assert.rejects(parkInspectionDraft(db, fixture('one')), /already has a saved draft/)
  assert.equal(await db.get('drafts', 'active'), null)
  evidenceEqual(await db.get('drafts', archivedDraftId('one')), latest)
})

test('switching from a stale parked package cannot overwrite its latest saved version', async () => {
  const db = store(); const latest = { ...fixture('one'), text: 'LATEST SAVED CONTENT' }
  await parkInspectionDraft(db, latest)
  const selected = await parkInspectionDraft(db, fixture('two'))
  await assert.rejects(activateInspectionDraft(db, selected, fixture('one')), /already has a saved draft/)
  evidenceEqual(await db.get('drafts', archivedDraftId('one')), latest)
  evidenceEqual(await db.get('drafts', selected.id), fixture('two'))
  assert.equal(await db.get('drafts', 'active'), null)
})

test('sealing removes only its own draft and cannot remove another package active in a different tab', async () => {
  const db = store(); await parkInspectionDraft(db, fixture('one')); await saveActiveDraft(db, fixture('two'))
  await db.saveInspection({ id: 'one' })
  await removeInspectionDraft(db, 'one')
  evidenceEqual(await db.get('drafts', 'active'), fixture('two'))
  assert.equal(await db.get('drafts', archivedDraftId('one')), null)
  assert.equal(await saveActiveDraft(db, fixture('one')), false, 'delayed autosave cannot resurrect a sealed case')
})

test('sealed drafts cannot become editable and blind challenges reject unrelated evidence', async () => {
  const db = store(); const selected = await parkInspectionDraft(db, fixture('one'))
  await assert.rejects(activateInspectionDraft(db, selected, null, 'new-challenge'), /outside the active blind challenge/)
  assert.equal(await db.get('drafts', 'active'), null)
  await db.saveInspection({ id: 'one' })
  await assert.rejects(activateInspectionDraft(db, selected), /already a sealed case/)
  await assert.rejects(parkInspectionDraft(db, fixture('one')), /already sealed/)
  evidenceEqual(await db.get('drafts', selected.id), fixture('one'))
})

test('same-challenge draft can be restored without changing its provenance', async () => {
  const db = store(); const original = { ...fixture('one'), challengeId: 'challenge-one' }
  const selected = await parkInspectionDraft(db, original)
  evidenceEqual(await activateInspectionDraft(db, selected, null, 'challenge-one'), original)
})

test('transition drains queued autosave, suppresses stale writes, rejects a double-click and retains latest edits', async () => {
  const db = store(); const writer = createDraftWriter(db); const first = fixture('one')
  const autosave = writer.save(first)
  const latest = { ...first, text: 'Typed immediately before clicking new' }
  const transition = writer.transition(() => parkInspectionDraft(db, latest))
  assert.equal(writer.busy, true)
  assert.equal(await writer.save(first), false)
  await assert.rejects(writer.transition(() => assert.fail('double click must not run')), /already in progress/)
  await autosave; await transition
  assert.equal(writer.busy, false)
  assert.equal(await db.get('drafts', 'active'), null)
  assert.equal((await db.get('drafts', archivedDraftId('one'))).text, latest.text)
})

test('a failed transition unlocks the writer for a safe retry', async () => {
  const db = store(); const writer = createDraftWriter(db)
  await assert.rejects(writer.transition(() => { throw new Error('Disk full') }), /Disk full/)
  assert.equal(writer.busy, false)
  assert.equal(await writer.save(fixture('one')), true)
  await writer.transition(() => parkInspectionDraft(db, fixture('one')))
  assert.equal((await db.all('drafts')).length, 1)
})

test('empty packages are not persisted as misleading drafts', async () => {
  const db = store()
  await assert.rejects(parkInspectionDraft(db, { inspectionId: 'empty', evidenceItems: [] }), /Capture a package/)
  assert.equal((await db.all('drafts')).length, 0)
})
