# Nextfi Software

Nextfi Software is a private, multi-model AI workspace that gives users access to multiple AI models **for free** from one unified application.

It is built as a **Next.js full-stack application** with **Supabase Postgres/Auth/Storage**, configurable model routing, usage controls, secure provider integrations, and a Vercel-ready deployment architecture.

**Website:** https://www.nextfisoftware.com/

## Stack

* Next.js App Router + React for UI and backend Route Handlers
* Supabase Postgres with Row Level Security
* Supabase Auth with PKCE OAuth and HttpOnly refresh cookies
* Google OAuth for normal user sign-in
* Supabase private Storage for uploads and generated images
* OpenAI, Google, Anthropic, Mistral, and NVIDIA server-side provider adapters
* Multiple AI models available through a unified workspace
* Usage, request, concurrency, and safety controls
* Vercel-ready deployment with no Docker runtime

NestJS, Prisma, Redis, Docker, Nginx, and the self-hosted PostgreSQL runtime have been removed.

## Free AI Models

Nextfi Software is designed around **free access to available AI models**.

Users can select from the models enabled by the application and use them from the same workspace without purchasing an individual subscription for each AI provider.

Supported provider integrations include:

* NVIDIA
* Mistral
* Google AI
* Anthropic
* OpenAI

Model availability depends on the provider's currently available free or hosted endpoints, API limits, and the models configured by the Nextfi Software administrator.

Free access does not mean unlimited provider infrastructure. Provider rate limits, request limits, concurrency controls, and safety restrictions may still apply.

## Development

1. Use the dedicated Nextfi Software Supabase project.
2. The hosted schema is already provisioned. For a fresh environment, apply the tracked migrations in order rather than only the original baseline.
3. Copy `.env.example` to `.env`.
4. Add the server-only `SUPABASE_SECRET_KEY` from the Nextfi Software project's API Keys settings.
5. Configure the AI provider keys required by the models you want to make available.
6. Configure Google under **Supabase Auth → Providers → Google** for user sign-in.
7. Run:

```bash
npm ci
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment Variables

Example provider configuration:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

NVIDIA_API_KEY=
MISTRAL_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
ANTHROPIC_API_KEY=

NEXTFI_CREDENTIAL_ENCRYPTION_KEY=
```


## User Authentication

The user-facing sign-in flow includes **Continue with Google**.

The application starts a Supabase PKCE OAuth flow at:

```text
/api/v1/auth/google
```

and returns through:

```text
/auth/callback
```

Google OAuth configuration is project-specific and is not part of database migrations.

For the Nextfi Software Supabase project, configure the Google Client ID and Client Secret in Supabase Auth and allow the application callback URL.

The staff/admin password flow remains separate from normal user OAuth.

## Model Routing

Nextfi Software provides a unified interface for multiple AI providers.

The application can route requests to configured models from different providers while keeping the user experience inside the same workspace.

Provider availability can change based on:

* Provider API availability
* Free-tier restrictions
* Rate limits
* Model availability
* Request and concurrency limits
* Administrator configuration
* Provider authentication requirements

The application should automatically fall back to another configured free model when the preferred model is unavailable, where supported.

## BYO API Keys

Users can optionally connect their own provider API keys.

Supported providers include:

* NVIDIA
* OpenAI
* Google AI
* Anthropic
* Mistral

BYO requests use the user's own provider account rather than Nextfi Software's shared provider resources.

Saved API keys are encrypted server-side and are never returned to the browser in plaintext.

Nextfi Software continues to enforce request, concurrency, security, and safety controls for BYO requests.

## Security

* Browser traffic uses same-origin `/api/v1` routes.
* The Supabase publishable key may be exposed by design.
* Supabase secret keys and AI provider secrets remain server-only.
* Every exposed public table has Row Level Security.
* Users cannot directly modify authorization-bearing `profiles.role` or `profiles.status` columns.
* Administrative data and security-sensitive operations are server-controlled.
* Private files are read only after a server-side ownership check.
* Saved provider credentials are encrypted server-side.
* CSP, HSTS in production, anti-framing, MIME sniffing protection, and restrictive browser permissions are enabled.
* Provider requests are subject to request, concurrency, and safety limits.

## No Paid AI Subscription Required

Nextfi Software's core goal is to provide access to multiple AI models through **one free workspace**.

Users do not need to maintain a separate paid subscription for every supported AI provider to use the models made available through Nextfi Software.

Some providers may impose their own external limits or require authentication. These limitations are outside Nextfi Software's control.

## Production

Deploy the Next.js application directly to Vercel and configure the production environment variables in Vercel Project Settings.

See:

* `docs/production-deployment.md`
* `docs/supabase-nextjs-architecture.md`

The production Supabase project is:

```text
ytzjrztxmnhqtokycenw
```

**Do not apply migrations to another application's database.**

## Branding

The application has been renamed to **Nextfi Software**.

* Product name: **Nextfi Software**
* Website: **https://www.nextfisoftware.com/**
* Development URL: `http://localhost:3000`
* API base path: `/api/v1`
