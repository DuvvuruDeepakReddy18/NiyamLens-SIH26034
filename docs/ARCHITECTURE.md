# NiyamLens architecture and trust model

## System goal

Provide an officer with a reproducible, reviewable assessment of declarations on a packaged commodity while keeping image recognition, legal logic and human disposition visibly separate.

## Design constraints

- A judge must be able to supply an unseen package.
- Tesseract worker, WebAssembly and supported language data are bundled and cached for offline use. Connected OCR is a separate explicit action and is never an automatic fallback.
- Browser computer vision is advisory. It cannot turn an uncalibrated image into a defensible millimetre measurement.
- Legal applicability changes over time and must be versioned and approved externally.
- Missing or weak evidence must cause abstention, not a guessed violation.
- An officer override must add history, never erase the automated result.

## Component map

```text
                         +-----------------------+
Camera / file ---------->| Evidence preparation  |
                         | hash, quality, rotate |
                         +-----------+-----------+
                                     |
                                     v
                         +-----------------------+
                         | Browser OCR           |
                         | text, confidence, box |
                         +-----------+-----------+
                                     |
                  +------------------+------------------+
                  v                                     v
        +---------------------+             +----------------------+
        | Declaration parser  |             | Geometry/calibration |
        | evidence proposals  |             | area + uncertainty   |
        +----------+----------+             +----------+-----------+
                   +------------------+-----------------+
                                      v
                         +-----------------------+
                         | Deterministic rules   |
                         | version + provenance  |
                         +-----------+-----------+
                                     |
                                     v
                         +-----------------------+
                         | Audit + local record  |
                         | IndexedDB / AES-GCM   |
                         +-----------+-----------+
                                     |
                                     v
                         Report / supervisor disposition
```

## Trust boundaries

1. **Original evidence:** the original file hash and capture metadata are immutable inputs. Preprocessed derivatives are separate.
2. **Recognition:** OCR text, word regions and confidence are evidence proposals. The officer can correct context, but the original transcript remains in the record.
3. **Measurement:** physical values are produced only when a scale reference is supplied. Uncertainty intervals cross-check the Rule 7 tier and text-height boundary.
4. **Decision:** only deterministic code evaluates the rule matrix. No language model issues a verdict.
5. **Human review:** supervisor action stores the automated status, reason, actor and a new hash-linked event.
6. **Transfer:** offline bundles are encrypted, but production authentication, server-side immutability and key management remain external deployment requirements.

## Major failure modes and controls

| Failure | Control | Residual risk |
|---|---|---|
| Blur, glare or poor lighting hides text | Quality gate and recapture guidance | Thresholds require field calibration |
| OCR misses a declaration | Confidence gate, word-region inspection, manual correction | Indian scripts need real dataset validation |
| Perspective or a curved bottle changes scale | four-corner homography, reference calibration, cylindrical calculator, uncertainty | Browser depth support does not itself validate measurement accuracy |
| Area error crosses a Table I boundary | lower/upper area bands force REVIEW | legal PDP selection remains an officer judgment |
| Package is legally exempt | explicit Rule 26 profiles and boundary tests | matrix requires current departmental approval |
| User edits or replaces evidence | original digest and hash-linked action log | local storage is not a production WORM archive |
| Supervisor changes the result | original automated status preserved, reason required | local actor switch is a prototype, not identity proof |
| Accuracy is overstated | synthetic fixtures labelled; field metrics only from imported labels | ground-truth protocol still needs approval |

## Scale path

The competition build is a single-browser PWA. A pilot deployment should replace local actors and storage with departmental SSO, an API, encrypted object storage, immutable event logging and signed rule-pack releases. OCR and deterministic rules can remain client-side for resilience, with server synchronization when connectivity returns.
