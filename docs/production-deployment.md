# Production deployment

Nextfi Software production is a **single full-stack Next.js application deployed directly
to Vercel**. Supabase hosts Postgres, Auth, and private Storage.

There is no Docker runtime, Nginx proxy, VPS deployment script, NestJS API,
Prisma runtime, Redis service, or self-hosted PostgreSQL service.

## Vercel setup

1. Connect `curib123/nextfisoftware-ai` to Vercel.
2. Set the project Root Directory to `apps/web`.
3. Keep the framework preset as **Next.js**.
4. Add the production environment variables from `.env.production.example` in
   Vercel Project Settings.
5. Set `NEXT_PUBLIC_SITE_URL` to `https://www.nextfisoftware.com/` (or your final custom production origin).
6. Deploy.

The server-only values must remain encrypted Vercel environment variables:

- `SUPABASE_SECRET_KEY`
- AI provider API keys, including `NVIDIA_API_KEY`
- `NEXTFI_CREDENTIAL_ENCRYPTION_KEY` when BYO provider keys are enabled
- `PAYMONGO_SECRET_KEY`
- `PAYMONGO_WEBHOOK_SECRET`

Do not expose any of those values through `NEXT_PUBLIC_`.

## Supabase

Use the dedicated Nextfi Software project:

`ytzjrztxmnhqtokycenw`

The current production migration head is tracked as:

`supabase/migrations/20260927230733_release_failed_generation_credits.sql`

Fresh Supabase projects must apply the complete migration chain in order.

Database migrations are managed through Supabase and are not run by the Vercel
application at startup.

## Google user login

Google user login is implemented in the application and must also be enabled on
the **Nextfi Software Supabase project**.

In Google Cloud:

1. Create or use a Web OAuth client.
2. Add your Vercel production origin under Authorized JavaScript origins.
3. Use the Supabase Google callback URL shown in **Supabase Auth → Providers →
   Google** as the Google OAuth Authorized redirect URI.

In Supabase:

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to:

   `https://www.nextfisoftware.com/`

3. Add this exact production callback to **Redirect URLs**:

   `https://www.nextfisoftware.com/auth/callback`

4. Keep this local-development callback only as an additional Redirect URL:

   `http://localhost:3000/auth/callback`

5. Open **Authentication → Providers → Google**.
6. Enable Google and add the Google Client ID and Client Secret.

If Supabase receives a `redirect_to` value that is not on the Redirect URLs
allow list, it falls back to the configured Site URL. If Site URL is still
`http://localhost:3000`, production OAuth will finish at
`http://localhost:3000/?code=...` instead of Nextfi Software.

The application route `/api/v1/auth/google` starts the PKCE OAuth flow and
`/auth/callback` completes it.

## PayMongo

Register the production webhook endpoint:

`https://YOUR_PRODUCTION_DOMAIN/api/v1/webhooks/paymongo`

After deployment, verify both `/health` and `/api/v1/health`.


## NVIDIA Free-model sync

Set `NVIDIA_API_KEY` as a server-only Vercel environment variable. After
deployment, open **Admin → Models & routing** and choose **Sync NVIDIA free
models**.

The sync reads the NVIDIA model catalog, performs real chat-completion probes in
bounded batches, and enables only endpoints that successfully answer. Healthy
NVIDIA models are added to the Free plan and Free Auto pool. Failed,
rate-limited, non-chat, or otherwise unverified endpoints remain unavailable.
Other provider endpoints join Free only after an administrator marks them as
verified free endpoints.

NVIDIA-hosted developer endpoints are controlled by NVIDIA and can have
account/model rate limits; Nextfi Software therefore treats health as dynamic rather than
assuming every listed model is usable.

## Bring Your Own API keys

Set `NEXTFI_CREDENTIAL_ENCRYPTION_KEY` before enabling user BYO connections.
`VROMPT_CREDENTIAL_ENCRYPTION_KEY` remains accepted as a legacy fallback during
migration.
Generate one stable 32-byte key, for example:

```bash
openssl rand -base64 32
```

Store it only in Vercel's encrypted environment settings. Do not rotate it
without a credential migration: existing saved provider keys are encrypted with
that value.

Users can then connect NVIDIA, OpenAI, Google AI, Anthropic, or Mistral from
**Settings → Your AI provider keys**. A saved key is verified before use,
encrypted server-side, masked in the UI, and never returned to the browser in
plaintext.
