# Field validation protocol

## Objective

Measure whether NiyamLens extracts declarations and issues safe decision-support outcomes on real, unseen packages. Synthetic fixtures test regressions only and must never be reported as field accuracy.

## Dataset target

Collect at least 300 packages with deliberate coverage across:

- flat cartons, pouches, glossy bottles and cylindrical labels;
- clean, dim, blurred, glared, skewed and partly occluded captures;
- English plus Hindi, Telugu and Tamil combinations;
- general, food, imported, medical-device, tobacco, pan masala, fast-food and formulation profiles;
- principal-display-panel areas near 50, 100, 500 and 2500 cm²;
- quantity boundaries at 10 g/ml and just above;
- compliant, non-compliant, exempt and genuinely indeterminate cases.

## Ground truth

Two trained reviewers independently label every declaration, its image region, applicable package profile, physical measurement and expected outcome. A qualified Legal Metrology reviewer adjudicates disagreements. Store both initial labels and the adjudication trail.

## Split policy

Split by product/SKU, not by image, so alternate photographs of one package cannot leak into both evaluation and development. Freeze the final test split before tuning thresholds.

## Required metrics

- Declaration-level precision, recall and F1.
- Exact-value accuracy for MRP, quantity, dates and barcode.
- Region localization overlap or reviewer acceptance.
- Overall status accuracy.
- False-violation rate, reported separately and treated as the highest-risk error.
- False-pass rate.
- Abstention/manual-review rate.
- Results by script, package shape, image-quality band and legal profile.
- Calibration absolute error in millimetres and panel-area percentage error.
- Median and 95th-percentile end-to-end latency on target phones.

## Acceptance principle

Do not choose production thresholds from a single aggregate score. Establish department-approved limits for false violations, false passes and measurement error, then use abstention to stay inside them. Any profile without adequate samples remains “not validated.”

## Import schema

Validation Lab accepts JSON arrays with:

```json
{
  "id": "FIELD-001",
  "condition": "glossy-cylindrical-hindi",
  "text": "reviewed ground-truth transcript",
  "meta": { "category": "general", "quantity": 100, "unit": "g" },
  "expectedStatus": "manual_review",
  "expectedFields": ["mrp", "netQuantity", "consumerCare"]
}
```

The current importer evaluates parser and rule outcomes from labelled text/context. A production validation service should also ingest image-level regions and physical measurement ground truth.
