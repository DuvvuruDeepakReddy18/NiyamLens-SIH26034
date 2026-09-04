# NiyamLens: SIH26034 win-readiness stress audit

**Assessment date:** 4 September 2026. **Source:** `1a53740a2dc9460f95dac43267a6e9ec667d5c54`, branch `codex/managed-cloud-release`. This is a current-source audit, not an assessment of the older public production alias. No application fixes, production promotion or GitHub push were performed during this audit.

## Verdict

**Keep SIH26034. The project has a credible route to a strong entry, but the current build is not winner-ready.** This is a technical judgment, not a prediction of the judges' decision. No responsible review can assign a winning probability without knowing the other teams, field performance and the sponsor's evaluation.

The application has substantial working infrastructure. However, its central claim—reliable package-compliance assessment—does not survive several simple adversarial inputs. The most serious failures occur with perfectly typed text, before OCR introduces any errors. A good presentation or additional dashboard features cannot substitute for fixing those failures.

SAH and SIH are not production-certification exercises. A narrowly scoped prototype can be competitive while clearly disclosing unsupported cases. But it must reliably perform the tasks it claims to perform. Incorrect positive verdicts, unearned confidence and hidden conflicting readings undermine that credibility.

## 1. What was actually tested

| Test | Actual observation | Meaning |
| --- | --- | --- |
| Existing application/database/client tests | 93/93 passed in a fresh run | Existing regression guarantees held, but coverage missed the new cases |
| Production build | Passed; Vite6.4.3 | Current source compiles; this is not a deployment or field test |
| Targeted rules/extraction cases | 43 cases: 17 expected outcomes, 26 expectation failures, including2 exceptions | Hand-selected controls and adversarial probes; not26 independent bugs |
| Deterministic property sweep | 13,080 cases: 7,239 expected outcomes, 3,841 unexpected positive verdicts, 2,000 exception occurrences | Many repetitions of a few root causes; NOT a real-world failure rate |
| Valid field-block permutations | All1,000 remained compliant | Ordinary field ordering did not break the verified baseline |
| Numeric font-tier boundaries | 12/12 passed | Correct encoded threshold implementation, not legal or physical-measurement certification |
| Existing OCR transcript replay | 17/17 unreviewed transcripts went to manual review | Safe abstention, not evidence that17 packages were correctly inspected |
| Local security and database stress harnesses | 8/8 reproduction/control tests executed as expected | Some tests deliberately PASS when they reproduce a defect; do not interpret this as8 security successes |
| Embedded PostgreSQL retry/contention controls | 100 identical seals ->1 case;30 competing stale-version reviews ->1 success/29 conflicts;100 quota attempts ->30 allowed | Useful SQL invariants on one local embedded backend, not hosted multi-session load capacity |
| Chrome UI | Corrupted comma-grouped price; sealed an exemption with conflicting quantities, no photo and no OCR | Fresh end-to-end local UI evidence, detailed below |

The property-sweep counts were reproduced independently. Runtime was approximately1.0–1.3 seconds for the pure-function sweep. This excludes OCR, browser rendering, network and cloud services. Some malformed inputs are direct-function `NaN`/`Infinity`, while others are serializable strings, negatives, huge finite numbers and wrong types. Their frequency in the synthetic suite is deliberate, not representative.

## 2. The failures that matter most

### A. An exemption report can be sealed without any scan

In a clean local Chrome session, enter:

    COMMON NAME: PAPER
    NET QTY 5 g
    NET QTY 100 g

Without uploading an image, running OCR or confirming fields, the console shows **EXEMPT**, evidence score100 and zero review checks. Clicking **Finalize inspection** succeeds. The sealed report displays **100.0% OCR confidence**, zero captured panels and a verified local hash chain containing just the seal event.

It does disclose the missing original OCR transcript further down, but that does not justify the confidence or exemption. This was a synthetic text-input test, never represented as actual OCR. The managed server requires1–4 panels, so this is **not** a demonstrated cloud upload bypass.

See [the full Chrome reproduction](CHROME-STRESS-REVIEW.md). The record remains on the isolated local origin at port5180, not in the user's operational workspace.

### B. The compliance engine confuses declaration presence with validity

With the remaining synthetic fields, exact-transcription confirmations and physical metadata supplied, these can pass:

- A bare `MANUFACTURED BY:` heading without a manufacturer identity.
- A bare `UNIT SALE PRICE` heading without an amount or unit.
- An impossible calendar date such as `31/02/2026`.
- A unit price inconsistent with the stated MRP and quantity.

These tests confirm what the software returns; they do not constitute a legal finding about an actual retail package. Profile-specific exceptions and amendments need qualified review. The official Legal Metrology department's published rules require manufacturer identity/address and specify unit-sale-price bases for applicable packages; a keyword detector is not enough to establish these. [Primary departmental reference](https://lmd.kerala.gov.in/service-registration/).

The fix direction is to separate **detected**, **structurally valid**, **consistent with other fields**, **unverified**, and **officer disposition**. Confirming that OCR matches the photo must not automatically certify that the printed content is valid.

