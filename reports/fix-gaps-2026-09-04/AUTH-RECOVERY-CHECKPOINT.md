# Auth recovery checkpoint — 4 September 2026

**Historical checkpoint; subsequently resolved:** the owner is now authenticated on the latest stage, and an identified real-photo inspection has been sealed, retrieved and exported. See [the later cloud acceptance report](CLOUD-ACCEPTANCE.md) for actual results and remaining release limits. The chronology below preserves the earlier wrong-origin diagnosis; it is not a request to sign in again.

The owner reported login completion. Chrome showed an authenticated administrator workspace on the older `ojawbw6dc` deployment (RC4), with zero cases and zero queued changes at the first observation. This proves an accepted Auth session and membership on that older deployment, not a completed password-login/storage acceptance test on 0.4.3.

The latest `pbgjljnoj` deployment still showed its sign-in page and a recovery-email confirmation. A newly opened tab on the same latest origin also showed sign-in. No credential values, session tokens, email links or browser storage were inspected or transferred.

## Diagnosed redirect configuration

Supabase Authentication → URL Configuration showed:

- Site URL: `https://niyamlens-sih26034-ojawbw6dc-duvvurudeepakreddy18s-projects.vercel.app`
- Redirect URLs: empty.

The app requests recovery with `redirectTo: location.origin`. The dashboard explains that unmatched redirects fall back to the Site URL. This configuration explains why recovery initiated from the latest stage opened the older deployment.

## Narrow configuration fix

Added exactly one allowed redirect:

`https://niyamlens-sih26034-pbgjljnoj-duvvurudeepakreddy18s-projects.vercel.app`

Saved through the Supabase dashboard and reloaded the settings page. The exact latest URL persisted; the default Site URL remained the older deployment. No wildcard, alternate project, public promotion, user/role change, password change or invitation/reset email was performed by the assistant. Previously issued emails were not rewritten. Successful end-to-end delivery to the new destination still requires a fresh owner-requested recovery flow if one is needed.

## Acceptance boundary at this checkpoint

The owner must sign in privately on the latest origin using their own password. If a password was never set, the existing authenticated older workspace exposes Change password; the assistant must not operate the password itself. A new latest-release tab was opened for the owner.

No hosted case or evidence object was created during this checkpoint. Real private upload, server receipt, cloud-only retrieval and export read-back remain pending. Single-admin authentication does not prove cross-user/role isolation.

A read-only review ran 59 targeted cloud, authorization, queue and report tests successfully (after retrying Node outside the process sandbox). It identified an important acceptance detail: same-origin reload can reopen cached image bytes. A separate authenticated origin/cache must retrieve the case to establish actual private Storage download; do not clear existing browser data as a shortcut. The studio's initial sealed-report snapshot is local, so use Inspection history after synchronization to check the server receipt.
