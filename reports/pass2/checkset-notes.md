# Product-disjoint photo check set — provisional freeze

Prepared 4 September 2026. Manifest: `datasets/critical-fields.checkset.v1.json`.

## Outcome and important limitation

Six photographs across six product codes were labelled visually before any new OCR was run on this check set. None overlaps the six product codes in `critical-fields.v1.json`. However, the remaining local photographs **do not provide confidently readable positive MRP, net-quantity or packed-date declarations**. The exact-value denominators are therefore **MRP 0, net quantity 0, packing date 0**. Positive recognition accuracy is **not measurable**, not 0% or 100%.

This is useful as an incomplete-capture, abstention and number-role check set. It is **not** the requested representative unseen-label recognition benchmark. It must not be used to claim that an OCR upgrade works on new real labels or that legal false-clear rates have improved.

## Selection and leakage disclosure

The available local inventory outside the six excluded product codes contains 12 original-size photographs across four products and 41 candidate thumbnails across six products. Source indexes were used for routing and attribution. Available views were inspected seeking actual critical declarations; no new OCR results were consulted and no selection was based on whether an engine succeeded.

Three selected photos are original-size declaration/nutrition views. Three are 400px candidate thumbnails. The latter expose the collection's resolution/coverage gap, not an adequate positive test. One is a front-only promotional counterexample, explicitly identified as such.

The split is product-code-disjoint from the current critical-field manifest, **not an independent holdout**. Four product codes already occur in older development collections; some exact photos were used for token-oriented benchmarks. The annotating agent previously inspected and OCR-tested another Maska Chaska photo, `20.jpg`, during an earlier task. Those results were not consulted for these labels. Amul shares a brand with an excluded product, and model-training exposure is unknown. This is availability sampling, not random or representative sampling.

All annotations are AI-provisional and require human review. The photographs are not complete-package legal ground truth. A declaration that is not visible in a crop is not necessarily missing from the physical package.

## Frozen photo inventory

| ID | Product code / product | Local view | Why it matters | Eligible critical values |
| --- | --- | --- | --- | --- |
| CK-001 | 8908009059383 / Health Factory bread | Nutrition, 1988 × 2385 | 80 g serving, per-100 g basis and two servings must not become inferred net weight | None |
| CK-002 | 8901058891430 / Maggi | Sideways nutrition, 1018 × 892 | 70 g serving and 100 g nutrition basis on wrinkled/glary film | None |
| CK-003 | 8901063142862 / NutriChoice | Folded care/licence panel, 2250 × 3000 | `100 g pack` appears with obscured scope beneath a pictured product; field identity must remain unresolved | None |
| CK-004 | 8901063017252 / Maska Chaska | Cropped wrapper, 400 × 230 | Price/tax-like heading fragment has no amount; the 50-50 brand and recycling 7 are not prices | None |
| CK-005 | 8901262150217 / Amul carton | Side panel, 148 × 400 | Net-content heading is visible but complete value/unit cannot be confidently labelled | None |
| CK-006 | 8909081002342 / Dark Fantasy | Box front, 225 × 400 | `22 ROLLS 2 FREE` is promotional wording; do not manufacture a net count from arithmetic | None |

Flat or near-flat surfaces and curved/wrinkled flexible packaging are represented. There is **no new cylindrical-bottle product** in this remaining local inventory. The set also lacks reliable positive price stamps, packing-date stamps, a language-balanced sample, and enough images for population-level statistics.

## How to use it without misleading the team

1. Check SHA-256 against the manifest before evaluation. Use the exact files; do not silently replace a thumbnail with a full-resolution download or another package with the same barcode.
2. Keep the manifest fixed while testing. Store fresh OCR text, engine/model/version, preprocessing and timestamps separately. Never substitute manually corrected text for the raw OCR result.
3. Run the normal extraction path and retain its candidates. List any price, quantity or packing-date candidates from these incomplete views for visual review, with field-role explanations. Do not automatically count every such prediction as wrong: `ambiguous_field` and `illegible` are unlabelled, not proven negatives.
4. Report exact-match denominators as zero and accuracy as not measurable. The old critical-field scorer may list exclusions; that is not a new performance result.
5. Report legal verdicts separately. No complete-package officer judgement is provided, so legal correctness and false-clear rate cannot be computed from this manifest.
6. Human corrections require a reviewer, explanation and a new version. Preserve the prior labels and output artifacts.

## What is needed for a real positive check set

Acquire newly selected product-level photos **before** tuning on them: a complete front/declaration-side pair, an independently readable net quantity and MRP, and an explicitly headed packing/manufacture date where present. Include flat packs and cylindrical bottles, clean and difficult capture conditions, and multiple package categories. Freeze exact image hashes and have a person check each value and field identity without seeing OCR predictions. Do not fill missing values from product catalogues, another photograph's batch, serving arithmetic or familiar pack sizes.

A practical next acquisition is six genuinely new products with two or more views each, but that is only a pilot, not enough to establish production accuracy. Existing low-resolution candidates could be replaced by new sample IDs if higher-resolution originals are obtained; doing so would improve readability but would not fix absent declaration sides or create an independent product holdout.

## Source and artifacts

Source URLs and product pages are retained per sample in the manifest. Existing collection metadata records Open Food Facts images as CC BY-SA and database information as ODbL 1.0. Retain original attribution records and check the applicable licence terms when redistributing images. No additional photo or OCR annotation was downloaded for this check set.

Only the new manifest and this note were created for this task. The original critical-field manifest, application code and earlier OCR reports were not modified. Integrity validation checks the six exact image hashes, unique IDs/codes, product-code disjointness, allowed label statuses and the three zero positive denominators; it does not validate the visual annotations or legal correctness.

Freeze validation passed: six samples, six unique products, zero old-product overlaps and six matching image hashes. Across 18 field annotations there are 14 `not_visible`, two `ambiguous_field` and two `illegible`; none is `readable`.

Manifest SHA-256 at freeze: `e11eb7271289fe500d3b6cee925327a5f5092658a9d2ad877fb5043e42f74ca6`.