### C. Clean text can be silently misparsed

- `MRP Rs. 1,000.00` becomes **1**, with a displayed96% parser score. Reproduced in Chrome as well as the pure parser.
- The first quantity in a transcript wins. All500 small-first conflict variants became exempt; the same pairs in reverse order stayed in review.
- Zero quantity can become exempt.
- `M.R.P.` and `PIECES` are treated inconsistently by different parsing paths.

One canonical parser should retain all candidates, normalized values, raw source spans and ambiguity. Avoid extracting one value for the UI and separately interpreting the same text for legal checks.

### D. Invalid inputs can defeat measurement safeguards

Negative reference, glyph-height and glyph-width values can cancel into positive ratios and yield **COMPLIANT**. Invalid uncertainty can become effectively zero. String values such as `'false'` can act like checked confirmations. Huge finite area/uncertainty values and malformed review notes produce uncaught exceptions.

Also, server recomputation trusts client metadata for which evidence panels need calibration. A local server-validator call with two actual panels but omitted panel-ID metadata accepted a single global calibration. This does not claim the API's separate Storage/hash checks were bypassed.

Use strict request schemas, finite positive physical quantities, actual booleans, validated classifications and server-derived panel scope. See [rules review](RULES-STRESS-REVIEW.md).

### E. Reliability and evidence handling still have edge failures

- If another review is queued while an earlier review request is in flight, the acknowledgement can overwrite the newer visible local review and display `synced`. The newer intent remains recoverable in the outbox; it was **not** proven permanently deleted.
- The API image-verification handler accepted a3-byte JPEG prefix as verified in a provider-mocked test. It checks signatures/hashes but not actual image decodability. This is not an image-decoder exploit and was not tested against live Supabase Storage.
- Malformed nested request values produce500s instead of structured4xx errors.
- Pagination can repeat a full tail page beyond the100,000 offset cap. That is a high-volume deployment defect, not a likely small hackathon-dataset failure.
- A100,000-character adversarial text pattern within the current allowed text limit exceeded a3-second CPU deadline. A30,000-character example took about1.28seconds through `validateCase`. The email regex was independently isolated as a superlinear hotspot. This was a bounded local timing test, not a hosted denial-of-service test.

Normal long-text profiles were fast (99,000-character near-declaration cases around7ms). That does not contradict the pathological pattern: input structure matters. Do not convert either measurement to a concurrent-user capacity claim.

## 3. Real OCR: the evidence is still too weak for a winning claim

The existing3September pilot measured17 declaration-panel photos from10 Indian-market products:

| OCR path | Existing result | Limitation |
| --- | --- | --- |
| Standard browser OCR | 61.1% expected-token recall | Not exact-value MRP/quantity/date accuracy |
| Deep browser OCR | 67.5% expected-token recall | Same small pilot; no demonstrated SKU-held-out field evaluation |
| Precomputed Google Vision annotations | 93.7% reference-token recall | Dataset reference, not a live configured application/provider test |

Many expected tokens are words such as "energy" and "protein", not legally critical values. For example, the Amul500ml/₹22 label's deep transcript scored80% token recall while the report recorded only one parsed signal. A photo looking readable and a high token score do not establish correct field extraction.

A fresh real-photo upload was attempted in Chrome but blocked by the reinstalled browser extension's file-URL permission. Instructions were provided. **This audit did not rerun the real-image OCR benchmark**, and no manually corrected text was counted as OCR success. Google Vision credentials are not configured on the staged deployment.

Required evidence: freeze unseen SKUs before tuning; capture them using ordinary phones; have independent reviewers annotate exact values and adjudicate disagreements. Report per-field exact match, false clearances, false violation flags, abstention/coverage, correction effort and complete inspection time—not a single inflated accuracy number. The existing field-validation protocol targets300 packages; it is a plan, not a completed result.

## 4. What already deserves credit

- Original OCR and officer corrections are distinct; original/analysis evidence and hashes are represented separately.
- Per-field review and unsupported/uncertain-case abstention are implemented.
- Known font-tier boundary uncertainty and curved/unverified physical measurements withhold automatic decisions.
- Recognized tobacco/pan-masala classes block the encoded small-pack exemption, and metadata cannot simply override a larger extracted quantity with a smaller one.
- PostgreSQL role/organization isolation, immutable retries, version conflicts, append-only records and quota limits held in the local tests.
- The client has scoped storage, identity-switch cancellation, bounded export downloads and byte-digest checks.
- Local record/queue commits and draft-recovery infrastructure are real implementations, not only mock dashboard elements.

These are useful foundations. An internal hash chain does not prove evidence was originally true or resist a privileged database administrator. Fake IndexedDB tests do not prove phone storage capacity. Mocked service tests do not prove real authentication/email/object-store operation.

## 5. Fit to the actual SIH problem

