import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from './brand-mark';
import { ThemeToggle } from '@/components/theme/theme-toggle';
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="brand-home">
      <header className="brand-nav">
        <Link href="/" aria-label="Home">
          <BrandLockup compact />
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/#why-nextfi">Features</Link>
          <Link href="/#models">Models</Link>
          <Link href="/#pricing">Pricing</Link>
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <Link className="primary-button" href="/chat">
            Open workspace
          </Link>
        </div>
      </header>
      <main className="content-page">{children}</main>
      <footer className="brand-footer">
        <BrandLockup compact />
        <nav aria-label="Footer">
          <Link href="/docs">Help</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
