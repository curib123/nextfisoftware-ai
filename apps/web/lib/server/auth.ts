import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { authJson, rest, SupabaseHttpError, supabaseUrl } from './supabase';
import type { DbPlan } from './credits';

type SupabaseAuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

type Profile = {
  id: string;
  email: string;
  username: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  account_type: 'REAL' | 'STARTER' | 'OFFICIAL';
};

export type Authenticated = {
  token: string;
  auth: SupabaseAuthUser;
  profile: Profile;
};

export function bearer(request: Request) {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export async function requireUser(request: Request): Promise<Authenticated> {
  const token = bearer(request);
  if (!token) throw new SupabaseHttpError('Authentication required.', 401);
  const auth = await authJson<SupabaseAuthUser>('/user', {
    headers: { authorization: `Bearer ${token}` },
  }).catch((error) => {
    if (error instanceof SupabaseHttpError)
      throw new SupabaseHttpError('Your session has expired.', 401);
    throw error;
  });
  const profile = await ensureProfile(auth);
  if (profile.status !== 'ACTIVE')
    throw new SupabaseHttpError('This account is not active.', 403);
  return { token, auth, profile };
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (user.profile.role !== 'ADMIN')
    throw new SupabaseHttpError('Administrator access required.', 403);
  return user;
}

async function ensureProfile(auth: SupabaseAuthUser): Promise<Profile> {
  const existing = await rest<Profile[]>('profiles', {
    admin: true,
    query: `id=eq.${encodeURIComponent(auth.id)}&select=*`,
  });
  if (existing[0]) return existing[0];

  const email = auth.email ?? '';
  const base =
    email
      .split('@')[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24) || 'user';
  const rows = await rest<Profile[]>('profiles', {
    admin: true,
    method: 'POST',
    query: 'on_conflict=id',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      id: auth.id,
      email,
      username: `${base}-${auth.id.slice(0, 6)}`,
    },
  });
  if (!rows[0]) throw new Error('Unable to initialize user profile.');
  return rows[0];
}

export async function activePlan(userId: string): Promise<DbPlan> {
  const now = new Date().toISOString();
  const subscriptions = await rest<
    { plan_id: string; current_period_end: string }[]
  >('subscriptions', {
    admin: true,
    query:
      `user_id=eq.${encodeURIComponent(userId)}&status=eq.ACTIVE&current_period_end=gt.${encodeURIComponent(now)}&select=plan_id,current_period_end&order=current_period_end.desc&limit=1`,
  });
  const planId = subscriptions[0]?.plan_id;
  const plans = await rest<DbPlan[]>('billing_plans', {
    admin: true,
    query: planId
      ? `id=eq.${encodeURIComponent(planId)}&select=*`
      : 'code=eq.FREE&select=*',
  });
  if (!plans[0]) throw new Error('Billing plan configuration is missing.');
  return plans[0];
}

export async function publicUser(user: Authenticated) {
  const plan = await activePlan(user.profile.id);
  return {
    id: user.profile.id,
    email: user.profile.email,
    username: user.profile.username,
    role: user.profile.role,
    accountType: user.profile.account_type,
    plan: plan.code,
    onboardingCompleted: true,
  };
}

export function siteOrigin(request?: NextRequest | Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (request) return new URL(request.url).origin;
  return 'http://localhost:3000';
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/chat';
  try {
    const url = new URL(value, 'https://vrompt.invalid');
    return url.origin === 'https://vrompt.invalid'
      ? `${url.pathname}${url.search}${url.hash}`
      : '/chat';
  } catch {
    return '/chat';
  }
}

export function createPkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  return { verifier, challenge, state };
}

export function oauthAuthorizeUrl(
  provider: 'google' | 'github',
  challenge: string,
  state: string,
  request: Request,
) {
  const url = new URL(`${supabaseUrl()}/auth/v1/authorize`);
  url.searchParams.set('provider', provider);
  url.searchParams.set('redirect_to', `${siteOrigin(request)}/auth/callback`);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');
  url.searchParams.set('state', state);
  return url;
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: SupabaseAuthUser;
};

export async function exchangePkce(code: string, verifier: string) {
  return authJson<TokenResponse>('/token?grant_type=pkce', {
    method: 'POST',
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
}

export async function refreshSupabaseToken(refreshToken: string) {
  return authJson<TokenResponse>('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function passwordLogin(email: string, password: string) {
  return authJson<TokenResponse>('/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}
