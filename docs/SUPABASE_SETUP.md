# NiyamLens shared-workspace setup

Updated 5 September 2026. A hosted Supabase project and public NiyamLens 0.4.4 deployment now exist. The stable production origin, Auth Site URL and exact redirect allowlist are aligned; see [the public-cutover report](../reports/public-release-2026-09-05/VALIDATION.md). One approved Officer accepted the first invitation and received a public-origin recovery email, but fresh password sign-in and the full multi-user matrix remain open gates. Read [the activation checkpoint](CLOUD_ACTIVATION_2026-09-04.md) before running any setup command: the schema is already installed manually, but CLI migration history is not yet recorded. This guide also describes reproducible setup for a separate, genuinely new project. Do not provision the first administrator again and do not push this repository's localhost-oriented `config.toml` into the hosted project.

## What works without a project

Run `npm install`, then `npm run dev`. The local workspace supports browser OCR, human verification, measurements, local drafts, sealed evidence and exports. Its role selector is explicitly a **training control**, not authentication. Connected OCR is no longer an unauthenticated public endpoint.

The new shared mode adds Supabase sign-in, verified workspace roles, private evidence uploads, server-recomputed findings, shared cases and assignments, append-only reviews and a durable offline submission queue. It activates only when its environment variables are configured.

## 1. Create your project

Create a Supabase project in your own account. Choose its region and billing settings yourself. Retain the database password in a password manager; do not put it in a chat, repository or PPT.

In Authentication settings:

- Disable public sign-ups. Only administrators should create or invite accounts.
- Set a minimum password length of at least 12 characters.
- Set the Site URL to the intended application URL and allow its exact password-recovery redirect URL. For local testing, allow `http://127.0.0.1:5173`.
- Configure an email sender/SMTP before relying on invitation or password-recovery delivery to a team. Test delivery; code alone does not guarantee it. The current hosted pilot's provider choice, private setup steps and pending acceptance checks are in [team email setup](TEAM_EMAIL_SETUP.md).

See [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords).

## 2. Apply the schema

From the repository directory, after selecting the new project:

**Existing NiyamLens hosted project:** stop here and follow the migration-history warning in the activation checkpoint. Do not rerun these migrations as though its database were empty. The commands below are for a new database whose schema has not already been installed.

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Review the migration list before confirming. These commands change the selected database. Do not use a database reset on an existing project with evidence.

The two migrations create organizations, memberships, cases, reviews, assignments, evidence registration, quotas, an internal server audit chain, and a private `evidence` storage bucket. Browser users have scoped read policies and no direct write privileges on operational records. Case/review/assignment mutations use role-checked database functions through the server.

Do not make `evidence` public or add permissive write policies. See [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## 3. Configure secrets locally

Copy `.env.example` to `.env.local`, then fill it using your own project settings:

| Variable | Location / purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Browser-safe project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser-safe publishable/anon key, never a service-role key |
| `SUPABASE_URL` | Same project URL, used by the server |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role secret; bypasses RLS and must never reach the browser |
| `GOOGLE_CLOUD_VISION_API_KEY` | Optional server-only connected-OCR provider key |

`.env.local` is ignored by Git. Use `.env.example` as the shareable template. **Never put a privileged secret in a `VITE_` variable.** Browser variables are compiled into public JavaScript.

## 4. Provision the first administrator

Create or invite the first user through your project's Authentication dashboard. Copy that user's UUID (not a password). The provisioning command below adds membership for an **existing** Auth user; it does not create passwords or send invitations:

```powershell
npm run workspace:setup -- --org-name="NiyamLens team" --user-id=AUTH_USER_UUID --role=admin
```

Keep the returned workspace UUID. Add existing users with:

```powershell
npm run workspace:setup -- --org-id=WORKSPACE_UUID --user-id=OFFICER_AUTH_UUID --role=officer
npm run workspace:setup -- --org-id=WORKSPACE_UUID --user-id=SUPERVISOR_AUTH_UUID --role=supervisor
```

The script refuses to silently replace an existing membership or create a same-name duplicate workspace. It is an administrator tool, not an API available to ordinary users. Role changes and suspensions currently require the administrator dashboard; there is no in-app membership administration UI.

## 5. Run locally

Use two terminals in the repository:

```powershell
npm run dev:api
```

```powershell
npm run dev
```

Open `http://127.0.0.1:5173`. Vite forwards `/api` requests to the local API on port 8787. Restart the API after changing server code or secrets. Restart Vite after changing browser environment values.

Sign in as an officer. Capture JPEG, PNG or WebP originals, perform OCR, compare each decisive field with the image and add verification notes. Sealing commits the case and upload operation atomically on the device. A pending item is **not yet cloud-backed**. The queue should clear only after verified file registration and a server case receipt.

## Optional: entirely local Supabase

Install/start Docker Desktop with its Linux engine running, then:

```powershell
npm run backend:start
npx supabase migration up --local
npm run backend:status
```

Use the local project URL and keys from the local CLI output in `.env.local`; do not share that output. Local Studio is configured on port 54323 and local email inspection on 54324. Public sign-ups are disabled in `supabase/config.toml`.

On the development machine used for this change, Docker's Linux engine did not start. Consequently, this exact stack has **not** been verified end to end locally. Database migrations were executed successfully using embedded PostgreSQL, which does not substitute for testing actual Supabase Auth and Storage.

## 6. Configure Vercel after the project is ready

Add the same five environment names to the intended Vercel environment. Keep the service-role and provider keys server-side. Both browser values must refer to the same project as the server values. Redeploy after setting them, because `VITE_` values are build-time settings.

The repository includes API routes and function timeouts. Image bytes upload directly to private Supabase Storage using exact-path upload tokens; metadata requests go through Vercel. The server subsequently verifies byte count, allowed type and SHA-256 before a case can be sealed. Upload recovery is **per file**, not byte-level resumable upload.

The verified 0.4.4 build is now on <https://niyamlens-sih26034.vercel.app/> and uses the intended production database; it is not an isolated staging project. Its four required Vercel Production variables are configured; the optional Google Vision key is not. Generated deployment URLs remain Vercel-protected. Use the stable public origin for application users, follow the acceptance checks below, and use [the public-cutover report](../reports/public-release-2026-09-05/VALIDATION.md) for the exact deployment and rollback IDs.

## Acceptance checks before team use

1. Sign in as two officers and one supervisor. Officers must not see one another's cases; the supervisor must see both within the same organization.
2. Try a user from another organization. Case and evidence access must be denied.
3. Capture an unseen real package. Retain the raw OCR, document corrections and verify decisive values. Never demonstrate OCR accuracy using manually corrected text as if the OCR produced it.
4. Go offline, seal a case, reload and recover the local work. Reconnect; verify one server case, the original/analysis objects and their digests. Interrupt an upload and retry.
5. Review the same server version from two supervisors. The second stale review must conflict, preserve its unsent reason and require explicit reconciliation.
6. Suspend a member and confirm the server denies subsequent reads, uploads, OCR and mutations even with an old token.
7. Exercise real invitation/recovery emails, expired sessions and signed evidence URLs.
8. Confirm an API failure never displays a cloud-saved receipt, and that `/api` responses are absent from the service-worker cache.
9. Test backup **and restore**, including private storage objects, not just database rows. No scheduled backup or successful restore is claimed by this code.

Use trusted devices. Offline IndexedDB data is separated by user/workspace but is not application-encrypted at rest; sign-out retains it to avoid deleting unsent evidence. Use OS disk encryption, appropriate device access controls and a deliberate retention policy. The server audit is internally hash-linked, not externally anchored WORM storage or statutory certification.
