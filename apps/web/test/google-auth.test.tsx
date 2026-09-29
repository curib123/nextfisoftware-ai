import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const beginGoogleLogin = vi.fn();
const beginGitHubLogin = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/components/providers/auth-provider', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    beginGoogleLogin,
    beginGitHubLogin,
  }),
}));

vi.mock('@/components/providers/site-settings-provider', () => ({
  useSiteSettings: () => ({
    siteName: 'Nextfi Software',
    settings: { 'features.registrationEnabled': true },
  }),
}));

vi.mock('@/lib/auth-return', () => ({
  rememberOAuthReturnPath: vi.fn(),
}));

import {
  AuthDialogProvider,
  SignInButton,
} from '@/components/providers/auth-dialog-provider';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

describe('user OAuth sign-in', () => {
  it('keeps Google sign-in available for normal users', async () => {
    render(
      <AuthDialogProvider>
        <SignInButton>Sign in</SignInButton>
      </AuthDialogProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Welcome to Nextfi Software.' }),
    ).toBeVisible();

    const google = await screen.findByRole('button', {
      name: /continue with google/i,
    });
    expect(google).toBeEnabled();

    fireEvent.click(google);
    await waitFor(() => expect(beginGoogleLogin).toHaveBeenCalledTimes(1));
    expect(beginGitHubLogin).not.toHaveBeenCalled();
  });
});
