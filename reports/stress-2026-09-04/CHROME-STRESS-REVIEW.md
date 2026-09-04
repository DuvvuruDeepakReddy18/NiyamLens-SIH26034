# Chrome stress findings — 4 September 2026

Tested current source at commit `1a53740a2dc9460f95dac43267a6e9ec667d5c54` in a new Chrome tab on the isolated local origin `http://127.0.0.1:5180/`. Cloud configuration was absent on this origin. No existing user records or live cloud services were mutated. One synthetic local record was created and left available as reproduction evidence.

## C1 — P1: a no-photo, no-OCR input can become a sealed exemption report

Reproduction through normal UI controls:

1. Start a new inspection, without capturing/uploading a photo or running OCR.
2. Paste this deliberately contradictory text into the evidence editor:

    COMMON NAME: PAPER
    NET QTY 5 g
    NET QTY 100 g

3. Do not confirm fields, classification, quantity or measurements. Do not apply detected context.
4. The UI immediately shows `EXEMPT`, evidence score `100`, one passed check, zero flagged, zero review and `0 captured panels`.
5. Click **Finalize inspection**. It succeeds: `Sealed record saved. Start a new inspection to capture new evidence.` History becomes one record.
6. Click **Open sealed report**. It shows the same exemption, `100.0% OCR confidence`, and `Local audit chain verified` even though only the seal event exists.

The report also honestly states there is no original OCR transcript, and shows zero captured panels. Those footnotes do not reconcile the conflicting 100% confidence and positive exemption claim. The report labels the typed text "Officer-reviewed evidence text" despite no per-field review occurring.

Local record ID: `NLM-20260904-ae39fd7a-44b6-4a66-a4cf-78051f186d43`. Created around 14:29 IST; sealed around 14:31 IST. This was a **synthetic text/UI test, not a successful scan or cloud upload**.

Underlying code: `INITIAL_META` in `src/App.jsx` initializes OCR/engine confidence to 100 without enabling evidence review. First photo upload enables `enforceEvidenceReview`; the text-only path does not. `inferQuantity` takes the first quantity and does not surface the second as a conflict. The local seal path permits zero panels. The rules harness separately proves the quantity conflict persists even with field-review mode enabled and the first extracted value confirmed.

Expected: manual text should have its own provenance, OCR confidence should be unavailable until an OCR run exists, safety review should not depend on visiting the upload path, contradictions should block decisive exemptions, and no-photo reports must not masquerade as image-supported findings. Whether text-only records may be saved at all is a product decision; if allowed, they need an explicitly unverified/manual status.

## C2 — P2: a common price format is corrupted before OCR is involved

In a fresh text-only inspection, paste an otherwise complete synthetic label with `MRP Rs. 1,000.00 inclusive of all taxes`.

Observed structured field: `MAXIMUM RETAIL PRICE 1 96% parser`. The price is parsed as 1, not 1000. This is an extraction defect with already-perfect text, not image recognition failure.

In the same input, `PACKED 31/02/2026` was detected and the month/year check passed. `MANUFACTURED BY:` alone was detected as a responsible entity and its rule passed. `UNIT SALE PRICE Rs. 99.00/g` passed despite MRP1000 and quantity100g. Overall status on this text-only baseline was manual review because geometry was missing; this Chrome check does **not** claim that baseline had an overall compliant verdict. The isolated rules harness demonstrates an overall compliant verdict when the remaining geometry/confirmation conditions are supplied.

## Real-image OCR rerun limitation

An actual Amul label photo was inspected visually. The attempted upload through the browser's file chooser failed with `fileChooser.setFiles failed` / `Not allowed`. The browser extension requires **Allow access to file URLs**; instructions were supplied to the user. No alternative browser-control mechanism or permission bypass was used.

Therefore there is **no fresh real-image OCR benchmark from this session**. The 61.1% standard / 67.5% deep figures elsewhere in this audit are explicitly the existing 3 September pilot. Typed test input above was never described as OCR output.

## Scope

These findings prove local UI behavior. They do not prove a zero-panel record can be stored in the managed cloud: the server adds authentication, evidence requirements and recomputation. Managed acceptance must be tested separately, and the server's own metadata/schema gaps are documented in the rules and security reviews.
