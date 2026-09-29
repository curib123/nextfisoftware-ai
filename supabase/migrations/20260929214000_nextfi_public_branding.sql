-- Complete the Vrompt -> Nextfi Software public-brand migration without
-- changing stable internal identifiers such as storage bucket names or enum values.

update public.site_settings
set value = '"Nextfi Software"'::jsonb
where key = 'branding.siteName'
  and value = '"Vrompt"'::jsonb;

update public.site_settings
set value = '"Multiple AI models. One smarter workspace."'::jsonb
where key = 'branding.tagline'
  and value in (
    '"One workspace. The right AI for every task."'::jsonb,
    '"Multiple AIs. A smarter you."'::jsonb
  );
