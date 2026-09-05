# NiyamLens domain and legal review packet

> **Status: DRAFT FOR INDEPENDENT REVIEW — NO APPROVAL OR SIGNATURE IS RECORDED**

- Product snapshot: NiyamLens 0.4.4
- Rules engine: `LMPC-RC-2026.09-RC6`
- Applicability matrix: `LMPC-MATRIX-2026.09-RC5`
- Prepared: 5 September 2026
- Intended reviewer: Legal Metrology authority, qualified Legal Metrology counsel, and measurement-domain reviewer as applicable

This packet converts the prototype's unresolved domain questions into an auditable review worksheet. It is not legal advice, a statutory certificate, or evidence that the Department of Consumer Affairs has approved NiyamLens. A blank signature block must remain blank until a real, identified reviewer completes the review.

## 1. What the reviewer is being asked to decide

NiyamLens supports inspection of declarations visible on physical pre-packaged commodities. It preserves images and OCR observations, extracts candidate declarations, records officer confirmations, applies a versioned rules interpretation, and returns `PASS`, `FLAG`, `MANUAL REVIEW`, or `EXEMPT`.

The following issues remain deliberately unresolved:

1. Whether the package is within Chapter II after applying Rule 3, including quantity, commodity, package form, and purchaser context.
2. Whether a claimed industrial or institutional exclusion satisfies the statutory definition and direct-purchase context; a buyer name alone is not accepted.
3. How the cement, fertilizer, and agricultural-farm-produce wording should be applied between 25 kg and 50 kg, and to records whose package form is not verified as a bag.
4. For food packages, which Rule 7 typography provisions remain applicable declaration-by-declaration when the same information is also required under another law, considering Rule 7(4).
5. Whether the proposed evidence, calibration, uncertainty, and officer-confirmation workflow is adequate for a field pilot.

Until these questions are adjudicated, the engine routes uncertainty to `MANUAL REVIEW`. For compatibility with the existing status model, `EXEMPT` may also mean “outside the supported Chapter II retail checks under the recorded Rule 3 facts.” It never means compliance with every other provision or law.

## 2. Source packet

Review against the amendment-complete primary text in force on the inspection date, not a blog summary.

