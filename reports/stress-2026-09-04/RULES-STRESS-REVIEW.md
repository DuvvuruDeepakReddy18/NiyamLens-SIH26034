# NiyamLens rules / extraction adversarial review

Run: 2026-09-04. Assessment only: no application edits, cloud writes, or newly captured OCR. Harness: `adversarial-rules.mjs` in this directory. Reproduce from repository root with `node reports/stress-2026-09-04/adversarial-rules.mjs`; it prints the complete JSON result. The harness reports failed expectations in JSON rather than using its process exit code as a CI assertion.

## What the numbers mean

- 43 deliberately selected synthetic adversarial/control cases: 17 expectations passed, 26 failed, including 2 uncaught exceptions.
- 12 numeric font-tier boundary cases: 12 passed.
- 17 existing real-label OCR transcripts replayed with unreviewed fields: 17 returned `manual_review`.
- These are correlated, hand-selected challenges, **not 26 independent defects and not an estimated field accuracy rate**. Some expectations probe desired semantic validation that the current presence-detector does not implement. No legal certification or calibrated image-measurement claim is made.
- For decisive synthetic tests, the harness supplies field confirmations whose note means **the text was transcribed exactly**, not that the content is legally valid. This isolates the important difference between confirming OCR and deciding compliance.

## Prioritized findings

### R1 — P1: multiple quantities within one transcript are silently reduced to the first

Repro: `NET QTY 5 g\nNET QTY 100 g`, metadata from `extractDeclarations`, classification confirmed and extracted first quantity confirmed. Actual: `exempt`, no review. Reverse the two lines and the result becomes `manual_review` on this incomplete label. `fieldCandidates([{id:'single',text:...}])` retains only `5 g`; separate OCR passes with the two quantities retain both.

Cause: `src/lib/extraction.mjs:49` uses first-match extraction; `src/lib/inspectionSafety.mjs:8` considers only the resulting single field per pass; exemption confirmation at line 53 verifies only that first field. Expected: collect all quantities and explicitly resolve distinct declaration panels, multi-packs, duplicated passes and contradictory readings before exempting. A confirm-reading click should not silently resolve an unshown competing declaration. This is a deterministic evidence-safety issue, independent of the final legal interpretation of a multi-pack.

### R2 — P1: invalid numeric metadata can produce a positive physical verdict

With the complete synthetic label and confirmed flat-plane measurements, `referencePx:-100`, `glyphPx:-9`, `glyphWidthPx:-3.5` produces overall `compliant`, all 15 checks passing. The double-negative ratios become positive. `measurementUncertainty:-20` and `pdpUncertainty:-10` also produce `compliant` because negative uncertainty is clamped to zero; non-finite uncertainty is likewise silently treated as zero. `NET QTY 0 g` and `NET QTY 0 kg` become `exempt` with exact field confirmation. The raw helper reports `isSmallPack(-5,'g') === true`; the enforced inspection does correctly block a mismatched negative metadata quantity when OCR has a different positive value.

Locations: `src/lib/rules.mjs:155`, `:252`, `:283`, `:298`, `:308`, `:339`; `server/caseService.mjs:15`. Expected: validated finite positive dimensions/quantity, meaningful bounded uncertainty, and explicit rejection/review of invalid input. The UI constrains some entries, but server validation currently accepts metadata wholesale; these must be guarded at both boundaries. A very long fractional quantity also underflows to zero, another instance of the same input-domain gap rather than a separate high-likelihood real-label defect.

### R3 — P1: server recomputation does not bind typography coverage to actual evidence panels

`validateCase()` accepts a complete record with two `evidenceItems` (`front`, `back`), but omitted `meta.evidencePanelIds` and no per-panel measurement map. Actual: overall `compliant`, only the global font measurement checked. The normal UI derives panel IDs at `src/App.jsx:633`, but the server forwards client metadata at `server/caseService.mjs:15` instead of deriving them from the validated evidence list. When panel IDs are supplied honestly, the existing engine correctly marks an uncalibrated second panel for review.

Expected: derive evidence panel scope on the server, validate panel IDs/uniqueness and the measurement map, and reject missing/unrecognized measurement linkage. This harness exercised the local server validation function, **not a successful network seal**; the actual API additionally checks registered Storage objects and hashes. This finding does not claim those upload checks were bypassed.

### R4 — P1: declaration presence is still conflated with semantic validity

On an otherwise complete label with exact-transcription confirmations, these mutated labels return overall `compliant`:

