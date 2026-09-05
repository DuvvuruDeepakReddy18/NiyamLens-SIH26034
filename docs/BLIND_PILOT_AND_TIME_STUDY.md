# Blind recognition pilot and verified-inspection timing

Prepared 5 September 2026. **Protocol/tooling ready; independent human observations are not yet collected.** A script cannot certify who labelled a photo or whether they were genuinely independent.

## Recognition: collect a fresh declaration-focused set

The downloaded folder is `C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02/`. Six photos already have exploratory outputs; exclude those photographs **and their SKUs**. The other 24 were subsequently AI-reviewed: they are **AI-exposed, not an untouched holdout**. Only 5 of their 72 target slots were readable; 64 were not visible and 3 illegible. See [the frozen AI-reference report](AI_REVIEW_AND_OCR_FOLLOWUP_2026-09-05.md). Do not use that set to claim independent human accuracy or tune recognition. Follow [the fresh collection assignment](VALIDATION_NEXT_ACTIONS.md) instead; substitute its new source root in the example commands below.

1. Two different people inspect the original photographs separately, without OCR outputs, catalogue answers, or each other's answers. Use the verified `NiyamLens_Field_Review_Kit_2026-09-05-v2` portable reviewer kit described in [FIELD_REVIEW_KIT.md](FIELD_REVIEW_KIT.md). Record MRP, net quantity and manufactured/packed date exactly as visible. Mark `not_visible`, `illegible` or `ambiguous_field` rather than guessing. These labels do not establish legal absence on the whole package.
2. A third person adjudicates disagreements. Record their reason. The lead verifies source rights, acquisition date, language, package shape, conditions, collector identity and prior development exposure. Keep these human attestations blank until checked.
3. Where a public photo lacks complete panels or physical scale, keep that limitation. Use physical packages for the complete-inspection and measurement study; do not invent unseen sides or millimetres from a web image.
4. Pre-register the actual browser configurations with `npm run field:browser -- --modes`. Copy the exact objects into the draft manifest's `modes` array **before freeze**. Register only configurations the team intends to compare.
5. Use the existing `field:pilot` import/validate/freeze pipeline. Each photo needs two `groundTruth.reviews`, different `reviewerId`s, true `independentPhotoReview`, false `ocrOutputsConsulted`, all three field labels, and genuine review timestamps. The freeze command checks labels, original hashes, SKU exclusions and the recorded development inventory.

Example commands from the repository (replace capitalized paths and IDs):

```powershell
npm run field:pilot -- init --dataset-id TEAM-PILOT-v1 --owner ACTUAL-LEAD-ID --output DRAFT.json
npm run field:pilot -- import --manifest DRAFT.json --input CHECKED-INTAKE.json --photo-root "C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02" --output IMPORTED.json
# Humans complete metadata, pre-register modes and supply both reviews in LABELLED.json.
npm run field:pilot -- validate --manifest LABELLED.json --photo-root "C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02"
npm run field:pilot -- freeze --manifest LABELLED.json --by ACTUAL-LEAD-ID --photo-root "C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02" --output FROZEN.json
```

Outputs are create-only. Do not change the sealed manifest to fit later OCR errors. A corrected reference requires a documented new version and an appropriate disclosure of exposure.

## Run the shipped browser workflow

Build an isolated **local-only** candidate (never point the runner at production accounts), then serve it on a safe localhost port:

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4191 --strictPort
# In a second terminal:
npm run field:browser -- --run --manifest FROZEN.json --photo-root "C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02" --mode browser-standard --base-url http://127.0.0.1:4191/ --output RAW-STANDARD.json
npm run field:pilot -- score --manifest FROZEN.json --input RAW-STANDARD.json --photo-root "C:/Users/duvvu/Desktop/SIH/NiyamLens-Field-Pilot-2026-09-04-02" --output SCORE-STANDARD.json
```

Repeat only the other pre-registered modes (`browser-deep`, `browser-paddle`) with new output filenames. The browser runner blocks non-local network requests and uses fresh contexts. It uploads the actual local files through the UI, clicks actual recognition controls, retains every failure and unchanged transcript, binds source hashes, and checkpoints each observation. It records a served-bundle fingerprint when available. Quality warnings are deliberately continued by the runner as an evaluation policy, not represented as human field-quality approvals.

Paddle scoring uses its **raw preview**, with no reviewed layout proposals. Tesseract scoring uses the unchanged default merged transcript. Manual crop/rotation, selecting an alternative pass, and officer corrections are different assisted workflows, not interchangeable raw-accuracy results. No photo is silently dropped because a mode failed. An incomplete corpus run must retain missing denominators and cannot claim full-corpus accuracy.

## Paired complete-inspection timing

Use `datasets/workflow-study.template.json` as the data format. Its empty `trials` array is intentional. Copy `trialTemplate` for each real attempt; replace nulls only with actual observations. Anonymous IDs are sufficient; do not put passwords, account tokens or personal contact details in the study.

- Give a new user the same defined task in both methods: inspect all relevant declarations, apply the agreed supported rules, record uncertainty/measurement, and produce a reviewable report.
- Compare the manual checklist/report method with NiyamLens, not manual inspection with OCR execution time alone.
- Counterbalance which method comes first across participants/packages. Record the actual order; learning effects are not magically removed by using the same package twice.
- An observer times capture, reading/transcription, verification/corrections, measurement and export. `totalSeconds` includes interruptions and navigation; unexplained time outside stages stays in the total.
- Retain `failed` and `abandoned` attempts with reasons. Never choose the fastest retry and discard earlier failures.
- Record the count of corrections. Do not treat a faster but wrong report as an efficiency improvement.
- A different reviewer compares each completed report with the physical package and records `qualityReview.reportCorrect`, the physical check and their reasoning. This is self-attested independent review, not departmental certification.

```powershell
npm run field:time-score -- OBSERVED-TRIALS.json NEW-TIME-SCORE.json
```

The scorer refuses malformed durations, self-review and duplicate IDs. Repeated attempts for the same participant/package are retained but excluded from a paired time-saving calculation; failed or unreviewed reports cannot manufacture success. It reports negative time savings as well as positive ones. No valid independently reviewed pair means `medianVerifiedSecondsSaved: null`.

## Human and hosted release gates

Use `DOMAIN_REVIEW_PACKET.md` for qualified legal/measurement adjudication, `TEAM_PILOT_ACCEPTANCE.md` for real approved officer/supervisor/control-organization checks, and `TEAM_WINNING_REHEARSAL.md` for the live drill. [Hosted synthetic acceptance](HOSTED_SYNTHETIC_ACCEPTANCE.md) records four separately authenticated synthetic roles; those tests are infrastructure evidence, not real participant observations. The original synthetic memberships were disabled after testing. Do not reuse one administrator as four people or extract credentials from a browser profile.

Before any public presentation, publish denominators and boundaries together: exact field correctness, corrections, failed/unreadable fields, complete-package verdict adjudication, report preparation time, device/network conditions and supported legal scope. This protocol does not promise an SIH outcome.
