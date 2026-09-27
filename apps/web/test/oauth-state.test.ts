import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isOAuthCallbackStateValid } from '@/lib/server/auth';

describe('OAuth callback state validation', () => {
  it('accepts a Supabase PKCE callback that contains no state query parameter', () => {
    expect(isOAuthCallbackStateValid('', 'expected-state')).toBe(true);
  });

  it('rejects a callback with a mismatched state', () => {
    expect(isOAuthCallbackStateValid('wrong-state', 'expected-state')).toBe(false);
  });
});
