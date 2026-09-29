'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

const themeStorageKey = 'nextfi-theme';
const legacyThemeStorageKey = 'vrompt-theme';

export type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = Exclude<Theme, 'system'>;

interface ThemeContextValue {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    let storedTheme = window.localStorage.getItem(themeStorageKey);
    if (storedTheme !== 'light' && storedTheme !== 'dark') {
      const legacyTheme = window.localStorage.getItem(legacyThemeStorageKey);
      if (legacyTheme === 'light' || legacyTheme === 'dark') {
        storedTheme = legacyTheme;
        window.localStorage.setItem(themeStorageKey, legacyTheme);
        window.localStorage.removeItem(legacyThemeStorageKey);
      }
    }
    const initialTheme: Theme =
      storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : 'system';

    const applyTheme = (nextTheme: Theme) => {
      const nextResolvedTheme: ResolvedTheme =
        nextTheme === 'system'
          ? mediaQuery.matches
            ? 'dark'
            : 'light'
          : nextTheme;

      document.documentElement.classList.toggle(
        'dark',
        nextResolvedTheme === 'dark',
      );
      document.documentElement.classList.toggle(
        'light',
        nextResolvedTheme === 'light',
      );
      document.documentElement.style.colorScheme = nextResolvedTheme;
      setResolvedTheme(nextResolvedTheme);
    };

    const initializationFrame = window.requestAnimationFrame(() => {
      setThemeState(initialTheme);
      applyTheme(initialTheme);
    });

    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      const currentTheme = window.localStorage.getItem(themeStorageKey);
      if (currentTheme !== 'light' && currentTheme !== 'dark') {
        const nextResolvedTheme: ResolvedTheme = event.matches
          ? 'dark'
          : 'light';
        document.documentElement.classList.toggle(
          'dark',
          nextResolvedTheme === 'dark',
        );
        document.documentElement.classList.toggle(
          'light',
          nextResolvedTheme === 'light',
        );
        document.documentElement.style.colorScheme = nextResolvedTheme;
        setResolvedTheme(nextResolvedTheme);
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => {
      window.cancelAnimationFrame(initializationFrame);
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolvedTheme,
      setTheme: (nextTheme) => {
        window.localStorage.setItem(themeStorageKey, nextTheme);
        setThemeState(nextTheme);
        const nextResolvedTheme: ResolvedTheme =
          nextTheme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : nextTheme;
        document.documentElement.classList.toggle(
          'dark',
          nextResolvedTheme === 'dark',
        );
        document.documentElement.classList.toggle(
          'light',
          nextResolvedTheme === 'light',
        );
        document.documentElement.style.colorScheme = nextResolvedTheme;
        setResolvedTheme(nextResolvedTheme);
      },
      theme,
      toggleTheme: () => {
        const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
        window.localStorage.setItem(themeStorageKey, nextTheme);
        setThemeState(nextTheme);
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
        document.documentElement.classList.toggle(
          'light',
          nextTheme === 'light',
        );
        document.documentElement.style.colorScheme = nextTheme;
        setResolvedTheme(nextTheme);
      },
    }),
    [resolvedTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
