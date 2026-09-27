import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { siteOrigin } from '@/lib/server/auth';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('production OAuth origin', () => {
  it('uses the real request origin instead of a stale localhost env value', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

    const request = new Request(
      'https://vrompt-ai-workplace-web.vercel.app/api/v1/auth/google',
    );

    expect(siteOrigin(request)).toBe(
      'https://vrompt-ai-workplace-web.vercel.app',
    );
  });

  it('respects the forwarded production host behind a trusted proxy', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

    const request = new Request('http://internal:3000/api/v1/auth/google', {
      headers: {
        host: 'internal:3000',
        'x-forwarded-host': 'vrompt-ai-workplace-web.vercel.app',
        'x-forwarded-proto': 'https',
      },
    });

    expect(siteOrigin(request)).toBe(
      'https://vrompt-ai-workplace-web.vercel.app',
    );
  });

  it('rejects localhost as a production fallback when no request exists', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

    expect(() => siteOrigin()).toThrow(
      'NEXT_PUBLIC_SITE_URL cannot point to localhost in production.',
    );
  });
});
