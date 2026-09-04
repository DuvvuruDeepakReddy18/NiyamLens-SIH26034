# NiyamLens security and data-integrity stress review

Date: 2026-09-04
Verdict: **request changes before presenting the managed workspace as production-ready.** No cross-organization read/write bypass was reproduced. The two release-priority defects are adversarial OCR-text CPU cost and a local synchronization acknowledgement race.

## Release-priority findings

### P1 — accepted OCR text can consume seconds of CPU

`validateCase` accepts 100,000 characters (`server/caseService.mjs:10`) and evaluates that text before committing (`server/caseService.mjs:16`). The email expression in `src/lib/extraction.mjs:54`, duplicated in `src/lib/rules.mjs:90`, performs a superlinear unsuccessful scan on text such as `a.a.a...` with no `@`.

Measured in isolated child processes against the actual source statement:

- 10,000 characters: 44.6 ms
- 30,000 characters: 387.6 ms
- 100,000 characters: exceeded the 3,000 ms kill deadline

The complete `validateCase` path took 1,281.7 ms at 30,000 characters and also exceeded 3,000 ms at 100,000. An authenticated member can therefore spend substantial API CPU inside the otherwise-valid 100 KB/1.8 MB request ceilings. The same input can freeze client-side evaluation. Require short line-oriented contact matching or use a linear bounded parser; lower and separately bound extracted text.

### P2 — an in-flight sync acknowledgement hides a newer queued review

`src/lib/syncEngine.mjs:14-18` snapshots the outbox, waits for transport, then deletes the acknowledged operation and unconditionally stores the returned record. A second tab can queue a newer review while the first request is in flight. The first response then replaces the visible projection and marks it `synced`, even though the second review is still pending.

Measured with the actual sync engine, IndexedDB store, and `mergeCloudRecord`:

- second operation remained in outbox: yes
- second review remained visible in the record: **no**
- visible record state: **synced**
- second reason remained recoverable from the outbox: yes

This is a projection/UX integrity failure, not permanent deletion, but it can mislead a reviewer. The acknowledgement transaction must re-read the outbox and avoid replacing the local projection when another operation for the same case exists.

## Other concrete findings

### P2 — server evidence verification accepts header-only files

`api/evidence.js:3,32-33` verifies declared byte length, SHA-256 and only the magic prefix. With mocked Storage returning the three bytes `FF D8 FF`, the actual handler registered it as a verified JPEG (HTTP 200). Decode the image server-side and enforce non-zero dimensions/pixel limits before registration.

This proves an API validation defect if such bytes are present in Storage. It does **not** prove the live Supabase upload path accepted the file; hosted Auth/Storage was not manipulated.

### P2 — capped offset pagination can loop forever

`api/cases.js:8,13` and `api/assignments.js:6,11` clamp the requested offset to 100,000 but return a cursor computed past that cap. A full page at the cap causes subsequent requests to query offset 100,000 repeatedly. The harness observed the same range three times before deliberately stopping. The thresholds are at least 100,020 accessible cases or 100,050 assignments. `src/App.jsx:1883-1890` follows `nextOffset` until null. Use keyset pagination or stop/reject when the cap is reached.

### P3 — malformed nested case structures become HTTP 500

`server/caseService.mjs:11,21` validates top-level arrays but accesses their entries before validating entry shape. Actual handler results:

- `auditChain: {}` → 500
- `auditChain: [null]` → 500
- `evidenceItems: [null]` → 500
- text of 100,001 characters → 413
- five panels → 422
- oversized metadata → 413

Add nested schema validation and return 400/422 without throwing type errors.

### Capacity risk — full records are duplicated in local outbox

`src/lib/syncEngine.mjs:1-2` embeds the record payload in an operation and `src/lib/storage.mjs:49-50` stores both copies atomically. A synthetic four-panel record containing data URLs serialized to 11,185,275 bytes; inspection plus outbox serialized to 22,370,749 bytes. Fake IndexedDB retained that record plus 500 small records in 107 ms. This measures logical duplication only: fake IndexedDB has no Chrome quota and is not browser-capacity proof. Store blobs once or keep outbox entries as references/deltas.

## Controls that held locally

The existing focused suites passed **30/30**. An additional actual-migration PGlite stress test observed:

- 100 identical seal calls → one immutable case
- 30 queued reviews against version 1 → one success and 29 stale conflicts
- 100 quota calls at a limit of 30 → exactly 30 allowed
- cross-organization rows visible to an outsider across cases, reviews, audit, evidence and assignments → zero
- case/review/audit deletion by `service_role` → denied

The API provider mock also returned 401 for unsigned/invalid tokens and 403 for a user outside the requested organization. These results support RLS, immutability, idempotency, optimistic concurrency and quota logic, but PGlite executes one embedded backend and does not prove hosted multi-session isolation.

The separately observed no-image/typed-text local workflow is **not a network authorization bypass**. Operational cloud sealing calls `validateCase`, which requires one to four panels (`server/caseService.mjs:12`), and `api/cases.js:18-24` requires both original and analysis objects registered to the authenticated owner, organization, case and panel. Local mode can create a high-confidence-looking record without those server checks, so local reports must remain visibly labelled unverified and must not be presented as managed evidence.

## Reproduction

```powershell
node --test reports/stress-2026-09-04/security-boundaries.mjs reports/stress-2026-09-04/security-postgres.mjs
node --test tests/database.test.mjs tests/storage-sync.test.mjs tests/workspace-security.test.mjs tests/workspace-client.test.mjs
```

Stress harness result: **8/8 passed** (each named reproduction passing means the documented defect reproduced, not that the application is safe). Focused regression result: **30/30 passed**.

Not performed: live Supabase Auth/Storage mutation, live multi-session races, Vercel load testing, actual browser quota exhaustion, or cloud penetration testing. No live service was written to or load-tested.
