export const RULE_MATRIX_VERSION = 'LMPC-MATRIX-2026.09-RC5'

export const RULE_MATRIX = [
  { id: 'R6-GENERIC', authority: 'Rule 6', title: 'Common / generic name', scope: 'General retail packages', automation: 'OCR region + officer correction', approval: 'source-encoded', source: 'DCA consolidated rules' },
  { id: 'R6-MRP', authority: 'Rule 6', title: 'Maximum retail price', scope: 'Applicable retail packages', automation: 'OCR amount + tax wording', approval: 'source-encoded', source: 'DCA FAQ Q27' },
  { id: 'R6-NET', authority: 'Rule 6', title: 'Net quantity', scope: 'Weight, measure or number', automation: 'OCR value + normalized unit', approval: 'source-encoded', source: 'DCA FAQ Q27' },
  { id: 'R6-ENTITY', authority: 'Rule 6', title: 'Responsible entity', scope: 'Manufacturer / packer / importer', automation: 'OCR region; address remains reviewable', approval: 'source-encoded', source: 'DCA FAQ Q27' },
  { id: 'R6-CARE', authority: 'Rule 6(2)', title: 'Consumer-care details', scope: 'Applicable retail packages', automation: 'Complaint office name + address + telephone + email detection', approval: 'source-encoded', source: 'DCA consolidated rules / FAQ Q27–28' },
  { id: 'R6-ORIGIN', authority: 'Rule 6', title: 'Country of origin', scope: 'Imported packages', automation: 'Profile-gated OCR region', approval: 'source-encoded', source: 'DCA FAQ Q27' },
  { id: 'R6-UNIT', authority: 'Rule 6(11)', title: 'Unit sale price', scope: 'Applicable pre-packaged commodities', automation: 'OCR value / reference unit', approval: 'source-encoded', source: 'G.S.R. 226(E), 2022' },
  { id: 'R7-HEIGHT', authority: 'Rule 7 / Table I', title: 'Minimum declaration height', scope: 'Principal display panel tier', automation: 'Calibrated region measurement + uncertainty', approval: 'source-encoded', source: 'DCA consolidated rules' },
  { id: 'R7-WIDTH', authority: 'Rule 7', title: 'Letter / numeral width', scope: 'Measured character excluding stated narrow glyphs', automation: 'Calibrated sample + manual exception confirmation', approval: 'source-encoded', source: 'DCA consolidated rules' },
  { id: 'R8-PLACEMENT', authority: 'Rule 8', title: 'Declaration placement', scope: 'Officer-confirmed general flat-package PDP; specialist scopes deferred', automation: 'Value-bound officer observations linked to a captured panel; not automated placement detection', approval: 'requires-specialist-review', source: 'Kerala Legal Metrology Department rule reproduction' },
  { id: 'R8-SPACE', authority: 'Rule 8(1)', title: 'Net-quantity clear space', scope: 'Same-plane numeral and nearest-print gap measurements', automation: 'Officer-supplied pixel ratios with explicit uncertainty; no claim of automatic measurement', approval: 'requires-specialist-review', source: 'Kerala Legal Metrology Department rule reproduction' },
  { id: 'R26-SMALL', authority: 'Rule 26(a)', title: 'Package up to 10 g / 10 ml', scope: 'Weight / measure packages, subject to current carve-outs', automation: 'Quantity boundary + commodity class', approval: 'source-encoded', source: 'DCA consolidated rules' },
  { id: 'R26-TOBACCO', authority: 'Rule 26(a) proviso', title: 'Tobacco carve-out', scope: 'Tobacco and tobacco products', automation: 'Small-package exemption is not applied', approval: 'source-encoded', source: 'DCA consolidated rules' },
  { id: 'R26-PAN-MASALA', authority: 'G.S.R. 881(E), 2025', title: 'Pan masala carve-out', scope: 'Pan masala packages of every size / weight', automation: 'Explicit commodity classification required', approval: 'source-encoded', source: 'PIB / 2025 amendment' },
  { id: 'R26-FASTFOOD', authority: 'Rule 26(b)', title: 'Restaurant / hotel fast-food packages', scope: 'Selected exemption profile', automation: 'Officer classification; never OCR-only', approval: 'source-encoded', source: 'DCA consolidated rules' },
  { id: 'R26-DRUG', authority: 'Rule 26(c)', title: 'Specified drug formulations', scope: 'Scheduled / non-scheduled formulations in referenced order', automation: 'Specialist classification required', approval: 'requires-specialist-review', source: 'DCA consolidated rules' },
  { id: 'R2-R7-MEDICAL', authority: 'G.S.R. 778(E), 2025', title: 'Medical-device declaration and typography profile', scope: 'Packages containing medical devices', automation: 'Defer declaration, height and width checks to Medical Devices Rules, 2017; mandatory specialist review', approval: 'requires-specialist-review', source: 'DCA 2025 amendment' },
  { id: 'R6-10A-ECOM', authority: 'G.S.R. 312(E), 2026', title: 'Imported-product country-of-origin filter', scope: 'E-commerce product listings; effective 1 July 2027', automation: 'Tracked as an integration requirement; excluded from physical-package verdicts', approval: 'source-encoded', source: 'DCA Second Amendment Rules, 2026' },
  { id: 'R4-AEO-IMPORT', authority: 'G.S.R. 418(E), 2026', title: 'AEO bonded-warehouse declarations', scope: 'AEO Tier-2 / Tier-3 imported packages', automation: 'Workflow context only; retail packages must carry required declarations before leaving the bonded warehouse', approval: 'source-encoded', source: 'e-Gazette Third Amendment Rules, 2026' },
]

