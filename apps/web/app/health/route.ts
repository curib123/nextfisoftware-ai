import { rest } from '@/lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await rest('billing_plans', { admin: true, query: 'select=id&limit=1' });
    return Response.json(
      { status: 'ok' },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { status: 'degraded' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
