# Team invitation email setup

Status on 5 September 2026: **SMTP active; stable public Site URL saved; first approved invitation consumed; intended Officer membership provisioned; one public-origin recovery email accepted; authenticated public-origin Officer workspace observed**. The original invite reached the recipient but redirected to a Vercel-protected generated URL. A limited read-only Auth query confirmed that the account was email-confirmed and signed in, so it was not reinvited or recreated. The verified 0.4.4 build was promoted, the stable public origin was added to the exact redirect allowlist and set as Site URL, and one recovery request was then sent to that origin. A recipient-supplied Chrome screenshot subsequently showed the approved Officer and `Authenticated workspace · server-verified permissions` on the stable origin. This does not yet prove an evidence upload/receipt or the multi-user permission matrix. The other three identities remain untouched. See [the public-cutover report](../reports/public-release-2026-09-05/VALIDATION.md). Recipient addresses and role mapping remain in the local Git/hosting-ignored roster, not this document.

## Selected pilot route

Use **Brevo Free transactional SMTP** for the small, consented team pilot. Its documented free allowance is 300 email sends/day. No paid plan is required for this allowance; account approval, transactional activation and delivery are separate requirements, not guarantees. [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

This is a temporary no-owned-domain route. Brevo allows mailbox-code verification of a sender, but rewrites unauthenticated/free-domain transactional From addresses onto its `t-sender-sib.com` domain. Recipients may not recognize that address. Use an owned, authenticated sending domain before broader release; do not describe this pilot setup as production email readiness. [Sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [temporary sender rewriting](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)

Supabase's default sender is not a substitute: it restricts recipients to project-team addresses. Do not give application testers Supabase organization/dashboard access to bypass that restriction. [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp)

## Account-owner steps

1. Sign in to Brevo or create a Free account, supplying genuine profile details and completing any mailbox/phone verification privately. Do not buy a plan or invent business details.
2. Verify a sender mailbox controlled by the owner. Suggested display name: **NiyamLens**. Do not use a teammate's address without permission.
3. Confirm transactional SMTP is active. A new account may require Brevo support approval; stop if approval is pending rather than treating credentials as proof of activation. [Activation troubleshooting](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP)
4. Create a dedicated NiyamLens SMTP credential only when ready to configure the project. Enter it directly into Supabase's password field; never paste it into chat, a source file, a screenshot, or an issue. It is an **SMTP key**, not the Brevo account password or API key. Keep recovery material in the owner's password manager.

Private account setup and sender verification are complete as observed in Chrome. Key creation and entry were performed privately by the owner, not independently verified by opening a secret-bearing page. Saved configuration persistence has now been checked by reloading Supabase. Its password field no longer displays the saved value, as the page explains; this is not a reason to paste or reveal it again. No credential was created, revealed or transferred by the assistant. Saved settings alone are not proof of a valid SMTP key, transactional activation or delivery. The first test exposed an IP restriction; it does not establish that the password is wrong.

## Supabase configuration

Target: project `NiyamLens-SIH26034` (`sivqthnclblqtqshexgx`), **Authentication → Emails → SMTP Settings**. Review the exact target and approve the configuration change before saving.

| Setting | Value |
| --- | --- |
| Sender email | The actual verified Brevo sender; do not guess |
| Sender name | NiyamLens |
| Host | `smtp-relay.brevo.com` |
| Port | `587` (STARTTLS; the current account's displayed setting) |
| Username | SMTP login shown by Brevo; not necessarily the account email |
| Password | Dedicated SMTP key, entered privately |

Use the provider's current account-specific SMTP settings as the authority. [Brevo SMTP configuration](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP)

Disable email link tracking before auth-mail acceptance. Brevo's **anonymous tracking** option is not equivalent to disabling tracking. Verify the actual delivered auth URL is not a tracking redirect; if reliable disabling cannot be established for the configured SMTP path, do not mark the provider accepted. Never copy a live single-use auth URL or token into this repository. Supabase documents both tracking-link breakage and premature single-use-link consumption by email scanners. [Supabase email-template limitations](https://supabase.com/docs/guides/auth/auth-email-templates#limitations), [Brevo anonymous tracking](https://help.brevo.com/hc/en-us/articles/11643306229906-Can-I-anonymize-the-tracking-of-opens-and-clicks-for-my-emails)

**Observed tracking limitation:** Settings → Transactional emails → Tracking exposed only **Anonymous email tracking?**, currently **No**, with explanatory text that both options retain tracking. It was left unchanged. No documented global SMTP no-rewrite switch or per-link exclusion was established. The July 21 developer clarification says per-recipient consent controls anonymize opens, not remove them; it does not establish suppression of click redirects. Do not substitute anonymous tracking, invent a no-track HTML attribute/header, or claim the Free account guarantees unchanged auth URLs. [Brevo clarification](https://developers.brevo.com/changelog/2026/7/21), [link rewriting](https://help.brevo.com/hc/en-us/articles/209421325-Why-is-the-URL-of-my-links-different-from-what-I-have-chosen)

If needed, ask Brevo support before acceptance (draft only; not sent):

> We are configuring this Free account's transactional SMTP for a small, consented Supabase authentication pilot. Can click tracking and URL rewriting be completely disabled for all SMTP messages on this account? Please confirm the exact supported setting or account-side change, rather than anonymous tracking. We also need confirmation that transactional SMTP is activated. Please do not request SMTP keys or live authentication links.

Preserve disabled public signup, email confirmation, current passwords and memberships. Do not increase sending limits for four test accounts. SMTP is Supabase configuration; it does not itself require an application redeployment or database migration.

## Redirect preflight

The intended application origin is:

<https://niyamlens-sih26034.vercel.app/>

Its exact origin is allowlisted and is the saved default Site URL. Both prior exact staged origins were preserved; no wildcard was added. Generated deployment URLs remain behind Vercel Authentication, so they must not be used for ordinary application invitations or recovery. A Vercel **Request Sent** page is infrastructure access control, not NiyamLens authentication; do not approve application users into the Vercel team. The first confirmed recipient was sent one new recovery email only after the stable public configuration was read back.

Previous Site URL, recorded for an approved rollback if needed:

`https://niyamlens-sih26034-ojawbw6dc-duvvurudeepakreddy18s-projects.vercel.app`

The first recipient's exact-email search was submitted with Enter (typing alone does not apply the filter). Once settled, it showed no matching users before the single invitation attempt and after a subsequent refresh. The user-table estimate is not an exact user count. Exact Auth/workspace UUID checks are still required before any membership grant.

## First invitation failure — 4 September, 23:27:39

The approved recipient was visually checked in the invitation form, then **Invite user** was clicked once. The modal did not provide a captured success result. Rather than resend, the operator cancelled it, refreshed the exact-email search, and read the project's Auth logs. The matching `POST /invite` returned HTTP 500 and `525 "5.7.1 Unauthorized IP address"`. No recipient account appeared in the refreshed search.

Brevo **Settings → Security → Authorized IPs** showed SMTP blocking **Activated**, API blocking **Deactivated**, zero authorized IPs and one unauthorized IP: `3.25.0.105`, Amazon.com, Inc., recorded at 23:28. Its timing is consistent with the failed send; this is not a provider guarantee of a fixed Supabase Auth egress address. No IP was authorized/deleted and no protection toggle was changed.

Following fresh owner approval, only `3.25.0.105` was authorized. Read-back showed one authorized address, zero unauthorized addresses, SMTP protection still **Activated** and API blocking still **Deactivated**. A fresh exact-recipient lookup remained empty, then one retry was submitted. The Auth user table created the intended identity in **Waiting for verification** state and displayed `Sent invite email`; Auth logs independently recorded `POST /invite`, HTTP 200, `user invited: request completed`, at 23:38:25. The exact Auth UUID remains only in the private ignored roster. No second retry was made. The recipient must confirm actual inbox/spam arrival privately. If another source address appears later, stop for provider confirmation rather than widening the list. [Brevo IP controls](https://help.brevo.com/hc/en-us/articles/5740111683858-Authorize-and-block-IP-addresses-for-API-and-SMTP-security)

A read-only invariant query then resolved exactly one primary workspace: `fec1146e-67d3-4cac-94e9-cf624fefa41e` (`NiyamLens team`), exactly one active owner-admin membership, exactly one matching invited Auth identity, and zero memberships for that identity. After separate action-time approval, a serializable, table-locked transaction rechecked the exact organization/recipient/owner invariants and inserted exactly one active **officer** membership—no upsert or role overwrite. Its returned row showed the intended workspace, recipient, `officer`, `active=true`, and a non-empty display name. A separate read-only postcondition query returned owner active-admin `1`, recipient active-officer `1`, and recipient membership total `1`.

## Acceptance sequence and evidence

Send one invitation first, then continue with the remaining approved recipients only after that delivery and link flow works. The account owner/recipient handles inbox access and password creation privately. Check for an existing Auth account before inviting; never reset an existing person's password as an invitation substitute.

**Current app ordering:** after the invite creates an Auth UUID, verify it and attach the approved active workspace membership before asking the recipient to open the link. A normal invite does not automatically open the password form in the current app; once in the workspace, the recipient uses **Change password → Save password** privately. Without membership, the app exposes only the no-membership screen and Sign out. If the link was already accepted, attach the approved membership and have the recipient reload that same signed-in tab before setting a password; do not sign them out or repeatedly reuse the link. This is code-supported sequencing from `src/Workspace.jsx`, not a completed live invitation test. The explicit redirect is the latest-stage root above, not an invented callback route.

| Check | Required evidence | Current result |
| --- | --- | --- |
| Provider readiness | Sender verified; transactional SMTP active; tracking behavior checked | Sender verified in UI; activation and no-rewrite acceptance pending |
| Project configuration | Correct project; saved settings read back without revealing key | SMTP and latest-stage Site URL persistence passed; one blocked IP authorized; SMTP blocking remained on and API blocking off |
| First external delivery | Recipient confirms inbox/spam arrival; record timestamp, not email token | Provider accepted one retry (Auth HTTP 200); recipient inbox/spam confirmation still pending |
| Invitation acceptance | Correct app origin; recipient sets password privately; real Auth identity verified | Auth identity and one active Officer membership ready; inbox/link/password flow still not run |
| Other recipients | Each intended user confirms receipt/acceptance; duplicates avoided | Not run |
| Recovery | Consenting pilot user receives recovery mail; intended-origin flow works | Not run |
| Authorization | Two officers, supervisor and control user pass the hosted permission matrix | Not run |

An accepted send request is not proof of delivery; an email arriving is not proof of successful sign-in; sign-in is not proof of correct workspace permissions. Record failures honestly, including sender rejection, rate limits, rewritten/expired links and missing membership. Do not repeatedly resend to work around a provider restriction.

After verifying exact Auth/workspace UUIDs, follow [team pilot acceptance](TEAM_PILOT_ACCEPTANCE.md) and [shared-workspace setup](SUPABASE_SETUP.md). `workspace:setup` attaches existing Auth users; it does not invite them. Preserve the owner's primary admin membership. Add two officers and one supervisor only to the primary workspace. Establish the control workspace with the owner as its first administrator, then add the fourth identity there as officer. Provision sequentially and never overwrite an existing role or suspension automatically.

## Recovery and rollback

Before a configuration change, record only non-secret prior settings and retain any necessary credentials in the owner's password manager. If SMTP or auth links fail, stop further invitations, inspect the relevant delivery/Auth errors without exposing tokens, and revert the specific saved settings with the owner's approval. The observed starting state was custom SMTP **off**: returning to it also restores the default sender's recipient restriction, not working team delivery.

Revoke an unused/compromised dedicated SMTP key only with authorization and awareness of which service uses it. Do not delete Auth users, evidence, cases, workspaces or memberships as an email-delivery rollback. No database reset, schema replay, production promotion or new Vercel secret is part of this setup.
