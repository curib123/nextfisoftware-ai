'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest } from '@/lib/api';
type PublicSettings = Record<string, string | boolean | number>;
const SiteSettingsContext = createContext({
  settings: {} as PublicSettings,
  refresh: async () => {},
});
export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings>({});
  const refresh = useCallback(async () => {
    setSettings(await apiRequest<PublicSettings>('/settings/public'));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<PublicSettings>('/settings/public', {
      signal: controller.signal,
    })
      .then(setSettings)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <SiteSettingsContext.Provider value={{ settings, refresh }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}
export function useSiteSettings() {
  const { settings, refresh } = useContext(SiteSettingsContext);
  const configuredSiteName = String(
    settings['branding.siteName'] || 'Nextfi Software',
  );
  const siteName =
    configuredSiteName.trim().toLowerCase() === 'vrompt'
      ? 'Nextfi Software'
      : configuredSiteName;

  return {
    settings,
    refresh,
    siteName,
    tagline: String(
      settings['branding.tagline'] ||
        'Multiple AI models. One smarter workspace.',
    ),
    announcement: String(settings['content.announcement'] || ''),
  };
}
