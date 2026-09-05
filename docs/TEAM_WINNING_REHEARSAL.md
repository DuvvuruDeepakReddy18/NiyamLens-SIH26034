# NiyamLens team competition rehearsal

> **Purpose:** make the live presentation falsifiable, calm, and reproducible. This runbook does not predict a win and does not convert prototype evidence into field accuracy or regulatory approval.

- Product snapshot used to write this runbook: NiyamLens 0.4.4 / `LMPC-RC-2026.09-RC6`
- Prepared: 5 September 2026
- Engineering results: use the dated release report and exact candidate's output; no fixed historical test count is a current guarantee.
- Release warning: rerun every check on the exact candidate and separately verify the public deployment before quoting a result

## 1. The competition position

The strongest defensible claim is not “AI decides whether any package is legal.” It is:

> NiyamLens converts a complete physical-package capture into traceable candidate declarations, deterministic and versioned checks, explicit uncertainty, and an officer-reviewable evidence packet. When evidence or legal scope is unresolved, it abstains.

The judge should be able to choose an eligible unseen retail package. A useful outcome may be `PASS`, `FLAG`, `MANUAL REVIEW`, or `EXEMPT`; the team must never force a desired result. A correct review caused by unreadable evidence, Rule 3 uncertainty, food typography, or a specialist regime is stronger than a fabricated pass.

Current limitations to state without prompting:

- No independently labelled, adequately sized field corpus establishes general OCR or verdict accuracy.
- Historical 17-panel token-recall figures are development measurements, not field accuracy.
- OCR confidence and the app's reliability value are not calibrated probabilities of correctness.
- Rule 3 special-commodity cases and food Rule 7(4) treatment still require qualified adjudication.
- Physical measurement needs same-plane reference evidence and laboratory validation.
- A local hash chain detects mutation but is not an external timestamp or WORM ledger.
- The current working tree is not the public release until the exact deployed assets and rule-pack ID are verified.

## 2. Six-person role assignment

Assign a primary and a backup before rehearsal. No one should discover their screen during judging.

| Role | Primary responsibility | Must be able to answer | Backup |
|---|---|---|---|
| 1. Lead presenter | Problem, user, boundaries, transitions, closing | Why this is safer than an OCR wrapper | |
| 2. Live operator | Login, Blind Challenge, capture, OCR, finalization | Every button in the seven-minute path | |
| 3. Evidence / OCR lead | Raw vs working transcript, source boxes, quality and fallback | Why confidence is not accuracy; why corrections remain visible | |
| 4. Rules / domain lead | Rule 3, Rule 6, Rule 7, Rule 26, abstention | Why food typography or special scope may review | |
| 5. Measurement / security lead | Area, reference, uncertainty, hashes, report, sync boundary | Why barcode flattening is not physical scale; what audit proves | |
| 6. Red-team timekeeper | Clock, failure injection, Q&A log, backup device | Stop/go conditions and exact fallback | |

Use real managed officer and reviewer accounts only if they have been tested on the exact release. Do not share credentials, switch identities by pretending to be another user, or expose secrets during screen recording.

## 3. Pre-flight: 30 minutes before the slot

### Exact-release evidence

- [ ] Record Git commit and whether the worktree is clean.
- [ ] Record package version, rule pack, and rule-matrix IDs shown in the UI.
- [ ] Run `npm test` and save the full output; do not reuse a historical count.
- [ ] Run `npm run build` on the same candidate.
- [ ] Run the applicable local and hosted browser checks.
- [ ] Open the public URL in a fresh browser and verify it serves the intended revision.
- [ ] Confirm no API keys, tokens, emails, private package data, or browser notifications will appear.

### Equipment and evidence

- [ ] Laptop, charger, phone, power bank, hotspot, and offline-cached build
- [ ] Current Chrome/Edge and camera permission
- [ ] Two pre-tested, legitimate accounts if demonstrating officer/reviewer separation
- [ ] Flat reference marker whose dimension was independently measured; ruler or caliper
- [ ] Five or more sealed retail packages not used for development, controlled by a non-team chooser
- [ ] One curved/glossy package to rehearse abstention
- [ ] Printed or offline copies of the official problem statement and [domain review packet](DOMAIN_REVIEW_PACKET.md)
- [ ] Backup local build and a saved evidence report from the same release, clearly labelled as backup

### Stop/go check

Do not use the public deployment for the judged run unless login, upload, OCR route being demonstrated, sync, reopen, and export work in a fresh session. If the deployment fails this gate, say so and use the verified local-first path; do not improvise a fake cloud result.

## 4. Seven-minute live script

The presenter speaks while the operator acts. Practice until the narration never blocks the controls.

