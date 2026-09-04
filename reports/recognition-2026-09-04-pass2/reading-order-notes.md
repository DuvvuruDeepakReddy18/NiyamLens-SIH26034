# Reading-order experiment: limited gain, review only

The same eight photographs and the same current parser produced **1/10 valid exact critical fields from raw RapidOCR text versus 2/10 from reconstructed rows**. Only Jaggery's packing date was added. This is a small, previously used development set with provisional AI visual labels—not a held-out accuracy result.

| Field | Readable references | Raw exact matches | Derived exact matches |
| --- | ---: | ---: | ---: |
| MRP | 3 | 1 | 1 |
| Net quantity | 5 | 0 | 0 |
| Packing date | 2 | 0 | 1 |

The filtered output contains exactly one officer-review suggestion: `PACKED ON: 02/08/2026`. It retains the unchanged heading and date strings, original quadrilaterals, source IDs, and original indexes. It is explicitly **ineligible for automatic verdicts**. No officer acceptance was performed by this experiment.

## Why Jaggery was not a simple same-row case

The returned OCR geometry has different vertical spacing in its two columns:

| Corresponding printed role | Heading centre y | Value centre y |
| --- | ---: | ---: |
| Batch | 335.35 | 311.99 |
| Packed on | 471.14 | 419.35 |
| Use by | 605.03 | 531.14 |
| MRP / price row | 738.92 | 634.71 |

These numbers are OCR box coordinates, not physical measurements. Heading pitch is approximately 135 pixels; value pitch is approximately 107 pixels. Equal centres or nearest-y matching is therefore unsuitable. Projecting boxes along their detected baselines gives unique half-height-overlap pairs for the packing date and use-by date. MRP and its price do not satisfy that row-band condition. No row-number/ordinal matching was used to force a correspondence.

## What changed

`src/lib/ocrReadingOrder.mjs` reconstructs generic geometric rows, including more than two adjacent OCR fragments. It does not begin with a recognised-heading candidate search. It preserves original strings and uses fixed geometric overlap, angle, gap and font-height limits. Complete-link row-band checks reject transitive chains through multiple rows. Parallel candidates, multiple declaration headings, and multiple numeric fragments for one heading cause abstention.

`reviewableDeclarationProposals(order)` is a separate, stricter filter. It accepts only a reconstructed row containing:

- An exact standalone MRP, net-quantity, or packing/manufacturing-date heading.
- Exactly one separate value fragment.
- One valid, non-conflicting corresponding candidate from the actual canonical parser.
- No unresolved or conflicting same-field evidence elsewhere in the original OCR lines.

Use-by, serving-size, manufacturer-BY declarations, ordinary neighbouring columns, invalid recognised values and multi-fragment values are excluded from suggestions. Every returned proposal has `requiresOfficerReview: true` and `eligibleForAutomaticVerdict: false`. The filter does not modify any transcript.

The parent's dotted `PKD. by` parser fix is present in both comparison arms. That fix alone leaves raw results at 1/10; reconstruction adds the packing-date evidence. Removing the spurious manufacturer-BY date conflict is a prerequisite, not a character-recognition improvement.

## Why the full derived transcript must not be adopted automatically

General geometric rows also combine unrelated same-height columns. Examples include `AFTER USE 1l` on Kinley and `DORDONTACT AT MFD & SCAN TO` on the ghee jar. These do not produce extra valid critical fields, and the strict proposal filter excludes them, but they demonstrate that row geometry is not semantic proof.

Use only reviewable, mapped suggestions for explicit officer decisions. Do not silently substitute the whole reordered transcript for raw OCR or describe this as a production-ready OCR fix.

## Verification and artifacts

- `node --test tests/ocr-reading-order.test.mjs`: **19/19 passed** when this report was written.
- All eight exact source-photo SHA256 values were checked against the frozen manifest.
- Every input transcript equalled the untouched `metadata.texts.join('\n')` output.
- `reading-order-comparison.json` records input/manifest/code hashes, both-arm field results, geometry diagnostics, every reconstructed row's exact source-box mapping, rejected groups, and the review-only proposal.
- The original raw text/box/confidence arrays remain in `reports/recognition-2026-09-04/rapidocr-default-raw.json`; the comparison contains hash-linked per-sample references.

This experiment did not integrate UI, deploy an engine, accept an officer correction, or measure legal-verdict accuracy. Its policy was developed after inspecting development-image geometry and synthetic counterexamples. Independent human annotation and unseen-photo validation remain necessary.
