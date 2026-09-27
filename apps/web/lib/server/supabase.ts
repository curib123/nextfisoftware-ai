import 'server-only';

export class SupabaseHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function supabaseUrl() {
  return required('SUPABASE_URL').replace(/\/$/, '');
}

export function publishableKey() {
  return required('SUPABASE_PUBLISHABLE_KEY');
}

export function secretKey() {
  return required('SUPABASE_SECRET_KEY');
}

type SupabaseRequestInit = RequestInit & {
  admin?: boolean;
  token?: string;
};

export async function supabaseFetch(
  path: string,
  init: SupabaseRequestInit = {},
): Promise<Response> {
  const { admin = false, token, ...requestInit } = init;
  const key = admin ? secretKey() : publishableKey();
  const headers = new Headers(requestInit.headers);
  headers.set('apikey', key);
  if (token) headers.set('authorization', `Bearer ${token}`);
  else if (admin) headers.set('authorization', `Bearer ${key}`);
  const response = await fetch(`${supabaseUrl()}${path}`, {
    ...requestInit,
    headers,
    cache: 'no-store',
  });
  return response;
}

async function parseError(response: Response) {
  const payload = await response.json().catch(async () => ({
    message: await response.text().catch(() => response.statusText),
  }));
  const record = payload as Record<string, unknown>;
  const message = String(
    record?.message ?? record?.msg ?? record?.error_description ?? record?.error ?? response.statusText,
  );
  return new SupabaseHttpError(message, response.status, payload);
}

export async function jsonRequest<T>(
  path: string,
  init: SupabaseRequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  const response = await supabaseFetch(path, { ...init, headers });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type RestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: string;
  body?: unknown;
  token?: string;
  admin?: boolean;
  prefer?: string;
  headers?: HeadersInit;
};

export async function rest<T>(table: string, options: RestOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.prefer) headers.set('prefer', options.prefer);
  return jsonRequest<T>(
    `/rest/v1/${table}${options.query ? `?${options.query}` : ''}`,
    {
      method: options.method ?? 'GET',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      token: options.token,
      admin: options.admin,
      headers,
    },
  );
}

export async function rpc<T>(
  name: string,
  body: Record<string, unknown>,
  admin = true,
) {
  return jsonRequest<T>(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
    admin,
  });
}

export async function authJson<T>(
  path: string,
  init: Omit<SupabaseRequestInit, 'admin'> = {},
) {
  return jsonRequest<T>(`/auth/v1${path}`, init);
}

export async function authAdminJson<T>(
  path: string,
  init: RequestInit = {},
) {
  return jsonRequest<T>(`/auth/v1/admin${path}`, { ...init, admin: true });
}

export async function storageUpload(
  path: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const response = await supabaseFetch(
    `/storage/v1/object/vrompt-private/${encodeStoragePath(path)}`,
    {
      method: 'POST',
      admin: true,
      body: bytes,
      headers: {
        'content-type': contentType,
        'x-upsert': 'false',
      },
    },
  );
  if (!response.ok) throw await parseError(response);
  return response.json().catch(() => ({}));
}

export async function storageDownload(path: string) {
  const response = await supabaseFetch(
    `/storage/v1/object/vrompt-private/${encodeStoragePath(path)}`,
    { admin: true },
  );
  if (!response.ok) throw await parseError(response);
  return response;
}

export async function storageDelete(path: string) {
  const response = await supabaseFetch(
    `/storage/v1/object/vrompt-private/${encodeStoragePath(path)}`,
    { method: 'DELETE', admin: true },
  );
  if (!response.ok && response.status !== 404) throw await parseError(response);
}

function encodeStoragePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function eq(value: string) {
  return encodeURIComponent(`eq.${value}`);
}

export function contains(value: string) {
  return encodeURIComponent(`*${value.replaceAll('*', '')}*`);
}
