# Real-photo managed cloud acceptance — 4 September 2026

**Outcome:** the owner is authenticated on the latest 0.4.3 stage. One real-photo inspection was processed, sealed to Supabase, retrieved through a separate origin, exported, saved, and independently checked. This is a narrowly scoped cloud-workflow acceptance result, not a public-release sign-off or an OCR accuracy benchmark.

This supersedes the pending latest-login and basic Storage-transfer status in [the recovery checkpoint](AUTH-RECOVERY-CHECKPOINT.md) and [the hosted checkpoint](HOSTED-RELEASE.md). No password, session token, invitation link, or environment-secret value was inspected, transferred, or added to this report.

## Release and test record

- Tested stage: <https://niyamlens-sih26034-pbgjljnoj-duvvurudeepakreddy18s-projects.vercel.app/>.
- Deployment: `dpl_9GnDpup4NMcnGLyRYvrVX6LWCxLi`; application source `3760cfca2e3c09883ec8a45838d9dbf8081da1b6`; version 0.4.3 / RC5.
- Case: `NLM-20260904-eccae07d-8675-4cb1-805e-b843ccaa907e`.
- Input: the unchanged development photograph `datasets/openfoodfacts-india/real-labels/8901262260121/6.jpg`, 881,680 bytes.
- Input SHA-256: `9d2187d0603d8781814e24320b452d596dc826a50ba29f0a7643f6d43b0c619b`.
- This photo had been inspected previously. It is **not a blind or unseen-label test**.
- The case contains an explicit acceptance-test note: private evidence persistence/retrieval only, no statutory decision, physical measurements, or absence confirmations.
- The test case remains in the workspace; no existing records were deleted or replaced.

## Observed Chrome workflow

| Step | Actual observation | Boundary |
| --- | --- | --- |
| Latest-origin authentication | Administrator account; “Authenticated workspace · server-verified permissions” | One active administrator is not cross-user or cross-organization isolation proof. |
| Original-photo upload | The named JPEG was selected through Chrome's actual file chooser | The automation's chooser operation was unusually slow; this was not treated as OCR runtime. |
| Whole-photo Paddle OCR | Actual 56-line, 749-character raw result was appended unchanged | Interleaved columns produced a bad quantity extraction. No corrected transcript was typed. |
| Guided quantity OCR | Actual close-up raw text was `Net Content:` followed by `500mL` | This was a suggested, officer-triggered region on a known photo, not automatic broad-label accuracy. |
| Working-reading selection | Only the close-up reading was selected, with a photo-comparison acknowledgement and a written reason | Both raw passes remained preserved. Selecting an existing pass is not rewriting the raw OCR. |
| Evaluation | Working quantity 500 ml; confidence unavailable; overall **MANUAL REVIEW** | Other declarations and physical measurements remained unverified; no compliant verdict was claimed. |
| Cloud seal | Local commit entered the queue, synchronized, and returned to zero queued changes | The initial studio report is local. The managed receipt was checked from Inspection history after synchronization. |
| Server receipt | Version 1; received 4 September 2026 at 20:09 IST; server hash below | This receipt came from the managed history response. Its mere presence in a later offline JSON file is not independent server authentication. |
| Separate-origin retrieval | A newly opened older-stage origin, without this case's locally captured images, loaded the new case and rendered its photograph and receipt | See the important current-server retrieval limitation below. |
| JSON disk save | Native Save As completed; the app reported “Saved copy read back and matched byte-for-byte (2,913,597 bytes).” | The user saved into Documents. The browser's native dialog was not controlled through hidden state or OS automation. |
| Independent saved-file verification | Offline CLI passed original and analysis hashes, exact source-image comparison, raw Paddle inclusion, audit linkage, and receipt shape | Hash linkage is internal consistency, not a signed forensic chain or legal validity. |

Server receipt payload hash:

`c1989169252434d695e1e1cff853fef2a2ece6c46018facb2e3e3b5fc1ee6e7a`

The recorded working-pass selection reason explicitly limits the interpretation: the close-up matches the visible quantity heading/value; the whole-image pass and conflicts remain retained; other declarations and physical measurements are unverified. The JSON's test note was separately checked after saving.

## Private Storage retrieval: what this does and does not prove

The separate origin was the already-authenticated older `ojawbw6dc` deployment, source `c945c370e9daa6539f3e75b4f46505b0ea8e6f5a`. The temporary retrieval tab was closed after checking it; the latest stage remains open.

