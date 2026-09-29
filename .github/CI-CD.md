# Nextfi CI

Nextfi Software uses `.github/workflows/ci-cd.yml` only for code quality checks.

## Pull requests and pushes

The workflow installs the npm workspace and runs:

- lint
- TypeScript type-checking
- unit tests
- the Next.js production build
- a repository check that prevents the removed NestJS/Docker/VPS runtime from returning

There are no Docker image builds, GHCR image pushes, SSH deployments, local
PostgreSQL services, or Redis services.

## Production deployment

Production deployment is handled by Vercel after the repository is connected to
a Vercel project. Keep production environment variables in Vercel's encrypted
project settings.

Supabase remains the hosted database, authentication, and private file-storage
platform. Database migrations remain tracked under `supabase/migrations` and
are applied to the dedicated Nextfi Software Supabase project separately.

Never commit the Supabase secret key, AI provider keys, Google OAuth client
secret, or PayMongo secrets to this repository.
