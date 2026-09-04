# NiyamLens 0.4.3 — gap fixes and verification

4 September 2026. This is a prototype acceptance record, not a claim of legal certification or field-wide OCR accuracy.

## Implemented

- Cloud builds: fail closed on missing or partial Production configuration, unsafe/mismatched project URLs, or privileged credentials in browser variables. Fully unconfigured local/Preview builds remain explicitly local-only. Existing Production settings are used for the managed staging deployment; secrets are not copied into arbitrary Preview builds.
- Reports: persistent prepared JSON/DOCX download links, an explicit native Save As workflow, byte-for-byte saved-copy verification, cancellation/error reporting, and stale-operation protection. A link click alone never reports successful disk saving.
- OCR: bounded heading-guided close-up rescans; explicit selection of existing raw passes for the working transcript; mandatory comparison/reason/acknowledgment; audit-before-publication; original images, raw passes, excluded readings and conflicts remain preserved. All decisive confirmations reset and confidence remains unavailable.

## Automated release checks

| Check | Result |
| --- | --- |
| Complete application regression suite | 375/375 passed; no skipped tests |
| Audit-gate failure handling | 5/5 passed |
| Production-format local build | Passed; explicitly local-only without hosted credentials |
| OCR source assets and final build assets | 17/17 SHA-256 matches each; 68,186,300 bytes |
| Production dependency audit | Complete report, zero reported vulnerabilities |
| Whitespace validation | `git diff --check` passed |

The initial sandboxed audit-test invocation could not spawn a child process (`EPERM`); the unrestricted rerun passed. Optional OCR bundles still produce large-chunk build warnings. Tests and asset integrity are not recognition-accuracy measurements.

## Actual Chrome workflow — real photograph

The unchanged Open Food Facts milk-label photograph `8901262260121/6.jpg` was used, SHA-256 `9d2187d0603d8781814e24320b452d596dc826a50ba29f0a7643f6d43b0c619b`. This is a previously inspected development photograph, not a blind holdout.

1. Whole-image Paddle recognition returned 56 lines / 749 characters. The quantity heading was separated from its value by unrelated column text; the working extraction was invalid. The full raw output was appended unchanged.
2. The UI suggested a heading-derived net-content rectangle. A fresh recognition run on that region returned exactly two lines / 18 characters:

   ```text
   Net Content:
   500mL
   ```

3. Appending this result kept the earlier reading and exposed a quantity conflict. No corrected OCR or desired numeric value was typed.
4. After a reload, the draft retained both passes. The explicit selection UI started with nothing selected. Reading 2 was chosen with a photo-comparison reason and replacement acknowledgment.
5. The working transcript then parsed 500 ml. Both original readings remained in raw history; the disagreement remained visible in field verification. Confidence stayed null, no physical-label confirmations were asserted, and the result stayed `manual_review`.
6. Local case `NLM-20260904-dc286bb9-848f-47e5-be49-03816271d424` was sealed. It has eight hash-linked audit events, including `working_ocr_passes_selected`. Its exported original-image bytes match the registered photograph hash.

## Actual report verification

- JSON was prepared from that sealed case. The user completed the native save dialog and confirmed saving.
- The saved file was found in Downloads: `NLM-20260904-dc286bb9-848f-47e5-be49-03816271d424-evidence.json`, **2,905,574 bytes**, SHA-256 `2b2c52ffd54b98b1b2e412c91cab63e297a6b76aa53ec1ab92a19a578689514b`.
- Independent parsing verified the local audit chain, the original image digest, both raw passes, the selection event, the working transcript and null OCR confidence.
- The actual saved JSON was selected through the app's **Verify saved copy** control. Chrome displayed **“Selected saved copy matches byte-for-byte (2,905,574 bytes).”** This is successful end-to-end JSON save/read-back evidence.
- The actual native Word report was generated in Chrome, shown as 1,493 KB. Word disk save/read-back was not separately completed in this check. Its generator and export lifecycle regressions pass; that does not substitute for a real DOCX save/read-back.
- Browser automation did not receive a download-completion event from the fallback link. Chrome's internal downloads page is inaccessible to the tool. No browser security setting was bypassed. Native saving plus the app's explicit saved-copy verification supplied the successful JSON check instead.

## Hosting acceptance boundaries

The production-configured staging deployment and its exact commit/CI result will be recorded separately after publication. The public domain is not promoted by this test. The staged app uses the existing intended-production Supabase database, not a separate staging database; no schema migration, database reset, invitation resend or account replacement is part of this release.

Owner password sign-in, real private Storage upload/seal/reload, email delivery, multi-user isolation and backup restoration still need authenticated hosted acceptance. The owner was asked to sign in privately. Health and unauthenticated API rejection cannot establish these flows. Google Vision credentials are not configured.

## Remaining OCR limitation

The frozen eight-photo development corpus previously scored only 1/10 provisional critical fields for the offline Rapid baseline. This release does not relabel that corpus, rewrite raw OCR, or claim improved automatic benchmark accuracy. One successful officer-assisted crop establishes that workflow on one photo only. Broader readable, independently labelled holdouts and officer field trials remain necessary.

## Deployment/rollback gate

Use `vercel deploy --prod --skip-domain --yes` only after the source is committed, pushed and CI passes. Confirm the hosted build logs explicitly report managed mode, `/api/health` is ready, and unsigned-in private endpoints reject requests. Do not promote the public alias before authenticated acceptance. If these checks fail, leave the existing alias untouched and investigate the staged release; application rollback must not reset the database.
