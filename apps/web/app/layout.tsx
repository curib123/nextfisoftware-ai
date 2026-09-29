import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/components/providers/app-providers';
import './globals.css';
import './workspace.css';
import './brand.css';
import './usability.css';

const themeInitScript = `
  (() => {
    try {
      const saved = localStorage.getItem('vrompt-theme');
      const dark = saved === 'dark' || (saved !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.add(dark ? 'dark' : 'light');
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    } catch {}
  })();
`;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001',
  ),
  title: {
    default: 'Nextfi Software — The right AI for every task.',
    template: '%s | Nextfi Software',
  },
  description:
    'One account. One subscription. Multiple AI models. Start with Auto or select a model yourself.',
  icons: { icon: '/vrompt-mark.svg' },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
