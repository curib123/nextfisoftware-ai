# Vrompt

Vrompt is a private multi-model AI workspace built as one **Next.js full-stack application** with **Supabase Postgres/Auth/Storage**.

## Stack

- Next.js App Router + React for UI and backend Route Handlers
- Supabase Postgres with Row Level Security
- Supabase Auth with PKCE OAuth and HttpOnly refresh cookies
- Supabase private Storage for uploads and generated images
- OpenAI, Google, Anthropic, and Mistral server-side provider adapters
- PayMongo checkout + signed webhooks
- Optional Oracle Free/VPS deployment with Docker + Nginx

NestJS, Prisma, Redis, and the self-hosted PostgreSQL runtime have been removed.

## Development

1. Use the dedicated Vrompt Supabase project `ytzjrztxmnhqtokycenw`.
2. The hosted schema is already provisioned from `supabase/migrations/20260927130707_nextjs_fullstack.sql`; apply that file only when creating a fresh environment.
3. Copy `.env.example` to `.env`. The project URL and publishable key are prefilled; add the server-only `SUPABASE_SECRET_KEY` from the Vrompt project's API Keys settings.
4. Configure any AI provider keys you want to enable.
5. Run:

```bash
npm ci
npm run dev
```

Open http://localhost:3000, or http://localhost:3100 when using Docker Compose.

## Security

- Browser traffic uses same-origin `/api/v1` routes. The Supabase publishable key may be exposed by design, while the Supabase secret key and all AI/payment secrets remain server-only.
- Every exposed public table has RLS.
- Users cannot update the authorization-bearing `profiles.role` or `profiles.status` columns directly.
- Billing, quota, audit, and cost ledgers are server-only.
- Private files are read only after a server-side ownership check.
- Credit reservation/finalization is atomic in Postgres.
- Paid access is activated only from a verified PayMongo webhook.
- CSP, HSTS in production, anti-framing, MIME sniffing protection, and per-IP Nginx API rate limits are enabled.

## Unit economics

One credit budgets at most **US$0.008** of provider work. Default monthly provider-cost ceilings:

| Plan | Price | Credits | Max modeled AI cost |
| --- | ---: | ---: | ---: |
| Free | $0 | 30 | $0.24 |
| Starter | $5.99 | 100 | $0.80 |
| Pro | $11.99 | 250 | $2.00 |
| Max | $24.99 | 600 | $4.80 |

Auto mode uses economical models; premium/manual models consume more credits according to their configured bounded cost. Admin analytics report revenue, AI cost, variable cost, contribution profit, and margin.

## Production

See `docs/production-deployment.md` and `docs/supabase-nextjs-architecture.md`.

The production Supabase project is `ytzjrztxmnhqtokycenw` (Vrompt). Do not apply the migration to the Nextfi project or another app's database.
