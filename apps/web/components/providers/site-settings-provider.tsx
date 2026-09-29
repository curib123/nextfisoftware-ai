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
  return {
    settings,
    refresh,
    siteName: String(settings['branding.siteName'] || 'Nextfi Software'),
    tagline: String(
      settings['branding.tagline'] || 'Multiple AIs. A smarter you.',
    ),
    announcement: String(settings['content.announcement'] || ''),
  };
}
