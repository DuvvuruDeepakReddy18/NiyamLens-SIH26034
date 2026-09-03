# Seven-minute judge demonstration

## 0:00–0:40 — Make the test falsifiable

Open **Blind challenge**. Ask a judge to pick any packaged commodity and retain control of it until capture. Start the challenge and point out that controlled packets disappear.

## 0:40–2:00 — Capture defensible evidence

Capture front, back and side declaration panels. Show the quality score, any recapture warning and the original SHA-256 digest. If the panel is skewed, select **Flatten panel** and click top-left, top-right, bottom-right and bottom-left. Explain that homography, rotation or grayscale creates a derivative without changing the original evidence.

## 2:00–3:10 — OCR with visible grounding

Run browser OCR. Show the separate reliability and engine-confidence values. If the capture is difficult, run **Deep scan small text** and explain that four overlapping detail tiles are added locally. Click MRP, net quantity and consumer care in the structured extraction grid; each click should highlight the matched image line. Correct an OCR error if one exists and state that recognition proposes evidence while deterministic rules decide. Use **Connected OCR** only if the server secret is configured and the judge agrees to the explicit image transfer.

## 3:10–4:30 — Geometry and exceptions

Select the package profile and quantity. For a flat panel, enter width and height; for a bottle, enter diameter, label height and visible circumference. Calibrate a known reference, then click the target text region. Show that an interval crossing a Table I boundary becomes REVIEW.

If the packet is small, demonstrate the appropriate Rule 26 path. Pan masala must not receive the ordinary small-package exemption. Do not claim this is a statutory determination.

## 4:30–5:30 — Seal the run

Finalize and open the evidence packet. Show:

- original image hashes;
- OCR confidence and structured evidence;
- rule-by-rule reasons and source references;
- final audit hash and “Audit chain verified.”

Export the JSON or print the packet if requested.

## 5:30–6:20 — Human accountability

Open **Officer operations**, switch to Supervisor, enter a mandatory review reason and seal a disposition. Reopen the report and show that the automated status is still present beside the human decision.

## 6:20–7:00 — Defuse the accuracy question

Open **Validation lab**. State clearly that the built-in records are synthetic regression fixtures. Import a team-labelled dataset if available and show verdict accuracy, field F1, false-violation rate and abstention. Finish with the four pending approval gates in **Rule library**.

## Failure recovery

- If local OCR fails, retry English, improve the panel crop or paste a verified transcript; the language assets are bundled and cached for offline use.
- If connected OCR is unavailable, show that local/deep OCR and the existing transcript remain intact. Do not frame provider availability as required for inspection.
- If the browser has no BarcodeDetector, enter GTIN manually.
- If reference detection fails, use two-click calibration.
- If WebXR depth is unavailable, continue with the reference card and do not claim depth measurement.
- If confidence is low, celebrate the REVIEW result: a safe abstention is an intended outcome.