Code comparison established that `workspaceClient.openRecord()` and its bounded-image helper are unchanged between the old and tested stages. They fetch **both original and analysis objects**, enforce MIME/size limits, check the original against its registered digest and analysis against its path digest, and return only after those checks pass. The old App awaits that retrieval before rendering the report. A rendered report in that origin therefore supports real private-object retrieval and those client-side checks, not just a latest-origin cache hit.

However, the old stage's `GET /api/evidence` lacks the current server's hardened read quotas, registered-object owner/organization lookup, and server-side image/digest revalidation. **This test does not live-exercise the latest hardened GET path.** Its automated tests pass; a fresh-cache retrieval against the latest origin with an authorized test account is still needed. Same-origin reload alone is insufficient because it can reuse IndexedDB images. Existing browser data was not erased to manufacture a cache miss.

## Saved JSON and reproducible verification

Local saved artifact, deliberately **not committed** with its account metadata and image bytes:

`C:/Users/duvvu/Documents/NLM-20260904-eccae07d-8675-4cb1-805e-b843ccaa907e-evidence.json`

| Offline check | Result |
| --- | --- |
| Export bytes | 2,913,597 |
| Export SHA-256 | `27d6d6d28c1fec3644c52bff196591f38ec3dc42704779c05e498dd8811c5304` |
| Original image | 881,680 bytes; registered hash and exact source-photo hash match |
| Analysis image | 628,046 bytes; registered path hash matches |
| Analysis SHA-256 | `eece3f4ec96c1f43312acbeb5d2f60b715e63716abf69362742719957fc66fa9` |
| Raw OCR history | Two Paddle passes, both found exactly in their labelled raw transcript sections |
| Working transcript | Separate from raw; different because of the documented pass selection |
| Client audit | Eight internally hash-linked events, including the seal event |
| Receipt fields | Present and well-formed, version 1, `syncState: synced` |

Run from the repository root (substitute your own saved-file path when sharing):

```powershell
node tools/verify-cloud-export.mjs "C:/Users/duvvu/Documents/NLM-20260904-eccae07d-8675-4cb1-805e-b843ccaa907e-evidence.json" --original "datasets/openfoodfacts-india/real-labels/8901262260121/6.jpg"
```

The verifier is read-only, uses bounded local-file reads, does not access the network or credentials, and does not print account identities, raw transcripts, image data, or private object paths. It checks MIME signatures and hashes, not complete image decoding. It does **not** recompute or authenticate the server payload hash from the hydrated export: the hydrated file includes images/review fields absent from the stored payload. An internally consistent client audit can be rewritten together with its hashes. Exact Paddle inclusion is not proof of execution, recognition accuracy, completeness, or legal compliance. Other providers' merged transcript contents are not compared as if they were Paddle append blocks.

## Automated checks and release boundary

The new verifier has nine tests, including altered bytes/text, malformed receipts/history, source/path mismatches, bounded file input, privacy-safe summaries, and nonmutation of the input record. Final review also added a regression against array-to-string coercion in the receipt hash field. The local application suite passed **384/384** after these changes; the separate audit-gate suite passed **5/5** (the latter required an allowed retry outside the process sandbox so Node could spawn its test worker). The preceding unchanged application release's GitHub verification passed its 375 application tests, five audit-gate tests, build, source/build OCR asset hashes, and production dependency audit; follow the current branch's CI for the new verification-only commit.

Only verification tools, tests, and checkpoint documents were changed for this acceptance work. No application code, environment variables, role assignments, or database schema were changed, and no new deployment is needed for these files. The original Auth allowlist fix is recorded separately in the recovery checkpoint.

**Still required before a broader release claim:**

1. Latest-stage fresh-cache private retrieval, distinct authorized officer/supervisor accounts, cross-user/organization denial tests, assignment/review permissions, and concurrent-version conflict handling in the hosted environment.
2. Real browser interrupted-upload/offline-retry checks, recovery delivery where needed, and a tested database/object backup restoration procedure.
3. Unseen real-label evaluation with manually established ground truth. The weak earlier development benchmark is not superseded by this one-photo workflow check. Google Vision remains unconfigured.
4. Separate native Word disk-save/read-back acceptance. Word generation was checked previously; this record establishes the managed **JSON** save.
5. Final public-domain Auth configuration, explicit promotion of the accepted release, and smoke checks on that domain.

The public alias `https://niyamlens-sih26034.vercel.app/` was **not promoted** during this work. Use the staged link at the top for the tested managed release.
