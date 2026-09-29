const oauthReturnStorageKey = 'nextfi-oauth-return-to';
const legacyOAuthReturnStorageKey = 'vrompt-oauth-return-to';
const safeLocalOrigin = 'https://nextfi.local';

export function sanitizeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const parsed = new URL(value, safeLocalOrigin);
    if (parsed.origin !== safeLocalOrigin) return null;
    if (parsed.pathname.startsWith('/auth') || parsed.pathname === '/login') {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function rememberOAuthReturnPath(value: string | null | undefined) {
  const path = sanitizeReturnPath(value);
  if (path && typeof window !== 'undefined') {
    window.sessionStorage.setItem(oauthReturnStorageKey, path);
    window.sessionStorage.removeItem(legacyOAuthReturnStorageKey);
  }
  return path;
}

export function getOAuthReturnPath() {
  if (typeof window === 'undefined') return null;
  const path =
    window.sessionStorage.getItem(oauthReturnStorageKey) ??
    window.sessionStorage.getItem(legacyOAuthReturnStorageKey);
  return sanitizeReturnPath(path);
}

export function consumeOAuthReturnPath() {
  const path = getOAuthReturnPath();
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(oauthReturnStorageKey);
    window.sessionStorage.removeItem(legacyOAuthReturnStorageKey);
  }
  return path;
}
