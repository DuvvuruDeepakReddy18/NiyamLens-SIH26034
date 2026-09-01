# Legal review register

This document is an engineering compliance aid, not legal advice. It records what the prototype encodes and what still requires review by the Department of Consumer Affairs, a Legal Metrology authority or qualified counsel.

## Sources used

- [Department of Consumer Affairs, consolidated Legal Metrology (Packaged Commodities) Rules, 2011 and amendments](https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/Book_on_Legal_Metrology_Packaged_Commodities_Rules%2C2011_with_all_amendments_whatsnews.pdf).
- [Department of Consumer Affairs, current Legal Metrology Acts and Rules index](https://consumeraffairs.gov.in/pages/legal-metrology-act), including the separately published 2025 and 2026 amendments.
- [Department of Consumer Affairs, Legal Metrology overview](https://consumeraffairs.gov.in/pages/legal-metrology-overview).
- [Department of Consumer Affairs, Packaged Commodities FAQ](https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/FAQs_on_Packaged_Commodities%2C_Rules_2011_whatsnews.pdf).
- Press Information Bureau summary of the Legal Metrology (Packaged Commodities) Second (Amendment) Rules, 2025 for pan masala.

The in-app Rules Library links the source URLs and exposes the active rule-pack ID.

## Encoded profiles

| Profile | Prototype behaviour | Approval state |
|---|---|---|
| Rule 6 declaration signals | Detects and evaluates configured mandatory fields by selected package profile | Source encoded; applicability review pending |
| Rule 7 / Table I | Selects normal or formed/moulded minimum height from panel-area tier | Source encoded; measurement validation pending |
| Area boundary | Uses supplied percentage uncertainty and abstains when the interval crosses a tier | Engineering trust policy |
| Text measurement | Uses calibrated pixel/reference ratio and lower/upper uncertainty bounds | Lab validation pending |
| Rule 26(a), ≤10 g/ml | Applies the small-package exemption when profile permits | Source encoded; profile review pending |
| Tobacco | Does not apply the Rule 26(a) small-package exemption because the proviso says clause (a) is not applicable to tobacco/tobacco products | Source encoded; counsel confirmation pending |
| Pan masala | 2025 carve-out disables small-package exemption and evaluates declarations | Source encoded; amendment-text confirmation pending |
| Food packages | Keeps the encoded general Legal Metrology declarations and typography checks in scope; does not claim FSSAI compliance | Source encoded; cross-regime applicability review pending |
| Consumer-care address | Passes only on address-like evidence near the complaint-contact block; ambiguous cases become REVIEW | Engineering trust policy; officer confirmation required |
| Restaurant/hotel fast food | Officer-selected exemption profile | Classification policy pending |
| Scheduled/non-scheduled formulations | Officer-selected exemption; specialist review marker | Specialist sign-off pending |
| Medical devices declared as drugs | No automatic formulation/small-package exemption; manual specialist review | Specialist sign-off pending |

## Deliberate correction to earlier working assumptions

The historic proviso requiring MRP and net quantity on packages from 10–20 g/ml was omitted by G.S.R. 784(E) in 2011. It is therefore not encoded as a current rule. The later Rule 26(a) proviso states that clause (a) is not applicable to tobacco and tobacco products, so the prototype does not grant those products the ≤10 g/10 ml exemption. The separate 2025 change targets pan masala. These interpretations must still be confirmed against the amendment-complete text before enforcement deployment.

## Approval gates

1. Legal Metrology authority approves applicability, exceptions and amendment dates.
2. Measurement laboratory validates reference-card and device-depth procedures.
3. Pilot owner approves the labelled ground-truth protocol and sample composition.
4. Security owner approves identity, encryption, retention and immutable storage.

The app intentionally shows all four as pending. No mock signature, approval badge or invented accuracy claim is included.