- [Department of Consumer Affairs consolidated Legal Metrology (Packaged Commodities) Rules, 2011 and amendments](https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/Book_on_Legal_Metrology_Packaged_Commodities_Rules%2C2011_with_all_amendments_whatsnews.pdf)
- [Department of Consumer Affairs Legal Metrology Acts and Rules index](https://consumeraffairs.gov.in/pages/legal-metrology-act)
- [Department of Consumer Affairs Packaged Commodities FAQ](https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/FAQs_on_Packaged_Commodities%2C_Rules_2011_whatsnews.pdf)
- [Department of Consumer Affairs G.S.R. 881(E), 2025 — pan masala change](https://consumeraffairs.gov.in/public/upload/files/2nd%20PCR%20Pan%20Masala_1764736734.pdf)
- Applicable food-labelling primary legislation and regulations identified by the independent reviewer: ______________________________
- Any State Legal Metrology circular or binding interpretation relied on: ______________________________

The engineering interpretation currently encoded is summarized in [LEGAL_REVIEW.md](LEGAL_REVIEW.md). The reviewer should record the exact rule, proviso, table, amendment, page, and effective date supporting each conclusion below.

## 3. Review integrity and independence

### Reviewer details

| Field | Reviewer entry |
|---|---|
| Full name | |
| Title / role | |
| Organisation | |
| Professional qualification / authority | |
| Jurisdiction and relevant experience | |
| Email / official contact | |
| Relationship to the team | |
| Conflict of interest disclosed? | ☐ No ☐ Yes — explain: |
| Review date and time zone | |
| Rules and amendments checked through | |

### Independence declarations

The reviewer should initial each completed statement.

- ____ I reviewed the cited primary text rather than relying only on the team's summary.
- ____ I was not asked to create a favourable result for a demo or competition.
- ____ I distinguished legal interpretation from software behavior and measurement validation.
- ____ I identified assumptions and unresolved issues instead of treating missing facts as confirmed.
- ____ I reviewed at least one package selected independently of the development team, if a case review is included.

## 4. Complete package-scope worksheet

Complete one copy for every adjudicated package. Do not infer unseen declarations from a front-only image.

### A. Case identity and provenance

| Field | Recorded value |
|---|---|
| NiyamLens case ID | |
| Challenge / pilot ID | |
| Product name exactly as printed | |
| Brand | |
| Manufacturer / packer / importer | |
| Barcode / GTIN, if present | |
| Lot / batch, if relevant | |
| Capture date, time, and time zone | |
| Captured by | |
| Physical package retained by | |
| Source was unseen by development team before trial? | ☐ Yes ☐ No ☐ Unknown |
| Any controlled fixture or prior development image used? | ☐ No ☐ Yes — identify: |

### B. Evidence-panel completeness

| Panel ID | Physical side / purpose | Original SHA-256 | Full side visible? | Readable? | Cropped/obscured areas | Reviewer initials |
|---|---|---|---|---|---|---|
| | | | ☐ Yes ☐ No | ☐ Yes ☐ No | | |
| | | | ☐ Yes ☐ No | ☐ Yes ☐ No | | |
| | | | ☐ Yes ☐ No | ☐ Yes ☐ No | | |
| | | | ☐ Yes ☐ No | ☐ Yes ☐ No | | |

Package surfaces and associated material checked:

- ☐ Front / principal presentation surface
- ☐ Back
- ☐ Left and right sides, seam, flap, top, and bottom where declarations may appear
- ☐ Sticker, overprint, sleeve, overwrap, or secondary label
- ☐ Outer and inner retail packages where a multipack is involved
- ☐ Insert or accompanying material, if legally relevant
- ☐ MRP / date panel
- ☐ Net-quantity panel
- ☐ Responsible-entity and consumer-care panel
- ☐ Country-of-origin panel for an imported package
- ☐ Every declaration-bearing surface was captured
- ☐ Missing or unreadable surface recorded as an evidence limitation

Completeness conclusion: ☐ Complete for the question reviewed ☐ Incomplete — `MANUAL REVIEW` required

Reason and missing evidence: ______________________________________________________________________

### C. Package and transaction facts

| Question | Recorded fact | Evidence / document ID | Reviewer conclusion |
|---|---|---|---|
| Is this a pre-packaged commodity offered or intended for retail sale? | | | |
| Printed net quantity and unit | | | |
| Normalized quantity in kg or litre, if applicable | | | |
| Package form: bag / bottle / carton / sachet / other | | | |
| Consumer scope: retail / industrial / institutional / unknown | | | |
| Purchased directly from manufacturer? | | | |
| Intended for use by the purchaser rather than retail resale? | | | |
| Purchase order, invoice, contract, or delivery evidence | | | |
| Commodity: ordinary / cement / fertilizer / agricultural farm produce / unresolved | | | |
| Category: general / food / imported / medical / other | | | |
| Rule 26-relevant class: standard / tobacco / pan masala / fast food / formulation / medical device / unresolved | | | |
| Other governing law or regulator | | | |

Important: an industrial or institutional name printed on the label is not, by itself, proof of the statutory purchase and use conditions.

## 5. Rule 3 adjudication worksheet

For each row, select exactly one result and give a primary-source pinpoint.

| ID | Question for qualified adjudication | Current RC6 behavior | Reviewer result | Primary-source pinpoint and reasoning |
|---|---|---|---|---|
| R3-01 | Is a confirmed ordinary retail package strictly above 25 kg or 25 litre outside Chapter II? How should an exact 25 boundary be treated? | `>25` outside; `≤25` in scope | ☐ Confirm ☐ Change ☐ Case-specific ☐ Unresolved | |
| R3-02 | For cement, fertilizer, or agricultural farm produce, does the special wording apply only when sold in bags, and is a confirmed package strictly above 50 kg outside Chapter II? | `>50 kg` outside only for confirmed mass record; non-mass record reviews | ☐ Confirm ☐ Change ☐ Case-specific ☐ Unresolved | |
| R3-03 | How should a confirmed special-commodity bag above 25 kg but not above 50 kg be routed? | `MANUAL REVIEW` pending interpretation and package-form confirmation | ☐ Confirm ☐ Change ☐ Case-specific ☐ Unresolved | |
| R3-04 | What evidence establishes an “industrial consumer,” including direct purchase from the manufacturer and use by that industry? | Requires explicit officer confirmation; buyer name alone is insufficient | ☐ Confirm ☐ Change ☐ Case-specific ☐ Unresolved | |
| R3-05 | What evidence establishes an “institutional consumer,” including direct purchase and use by the qualifying institution? | Requires explicit officer confirmation; buyer name alone is insufficient | ☐ Confirm ☐ Change ☐ Case-specific ☐ Unresolved | |
| R3-06 | What should happen when label text conflicts with the officer-selected commodity class? | `MANUAL REVIEW` | ☐ Confirm ☐ Change ☐ Case-specific ☐ Unresolved | |
| R3-07 | Is `EXEMPT` acceptable UI language for “outside the supported Chapter II check set,” or should a distinct result be used? | Uses `EXEMPT` with an explicit no-clearance warning | ☐ Confirm ☐ Change ☐ Case-specific ☐ Unresolved | |

### Rule 3 case conclusion

- Chapter II result: ☐ In scope ☐ Outside Chapter II ☐ Unresolved / manual review
- Facts relied on: _______________________________________________________________________________
- Exclusion or inclusion rationale: ________________________________________________________________
- Other laws/checks that remain applicable: ________________________________________________________
- Required software wording/change: _______________________________________________________________

## 6. Food-package Rule 7(4) adjudication

RC6 preserves the measured geometry but sets food-package Rule 7 typography findings to `MANUAL REVIEW`. It does not issue a food-typography pass or violation while the cross-regime question is pending.

Review declaration-by-declaration; do not assume one answer covers every item on a food package.

| Declaration / measurement | Required under LMPC provision | Also required under identified food law? | Effect of Rule 7(4) on Rule 7(1)–(3) | Reviewer result and source pinpoint |
|---|---|---|---|---|
| Common / generic name | | | | |
| Net quantity | | | | |
| MRP and inclusive-tax wording | | | | |
| Responsible entity | | | | |
| Consumer-care details | | | | |
| Date declaration | | | | |
| Country of origin | | | | |
| Unit sale price | | | | |
| Other: | | | | |

Questions requiring an explicit answer:

1. Does Rule 7(4) disapply Rule 7(1)–(3) only for the overlapping information, or for all declarations on the food package?
2. Which food-law provision and typography requirement applies to each overlapping declaration?
3. Which declarations remain governed by LMPC typography, if any?
4. Should NiyamLens keep a package-level food review, or evaluate a reviewer-approved per-declaration mapping?
5. What effective dates, transitional provisions, or commodity-specific exceptions must be represented?

Reviewer conclusion: ☐ Keep RC6 abstention ☐ Approve a per-declaration mapping ☐ Other: __________________

Required rule-matrix changes: ____________________________________________________________________

## 7. Measurement reference and label-geometry sheet

Complete this sheet with a measurement-domain reviewer. A perspective-correcting barcode does not establish absolute millimetres. A reference must be measured, visible, and on the same evidence plane as the sampled glyph unless a validated alternative procedure is approved.

### A. Principal display panel

| Field | Value |
|---|---|
| Evidence panel ID and original SHA-256 | |
| Package geometry: flat / cylindrical / other | |
| Surface is the legally relevant principal display panel? | ☐ Confirmed ☐ Unresolved |
| Width / circumference input (cm) | |
| Height input (cm) | |
| Cylinder diameter and coverage, if used | |
| Measuring instrument and asset ID | |
| Instrument resolution / calibration status | |
| Nominal calculated area (cm²) | |
| Stated area uncertainty (%) | |
| Lower–upper area interval (cm²) | |
| Table I boundary crossed by interval? | ☐ No ☐ Yes — review |
| Proposed Table I tier | |
| Reviewer-approved calculation or correction | |

### B. Physical reference and glyph sample

| Field | Value |
|---|---|
| Evidence panel ID | |
| Analysis derivative hash / transform description | |
| Reference object description and material | |
| Reference object's measured dimension (mm) | |
| Reference measurement instrument / asset ID | |
| Reference span in pixels | |
| Reference and glyph on the same physical plane? | ☐ Yes ☐ No / unresolved |
| Reference visibility and edge-selection method | |
| Sampled declaration and exact character / numeral | |
| Formed or moulded marking? | ☐ Yes ☐ No ☐ Unresolved |
| Glyph height in pixels | |
| Glyph width in pixels | |
| Nominal scale (mm/pixel) | |
| Nominal glyph height and width (mm) | |
| Stated measurement uncertainty (%) and basis | |
| Height lower–upper interval (mm) | |
| Width lower–upper interval (mm) | |
| Applicable minimum height / width rule | |
| Threshold crossed by interval? | ☐ No ☐ Yes — review |
| Reviewer conclusion | ☐ Supports finding ☐ Does not support finding ☐ More evidence required |

Repeat the reference-and-glyph sheet for every physically separate panel used for a typography finding. Do not reuse one panel's pixel scale on another panel.

### Measurement-method decision

- ☐ Suitable for controlled pilot only
- ☐ Suitable for field pilot subject to listed controls
- ☐ Not suitable; redesign required
- ☐ No measurement conclusion in this review

Required controls, error budget, and sample size: ___________________________________________________

## 8. Adjudicated test cases

At minimum, attach independently checked examples for:

- exactly 25 kg and immediately above 25 kg ordinary retail goods;
- a 30 kg ordinary retail package;
- cement, fertilizer, or agricultural farm produce at 25 kg, above 25 kg through 50 kg, and above 50 kg, with package form recorded;
- industrial and institutional scenarios with and without adequate direct-purchase/use evidence;
- a food package with measured typography and a declaration-by-declaration Rule 7(4) analysis;
- exactly 10 g/ml, immediately above 10 g/ml, tobacco, and pan masala Rule 26 cases;
- an uncertainty interval that crosses a Table I boundary;
- a classification conflict and an incomplete-panel capture.

| Case ID | Physical package / synthetic boundary | Expected legal route | Actual RC6 route | Agree? | Reviewer note |
|---|---|---|---|---|---|
| | | | | ☐ Yes ☐ No | |
| | | | | ☐ Yes ☐ No | |
| | | | | ☐ Yes ☐ No | |
| | | | | ☐ Yes ☐ No | |

Synthetic boundary cases validate code determinism; they do not replace real-package review.

## 9. Findings and change requests

| Finding ID | Severity | Rule / workflow | Evidence | Required change | Owner | Due date | Closure evidence |
|---|---|---|---|---|---|---|---|
| | ☐ Blocker ☐ Major ☐ Minor | | | | | | |
| | ☐ Blocker ☐ Major ☐ Minor | | | | | | |
| | ☐ Blocker ☐ Major ☐ Minor | | | | | | |

Overall disposition:

- ☐ Not reviewed
- ☐ Reviewed with unresolved blockers — keep all affected findings in `MANUAL REVIEW`
- ☐ Suitable for a controlled pilot with the conditions listed above
- ☐ Suitable for a field pilot after the listed changes are verified
- ☐ Other: ______________________________________________________________________________________

This disposition does not authorize enforcement deployment unless the reviewer has the authority to grant it and states that scope expressly.

## 10. Independent reviewer signature — intentionally blank

I confirm only the scope and conclusions explicitly recorded in this packet. I do not certify facts or systems I did not examine.

| Signature field | Entry |
|---|---|
| Reviewer name | |
| Signature | |
| Date and time zone | |
| Official seal / credential reference, if applicable | |
| Pages / attachments covered | |
| Limitations | |

Team acknowledgement of received findings (not a legal approval):

| Team representative | Signature | Date |
|---|---|---|
| | | |

## 11. Required attachments

- Completed package-scope worksheet and all panel images
- Original and derivative hashes
- Unedited raw OCR output, working transcript, and correction history
- Rule-pack and matrix identifiers shown by the reviewed build
- Rule-by-rule evidence report
- Purchase/use documents for any industrial or institutional exclusion
- Measurement photographs, instrument details, calculations, and uncertainty basis
- Primary-source excerpts/pinpoints within permitted use
- Test output from the exact reviewed revision
- Every change request and its closure evidence

