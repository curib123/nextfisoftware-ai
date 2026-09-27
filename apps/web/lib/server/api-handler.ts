import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  createPkce,
  exchangePkce,
  isOAuthCallbackStateValid,
  oauthAuthorizeUrl,
  passwordLogin,
  publicUser,
  refreshSupabaseToken,
  requireAdmin,
  requireUser,
  safeReturnPath,
  siteOrigin,
} from './auth';
import { handleAdmin, publicSettings } from './admin';
import {
  billingSummary,
  createCheckout,
  handlePayMongoWebhook,
  paymentStatus,
  publicPlans,
} from './billing';
import { ApiError, bodyJson, errorResponse, json, routeId, stringValue } from './http';
import {
  catalogModels,
  conversationsRoute,
  fileRoute,
  preferences,
  projectsRoute,
  promptsRoute,
  streamMessage,
  uploadFile,
  workflowsRoute,
  workspaceModels,
  workspaceUsage,
} from './workspace';
import { providerConnectionsRoute } from './provider-credentials';
import { authAdminJson, authJson, rest } from './supabase';

const REFRESH_COOKIE = 'vrompt_refresh';
const PKCE_COOKIE = 'vrompt_pkce';
const STATE_COOKIE = 'vrompt_oauth_state';
const RETURN_COOKIE = 'vrompt_oauth_return';

function secureCookies() {
  return process.env.NODE_ENV === 'production';
}

function refreshCookie(value: string) {
  return {
    name: REFRESH_COOKIE,
    value,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax' as const,
    path: '/api/v1/auth',
    maxAge: 60 * 60 * 24 * 30,
  };
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== siteOrigin(request))
    throw new ApiError('Cross-origin request rejected.', 403);
}

export async function handleApi(request: NextRequest, path: string[]) {
  try {
    const [root, second, third, fourth] = path;

    if (root === 'webhooks' && second === 'paymongo' && request.method === 'POST')
      return json(await handlePayMongoWebhook(request));

    if (root === 'auth') {
      if ((second === 'google' || second === 'github') && request.method === 'GET')
        return beginOauth(request, second);
      if (second === 'refresh' && request.method === 'POST') {
        assertSameOrigin(request);
        return refreshSession(request);
      }
      if (second === 'logout' && request.method === 'POST') {
        assertSameOrigin(request);
        return logoutSession(request);
      }
      if (second === 'staff' && third === 'login' && request.method === 'POST') {
        assertSameOrigin(request);
        return staffLogin(request);
      }
      if (second === 'staff' && third === 'password' && request.method === 'POST') {
        assertSameOrigin(request);
        return staffPassword(request);
      }
      throw new ApiError('Authentication route not found.', 404);
    }

    if (root === 'health' && request.method === 'GET') {
      await rest('billing_plans', { admin: true, query: 'select=id&limit=1' });
      return json({ status: 'ok' });
    }

    if (root === 'settings' && second === 'public' && request.method === 'GET')
      return json(await publicSettings());

    if (root === 'catalog' && second === 'models' && request.method === 'GET')
      return json(await catalogModels());

    if (root === 'billing' && second === 'plans' && request.method === 'GET')
      return json(await publicPlans());

    if (root === 'billing') {
      const user = await requireUser(request);
      if (second === 'me' && request.method === 'GET')
        return json(await billingSummary(user));
      if (second === 'checkout' && request.method === 'POST') {
        assertSameOrigin(request);
        return json(await createCheckout(request, user), 201);
      }
      if (second === 'payments' && third && request.method === 'GET')
        return json(await paymentStatus(user, routeId(third, 'Payment ID')));
      throw new ApiError('Billing route not found.', 404);
    }

    if (root === 'workspace') {
      const user = await requireUser(request);
      if (second === 'models' && request.method === 'GET')
        return json(await workspaceModels(user));
      if (second === 'provider-connections') {
        if (request.method !== 'GET') assertSameOrigin(request);
        return json(await providerConnectionsRoute(request, user, third));
      }
      if (second === 'usage' && request.method === 'GET')
        return json(await workspaceUsage(user));
      if (second === 'preferences')
        return json(await preferences(request, user));
      if (second === 'projects')
        return json(await projectsRoute(request, user, third));
      if (second === 'saved-prompts')
        return json(await promptsRoute(request, user, third));
      if (second === 'workflows')
        return json(await workflowsRoute(request, user, third, fourth));
      if (second === 'files' && third)
        return fileRoute(request, user, third);
      if (second === 'conversations') {
        if (third && fourth === 'messages' && request.method === 'POST')
          return streamMessage(request, user, third);
        if (third && fourth === 'files' && request.method === 'POST')
          return json(await uploadFile(request, user, third), 201);
        return json(await conversationsRoute(request, user, third));
      }
      throw new ApiError('Workspace route not found.', 404);
    }

    if (root === 'admin') {
      const admin = await requireAdmin(request);
      return json(await handleAdmin(request, admin, path.slice(1)));
    }

    throw new ApiError('API route not found.', 404);
  } catch (error) {
    return errorResponse(error);
  }
}

