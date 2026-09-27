import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/chat',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/providers/auth-provider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'curib@example.com',
      username: 'curibtech',
      role: 'USER',
      accountType: 'REAL',
      plan: 'FREE',
      onboardingCompleted: true,
    },
    isLoading: false,
    logout: vi.fn(),
  }),
}));

vi.mock('@/components/theme/theme-provider', () => ({
  useTheme: () => ({ toggleTheme: vi.fn() }),
}));

vi.mock('@/components/providers/site-settings-provider', () => ({
  useSiteSettings: () => ({ announcement: '' }),
}));

vi.mock('@/components/providers/auth-dialog-provider', () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));

vi.mock('@/components/ui/feedback-modal', () => ({
  useFeedback: () => ({
    alert: vi.fn(),
    confirm: vi.fn().mockResolvedValue(false),
  }),
}));

vi.mock('@/components/billing/plan-badge', () => ({
  PlanBadge: () => <span>Free</span>,
}));

vi.mock('@/components/brand/brand-mark', () => ({
  BrandLockup: () => <span>Vrompt</span>,
}));

import { WorkspaceShell } from '@/components/workspace/shell';

describe('workspace topbar identity', () => {
  it('shows the authenticated username beside the avatar', () => {
    render(
      <WorkspaceShell>
        <div>Workspace content</div>
      </WorkspaceShell>,
    );

    expect(screen.getByText('curibtech')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Account menu for curibtech' }),
    ).toBeVisible();
  });
});
