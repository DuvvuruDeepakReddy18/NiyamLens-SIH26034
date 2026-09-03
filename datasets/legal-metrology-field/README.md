# Legal Metrology field dataset protocol

This folder is the collection contract for the dataset NiyamLens still needs. The included CSV is a schema, not fabricated evidence.

## Target

Collect at least 250 packages and keep all panels from one physical package in the same case. Reserve 20% of package IDs as a sealed test split before tuning OCR or parsers. Include flat cartons, glossy pouches, bottles, jars, sachets, imported products, food, non-food, small-package exemptions, tobacco/pan-masala carve-outs and non-compliant or ambiguous labels confirmed by two reviewers.

## Capture requirements

- Preserve the original image and SHA-256 digest.
- Capture front/identity, MRP/date, responsible-entity/consumer-care and quantity/barcode views, or one complete declaration panel.
- Record blur, glare, curvature, perspective, language and lighting as independent conditions.
- Transcribe visible text exactly. Do not copy a web product listing.
- Mark a declaration `not_visible` when the submitted panels do not show it. Absence from a photograph is not automatically a package violation.
- Record physical panel dimensions and typography only when measured against a documented reference.

## Review

One annotator enters the truth, a second reviewer verifies it against the images, and a Legal Metrology subject-matter reviewer approves any expected compliance status. Until that review exists, use `expected_status=unreviewed`.

Report token recall, declaration detection precision/recall/F1, normalized value accuracy, false-violation rate, abstention rate, latency and results by package form and capture condition. Never merge train/tuning packages into the sealed test split.