function beginOauth(request: NextRequest, provider: 'google' | 'github') {
  const { verifier, challenge, state } = createPkce();
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get('returnTo'));
  const response = NextResponse.redirect(
    oauthAuthorizeUrl(provider, challenge, state, request),
    302,
  );
  const common = {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax' as const,
    path: '/auth/callback',
    maxAge: 10 * 60,
  };
  response.cookies.set(PKCE_COOKIE, verifier, common);
  response.cookies.set(STATE_COOKIE, state, common);
  response.cookies.set(RETURN_COOKIE, returnTo, common);
  return response;
}

async function refreshSession(request: NextRequest) {
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) return json({ message: 'No active session.' }, 401);
  try {
    const tokens = await refreshSupabaseToken(refresh);
    const synthetic = new Request(request.url, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await requireUser(synthetic);
    const response = json({
      accessToken: tokens.access_token,
      user: await publicUser(user),
    });
    const next = new NextResponse(response.body, response);
    next.cookies.set(refreshCookie(tokens.refresh_token));
    return next;
  } catch {
    const response = json({ message: 'Your session has expired.' }, 401);
    const next = new NextResponse(response.body, response);
    next.cookies.set({
      name: REFRESH_COOKIE,
      value: '',
      path: '/api/v1/auth',
      maxAge: 0,
    });
    return next;
  }
}

async function logoutSession(request: NextRequest) {
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refresh) {
    try {
      const tokens = await refreshSupabaseToken(refresh);
      await authJson('/logout?scope=global', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
    } catch {
      // Clearing the local refresh cookie is still required.
    }
  }
  const response = json({ signedOut: true });
  const next = new NextResponse(response.body, response);
  next.cookies.set({
    name: REFRESH_COOKIE,
    value: '',
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 0,
  });
  return next;
}

async function staffLogin(request: NextRequest) {
  const input = await bodyJson<Record<string, unknown>>(request);
  const email = stringValue(input.email, 'Email', { min: 3, max: 320 }).toLowerCase();
  const password = stringValue(input.password, 'Password', { min: 1, max: 128 });
  const tokens = await passwordLogin(email, password);
  const synthetic = new Request(request.url, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const admin = await requireAdmin(synthetic);
  const response = json({
    accessToken: tokens.access_token,
    user: await publicUser(admin),
  });
  const next = new NextResponse(response.body, response);
  next.cookies.set(refreshCookie(tokens.refresh_token));
  return next;
}

async function staffPassword(request: NextRequest) {
  const admin = await requireAdmin(request);
  const input = await bodyJson<Record<string, unknown>>(request);
  const currentPassword = stringValue(input.currentPassword, 'Current password', {
    min: 1,
    max: 128,
  });
  const newPassword = stringValue(input.newPassword, 'New password', {
    min: 12,
    max: 128,
  });
  const verified = await passwordLogin(admin.profile.email, currentPassword);
  if (verified.user.id !== admin.profile.id)
    throw new ApiError('Current password is incorrect.', 403);

  await authAdminJson(`/users/${encodeURIComponent(admin.profile.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: newPassword }),
  });
  await authJson('/logout?scope=global', {
    method: 'POST',
    headers: { authorization: `Bearer ${verified.access_token}` },
  }).catch(() => {});
  const response = json({ changed: true });
  const next = new NextResponse(response.body, response);
  next.cookies.set({
    name: REFRESH_COOKIE,
    value: '',
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 0,
  });
  return next;
}

export async function oauthCallback(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const expectedState = request.cookies.get(STATE_COOKIE)?.value ?? '';
  const verifier = request.cookies.get(PKCE_COOKIE)?.value ?? '';
  const returnTo = safeReturnPath(request.cookies.get(RETURN_COOKIE)?.value);

  const fail = (message: string) => {
    const target = new URL('/?authError=' + encodeURIComponent(message), siteOrigin(request));
    const response = NextResponse.redirect(target, 302);
    clearOauthCookies(response);
    return response;
  };
  if (!code || !verifier || !isOAuthCallbackStateValid(state, expectedState))
    return fail('Sign-in could not be verified.');

  try {
    const tokens = await exchangePkce(code, verifier);
    // Force profile initialization and status check before persisting refresh access.
    await requireUser(
      new Request(request.url, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    );
    const response = NextResponse.redirect(
      new URL(returnTo, siteOrigin(request)),
      302,
    );
    response.cookies.set(refreshCookie(tokens.refresh_token));
    clearOauthCookies(response);
    return response;
  } catch {
    return fail('Sign-in could not be completed.');
  }
}

function clearOauthCookies(response: NextResponse) {
  for (const name of [PKCE_COOKIE, STATE_COOKIE, RETURN_COOKIE])
    response.cookies.set({
      name,
      value: '',
      path: '/auth/callback',
      maxAge: 0,
    });
}
