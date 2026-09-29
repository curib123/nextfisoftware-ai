import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { ThemeProvider } from '@/components/theme/theme-provider';
import { ThemeToggle } from '@/components/theme/theme-toggle';

describe('theme toggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      }),
    });
  });

  it('starts from the system theme and toggles to an explicit light theme', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await vi.waitFor(() =>
      expect(screen.getByRole('button')).toHaveAccessibleName(
        'Switch to light mode',
      ),
    );
    expect(document.documentElement).toHaveClass('dark');

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Switch to dark mode',
    );
    expect(document.documentElement).toHaveClass('light');
    expect(window.localStorage.getItem('nextfi-theme')).toBe('light');
  });

  it('tracks operating-system theme changes while system mode is active', async () => {
    let onChange: ((event: MediaQueryListEvent) => void) | undefined;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: (_event: string, listener: typeof onChange) => {
          onChange = listener;
        },
        matches: false,
        removeEventListener: vi.fn(),
      }),
    });

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await vi.waitFor(() =>
      expect(document.documentElement).toHaveClass('light'),
    );
    onChange?.({ matches: true } as MediaQueryListEvent);
    await vi.waitFor(() =>
      expect(document.documentElement).toHaveClass('dark'),
    );
    expect(window.localStorage.getItem('nextfi-theme')).toBeNull();
  });
});
