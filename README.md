# Nextfi Software

Nextfi Software is a private multi-model AI workspace built as one **Next.js full-stack application** with **Supabase Postgres/Auth/Storage**.

## Stack

* Next.js App Router + React for UI and backend Route Handlers
* Supabase Postgres with Row Level Security
* Supabase Auth with PKCE OAuth and HttpOnly refresh cookies
* Google OAuth for normal user sign-in
* Supabase private Storage for uploads and generated images
* OpenAI, Google, Anthropic, Mistral, and NVIDIA server-side provider adapters
* PayMongo checkout + signed webhooks
* Vercel-ready deployment with no Docker runtime

NestJS, Prisma, Redis, Docker, Nginx, and the self-hosted PostgreSQL runtime have been removed.

**Website:** https://www.nextfisoftware.com/

## Development

1. Use the dedicated Nextfi Software Supabase project.
2. The hosted schema is already provisioned. For a fresh environment, apply the tracked migrations in order rather than only the original baseline.
3. Copy `.env.example` to `.env`. The project URL and publishable key are prefilled; add the server-only `SUPABASE_SECRET_KEY` from the Nextfi Software project's API Keys settings.
4. Add `NVIDIA_API_KEY` to discover and verify NVIDIA hosted developer endpoints for the Free plan; keep `MISTRAL_API_KEY` as the Free fallback.
5. Add `VROMPT_CREDENTIAL_ENCRYPTION_KEY` if users should be able to save their own provider API keys.
6. Configure any other shared AI provider keys you want to enable.
7. Configure Google under **Supabase Auth → Providers → Google** for user sign-in.
8. Run:

```bash
npm ci
npm run dev
```

Open http://localhost:3000.

## User Authentication

The user-facing sign-in flow includes **Continue with Google**. The application starts a Supabase PKCE OAuth flow at `/api/v1/auth/google` and returns through `/auth/callback`.

Google OAuth configuration is project-specific and is not part of database migrations. For the Nextfi Software Supabase project, configure the Google Client ID and Client Secret in Supabase Auth and allow the application callback URL.

The staff/admin password flow remains separate from normal user OAuth.

## Security

* Browser traffic uses same-origin `/api/v1` routes. The Supabase publishable key may be exposed by design, while the Supabase secret key and all AI/payment secrets remain server-only.
* Every exposed public table has RLS.
* Users cannot update the authorization-bearing `profiles.role` or `profiles.status` columns directly.
* Billing, quota, audit, and cost ledgers are server-only.
* Private files are read only after a server-side ownership check.
* Credit reservation/finalization is atomic in Postgres.
* Paid access is activated only from a verified PayMongo webhook.
* CSP, HSTS in production, anti-framing, MIME sniffing protection, and restrictive browser permissions are enabled.

## Unit Economics

One credit budgets at most **US$0.008** of provider work. Default monthly provider-cost ceilings:

| Plan                                      |  Price | Credits |           Max modeled AI cost |
| ----------------------------------------- | -----: | ------: | ----------------------------: |
| Free (verified NVIDIA + Mistral fallback) |     $0 |      30 | $0.24 shared-provider ceiling |
| Starter                                   |  $5.99 |     100 |                         $0.80 |
| Pro                                       | $11.99 |     250 |                         $2.00 |
| Max                                       | $24.99 |     600 |                         $4.80 |

Free accounts can use NVIDIA hosted chat endpoints only after Nextfi Software confirms them with a successful live completion request; Mistral remains the fallback. NVIDIA-hosted developer access is externally rate-limited and should not be treated as unlimited infrastructure.

Paid plans can use the configured multi-model pool and eligible manual models.

Users can also connect their own NVIDIA, OpenAI, Google AI, Anthropic, or Mistral API key. BYO requests use the user's provider account and consume zero Nextfi Software AI credits, while Nextfi Software still enforces request, concurrency, and safety limits.

Saved BYO keys are encrypted server-side and never returned in plaintext. Admin analytics keep BYO provider cost at zero because that cost belongs to the user's provider account.

## Production

Deploy the Next.js application directly to Vercel and configure the production environment variables in Vercel Project Settings.

See:

* `docs/production-deployment.md`
* `docs/supabase-nextjs-architecture.md`

The production Supabase project is `ytzjrztxmnhqtokycenw`.

**Do not apply migrations to another application's database.**

## Branding

The application has been renamed from **Vrompt / Nextfi AI** to **Nextfi Software**.

* Product name: **Nextfi Software**
* Website: **https://www.nextfisoftware.com/**
* Development URL: `http://localhost:3000`
* API base path: `/api/v1`
