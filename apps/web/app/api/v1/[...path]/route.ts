import type { NextRequest } from 'next/server';
import { handleApi } from '@/lib/server/api-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function dispatch(request: NextRequest, context: Context) {
  const { path } = await context.params;
  return handleApi(request, path ?? []);
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const PUT = dispatch;
