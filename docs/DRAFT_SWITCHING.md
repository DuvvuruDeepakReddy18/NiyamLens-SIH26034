# Switching between package inspections

Use **Save draft & new inspection** near the top of the inspection page when moving to a different product. The button waits for local storage to commit before opening a clean capture screen. Then use **Capture / upload package** for the next image.

- The previous package appears in **Saved drafts**, with its photograph, filename and save time.
- **Resume draft** reopens that package. If another package is open, it is saved separately first.
- Drafts retain original/analysis photos, working text, raw OCR, panel roles, review notes, measurement inputs and the audit chain. Restored evidence is evaluated under the current evidence policy, not treated as a new OCR run or legal approval.
- Drafts are stored in this browser profile, on this device, within the current workspace. They are not uploaded to cloud backup. Clearing site data or using another device/browser will not recover them. Finalize and synchronize important completed records through the existing managed workflow.
- To add another side of the **same package**, use **Add package panel** instead. Do not combine different products into one inspection.
- The new-inspection/resume actions are locked during image processing, OCR, saving and unresolved OCR previews. Append or dismiss the preview explicitly. Blind challenges do not allow switching to unrelated evidence.
- If saving fails, the current inspection stays open and an error explains that it was not cleared. Retry after addressing the storage problem.
- Finalizing removes only that inspection's draft; other saved drafts remain available. Sealed cases remain in **Inspection history**.

## Validation

`tests/inspection-drafts.test.mjs` checks transaction rollback, latest edits before autosave, multiple drafts, legacy recovery, workspace separation, queued autosave ordering, repeated clicks, stale-tab protection, challenge restrictions and sealed-case protection.

`tools/qa-inspection-drafts.mjs` uses an isolated local system-Chrome profile. It runs actual Paddle OCR on the Amul photo, saves a review note, switches to the Kinley photo, then restores Amul and compares the preserved image bytes, raw/working text and audit history. Kinley's text in this test is explicitly a manual persistence fixture, not an OCR result. The check also covers reload, pending preview locks, sealing, an injected storage-quota error, retry and desktop/mobile layout.

Run against a local app, without opening personal browser profiles:

```powershell
node --test tests/inspection-drafts.test.mjs
node tools/qa-inspection-drafts.mjs
```

The browser check defaults to localhost port 4201; `NIYAMLENS_BASE_URL` can select another local build. Its generated evidence is in `reports/draft-switch-2026-09-10`. Tests do not establish general OCR accuracy or hosted cloud acceptance.
