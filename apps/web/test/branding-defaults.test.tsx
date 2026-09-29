import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn().mockRejectedValue(new Error('offline')),
}));

import {
  SiteSettingsProvider,
  useSiteSettings,
} from '@/components/providers/site-settings-provider';

function BrandDefaults() {
  const { siteName } = useSiteSettings();
  return <span>{siteName}</span>;
}

describe('branding defaults', () => {
  it('uses the Nextfi Software product name when public settings are unavailable', () => {
    render(
      <SiteSettingsProvider>
        <BrandDefaults />
      </SiteSettingsProvider>,
    );

    expect(screen.getByText('Nextfi Software')).toBeVisible();
  });
});
