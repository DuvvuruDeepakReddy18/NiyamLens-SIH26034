# Report save reliability fix

## What was wrong

The JSON report path clicked a detached anchor and immediately revoked its Blob URL. That provided no reliable time for the browser to consume the URL and no completion signal. The Word path generated a native DOCX correctly but only offered an ordinary download link. A link click cannot establish that a file was saved, and the previous live verification did not locate a downloaded file.

## Changes

- `ReportDownloads.jsx` provides a common prepare/save workflow for native DOCX and complete evidence JSON. Generating a report does not alter the sealed record or its original images/transcripts.
- `reportExport.mjs` owns a single-flight, generation-guarded lifecycle. Closing the report or switching records prevents stale document generation, file-picker results or verification results from publishing into the next report.
- **Save as** invokes `showSaveFilePicker` immediately during the click, writes the already-generated Blob, closes the writable stream, reads the selected file back, and compares every byte. Only a matching read-back produces a saved-copy verification message.
- **Download with browser** retains a visible, retryable Blob URL. Clicking it is explicitly labelled *download requested, completion not verified*.
- **Verify saved copy** allows the user to choose a downloaded file and compare its complete bytes with the generated Blob, including detecting same-length corruption. This also supports browsers without the file-system save picker.
- Cancelling the save picker starts no fallback download. Permission errors, write failures, unavailable read-back and mismatches retain the prepared report for retry and display distinct messages. Interrupted writable streams are aborted before close where possible.
- URLs remain valid while the prepared report is displayed; replacement/unmount revokes them after a 60-second browser-consumption grace period. Generated reports are bounded to 128 MiB.

The explicit picker gesture follows [Chrome's File System Access guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access). The persistent URL lifetime addresses [object-URL release semantics](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static).

## Automated verification

Command: `node --test tests/report-export.test.mjs tests/report-export-integration.test.mjs tests/report-document.test.mjs`

Result during implementation: **30/30 tests passed** (16 new export lifecycle tests, 3 App/component source-integration contracts, and 11 existing native DOCX content/integrity tests).

The new tests cover synchronous picker invocation, exact-byte preservation, successful write/close/read-back, cancel, unsupported API, denied access, write failure and abort, read-back failure, same-length corruption, verifying an actual selected-copy Blob, stale generation success/failure, closing while a picker is open, switching records during a write, stale verification, repeated clicks, delayed URL cleanup, size limits and safe filenames.

## Live Chrome acceptance procedure

1. Open a sealed, hydrated case and choose **Export JSON**. Confirm a prepared `.json` filename and size appear, without a claim that it has been saved.
2. Select **Save as**, choose a test filename, and save. The app should report that the saved copy was read back and matched. Open the JSON independently and verify case ID, raw transcript, evidence hashes and original image fields.
3. Repeat for **Export Word (.docx)**. Open it in Word/LibreOffice and inspect evidence images, raw versus reviewed text, findings and audit caveats.
4. Open Save as again and cancel. Confirm the report stays retryable and no fallback download starts.
5. Use **Download with browser**, inspect Chrome Downloads, then **Verify saved copy** and select that downloaded file. A mismatch must remain a visible error, not become a success merely because filename/size match.
6. Start Word generation and close/reopen a different report. Confirm the earlier artifact is not offered under the new case.

Automated helper tests do **not** establish that the native picker can be controlled by the current browser-automation integration, that a browser-download fallback completed, or that Word visually renders the live downloaded file. Those remain explicit live acceptance checks for the coordinating agent/user.