export const APPROVAL_GATES = [
  { id: 'LEGAL-SIGNOFF', owner: 'Department of Consumer Affairs / qualified LM counsel', status: 'pending', requirement: 'Approve amendment-complete applicability and exemption matrix.' },
  { id: 'MEASUREMENT-VALIDATION', owner: 'Legal Metrology laboratory', status: 'pending', requirement: 'Validate phone/reference-card measurement error and calibration process.' },
  { id: 'FIELD-DATASET', owner: 'Inspector pilot lead', status: 'pending', requirement: 'Label real packages and approve ground-truth protocol.' },
  { id: 'SECURITY-REVIEW', owner: 'Department security team', status: 'pending', requirement: 'Approve identity, retention, encryption and server deployment controls.' },
]

export const RULE_EDGE_CASES = [
  { id: 'EC-001', title: 'Exactly 10 g, standard commodity', text: 'NET QTY 10 g', meta: { quantity: 10, unit: 'g', commodityClass: 'standard', ocrConfidence: 95 }, expectedStatus: 'exempt' },
  { id: 'EC-002', title: '10.1 g, standard commodity', text: 'NET QTY 10.1 g', meta: { quantity: 10.1, unit: 'g', commodityClass: 'standard', ocrConfidence: 95 }, expectedStatus: 'non_compliant' },
  { id: 'EC-003', title: '8 g tobacco package', text: 'TOBACCO PRODUCT\nNET QTY 8 g', meta: { quantity: 8, unit: 'g', commodityClass: 'tobacco', ocrConfidence: 95 }, expectedStatus: 'non_compliant' },
  { id: 'EC-004', title: '8 ml standard package', text: 'NET QTY 8 ml', meta: { quantity: 8, unit: 'ml', commodityClass: 'standard', ocrConfidence: 95 }, expectedStatus: 'exempt' },
  { id: 'EC-005', title: 'Low confidence missing declarations', text: 'MRP 20', meta: { quantity: 100, unit: 'g', commodityClass: 'standard', ocrConfidence: 42 }, expectedStatus: 'manual_review' },
  { id: 'EC-006', title: 'Panel uncertainty crosses 100 cm²', text: '', meta: { pdpArea: 99, pdpUncertainty: 5, ocrConfidence: 20 }, expectedStatus: 'manual_review' },
  { id: 'EC-007', title: '8 g pan masala package', text: 'PAN MASALA\nNET QTY 8 g', meta: { quantity: 8, unit: 'g', commodityClass: 'pan_masala', ocrConfidence: 95 }, expectedStatus: 'non_compliant' },
]
