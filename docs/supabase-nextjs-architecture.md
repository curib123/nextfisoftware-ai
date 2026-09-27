# Vrompt: Next.js + Supabase architecture

Vrompt is a single full-stack Next.js application designed for serverless
deployment.

## Runtime

- **UI:** Next.js App Router + React.
- **Backend:** same-origin Next.js Route Handlers under `/api/v1`.
- **Hosting:** Vercel.
- **Database:** Supabase Postgres.
- **Authentication:** Supabase Auth with Google/GitHub OAuth for users and a
  separate staff password flow.
- **Files:** private Supabase Storage bucket (`vrompt-private`).
- **AI:** provider calls are made only from Next.js server code. Shared provider keys never reach the browser. Users may optionally save their own provider keys; Vrompt encrypts them server-side with AES-256-GCM and never returns plaintext credentials.
- **Payments:** PayMongo checkout + signed webhooks.
- **Caching / quotas:** Postgres-backed atomic reservations remove the Redis requirement and work on serverless deployments.

No Docker, Nginx, Prisma, Redis, NestJS, or self-hosted Postgres runtime is
required.

## Security model

1. Every table in `public` has RLS enabled.
2. Browser-readable tables receive explicit grants; billing, usage, audit and accounting tables remain server-only.
3. User rows use ownership predicates based on `auth.uid()`.
4. Administrator authorization is stored in `profiles.role`, never user-editable auth metadata.
5. The Supabase secret key is server-only. The publishable key is safe to expose, although the current browser application talks to same-origin Next.js APIs.
6. File objects are private. Next.js checks the attachment owner before it reads or deletes an object.
7. Quota reservation/finalization is atomic in Postgres. The RPCs are revoked from `PUBLIC`, `anon` and `authenticated` and granted only to `service_role`.
8. OAuth uses PKCE + state and short-lived HttpOnly cookies. Refresh tokens remain HttpOnly.
9. Billing access is activated only by a validated PayMongo webhook, never by the browser redirect.

## User OAuth

Normal users can sign in with Google from the shared sign-in dialog. The
application uses:

- `GET /api/v1/auth/google` to begin Google OAuth
- `GET /auth/callback` to exchange the PKCE authorization code
- an HttpOnly refresh cookie for session renewal

The Google provider must be enabled separately in the Vrompt Supabase project's
Auth settings because provider credentials are not stored in SQL migrations.

## Cost controls

Vrompt budgets **$0.008 of provider cost per credit**. Manual models calculate credits from configured input/output limits and provider rates. Auto mode uses a low-cost pool and only selects models whose bounded provider cost fits the credit budget.

Default plans:

| Plan | Price | Credits | Maximum modeled provider budget |
| --- | ---: | ---: | ---: |
| Free (verified NVIDIA + Mistral fallback) | $0 | 30 | $0.24 shared-provider ceiling |
| Starter | $5.99 | 100 | $0.80 |
| Pro | $11.99 | 250 | $2.00 |
| Max | $24.99 | 600 | $4.80 |

Free Auto considers only NVIDIA models that have passed Vrompt's real completion health check; Mistral is retained as the fallback. The NVIDIA developer catalog is synchronized by an administrator in bounded batches so unavailable or non-chat endpoints remain disabled.

BYO requests use a separate zero-credit quota bucket. They do not add provider spend to Vrompt's cost ledger because the user owns the provider account, but they still use Vrompt rate, concurrency, input, file, and timeout limits.

Free-user shared-provider spend must still be treated as acquisition cost. Track conversion and contribution margin in the admin analytics view before increasing free allowances.

## Required environment variables

```env
NEXT_PUBLIC_SITE_URL=https://your-domain.example
NEXT_PUBLIC_SUPABASE_URL=https://ytzjrztxmnhqtokycenw.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...

NVIDIA_API_KEY=
NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com
MISTRAL_API_KEY=

OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
ANTHROPIC_API_KEY=

VROMPT_CREDENTIAL_ENCRYPTION_KEY=

PAYMONGO_MODE=test
PAYMONGO_SECRET_KEY=sk_test_...
PAYMONGO_WEBHOOK_SECRET=
PAYMONGO_PAYMENT_METHODS=card,gcash,qrph
```

Never put `SUPABASE_SECRET_KEY`, AI provider keys, OAuth client secrets, or
payment secrets in a `NEXT_PUBLIC_` variable.

## Supabase setup

Use the dedicated Vrompt Supabase project and keep its migration history aligned
with `supabase/migrations`.

The current migration head is:

`supabase/migrations/20260927230733_release_failed_generation_credits.sql`

Fresh environments must apply the complete migration chain in order.

For Google user login, enable Google in Supabase Auth, configure its Client ID
and Client Secret, and allow:

- `https://YOUR_DOMAIN/auth/callback`
- `http://localhost:3000/auth/callback` for local development

The repository deliberately does not contain private OAuth credentials.
