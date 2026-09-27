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

1. Create a dedicated Vrompt Supabase project.
2. Apply `supabase/migrations/20260927000000_nextjs_fullstack.sql`.
3. Copy `.env.example` to `.env` and add the Vrompt Supabase URL/keys.
4. Configure any AI provider keys you want to enable.
5. Run:

```bash
npm ci
npm run dev
```

Open http://localhost:3000, or http://localhost:3100 when using Docker Compose.

## Security

- Browser traffic uses same-origin `/api/v1` routes; Supabase keys and AI/payment secrets stay server-side.
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

The connected Supabase project must be dedicated to Vrompt. Do not apply the migration to another app's database.
