import type { NextRequest } from 'next/server';
import { SupabaseHttpError } from './supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

export async function bodyJson<T extends Record<string, unknown>>(
  request: Request,
): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new ApiError('Expected a JSON request.', 415);
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new ApiError('Invalid request body.');
  return data as T;
}

export function stringValue(
  value: unknown,
  name: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
) {
  if (options.optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string') throw new ApiError(\`\${name} must be text.\`);
  const text = value.trim();
  if (options.min !== undefined && text.length < options.min)
    throw new ApiError(\`\${name} is too short.\`);
  if (options.max !== undefined && text.length > options.max)
    throw new ApiError(\`\${name} is too long.\`);
  return text;
}

export function integerValue(
  value: unknown,
  name: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new ApiError(\`\${name} is invalid.\`);
  return number;
}

export function uuid(value: unknown, name = 'ID') {
  const text = stringValue(value, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text))
    throw new ApiError(\`\${name} is invalid.\`);
  return text;
}

export function routeId(value: string | undefined, name = 'ID') {
  return uuid(value ?? '', name);
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return json({ message: error.message }, error.status);
  if (error instanceof SupabaseHttpError) {
    const status =
      error.status === 401 ? 401 :
      error.status === 403 ? 403 :
      error.status === 404 ? 404 :
      error.status === 409 ? 409 :
      error.status === 429 ? 429 : 502;
    return json(
      { message: status >= 500 ? 'A data service request failed. Please retry.' : error.message },
      status,
    );
  }
  console.error('Vrompt route error', error);
  return json({ message: 'Something went wrong. Please retry.' }, 500);
}

export function query(request: NextRequest | Request) {
  return new URL(request.url).searchParams;
}
