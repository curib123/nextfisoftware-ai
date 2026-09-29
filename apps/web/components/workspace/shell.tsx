'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandLockup } from '@/components/brand/brand-mark';
import { useAuth } from '@/components/providers/auth-provider';
import { useTheme } from '@/components/theme/theme-provider';
import { Icon, type IconName } from '@/components/ui/icon';
import { useSiteSettings } from '@/components/providers/site-settings-provider';
import { SignInButton } from '@/components/providers/auth-dialog-provider';
import { useFeedback } from '@/components/ui/feedback-modal';
import { PlanBadge } from '@/components/billing/plan-badge';
const navigationIcons: Record<string, IconName> = {
  '/chat': 'chat',
  '/conversations': 'history',
  '/projects': 'folder',
  '/saved-prompts': 'library',
  '/workflows': 'workflow',
  '/usage': 'chart',
  '/billing': 'card',
  '/settings': 'settings',
  '/admin': 'grid',
  '/admin/models': 'cube',
  '/admin/plans': 'library',
  '/admin/analytics': 'chart',
  '/admin/users': 'users',
  '/admin/billing': 'card',
  '/admin/audit': 'shield',
  '/admin/settings': 'settings',
  '/models': 'cube',
};
export const workspaceLinks = [
  ['/chat', 'New Chat'],
  ['/conversations', 'Conversations'],
  ['/projects', 'Projects'],
  ['/saved-prompts', 'Saved Prompts'],
  ['/workflows', 'Workflows'],
  ['/usage', 'Usage'],
  ['/billing', 'Billing'],
  ['/settings', 'Settings'],
] as const;
export function WorkspaceShell({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, isLoading, logout } = useAuth();
  const { alert, confirm } = useFeedback();
  const { toggleTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { announcement } = useSiteSettings();
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLElement>('a')?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const targets = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>('a,button') ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (!targets?.length) return;
      const first = targets[0],
        last = targets[targets.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keydown);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [open]);
  if (isLoading)
    return <main className="center-page">Opening your workspace…</main>;
  if (!user)
    return (
      <main className="center-page">
        <h1>
          {admin ? 'Sign in to administration' : 'Your AI workspace awaits.'}
        </h1>
        <p>
          {admin
            ? 'Use your administrator account to manage Nextfi Software.'
            : 'Sign in to keep your conversations private and synced.'}
        </p>
        {admin ? (
          <Link className="primary-button" href="/staff/login">
            Administrator sign in
          </Link>
        ) : (
          <SignInButton className="primary-button">Sign in</SignInButton>
        )}
        <Link href="/">Back to home</Link>
      </main>
    );
  if (admin && user?.role !== 'ADMIN')
    return (
      <main className="center-page">
        <h1>Administrator access required.</h1>
        <p>Use your workspace to continue.</p>
        <Link className="primary-button" href="/chat">
          Back to chat
        </Link>
      </main>
    );
  if (!admin && user && user.role !== 'USER')
    return (
      <main className="center-page">
        <Link href="/admin">Open administration</Link>
      </main>
    );
  const links = admin
    ? [
        ['/admin', 'Overview'],
        ['/admin/models', 'Models & routing'],
        ['/admin/plans', 'Plans & allowances'],
        ['/admin/analytics', 'Costs & revenue'],
        ['/admin/users', 'Users'],
        ['/admin/billing', 'Billing'],
        ['/admin/audit', 'Audit history'],
        ['/admin/settings', 'Settings'],
      ]
    : workspaceLinks;
  const accountName =
    user.username.trim() || user.email.split('@')[0]?.trim() || 'Account';
  const accountParts = accountName.split(/\s+/).filter(Boolean);
  const accountInitials =
    (accountParts.length > 1
      ? accountParts
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
      : accountName.slice(0, 2)
    ).toUpperCase() || 'AC';

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`workspace-sidebar ${open ? 'is-open' : ''}`}
      >
        <Link aria-label="Nextfi Software home" className="workspace-brand" href="/">
          <BrandLockup compact />
        </Link>
        <nav aria-label={admin ? 'Administration' : 'Workspace'}>
          {links.map(([href, label], index) => (
            <div key={href}>
              {(index === 0 || index === (admin ? 4 : 5)) && (
                <p className="navigation-group-label">
                  {index === 0
                    ? admin
                      ? 'Manage workspace'
                      : 'Create & organize'
                    : admin
                      ? 'Operations'
                      : 'Your account'}
                </p>
              )}
              <Link
                key={href}
                href={href as Route}
                onClick={(event) => {
                  setOpen(false);
                  if (
                    href === '/chat' &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    router.push(`/chat?new=${crypto.randomUUID()}`);
                  }
                }}
                aria-current={
                  pathname === href ||
                  (href !== '/admin' && pathname.startsWith(href + '/'))
                    ? 'page'
                    : undefined
                }
              >
                <Icon name={navigationIcons[href] ?? 'grid'} />
                {label}
              </Link>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-plan">
            <span>{admin ? 'Access' : 'Your plan'}</span>
            <PlanBadge />
          </div>
          <Link href="/docs">
            <Icon name="help" /> Help & getting started
          </Link>
        </div>
      </aside>
      <div
        id="account-actions"
        popover="auto"
        className="account-menu"
        onClick={(event) => event.currentTarget.hidePopover()}
      >
        <div className="account-menu-profile">
          <span className="account-avatar" aria-hidden="true">
            {accountInitials}
          </span>
          <span>
            <strong>{accountName}</strong>
            <small>{user.email}</small>
          </span>
        </div>
        <Link href={admin ? '/admin/settings' : '/settings'}>
          <Icon name="settings" /> Account settings
        </Link>
        <button onClick={toggleTheme}>
          <Icon name="sun" /> Change theme
        </button>
        {user && (
          <button
            onClick={async () => {
              const accepted = await confirm({
                title: 'Sign out?',
                message:
                  'Your saved workspace stays private and will be available when you sign in again.',
                confirmLabel: 'Sign out',
              });
              if (!accepted) return;
              try {
                await logout();
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Unable to sign out. Please retry.';
                alert({
                  tone: 'error',
                  title: 'Could not sign out',
                  message,
                });
              }
            }}
          >
            <Icon name="logout" /> Sign out
          </button>
        )}
      </div>

      <main className="workspace-main" id="workspace-content" tabIndex={-1}>
        <header className="workspace-topbar">
          <button
            className="workspace-menu-toggle"
            ref={menuButton}
            aria-controls="workspace-navigation"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name="menu" />
          </button>
          <div className="workspace-topbar-title">
            <span className="eyebrow">
              {admin ? 'Administration' : 'Workspace'}
            </span>
            <strong>
              {pathname === '/chat'
                ? 'Chat'
                : (links.find(
                    ([href]) =>
                      pathname === href ||
                      (href !== '/admin' && pathname.startsWith(href + '/')),
                  )?.[1] ?? 'Workspace')}
            </strong>
          </div>
          <div className="workspace-topbar-actions">
            <PlanBadge />
            <button
              className="workspace-topbar-avatar"
              popoverTarget="account-actions"
              aria-label={`Account menu for ${accountName}`}
              title={`${accountName} · ${user.email}`}
              type="button"
            >
              <span className="account-avatar" aria-hidden="true">
                {accountInitials}
              </span>
              <span className="workspace-topbar-identity">
                <span className="workspace-topbar-user">{accountName}</span>
                <small>{user.email}</small>
              </span>
              <Icon
                name="chevronDown"
                className="workspace-topbar-account-chevron"
              />
            </button>
          </div>
        </header>
        {announcement && (
          <div className="site-announcement">{announcement}</div>
        )}
        {children}
      </main>
    </div>
  );
}
