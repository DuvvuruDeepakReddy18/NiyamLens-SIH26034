# Chrome acceptance — 4 September 2026

Local origin: http://127.0.0.1:5180/. Rule pack RC5, version 0.4.0 working changes. This is not the hosted deployment. Browser was controlled through visible UI; no injected OCR transcript was used for the real-photo test.

| Test | Observed outcome |
| --- | --- |
| Real upload | Amul photo `datasets/openfoodfacts-india/real-labels/8901262260121/6.jpg` uploaded through Chrome's file chooser. Original SHA-256 `9d2187d0603d8781814e24320b452d596dc826a50ba29f0a7643f6d43b0c619b`. |
| Standard OCR | Completed; two declaration-heading signals, but no valid structured quantity/MRP. Displayed reliability heuristic 58%, engine 57%; these are not accuracy scores. |
| Deep OCR | Completed; three declaration-heading signals, but still no valid quantity/MRP. Raw text included `500 mr` and `MEP ; 2 22.00`, not reliably parsed 500 mL / Rs22. No manual corrections. |
| Safe disposition | Deep result: MANUAL REVIEW, 19 review checks, zero passes, zero flags. This is a successful abstention and a recognition failure, not an OCR success. |
| Finalize reachability | Discovered sticky panel placed its actions outside the available viewport. Updated constrained flex layout and independently scrollable findings; button then worked. Screenshot inspection confirmed actions visible. |
| Local seal / persistence | Sealed `NLM-20260904-b881226f-91b2-49f1-a8ef-3e84fdbed54a`; history increased from one pre-existing audit fixture to two records. Reopened after a dev refresh. Working text and raw OCR remained identical; five audit events retained. |
| Word generation | First lazy import exposed a Vite dependency-optimization reload. Added explicit docx prebundling. Report generated at 1,493 KB with a visible save link. Download-event observation timed out; actual file save and Word visual rendering NOT accepted yet. |
| Text-only adversarial input | `NET QTY 5 g` plus `NET QTY 100 g`, negative MRP and invalid month prefix remained MANUAL REVIEW. Quantity candidates visibly conflicted; invalid confirmation options disabled. No OCR score and Finalize disabled without a photograph. |
| Placement controls | Synthetic test packet only: panel selection, flat-package scope and officer-confirmation controls available. No claim these observations came from a real inspected package. |
| Clear-space calculation | Synthetic supplied height10px, gaps20/20/30/30px and5% uncertainty yielded the clear-space check PASS. Changing upper gap to1px reset confirmation and yielded REVIEW; explicit reconfirmation yielded FLAG. Other missing evidence kept overall review. |

## Boundaries

- The controlled packet's prefilled text was never presented as live OCR. Its spacing values are deliberately synthetic UI inputs, not ground truth or a physical measurement.
- No statutory, laboratory or field-accuracy validation is implied by this run.
- No Supabase sign-in/upload, hosted load test, Google Vision request, Git push or production deployment occurred in this acceptance run.
- DOCX unit tests validate generated content/structure, not the appearance of every Word page.
- Historical stress reports remain unchanged. They demonstrate the old bugs and are not current pass reports.