| Mutation | Actual check | Nature of gap |
|---|---|---|
| `MANUFACTURED BY:` with no manufacturer name | manufacturer `pass` | Heading-only match |
| `UNIT SALE PRICE` with no amount/unit | unitSalePrice `pass` | Heading-only match |
| MRP Rs40, quantity100g, USP Rs99/g | unitSalePrice `pass` | No price/quantity arithmetic validation |
| `PACKED 31/02/2026` | packDate `pass` | Regex accepts an impossible calendar date |
| Imported profile, `COUNTRY OF ORIGIN: UNKNOWN` | countryOrigin `pass` | Any nonempty placeholder accepted |

Locations: `src/lib/rules.mjs:75`, `:80`, `:105`, `:110`; `src/lib/extraction.mjs:50`, `:52`, `:57`; `src/lib/inspectionSafety.mjs:27`. An entirely empty origin heading at the end of text **does** remain manual-review in enforced mode because extraction cannot confirm a value. The impossible date is a calendar-validation issue; a bare month/year may separately satisfy the applicable declaration and requires legal interpretation. The USP arithmetic and origin/manufacturer requirements need amendment-complete primary-source legal sign-off before calling a package unlawful. The verified implementation finding is that these inputs are called passing/compliant, not that this audit certifies their legal disposition. Safer behavior is `present; validity unverified` or manual review until a semantic validator exists.

### R5 — P2: ordinary price formats are silently corrupted

`extractDeclarations('MRP Rs. 1,000.00').byId.mrp.value` is `'1'`, confidence96. `MRP Rs. -40.00` becomes `'40.00'`; `MRP Rs. 40.999` becomes `'40.99'`. Location: `src/lib/extraction.mjs:48`. These are text parsing errors, not OCR errors: the input is already perfect text. Expected: parse supported grouping losslessly, reject invalid signs/precision, retain source spans and abstain on ambiguous amounts.

### R6 — P2: malformed requests can crash the evaluator rather than return structured validation failures

- Finite `pdpArea:1e308` and `pdpUncertainty:1e308` lead to multiplication overflow then `TypeError: Cannot read properties of null (reading 'minimum')` at `src/lib/rules.mjs:269`.
- `fieldReviews.mrp={state:'confirmed',value:'40.00',reason:17}` triggers `TypeError: review.reason?.trim is not a function` at `src/lib/inspectionSafety.mjs:27`.
- String `'false'` for `pdpConfirmed`, `measurementConfirmed`, and `widthCharacterConfirmed` is truthy and allows overall `compliant` (lines43 and48). Unknown commodity string `typo_tobacco` permits `exempt` on `TOBACCO PRODUCT\nNET QTY 8 g` instead of enum validation/review.

These need strict request schemas, types, enum validation, and finite arithmetic guards. This does not establish service-wide denial of service; it establishes per-input unhandled exceptions and weak safety input contracts.

### R7 — P2: extraction and rule parsing disagree about supported spellings

With otherwise complete confirmed inputs, replacing `MRP` by `M.R.P.` yields a detected/confirmable amount in extraction but manual-review in compliance because the rule regex fails. `NET QTY 100 PIECES` has the same mismatch. Direct `inferQuantity('NET QTY 8 GRAMS')` finds no quantity although extraction normalizes GRAMS to g and the declaration regex accepts it. Locations: `src/lib/extraction.mjs:48`, `:49`; `src/lib/rules.mjs:60`, `:70`, `:150`. These are safe false-abstentions in enforced mode, but erode live-demo credibility and add unnecessary manual work. Use one canonical parser rather than maintaining three inconsistent quantity grammars.

## Strengths retained under stress

- Complete verified baseline still returns compliant; no false alarm was introduced by the harness.
- Missing quantity, unreviewed fields, unsupported Indic-only text, curved surfaces, area-tier uncertainty, and known uncalibrated second panels abstain.
- The 100g-OCR/5g-metadata exemption mismatch is caught.
- Recognized tobacco/pan-masala classes block the small-pack exemption.
- Separate-pass OCR conflicts retain source identities.
- All 12 probes immediately below/at/above the 50,100,500,2500 cm² boundaries match the encoded tier table. This verifies implementation boundaries, not regulatory completeness.
- Local server validation rejects explicitly marked controlled fixtures.
- All 17 stored real-OCR transcripts replayed without user verification stay manual-review. This is good safety behavior, not evidence of useful autonomous coverage.

## Competition consequence

The architecture has credible safety ideas, but a strong judge can still break the rules engine using clean text: conflicting quantities, a blank manufacturer declaration, a comma-grouped price, or an impossible date. More dashboard features will not cure these failures. Before claiming an inspection-ready product, prioritize one canonical typed extraction model, conflict resolution, server-derived evidence scope, semantic validation with clear abstention, and a held-out **field-level** real-package benchmark. Publish exact-match price/quantity accuracy, false-clear rate, review rate, time-to-completion and calibration error rather than token recall alone.
