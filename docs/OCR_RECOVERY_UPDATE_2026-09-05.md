# OCR recovery update — measured improvement, not a win guarantee

**Live:** [NiyamLens](https://niyamlens-sih26034.vercel.app/), published 5 September 2026 at approximately 13:31 UTC. Source commit `6c9d185616ac91ad7e241f9bee381d90e62818f0` is pushed; [CI passed](https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33968920163). Deployment `dpl_HGyqHTseiK6KuT2QwPXuc6iBZoYy` is READY (Vite, existing RC6/0.4.4 line; reported deployment command duration 37 seconds). Subsequent release-note/probe commits do not change this deployed application source.

## What changed

- Compact prices such as `MRP48` now parse without inserting or changing characters. Embedded words, damaged digits and invalid amounts remain rejected.
- The printed litre symbol `ℓ` is accepted as a unit spelling. `I`, `1` and missing units are not repaired into litres.
- A standalone role continuation such as `MFD &` no longer becomes a bogus conflicting date. Empty headings and damaged dates still remain unresolved.
- Heading-guided close-ups include bounded adjacent pixels when the detector missed the value. Sloping rows use baseline geometry.
- Larger stacked net-quantity numerals can become source-mapped review suggestions. Competing values, intervening text, invalid units and source conflicts still block acceptance; price/date geometry was not relaxed.
- Optional dark-stamp recovery uses a deterministic maximum-RGB monochrome image, with an optional 90-degree clockwise rotation. It works on whole panels or a selected region. The exact input is visible; the original, raw readings and mapped overlays remain preserved.

## What the built app actually recovered

Eight known development photos, ten AI-provisional readable references. All three configurations ran on all eight photos through Chrome upload, model execution, preview, optional layout-checkbox selection, append and draft persistence. No typed correction or field confirmation was made.

| Configuration | Direct extraction from raw OCR | With all available layout suggestions selected by test automation |
|---|---:|---:|
| Previous original-colour baseline | 1/10 | 5/10 |
| Updated original-colour Paddle | 1/10 | 6/10 |
| Optional upright dark stamp | 2/10 | 5/10 |
| Optional dark stamp, 90° clockwise | 2/10 | 2/10 |

These alternatives cannot be added into an “8/10 accuracy” claim. Dark treatment recovered the compact price on CF-002; rotation recovered the packed date on CF-005. It also lost other readings. Keep original-colour Paddle as the general option; choose stamp recovery only when the image warrants it.

Zero wrong-valid candidates were observed among the ten eligible reference slots in each configuration. That is not a calibrated safety claim. Upright dark treatment produced one valid quantity on a reference marked illegible/excluded; it is not counted as a success or a correct negative. Four eligible fields remain unresolved in the original-colour path. Cropped headings, multi-column MRP/USP layout and damaged pixels still require recapture or explicit review.

## How your team can use it

1. Upload the original photograph; address image-quality warnings honestly.
2. Open **More OCR options → Try Paddle OCR · local**. Compare the highlighted original fragments before accepting any layout suggestion.
3. If a dark stamped price/date overlaps coloured print, open **Recover an overprinted or sideways dark stamp**. Choose its direction. Prefer selecting a complete declaration region over rescanning unrelated text.
4. Inspect the exact processed image and raw reading. Dismiss a bad result. Appending preserves earlier readings; conflicts are not silently resolved.
5. Confirm fields only after checking the real label. A missing/cropped declaration requires a new photo, not an inferred value.

## Verification and release gates

- Complete bounded-concurrency local suite: **617/617 passed**; production build passed.
- Whole-image Chrome acceptance: **24/24 passed**. Source hashes, actual-input pixels, raw history and unconfirmed review state were checked.
- Guided close-up, manual two-corner crop, rotated crop, mobile overflow and saved coordinate-frame checks passed.
- Existing desktop/mobile UI and functional evidence/history/export regressions passed.
- The first unrestricted-parallel unit run failed one test-file process; isolated and full bounded reruns passed. Two new UI-harness selector mistakes were corrected; failed reports were retained. None are hidden as successful runs.

Source-bound results: [evidence summary](../reports/ocr-recovery-2026-09-05/evidence.json). Old RC6 reports/PDF retain their historical results. Local tests do not imply signed-in hosted acceptance.

## Publication checks

The staged health check passed before promotion. Two anonymous post-promotion snapshots one minute apart each verified the homepage, expected application bundle, backend health and HTTP 401 for case access. The new bundle is `/assets/index-gwkgHLXn.js`, SHA-256 `39d8e5a911adc139f383cb1f5d3b908446a95c4758a84b9d9356d34d8a0797ea`. Source-bound public probe receipts are retained alongside the evidence summary.

One deployment-scoped error-log query returned no matching logs. This is an immediate rollout check, not 15 minutes of observation, sustained monitoring, a drains audit, a load test or a fresh signed-in multi-account test. No database, storage, identity or membership changes were made.

## Still required for a credible competition claim

Fresh independently labelled photographs, physical-package workflow timing, and qualified legal/measurement adjudication are not software outputs. They remain incomplete; AI cannot supply independent human participation or professional approval. The [existing validation plan](VALIDATION_NEXT_ACTIONS.md) is ready for those participants. This update improves recovery but does not make arbitrary real-label recognition reliable or guarantee an SIH win.

## Release safety

No database schema, account, membership, storage or external OCR provider changes. Existing RC6 is the rollback target for this frontend/parser update. Do not delete queued inspections during rollback; retain raw observations, and re-check any candidate extraction changed by the parser. Publication must wait for CI and local browser acceptance. Post-publication checks cover the public page, bundle, health endpoint and anonymous access denial; they do not substitute for signed-in hosted OCR testing.
