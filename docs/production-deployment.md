# Production deployment

Vrompt production is a **single full-stack Next.js application deployed directly
to Vercel**. Supabase hosts Postgres, Auth, and private Storage.

There is no Docker runtime, Nginx proxy, VPS deployment script, NestJS API,
Prisma runtime, Redis service, or self-hosted PostgreSQL service.

## Vercel setup

1. Connect `curib123/vrompt-ai-workplace` to Vercel.
2. Set the project Root Directory to `apps/web`.
3. Keep the framework preset as **Next.js**.
4. Add the production environment variables from `.env.production.example` in
   Vercel Project Settings.
5. Set `NEXT_PUBLIC_SITE_URL` to the final production origin.
6. Deploy.

The server-only values must remain encrypted Vercel environment variables:

- `SUPABASE_SECRET_KEY`
- AI provider API keys
- `PAYMONGO_SECRET_KEY`
- `PAYMONGO_WEBHOOK_SECRET`

Do not expose any of those values through `NEXT_PUBLIC_`.

## Supabase

Use the dedicated Vrompt project:

`ytzjrztxmnhqtokycenw`

The production baseline is tracked as:

`supabase/migrations/20260927130707_nextjs_fullstack.sql`

Database migrations are managed through Supabase and are not run by the Vercel
application at startup.

## Google user login

Google user login is implemented in the application and must also be enabled on
the **Vrompt Supabase project**.

In Google Cloud:

1. Create or use a Web OAuth client.
2. Add your Vercel production origin under Authorized JavaScript origins.
3. Use the Supabase Google callback URL shown in **Supabase Auth → Providers →
   Google** as the Google OAuth Authorized redirect URI.

In Supabase:

1. Open **Authentication → Providers → Google**.
2. Enable Google.
3. Add the Google Client ID and Client Secret.
4. Add the Vrompt application callback to the Supabase redirect allow list:

   `https://YOUR_PRODUCTION_DOMAIN/auth/callback`

5. Keep this development callback available when needed:

   `http://localhost:3000/auth/callback`

The application route `/api/v1/auth/google` starts the PKCE OAuth flow and
`/auth/callback` completes it.

## PayMongo

Register the production webhook endpoint:

`https://YOUR_PRODUCTION_DOMAIN/api/v1/webhooks/paymongo`

After deployment, verify both `/health` and `/api/v1/health`.
