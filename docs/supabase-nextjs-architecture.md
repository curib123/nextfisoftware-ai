# Vrompt: Next.js + Supabase architecture

Vrompt now targets a single full-stack Next.js application.

## Runtime

- **UI:** Next.js App Router + React.
- **Backend:** same-origin Next.js Route Handlers under `/api/v1`.
- **Database:** Supabase Postgres.
- **Authentication:** Supabase Auth. OAuth/password tokens are never accepted as authorization without server validation.
- **Files:** private Supabase Storage bucket (`vrompt-private`).
- **AI:** provider calls are made only from Next.js server code. Provider keys never reach the browser.
- **Payments:** PayMongo checkout + signed webhooks.
- **Caching / quotas:** Postgres-backed atomic reservations remove the Redis requirement and work on serverless deployments.

## Security model

1. Every table in `public` has RLS enabled.
2. Browser-readable tables receive explicit grants; billing, usage, audit and accounting tables remain server-only.
3. User rows use ownership predicates based on `auth.uid()`.
4. Administrator authorization is stored in `profiles.role`, never user-editable auth metadata.
5. The Supabase secret key is server-only. The publishable and secret Supabase keys are both kept server-side because browser code talks only to same-origin Next.js routes.
6. File objects are private. Next.js checks the attachment owner before it reads or deletes an object.
7. Quota reservation/finalization is atomic in Postgres. The RPCs are revoked from `PUBLIC`, `anon` and `authenticated` and granted only to `service_role`.
8. OAuth uses PKCE + state and short-lived HttpOnly cookies. Refresh tokens remain HttpOnly.
9. Billing access is activated only by a validated PayMongo webhook, never by the browser redirect.

## Cost controls

Vrompt budgets **$0.008 of provider cost per credit**. Manual models calculate credits from configured input/output limits and provider rates. Auto mode uses a low-cost pool and only selects models whose bounded provider cost fits the credit budget.

The production seed replaces the retiring Gemini 2.5 image model with `gemini-3.1-flash-lite-image` and caps image provider cost at $0.04 per generation for credit planning.

Default plans:

| Plan | Price | Credits | Maximum modeled provider budget |
| --- | ---: | ---: | ---: |
| Free | $0 | 30 | $0.24 |
| Starter | $5.99 | 100 | $0.80 |
| Pro | $11.99 | 250 | $2.00 |
| Max | $24.99 | 600 | $4.80 |

Free-user spend must still be treated as acquisition cost. Track conversion and contribution margin in the admin analytics view before increasing free allowances.

## Required environment variables

```env
NEXT_PUBLIC_SITE_URL=https://your-domain.example
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...

OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
ANTHROPIC_API_KEY=
MISTRAL_API_KEY=

PAYMONGO_MODE=test
PAYMONGO_SECRET_KEY=sk_test_...
PAYMONGO_WEBHOOK_SECRET=
PAYMONGO_PAYMENT_METHODS=card,gcash,qrph
```

Never put `SUPABASE_SECRET_KEY`, AI provider keys, or payment secrets in a `NEXT_PUBLIC_` variable.

## Supabase setup

Create a **dedicated Vrompt Supabase project**. Do not apply the migration to another application database.

Apply `supabase/migrations/20260927000000_nextjs_fullstack.sql`, configure Google/GitHub providers in Supabase Auth if used, then add these redirect URLs:

- `https://YOUR_DOMAIN/auth/callback`
- `http://localhost:3000/auth/callback` for local development

The repository deliberately does not contain live credentials.
