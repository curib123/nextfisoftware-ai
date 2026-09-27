import type { NextRequest } from 'next/server';
import { oauthCallback } from '@/lib/server/api-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  return oauthCallback(request);
}