| Time | Operator action | Presenter line | Required evidence / fallback |
|---|---|---|---|
| 0:00–0:30 | Show the landing/current workspace and open **Blind challenge** | “Inspectors need a traceable triage record, not an AI accusation. Please choose any sealed retail pre-packaged commodity from this unseen pool.” | If the judge supplies a specialist product, accept it and explain that a review route is valid. |
| 0:30–1:15 | Start the challenge; capture declaration-bearing panels and assign their roles | “The judge chose the evidence. Controlled fixtures are disabled. We keep each physical panel and hash the original before processing.” | Show challenge code, captured-panel count, and original hash. If a panel is missing, record it rather than claiming completeness. |
| 1:15–1:50 | Show quality feedback; rotate or flatten one panel only if needed | “Preprocessing creates a derivative; the original remains unchanged. Weak capture becomes retake guidance.” | Compare original hash. If correction fails, keep original and continue with the limitation visible. |
| 1:50–2:45 | Run local OCR or the explicitly selected OCR route; open one grounded field | “OCR proposes evidence. The raw observation, working transcript, engine score, and source geometry stay distinguishable.” | Never type the expected answer before OCR. If OCR misses it, show the physical label and record an officer correction with reason. |
| 2:45–3:35 | Confirm package category, Rule 26 class, printed quantity/unit, Rule 3 consumer scope and commodity group; confirm Rule 3 only after checking | “Applicability is a legal fact gate. A buyer name alone cannot create an industrial or institutional exclusion.” | Unknown or conflicting scope must remain review. Outside Chapter II is not clearance under other laws. |
| 3:35–4:25 | Enter panel geometry and same-plane reference/glyph measurements, or deliberately leave unsupported measurement unconfirmed | “We propagate area and measurement uncertainty. Barcode geometry can flatten perspective but cannot create millimetres.” | If food, curved, near a tier boundary, or reference evidence is weak, point to `MANUAL REVIEW` rather than forcing typography. |
| 4:25–5:15 | Open structured evidence and two rule findings | “Every finding exposes the rule, reason, evidence, and uncertainty. The rules engine—not an LLM—produces the route.” | Trace one detected declaration and one missing/uncertain field to actual evidence. |
| 5:15–6:05 | Finalize; show saved/synced state and open the evidence report | “The packet preserves images, hashes, OCR provenance, confirmations, rule version, and the audit timeline.” | Say “local” or “server acknowledged” exactly as shown. Do not call a local hash chain immutable. |
| 6:05–6:35 | If pre-verified, open the real reviewer workflow and record a reasoned disposition; otherwise show the blank/pending review state | “Human review appends a separate disposition; it does not rewrite the automated observation.” | Never simulate a supervisor identity. If a second account is unavailable, state the limitation and show the workflow only. |
| 6:35–7:00 | Show the approval register and close on the unseen result | “The product is useful because it is falsifiable and knows when to abstain. The next evidence gate is an independently labelled field pilot and qualified legal/measurement review.” | State the actual unseen outcome without editing it. |

### Sixty-second fallback path

If the live route becomes unavailable:

1. State the failure and elapsed time.
2. Keep the current screenshot/error visible long enough for the judge to understand it.
3. Switch to the local cached app or the pre-generated same-release report.
4. Label the fallback artifact and explain what was live versus previously generated.
5. Continue with evidence tracing and abstention; do not claim the failed step passed.

## 5. Unseen-package protocol

This protocol makes the trial credible without pretending one package establishes accuracy.

### Selection

1. A non-team custodian numbers at least five sealed retail packages that the development team has not photographed, transcribed, tuned on, or added to fixtures.
2. Include different forms: flat carton/pouch, cylindrical bottle, glossy panel, small text, and a multilingual label where available.
3. The judge or custodian chooses the number after Blind Challenge starts.
4. The eligible pool is physical retail pre-packaged commodities. Loose goods are outside the intended workflow. Specialist products are allowed but may correctly produce review.

### Evidence preservation

- Record the package number, challenge code, timestamps, all original hashes, and panel roles.
- Preserve unedited raw OCR before any correction.
- Record every officer correction, crop, transformation, rerun, and reason.
- Do not patch code, change regexes, relabel the product, or add the image to a dataset during the trial.
- Preserve the final report even if the result is poor or the system fails.
- A later legal ground truth must be created independently using the [domain review packet](DOMAIN_REVIEW_PACKET.md); the team may not infer it from the app's result.

### Trial record

| Trial | Package custodian / ID | Unseen declaration | Capture panels complete? | OCR route and elapsed time | Officer corrections | Final route | Crash / fallback | Independent ground truth available? |
|---|---|---|---|---|---|---|---|---|
| 1 | | ☐ | | | | | | |
| 2 | | ☐ | | | | | | |
| 3 | | ☐ | | | | | | |
| 4 | | ☐ | | | | | | |
| 5 | | ☐ | | | | | | |

Without independent labels, summarize these only as workflow trials—completion rate, elapsed time, crashes, corrections, and abstentions—not accuracy.

## 6. Internal readiness gate

This is a team rehearsal gate, not an SIH judging formula or a probability of winning.

