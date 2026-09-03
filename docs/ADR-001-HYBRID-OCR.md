# ADR-001: Local-first OCR with explicit connected escalation

- Status: Accepted for the competition prototype
- Date: 2026-09-03
- Scope: Text recognition only; compliance decisions remain outside the OCR provider

## Context

NiyamLens must work in an unreliable-network inspection setting while also surviving a judge's unseen-package test. The bundled Tesseract path preserves privacy and remains available offline, but the current 10-image Indian-market pilot recovered 75.9% of pre-labelled tokens. Precomputed Google Vision annotations supplied with the same Open Food Facts images recovered 96.6%. Those figures are pilot token-recall measurements, not field or legal-decision accuracy.

The system therefore needs a stronger recognition option without silently uploading evidence or allowing a probabilistic model to issue a legal verdict.

## Decision

Use a hybrid recognition boundary:

1. Browser OCR remains the default and sends no package image to NiyamLens or an OCR provider.
2. Deep scan remains local and adds four overlapping detail tiles to the three whole-panel passes.
3. Connected OCR is a separate, explicit action. It sends only the processed panel data to a NiyamLens serverless endpoint, which calls Google Vision `DOCUMENT_TEXT_DETECTION` using a server-side key.
4. The API key is never included in the browser bundle. The endpoint validates media type and size, applies a timeout, disables caching and returns normalized text, confidence and word boxes rather than the raw provider payload.
5. NiyamLens does not persist a connected-OCR image on its server. The UI tells the inspector that the configured provider receives it.
6. OCR output is evidence, not a verdict. The deterministic rules engine consumes inspector-verifiable declarations and abstains when evidence reliability or measurement certainty is insufficient.
7. Every connected-OCR request, success and failure is recorded in the local hash-linked audit chain. A failed request leaves previous local evidence intact.

## Alternatives considered

- Tesseract only: strongest offline/privacy posture, but the pilot exposes material recall failures on small and curved label text.
- Cloud only: higher reference recall, but makes inspections network-dependent and transfers every image by default.
- Hybrid with automatic fallback: rejected because a network failure would silently change the privacy boundary.

## Consequences

- A team can demonstrate an entirely offline inspection and separately demonstrate a higher-recall connected path.
- Production use requires departmental approval of the provider, region, retention terms, credentials and threat model.
- Connected OCR requires `GOOGLE_CLOUD_VISION_API_KEY` in the deployment environment. It is intentionally unavailable when the variable is absent.
- Provider confidence is displayed separately from the calibrated reliability score and must not be reported as accuracy.

## References

- Google Cloud Vision OCR: https://docs.cloud.google.com/vision/docs/ocr
- Google Cloud Vision request format: https://docs.cloud.google.com/vision/docs/request
- Open Food Facts API and datasets: https://openfoodfacts.github.io/openfoodfacts-server/api/
