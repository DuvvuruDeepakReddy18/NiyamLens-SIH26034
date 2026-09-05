# NiyamLens: the work that will establish usefulness

Prepared 5 September 2026. Engineering can prepare these experiments; only real observations can complete them. **No win, accuracy, time saving or regulatory approval is claimed.**

## 1. Fresh photographs — ready to collect, not collected

Suggested assignment, subject to each person's agreement: Arif collects PKG01–10, Tharun PKG11–20, and Banu PKG21–30. These are collection assignments, not claims that they accepted or completed work. Use new physical products/SKUs not used in development or the AI-reviewed 24. Obtain permission for any non-team material.

Each package needs up to four original JPEG/PNG/WebP images: (1) full declaration-bearing panel, (2) complete MRP heading and amount, (3) complete net-quantity heading/value/unit, (4) manufacturing/packing stamp and its heading. Combine images only where the original already shows multiple declarations; do not collage or re-encode originals. Photograph other sides where necessary for legal review, keeping the app's four-panel limit in mind. Keep the physical package for adjudication. Avoid people, private addresses and unrelated personal data in the frame.

Include flat cartons, glossy pouches, cylindrical bottles, small print, faint overprints and multilingual labels. Avoid a nutrition-only corpus. For each target, record whether it is actually visible and readable, not whether OCR succeeded. A missing photo is a capture failure, not a missing statutory declaration.

Folder convention: `PKG01/front.jpg`, `PKG01/declarations.jpg`, `PKG01/date-stamp.jpg`, plus intake metadata (collector ID, capture time, GTIN/SKU, language, shape, conditions, source rights, prior development exposure). Reserve products **by SKU before tuning**, for example 10 development and 20 evaluation products. Do not tune on evaluation photos or their answers.

Two different people label each evaluation photo independently without OCR, catalogue answers or each other's answers. Arif and Tharun can review separately; a third person adjudicates disagreements. These are real human tasks—AI transcriptions cannot stand in for either reviewer. Freeze IDs, original hashes, labels, exclusions and planned browser modes with [the pilot tooling](BLIND_PILOT_AND_TIME_STUDY.md) before running OCR.

Report each field's exact-match numerator/denominator, wrong valid readings, unreadable/not-visible slots, crashes, assisted corrections and unattempted rows separately. A 30-product convenience sample is not national field accuracy.

## 2. Complete-inspection timing — ready, no observations

Use [the observer timer](validation-kit/observer.html) locally in a browser. It collects measured stage durations and exports the existing study JSON format. It does not invent physical quality checks. Export after each session and keep all attempts, including failures. Anonymous participant/package IDs only.

Start with six new users on two packages each, each using both the manual checklist/report and NiyamLens. Alternate which method comes first; same-package repeat measurements have learning effects. Time from first capture/checklist action until a usable report exists, including all corrections and waiting. Afterward, another person compares each report with the physical package and adds the explicit quality review. Only then score:

```powershell
npm run field:time-score -- OBSERVED-TRIALS.json NEW-TIME-SCORE.json
```

This is a small pilot proposal, not a pre-completed study or a statistically representative sample. Retain slower app trials and failed attempts.

## 3. Qualified domain and measurement review — pending a reviewer

Send the [unsigned domain packet](DOMAIN_REVIEW_PACKET.md), primary-source references, and five complete real-package reports to a qualified Legal Metrology practitioner. Ask specifically about applicability, exemptions, food typography, placement and what evidence permits a finding. Keep unresolved interpretations in manual review. Do not describe a teammate account labelled “officer” as a government endorsement.

Suggested outreach (not sent): “We built a student inspection-support prototype for SIH26034. Could you review five traceable package reports and our rule-interpretation worksheet? We are seeking corrections and limitations, not endorsement. We would also like to observe a permitted inspection workflow, with no confidential material collected.”

For measurement, have a measurement-qualified reviewer compare independently measured reference/glyph dimensions with app results. Include planar, tilted, near-threshold and curved packages; record instrument resolution and reference uncertainty. An unmeasured marker or barcode cannot establish physical scale. Retain every failure and uncertainty interval; do not substitute browser pixel tests for physical validation.

## 4. Hosted roles and recovery

Separate synthetic infrastructure acceptance from real user onboarding. Check the stable public URL, fresh sign-in, permitted role, denied peer/cross-organization access, interrupted upload retry, stale review, fresh-browser image retrieval, export, and offline restart/reconnect. Keep test users contained afterward. Do not share passwords or administrator keys.

The release's private function rollback is not a full workspace/Auth/Storage backup. Full protected off-site backup and service-level disaster recovery remain separate operational gates; follow [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## 5. Judge rehearsal — ready, no human rehearsals recorded

Use [the seven-minute rehearsal](TEAM_WINNING_REHEARSAL.md). An outsider chooses an unfamiliar eligible package. Show upload, actual OCR, a source-linked reading, a visible correction if needed, an uncertainty-driven review, finalization, server acknowledgment and fresh retrieval. Never force a pass. Retain the recording even if a step fails. Assign a primary and backup for presentation, capture/OCR, rules, measurement, cloud/security and red-team timing.

Complete three consecutive rehearsals and one disconnected-network rehearsal on the actual release. Every teammate should explain the biggest remaining limitation: measured raw OCR recovery is still weak on the small known development set. Adding more screens will not substitute for reliable capture, independently measured performance and reviewer trust.
