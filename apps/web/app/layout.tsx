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
      const nextfiKey = 'nextfi-theme';
      const legacyKey = 'vrompt-theme';
      let saved = localStorage.getItem(nextfiKey);
      if (!saved) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy === 'light' || legacy === 'dark') {
          saved = legacy;
          localStorage.setItem(nextfiKey, legacy);
          localStorage.removeItem(legacyKey);
        }
      }
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
    default: 'Nextfi Software — Multiple AI models in one workspace',
    template: '%s | Nextfi Software',
  },
  description:
    'Use multiple AI models in one private workspace. Let Auto route to a healthy model, choose one yourself, or connect your own provider API keys.',
  applicationName: 'Nextfi Software',
  keywords: [
    'AI workspace',
    'multi-model AI',
    'AI model router',
    'NVIDIA AI',
    'Mistral AI',
    'OpenAI',
    'Anthropic',
    'Google AI',
  ],
  openGraph: {
    title: 'Nextfi Software — Multiple AI models in one workspace',
    description:
      'One focused workspace for multiple AI models, smart Auto routing, and bring-your-own provider keys.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Nextfi Software',
    description:
      'Multiple AI models, smart routing, and BYO provider keys in one workspace.',
  },
  icons: { icon: '/nextfi-mark.svg' },
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
