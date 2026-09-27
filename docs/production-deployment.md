# Production deployment

Vrompt production is a **single full-stack Next.js application** behind Nginx. Supabase hosts Postgres, Auth, and private Storage. There is no NestJS API, Prisma runtime, Redis container, or local production Postgres container.

## One-time setup

1. Create a dedicated Supabase project for Vrompt.
2. Apply `supabase/migrations/20260927000000_nextjs_fullstack.sql`.
3. Configure Google/GitHub providers in Supabase Auth if desired.
4. Add `https://YOUR_DOMAIN/auth/callback` to the Supabase redirect allow list.
5. Copy `.env.production.example` to the server as `.env.production` and add the server-only Supabase, AI-provider, and PayMongo secrets.
6. Register `https://YOUR_DOMAIN/api/v1/webhooks/paymongo` in PayMongo.
7. Bootstrap the Oracle/VPS host with `infrastructure/vps/bootstrap-ubuntu.sh`.

## Deploy

CI builds only two images: Next.js and Nginx. The host pulls immutable SHA-tagged images and starts:

- `vrompt-web`
- `vrompt-nginx`

Database migrations are deployed through the Supabase project, not by a production app container.

Run `infrastructure/release/phase1-audit.sh` before promotion. After deployment, `/health` and `/api/v1/health` verify Next.js can reach Supabase.