The official26034 statement is indeed about scanning labels/product information for Legal Metrology compliance. It includes correctness, placement, readability/font checks, reports, evidence/history, secure roles and dashboards. The current project fits the problem; there is no reason to switch problem statements merely because these bugs were found. However, declaration-placement validation was not found, and JSON plus browser Print/PDF does not yet establish a practical editable inspector document. [Official SIH2026 statement](https://www.sih.gov.in/sih2026PS).

The2026 guidelines assess novelty, practicality, technical complexity, clarity, sustainability, impact, UX and future development. They do not publish the earlier invented numerical ranking. Approximately4–5 teams may reach a PS finale, and the sponsor may decline to award a winner if expectations are not met. A low submission counter is not proof of weak competition. [Official2026 guidelines](https://www.sih.gov.in/letters/SIH2026-Guidelines-College-SPOC.pdf).

The current official PS page and guidelines disagree on some submission dates. Confirm the operative deadline with the college SPOC; do not rely on an older community mirror or a21-day plan.

NiyamLens's strongest potential differentiator is a **traceable, conservative inspection workflow that saves an officer time without silently clearing bad evidence**. OCR engines, hashes, homography and role-based access are standard ingredients; integration alone is not proof of novelty. Show a measured improvement over a phone photo plus a manual checklist.

## 6. Order of work before claiming a strong contender

1. **Eliminate known false clearances.** Fix canonical extraction/conflicts, semantic validation and exemption applicability; add each reproduction as a regression with the safe expected outcome.
2. **Make confidence and evidence provenance truthful.** No OCR confidence without OCR; no automatic image-supported verdict from unverified typed-only input; separate transcription review from compliance approval.
3. **Harden the trust boundaries.** Strict server metadata validation, server-derived panel coverage, positive finite geometry, valid enums, safe error responses, image decoding/limits, outbox acknowledgement race and bounded parser runtime.
4. **Freeze and run an unseen-label evaluation.** Start with a practical independently annotated batch, expand toward the documented300-package protocol, and keep held-out SKUs out of tuning. Publish failures as well as successes.
5. **Validate legal and physical claims with people.** Qualified domain review of rule versions/applicability; real measurement comparisons across phones, package planes and font sizes; reproducible uncertainty results.
6. **Demonstrate one real operational round trip.** Officer login -> photo -> unedited OCR -> review -> interrupted-network recovery -> private upload -> second-user review -> portable evidence export -> sign out/revocation. Test on actual hosted services with authorized test accounts. The first-admin invitation and configured backend alone do not prove this.
7. **Then finish sponsor-facing gaps and documentation.** Placement checks within a defensible supported scope; practical editable report; one dated feature/validation manifest instead of stale README/deck claims.

Deployment-grade backup/restore, retention, local-device privacy and multi-session load testing are separate release requirements. They matter for a real operational product, but should not consume the time needed to prove core inspection correctness before SAH.

## 7. The judge gauntlet

Ask someone outside the development team to bring ten unseen packages. Do not provide prepared transcripts. On an ordinary phone, explain failures openly and show:

- Exact MRP, quantity and date readings before correction, with the corresponding image regions.
- A contradictory/malformed label that is not cleared.
- A hard/curved/glare case that triggers a specific retake or review request.
- A valid exemption with applicable classification evidence, plus a carve-out case.
- A borderline physical measurement that abstains rather than invents certainty.
- A dropped-network/reload round trip without lost or misleadingly synced reviews.
- A second real account's permitted view and a denied cross-workspace view.
- An exported evidence record whose original bytes and correction history remain inspectable.

Measure the full process against a manual checklist. The team should be able to explain every failed case, support boundary and trade-off without relying on a polished prerecorded sequence.

**Bottom line:** there is a worthwhile solution here. The next competitive advantage is stronger proof and fewer wrong decisions—not more feature names. I would pitch the current build as an actively validated prototype, not as inspection-ready compliance automation.

## Reproduction and audit files

Run from the repository root:

    npm test
    npm run build
    node reports/stress-2026-09-04/adversarial-rules.mjs
    node reports/stress-2026-09-04/property-rules-sweep.mjs
    node --test reports/stress-2026-09-04/security-boundaries.mjs reports/stress-2026-09-04/security-postgres.mjs

The first two audit harnesses print findings and may exit0 even when unsafe outcomes are recorded. The security harness deliberately asserts the current reproductions. These must be converted to protective regression assertions when fixes are implemented; a green reproduction suite is not a green release gate.

Supporting files: [rules review](RULES-STRESS-REVIEW.md), [security review](SECURITY-STRESS-REVIEW.md), [Chrome reproduction](CHROME-STRESS-REVIEW.md), [property results](property-rules-sweep-results.json), and the executable harnesses in this directory. Live Auth/Storage acceptance, a fresh real-image run and representative phone/field evaluation remain unverified in this assessment. No hosted load test was run and no real-service security boundary was probed destructively.

Method: the engineering testing-strategy and code-review skills directed independent correctness, security/reliability and sponsor-fit reviews, with reproducible failure cases and explicit distinctions between actual tests, historical evidence and unverified capabilities.
