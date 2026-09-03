# NiyamLens release verification — 3 September 2026

This is the evidence record for the SIH26034 college-round prototype release. It distinguishes automated verification from claims that still require field or regulator approval.

## Automated checks completed

| Check | Result |
| --- | --- |
| Unit and rule regression suite | 54/54 passed |
| Production build | Passed |
| Full desktop/mobile UI workflow | Passed |
| Local browser OCR regression | Passed; 12/12 expected lines detected on the controlled fixture |
| Connected-OCR consent and failure preservation | Passed |
| PWA/offline reload and offline OCR | Passed |
| Real-label standard benchmark | 61.1% token recall across 17 scored photos from 10 real Indian-market products |
| Real-label deep scan | 67.5% token recall on the same frozen cases |
| Precomputed Google Vision comparison | 93.7% token recall on the same frozen cases |
| Manual transcription injected into benchmark | No |
| Independent Chrome render check | Passed; no NiyamLens-origin console errors |

The real-label set is an OCR stress benchmark, not a compliance ground-truth dataset. Images are contributor photographs sourced through Open Food Facts. Front-only marketing images are excluded from the scored set; difficult declaration panels remain included.

## Release contents

- Web prototype with multi-panel capture, browser OCR, explicit connected-OCR consent, structured evidence extraction, rules-as-code, abstention, reports, audit history, operator roles, PWA/offline behavior and blind-challenge mode.
- Rule pack `LMPC-RC-2026.09-RC4` and applicability matrix `LMPC-MATRIX-2026.09-RC4`.
- Six-slide editable SIH-template presentation and six-page flattened submission PDF.
- Team feature-verification guide and reproducible QA commands.
- A 2 minute 28 second continuous narrated browser recording with visible clicks, untouched real-photo OCR, controlled rule fixtures, evidence reporting, rule provenance, validation, operations and blind-challenge mode.

## Claims intentionally not made

- No claim of department, laboratory or Legal Metrology officer approval.
- No claim that OCR accuracy equals verdict accuracy.
- No claim of production security approval, calibrated-device certification or nationwide field validation.
- No claim that connected Google Vision OCR works without a server-side `GOOGLE_CLOUD_VISION_API_KEY`.

## Human gates still open

1. Replace “College allocation pending” with the official SIH Team ID when the college SPOC provides it.
2. Obtain amendment-complete legal review from the sponsoring department or qualified Legal Metrology counsel.
3. Run a labelled field pilot with inspectors and measure false-violation rate by package type.
4. Validate physical text measurements against laboratory instruments and document device-specific error bounds.
5. Complete production identity, encryption, retention and server-security review before real enforcement use.

The prototype is decision support. A qualified officer remains responsible for the legal determination.
