# Cloud-mode configuration diagnosis

4 September 2026. These findings concern configuration and read-only readiness, not a completed authenticated cloud-acceptance run.

## Root cause, verified

The managed deployment and the new GitHub Preview did **not** use the same Vercel environment scope. Existing Supabase configuration was not lost.

- The previous activation record deliberately configured the four Supabase variables for **Production only** and staged an application using `vercel deploy --prod --skip-domain`. That consumes Production configuration without promoting the public domain.
- Live read-only `vercel env ls production` confirmed `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, each shown only as **Encrypted**.
- Live read-only `vercel env ls preview` returned **No Environment Variables found**.
- `WorkspaceGate` reads its public Supabase configuration at Vite build time. A Preview built without those values correctly renders **Cloud not configured**; adding server-only configuration after the build would not activate the compiled browser client.
- The repository's saved Vercel project matches `niyamlens-sih26034`. No replacement project or database was necessary.

## Independent live read-only checks

Normal authenticated Vercel CLI requests were used; no stored credentials were extracted or printed.

| Deployment | `/api/health` observed JSON |
| --- | --- |
| Existing managed staged `niyamlens-sih26034-ojawbw6dc-duvvurudeepakreddy18s-projects.vercel.app` | `{"service":"niyamlens","ready":true}` |
| New Preview `niyamlens-sih26034-7cloxwhhk-duvvurudeepakreddy18s-projects.vercel.app` | `{"service":"niyamlens","ready":false}` |

Health currently proves only that the server can read the organizations table. It does not prove password sign-in, Storage transfer, isolation, synchronization, email delivery or backup restoration.

## Fix and prevention

1. Stage the verified new commit using the existing Production scope and `--skip-domain`. Do not copy the privileged production key into every pull-request Preview. Do not promote the public alias before acceptance.
2. Add `node tools/validate-build-config.mjs` before `vite build`. The validator loads the same default production-mode env files as Vite; it performs no network request and never logs configuration values.
3. Production builds must have all four required variables. Partial configuration fails in every environment. Fully unconfigured local/Preview builds remain available and are explicitly labelled local-only in the build result.
4. Browser/server URLs must normalize to the same safe HTTPS project root. HTTP loopback roots are accepted only for genuinely local builds where `VERCEL_ENV` is absent. Public credentials must be modern publishable keys or legacy `anon` JWTs; secret/service-role credentials are rejected there. Server credentials must have the corresponding privileged key type.
5. Verify the new staged browser presents secure sign-in, health is ready, and unauthenticated endpoints reject access. Then use the owner's already-provisioned account for real sign-in and identified test evidence. Do not recreate the account, resend an invitation or rerun manually installed migrations by default.

Key-shape checks are not authentication or JWT signature verification. The supported key families follow [Supabase's API key documentation](https://supabase.com/docs/guides/getting-started/api-keys).

## Automated checks

The new `tests/build-config.test.mjs` passed 9/9 tests: every partial configuration combination, Production fail-closed behavior, explicitly local Preview behavior, modern/legacy key families, privileged browser-key rejection, malformed/bounded values, unsafe or mismatched origins, strict local-only loopback exceptions, redacted CLI results, and refusal to invoke third-party environment-loading diagnostics while `DEBUG` is enabled. The installed Vite loader's debug path can print resolved environment values, so this guard runs before the loader. The independent test invocation used `--test-isolation=none` because the sandbox blocked the default Node test-runner subprocess with `spawn EPERM`; a full unrestricted suite remains the release owner's gate. Running the CLI in this repository without credentials also returned the expected explicit local-only result.

No environment mutation, database mutation, invitation, deployment or promotion was performed by this diagnostic task. Existing migration-history and real-account acceptance caveats in `docs/CLOUD_ACTIVATION_2026-09-04.md` remain applicable until separately verified.
