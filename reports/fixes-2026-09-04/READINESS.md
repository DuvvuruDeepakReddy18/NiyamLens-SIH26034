# NiyamLens — team readiness handoff

Historical snapshot of the earlier hardening pass. For the subsequent 0.4.1 fixes, fresh recognition experiments and new Chrome acceptance, see [current implementation status](../recognition-2026-09-04/IMPLEMENTATION-STATUS.md). The observations and counts below are retained as earlier evidence.

As of 4 September 2026. Project: SIH26034, Legal Metrology package-label inspection support.

## Bottom line

The prototype is safer and more complete, but **it is not yet a reliably automatic real-label inspection system or a proven SIH winner**. The latest live Chrome test still failed to extract critical declarations from a real milk package. The improved behaviour is that it retained manual review instead of confidently clearing or flagging the package. That is a safety improvement, not an OCR-accuracy improvement.

The latest local full run passed **164/164 automated tests**, and `npm run build` passed. These are software checks, including mocked provider boundaries; they do not establish real-world recognition accuracy, regulatory approval, or live cloud acceptance.

## What is verified, and what is not

| Area | Current evidence |
| --- | --- |
| Local code | 164/164 automated tests; production build passes. Changes remain local, not pushed or deployed in this work. |
| Real Chrome capture | Actual file upload succeeded after Chrome file-access permission was enabled. Standard and deep browser OCR were exercised without correcting the extracted text. |
| Real-label result | Amul image described below remained manual review: **19 review checks, 0 flags, 0 passes**. Critical quantity/price extraction failed. |
| Local persistence | The inspected case was sealed locally as `NLM-20260904-b881226f-91b2-49f1-a8ef-3e84fdbed54a`. Local sealing is not a cloud backup. |
| Synthetic benchmark | **12/13** expected verdicts matched; **3/3** labelled field values matched. Only three value labels exist. No held-out field accuracy is established. |
| Word export | Real OOXML `.docx` generation, **11/11** focused automated checks. Chrome generated a **1,493 KB** report from the real sealed case and exposed an explicit **Save generated Word report** link. The browser tool did not confirm the file save; document visual rendering remains unverified. |
| Managed cloud | Actual Supabase Auth/Storage and hosted end-to-end behaviour were **not tested in this work**. Do not describe the local fixes as deployed. |

### The real-label failure to keep visible

- Source image: `datasets/openfoodfacts-india/real-labels/8901262260121/6.jpg` — Amul Taaza Milky Milk.
- Critical visible declarations used for comparison: **500 mL** and **₹22**.
- Standard and deep OCR did not reliably produce those structured fields. The deep raw transcript contained `500 mr` and `MEP ; 2 22.00`; the canonical parser did not treat that as validated quantity/MRP evidence.
- No text was manually corrected to make the result look successful. The unedited failure was preserved in the locally sealed case.
- This photograph is one stress case, not an accuracy estimate. A deep scan button or high engine score is not evidence of accurate legal declarations.

## Implemented fixes

- **Safer declaration parsing:** bounded numeric/date parsing, invalid-calendar rejection, duplicate/conflicting declarations retained, invalid month names rejected, and ambiguous amount/quantity readings withheld. Manufacturer name/address and supported single-package unit-price arithmetic are checked more carefully; uncertain legal scope remains review.
- **Evidence-bound decisions:** no photograph means no finalization. Pending capture/OCR also blocks finalization. Changing captured evidence invalidates OCR provenance and image-bound confirmations, so old measurements/reviews cannot silently clear a new image.
- **Honest OCR provenance:** manual text and default metadata cannot create an OCR-confidence claim. UI, server normalization and Word export use the same recorded-run semantics. Client-reported OCR history is not independent certification.
- **Officer-assisted placement:** the UI records declaration location on a selected panel and net-quantity clear-space measurements with uncertainty. It does not automatically identify the legal PDP. Curved, food and other specialist scopes remain manual review. The separate-USP equal-price exception is respected.
- **Stronger managed-data boundaries:** nested case validation, real image decoding and byte/dimension limits, attached-panel references, server-side reevaluation, bounded provider requests and pagination, and safer synchronization acknowledgement. New queued operations avoid duplicating stored image bytes. These are code-tested safeguards, not a substitute for cloud acceptance testing.
- **Real report export:** editable DOCX with separate automated findings/officer dispositions, original and corrected transcripts, conflicting fields, rule findings, captured-panel images where supported, hashes and trust-boundary notices. Unavailable, invalid, oversized or unsupported images are explicitly omitted; remote image URLs are not fetched by the document builder.
- **Honest benchmark metrics:** malformed manifests are rejected before entering the UI; missing labels yield `N/A`, not invented ground truth. Per-field normalized exact-match counts and eligible denominators are shown. False clearances and unsupported violation flags are counted separately.
- **Usable actions:** verdict actions were made sticky/reachable instead of being lost below the inspection content. This is not a claim that every device/viewport has been tested.

