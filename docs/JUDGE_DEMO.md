# Seven-minute judge demonstration

Use [the current team rehearsal and release gates](TEAM_WINNING_REHEARSAL.md) with this short script. The measured recognition limitations and current implementation status are in [the readiness follow-up](READINESS_IMPLEMENTATION_2026-09-05.md). This is a rehearsal plan, not evidence that a live trial succeeded.

## 0:00–0:40 — Make the test falsifiable

Open **Blind challenge**. Ask a judge to pick any packaged commodity and retain control of it until capture. Start the challenge and point out that controlled packets disappear.

## 0:40–2:00 — Capture defensible evidence

Capture front, back and side declaration panels. Show the quality score, any recapture warning and the original SHA-256 digest. If the panel is skewed, select **Flatten panel** and click top-left, top-right, bottom-right and bottom-left. Explain that homography, rotation or grayscale creates a derivative without changing the original evidence.

## 2:00–3:10 — OCR with visible grounding

Run browser OCR. Show the separate reliability and engine-confidence values; neither is a calibrated probability of correctness. Use the critical-field recovery cards to select a close-up including both the heading and its value. If needed, open **More OCR options** for deep or optional Paddle OCR. Click a located declaration to show its available image evidence; do not invent a bounding box when geometry is unavailable. Record any officer correction and its reason visibly. Use **Connected OCR** only after its real deployment configuration has been verified and the judge agrees to the explicit image transfer.

## 3:10–4:30 — Geometry and exceptions

Check the package profile, quantity and Rule 3 consumer/commodity scope against the physical package. Confirm applicability only when supported. For a flat panel, record physical dimensions and a same-plane known reference before measuring the target text. A bottle's entered dimensions do not validate curved-surface text measurement. Show that unresolved scope, curved/unverified measurement or an interval crossing a tier boundary remains REVIEW. Food typography remains REVIEW pending qualified cross-regime interpretation.

If the packet is small, demonstrate the appropriate Rule 26 path. Pan masala must not receive the ordinary small-package exemption. Do not claim this is a statutory determination.

## 4:30–5:30 — Seal the run

Finalize and open the evidence packet. Show:

- original image hashes;
- OCR confidence and structured evidence;
- rule-by-rule reasons and source references;
- final audit hash and “Audit chain verified.”

Export the JSON or print the packet if requested.

## 5:30–6:20 — Human accountability

For a managed demonstration, use a separately authenticated, pre-tested supervisor account. Open **Officer operations**, enter a mandatory review reason and seal a disposition. Reopen the report and show that the automated status is still present beside the human decision. The local-only actor switch is a training simulation, not proof of authenticated roles; label it explicitly if used. Never present a simulated identity as hosted authorization.

## 6:20–7:00 — Defuse the accuracy question

Open **Validation lab**. State clearly that built-in records are synthetic regression fixtures. Show field exact-match, errors and abstention only with their labelled denominators and provenance. Do not substitute token recall, officer-corrected text or a known-photo success for blind raw recognition accuracy. Verdict accuracy needs independently adjudicated complete-package ground truth. Finish with the actual pending approval gates in **Rule library**.

## Failure recovery

- If local OCR fails, improve the capture or select a declaration-region crop. If an officer must transcribe it, explicitly record that manual correction and its reason; do not count it as OCR success. Offline OCR requires the pack to have been downloaded and verified before disconnection.
- If connected OCR is unavailable, show that local/deep OCR and the existing transcript remain intact. Do not frame provider availability as required for inspection.
- If the browser has no BarcodeDetector, enter GTIN manually.
- If reference detection fails, use two-click calibration.
- If WebXR depth is unavailable, continue with the reference card and do not claim depth measurement.
- If evidence is weak, retain REVIEW and its explanation. Abstention is a safety control; a system that always requires review has not yet demonstrated useful automation.