- [ ] Three consecutive seven-minute rehearsals finish without hidden setup or unreported fallback.
- [ ] Five unseen-package trials are retained, including failures.
- [ ] One trial demonstrates a genuine correction without rewriting raw OCR.
- [ ] One trial demonstrates a defensible `MANUAL REVIEW`.
- [ ] One rehearsal runs with network disconnected after offline assets are verified.
- [ ] Every presenter can explain Rule 3 purchaser context and the food Rule 7(4) pending issue.
- [ ] Measurement lead rejects a different-plane or unmeasured reference.
- [ ] Real reviewer workflow uses real accounts; otherwise it is described as pending.
- [ ] The exact deployed revision passes build, browser, sync, and export checks.
- [ ] No slide or spoken line converts a heuristic, synthetic fixture, or development pilot into accuracy.

A failed item becomes an owner-assigned rehearsal issue with a retest date; it is not verbally waived.

## 7. Red-team questions the team must survive

| Judge attack | Live proof | Honest answer boundary |
|---|---|---|
| “You tuned this to your sample.” | Judge-selected Blind Challenge and preserved raw output | One unseen trial is evidence of falsifiability, not generalization. |
| “Why should I trust 91%?” | Open score labels and raw transcript | It is an unvalidated heuristic from a controlled run, not accuracy. |
| “This 30 kg pack has no MRP—why no violation?” | Rule 3 scope finding | A confirmed ordinary retail package above 25 kg/litre is routed outside this Chapter II check set; that is not other-law clearance. |
| “It says factory buyer—so it is industrial.” | Unconfirmed purchaser-context controls | A name is insufficient; direct manufacturer purchase and statutory use facts must be verified. |
| “Your food font is too small.” | Food geometry retained with review status | Rule 7(4) cross-regime applicability is pending qualified, declaration-specific review. |
| “The barcode gives scale.” | Flattening geometry and reference controls | It gives perspective structure; magnification varies, so it does not establish millimetres. |
| “Your OCR missed the MRP.” | Raw OCR, physical image, correction audit | The officer can correct evidence transparently; raw accuracy remains a miss. |
| “This hash proves nobody tampered with it.” | Audit-chain wording | It detects inconsistency inside the record; it is not external timestamping or WORM storage. |
| “Show cross-device access.” | Real server-acknowledged case or explicit local status | Demonstrate only if the exact hosted revision and accounts passed acceptance. |
| “Will this win?” | N/A | No honest system can guarantee judging. We can demonstrate evidence, differentiation, and known gaps. |

## 8. Evidence log for each rehearsal

Record:

- exact URL, commit, worktree state, package version, rule pack, and matrix;
- test/build/browser command outputs and timestamps;
- account roles used, without credentials;
- chosen package ID and who controlled it;
- screen recording and unedited raw OCR artifact;
- original image hashes and evidence report hash;
- final status, elapsed time, corrections, abstentions, and failures;
- follow-up owner, due date, and retest result.

Do not publish real package/customer information or account identifiers without authorization.

## 9. Slide claims pending refresh

The existing PPTX was not regenerated in this documentation pass. Its source at `tools/build-official-sih-ppt.cjs` still contains claims that must be reviewed before submission:

| Existing slide/source claim | Why it is pending | Required treatment |
|---|---|---|
| “31 implemented capabilities” | No maintained, independently auditable denominator is tied to that number | Replace with a sourced feature map or remove the count. |
| “54/54 automated tests pass” (feasibility and evidence slides) | Stale historical count | Replace only after the final candidate reruns the full suite; include date/revision, or omit the number. |
| “Production build + browser QA pass” | Could refer to an earlier revision | Attach exact build and browser artifacts for the deployed candidate and date the statement. |
| Rules summary names Rule 6, Rule 7 and Rule 26 but not the Rule 3 gate | Does not reflect RC6 applicability semantics | Add Rule 3 and state that out-of-scope is not other-law clearance. |
| Rule 7 typography is presented without the food-package Rule 7(4) caveat | RC6 now abstains on food typography pending review | Add the food cross-regime limitation. |
| 61.1% / 67.5% token recall and 93.7% precomputed cloud baseline | Small historical development corpus; cloud figure is precomputed reference data, not live NiyamLens connected-OCR accuracy | Keep only with corpus, denominator, date, method, and “not field/verdict accuracy”; otherwise remove. |
| Speaker note says “ten-photo OCR pilot” | The cited material describes 17 declaration-panel photos across ten products | Correct the unit and denominator. |
| “Vercel-ready release candidate” | Readiness is weaker than exact deployed-revision acceptance | Replace with the actual verified deployment state and timestamp after final cutover. |

Until regenerated, the team must not present the old deck as evidence of the current RC6 build.

## 10. After-action review

Within fifteen minutes of every rehearsal, answer:

1. Where did the operator hesitate or navigate incorrectly?
2. Which spoken claim exceeded the evidence on screen?
3. Did the package capture cover every declaration-bearing panel?
4. Did any correction overwrite or obscure raw OCR?
5. Was Rule 3 confirmed from facts or guessed from the label?
6. Did measurement use a valid same-plane reference and state uncertainty?
7. Was the final status allowed to remain review/exempt when appropriate?
8. Did report, sync, reopen, and export describe their true state?
9. What single failure would a judge most likely reproduce next?
10. Who owns the fix, and what exact evidence will close it?