## Reproduce the checks

Run these commands from the project directory in PowerShell:

```powershell
Set-Location 'C:\Users\duvvu\Documents\ChatGPT\SIH 2026\niyamlens'
npm test
npm run build
npm run dev
```

Open the local URL printed by Vite in Chrome. Keep the existing failure case intact; use a new inspection for repeat tests.

| Check | Procedure and expected evidence |
| --- | --- |
| No-photo safety | Start a new inspection with no uploaded image. Attempt finalization, even if text is entered. It must remain blocked. |
| Real OCR, unedited | Upload the Amul file above. Click **Run browser OCR**; save the raw result. Then click **Deep scan small text** and compare quantity/MRP against the photograph. Do not type corrected text during this test. Report failures, not just a final status. |
| Manual versus OCR | In a new photographed inspection, enter visible text without running OCR. It must not acquire a completed OCR run or a numeric OCR-confidence claim. Manual transcription must remain distinguishable from recognition. |
| Changed-image safety | Run OCR and create field/measurement/placement confirmations. Change the captured evidence. The previous image-bound confirmations and OCR provenance must no longer authorize a clear result. Retake/review before sealing. |
| Conflicts | In a separate, explicitly manual test, use conflicting declarations such as `NET QTY 5 g` and `NET QTY 100 g`. The conflict must remain visible; it must not silently grant the small-package exemption. This is a parser test, not an OCR test. |
| Placement | Expand **Declaration placement & quantity clear space**. Select a captured panel, confirm an appropriate flat-package scope, and enter source notes/measurements. Missing, stale or out-of-scope observations must remain review. Never invent measurements to obtain a pass. |
| Persistence | Finalize a photographed inspection, reopen it from history, refresh and reopen again. Check its ID, raw transcript, working transcript and review state. This verifies this browser's local record, not another device or cloud storage. |
| Report | Open **Evidence**, export JSON and **Export Word (.docx)**. Inspect every panel and any omission notices, raw versus edited text, automated versus officer decisions, and provenance. Open the DOCX in Word and visually inspect page/table/image layout before sharing it. |
| Benchmark labels | In **Validation lab**, import JSON below. Verdict/value/presence accuracy and false-clear metrics must show unlabelled/`N/A`, not a manufactured pass. Then add genuine labels to a separate copy and verify the displayed denominators. |

Minimal deliberately unlabelled benchmark:

```json
[{ "id": "TEAM-UNLABELLED-01", "text": "NET QTY 100 g" }]
```

Focused checks, if isolating a failure:

```powershell
node --test tests/benchmark.test.mjs
node --test tests/report-document.test.mjs
node --test tests/inspection-workflow.test.mjs
node --test tests/security-boundaries-regression.test.mjs
```

Use these current tests and fresh browser evidence for acceptance. Historical audit scripts/reports may deliberately reproduce old bugs or assert old behaviour; do not present them as a current release pass without reviewing their assertions. Do not rerun historical media-generation scripts merely to make an old demo appear current.

## What the team must finish before stronger claims

1. **Recognition:** collect untouched raw OCR on varied real packages; prioritize exact MRP, quantity/unit and dates. Investigate image quality, preprocessing and recognition options against these failures. A manual correction must never be counted as OCR success.
2. **Independent field evaluation:** freeze a product-level holdout before tuning. Record per-field labels, illegible/missing panels, packaging conditions and adjudicated verdicts. Measure exact-value accuracy, unsafe clears, unsupported flags, abstention and latency with their denominators. A supplied-transcript benchmark does not execute OCR; the Open Food Facts pilot is not legal-compliance ground truth.
3. **Regulatory review:** have an authorised/domain-qualified reviewer assess amendment completeness, exceptions, PDP applicability and physical measurement methods. Resolve disagreements before treating verdict labels as ground truth. The [Kerala Legal Metrology department's published rules](https://lmd.kerala.gov.in/service-registration/) support review of declarations, unit sale price and placement, but a source link alone is not approval of this implementation.
4. **Live deployment acceptance:** test actual sign-in, officer/supervisor permissions, cross-workspace denial, private image upload/reopen, reconnect/retry, concurrent reviews and pagination on the intended hosted stack. Confirm GitHub push/backup and deployed commit separately; do not infer either from a local build.
5. **Shareable evidence:** finish Word visual/download acceptance and record an unedited screen walkthrough showing upload, scan, failures, review and persistence. Keep synthetic fixtures visibly separate from real packages.

The defensible pitch today is **evidence-aware inspection assistance that makes uncertainty and human review explicit**. A winning submission still needs convincing real-package results and domain validation; this handoff does not promise a competition outcome.
