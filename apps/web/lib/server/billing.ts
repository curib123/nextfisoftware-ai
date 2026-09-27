import 'server-only';

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Authenticated } from './auth';
import { siteOrigin } from './auth';
import type { DbPlan, DbPolicy } from './credits';
import { ApiError, bodyJson } from './http';
import { rest } from './supabase';

type SubscriptionRow = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  provider: string;
  current_period_start: string;
  current_period_end: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};
type PaymentRow = {
  id: string;
  user_id: string;
  subscription_id: string | null;
  plan_id: string | null;
  discount_code_id: string | null;
  provider: string;
  status: string;
  amount: number;
  original_amount: number;
  discount_amount: number;
  currency: string;
  idempotency_key: string;
  external_checkout_session_id: string | null;
  external_payment_id: string | null;
  failure_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  paid_at: string | null;
};
type DiscountRow = {
  id: string;
  code: string;
  name: string;
  kind: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number;
  max_discount_amount: number | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  max_redemptions: number | null;
  max_redemptions_per_user: number;
  redemption_count: number;
};

type PayMongoResourceAttributes = Record<string, unknown> & {
  reference_number?: string;
  metadata?: { reference_number?: string };
  payments?: Array<{
    id?: string;
    attributes?: { status?: string; amount?: number; currency?: string };
  }>;
  livemode?: boolean;
};
type PayMongoEvent = {
  data?: {
    id?: string;
    attributes?: {
      type?: string;
      livemode?: boolean;
      data?: {
        id?: string;
        attributes?: PayMongoResourceAttributes;
      };
    };
  };
};
type PayMongoCheckoutResponse = {
  data?: { id?: string; attributes?: { checkout_url?: string } };
};

export function paymentMode() {
  return process.env.PAYMONGO_MODE?.trim() === 'live' ? 'live' : 'test';
}

export function checkoutConfigured() {
  const key = process.env.PAYMONGO_SECRET_KEY?.trim() ?? '';
  const expected = paymentMode() === 'live' ? 'sk_live_' : 'sk_test_';
  return key.startsWith(expected) && Boolean(process.env.PAYMONGO_WEBHOOK_SECRET?.trim());
}

function periodLabel(plan: DbPlan) {
  if (plan.billing_interval === 'ONE_TIME') return 'one-time payment';
  const count = plan.interval_count || 1;
  return count === 1
    ? `per ${plan.billing_interval.toLowerCase()}`
    : `every ${count} ${plan.billing_interval.toLowerCase()}s`;
}

function periodDays(plan: DbPlan) {
  const unit =
    plan.billing_interval === 'DAY'
      ? 1
      : plan.billing_interval === 'WEEK'
        ? 7
        : plan.billing_interval === 'YEAR'
          ? 365
          : 30;
  return unit * Math.max(1, plan.interval_count);
}

export async function publicPlans() {
  const [plans, policies] = await Promise.all([
    rest<DbPlan[]>('billing_plans', {
      query: 'is_active=eq.true&select=*&order=display_order.asc',
    }),
    rest<DbPolicy[]>('generation_policies', {
      admin: true,
      query: 'enabled=eq.true&select=*',
    }),
  ]);
  return {
    currency: plans[0]?.currency ?? 'USD',
    checkoutAvailable: checkoutConfigured(),
    paymentMode: paymentMode(),
    plans: plans.map((plan) => {
      const allowed = policies.filter((policy) => policy.plan_id === plan.id);
      return {
        id: plan.code,
        name: plan.name,
        description: plan.description,
        originalPrice: plan.original_price,
        priceCentavos: plan.original_price,
        currency: plan.currency,
        billingInterval: plan.billing_interval,
        billingPeriod: periodLabel(plan),
        monthlyCredits: plan.monthly_credits,
        maxProjects: plan.max_projects,
        maxWorkflows: plan.max_workflows,
        maxFiles: Math.max(0, ...allowed.map((policy) => policy.max_files)),
        imageGeneration: allowed.some((policy) => policy.allowed_features.includes('image_generation')),
        manualModelCount: allowed.filter((policy) => policy.model_id).length,
        allowances: allowed.map((policy) => ({
          bucket: policy.bucket === 'AUTO' ? 'Auto' : 'Manual model',
          dailyLimit: policy.daily_limit,
          monthlyLimit: policy.monthly_limit,
        })),
        features: [],
      };
    }),
  };
}

export async function billingSummary(user: Authenticated) {
  await expireSubscriptions(user.profile.id);
  const subscriptions = await rest<SubscriptionRow[]>('subscriptions', {
    admin: true,
    query: `user_id=eq.${encodeURIComponent(user.profile.id)}&select=*&order=created_at.desc&limit=1`,
  });
  const payments = await rest<PaymentRow[]>('payments', {
    admin: true,
    query: `user_id=eq.${encodeURIComponent(user.profile.id)}&select=*&order=created_at.desc&limit=1`,
  });
  const subscription = subscriptions[0];
  const active =
    subscription?.status === 'ACTIVE' &&
    new Date(subscription.current_period_end).getTime() > Date.now();
  let plan: DbPlan | undefined;
  if (active) {
    const rows = await rest<DbPlan[]>('billing_plans', {
      admin: true,
      query: `id=eq.${encodeURIComponent(subscription.plan_id)}&select=*`,
    });
    plan = rows[0];
  }
  return {
    plan: plan?.code ?? 'FREE',
    planCode: plan?.code ?? 'FREE',
    planName: plan?.name ?? 'Free',
    subscription: subscription
      ? {
          id: subscription.id,
          status: active ? subscription.status : subscription.status === 'ACTIVE' ? 'EXPIRED' : subscription.status,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
        }
      : null,
    latestPayment: payments[0]
      ? {
          id: payments[0].id,
          status: payments[0].status,
          amount: payments[0].amount,
          currency: payments[0].currency,
          createdAt: payments[0].created_at,
        }
      : null,
  };
}

export async function paymentStatus(user: Authenticated, id: string) {
  await expirePendingPayment(user.profile.id, id);
  const rows = await rest<PaymentRow[]>('payments', {
    admin: true,
    query: `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.profile.id)}&select=*`,
  });
  if (!rows[0]) throw new ApiError('Payment not found.', 404);
  return {
    id: rows[0].id,
    status: rows[0].status,
    failureCode: rows[0].status === 'FAILED' ? rows[0].failure_code : null,
  };
}

export async function createCheckout(request: Request, user: Authenticated) {
  if (!checkoutConfigured())
    throw new ApiError('Paid checkout is temporarily unavailable.', 503);
  await expireSubscriptions(user.profile.id);

  const input = await bodyJson<Record<string, unknown>>(request);
  const planCode = typeof input.planCode === 'string' ? input.planCode.trim().toUpperCase() : 'PRO';
  const plans = await rest<DbPlan[]>('billing_plans', {
    admin: true,
    query: `code=eq.${encodeURIComponent(planCode)}&is_active=eq.true&select=*`,
  });
  const plan = plans[0];
  if (!plan || plan.original_price <= 0 || plan.code === 'FREE')
    throw new ApiError('This paid plan is not available.', 409);

  const active = await rest<SubscriptionRow[]>('subscriptions', {
    admin: true,
    query:
      `user_id=eq.${encodeURIComponent(user.profile.id)}&status=eq.ACTIVE&current_period_end=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`,
  });
  if (active[0])
    throw new ApiError('A paid plan is already active. Choose another plan after it ends.', 409);

  const rawKey = request.headers.get('idempotency-key')?.trim() ?? '';
  const idempotencyKey =
    rawKey && rawKey.length <= 255 && /^[A-Za-z0-9._:-]+$/.test(rawKey)
      ? rawKey
      : `vrompt-${randomUUID()}`;
  const existing = await rest<PaymentRow[]>('payments', {
    admin: true,
    query: `idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*`,
  });
  if (existing[0]) {
    if (existing[0].user_id !== user.profile.id)
      throw new ApiError('Checkout request is not available.', 403);
    const url = String(existing[0].metadata?.checkoutUrl ?? '');
    if (url) return { paymentId: existing[0].id, status: existing[0].status, checkoutUrl: url };
    throw new ApiError('This checkout request is already processing.', 409);
  }

  const checkoutLimit = Math.max(
    1,
    Math.min(20, Number(process.env.PAYMONGO_CHECKOUT_RATE_LIMIT_PER_HOUR ?? 5) || 5),
  );
  const recentAttempts = await rest<{ id: string }[]>('payments', {
    admin: true,
    query:
      `user_id=eq.${encodeURIComponent(user.profile.id)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}&select=id`,
  });
  if (recentAttempts.length >= checkoutLimit)
    throw new ApiError('Too many checkout attempts. Please try again later.', 429);

  const discount = await resolveDiscount(
    user.profile.id,
    typeof input.discountCode === 'string' ? input.discountCode : '',
    plan.original_price,
  );
  const finalAmount = plan.original_price - (discount?.amount ?? 0);
  if (finalAmount < 100)
    throw new ApiError('The discount cannot reduce checkout below the minimum amount.', 409);

  const now = new Date();
  const subscriptionRows = await rest<SubscriptionRow[]>('subscriptions', {
    admin: true,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: user.profile.id,
      plan_id: plan.id,
      status: 'PENDING',
      provider: 'PAYMONGO',
      current_period_start: now.toISOString(),
      current_period_end: new Date(now.getTime() + periodDays(plan) * 86_400_000).toISOString(),
    },
  });
  const subscription = subscriptionRows[0]!;
  const paymentRows = await rest<PaymentRow[]>('payments', {
    admin: true,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: user.profile.id,
      subscription_id: subscription.id,
      plan_id: plan.id,
      discount_code_id: discount?.row.id ?? null,
      provider: 'PAYMONGO',
      status: 'PENDING',
      amount: finalAmount,
      original_amount: plan.original_price,
      discount_amount: discount?.amount ?? 0,
      currency: plan.currency,
      idempotency_key: idempotencyKey,
    },
  });
  const payment = paymentRows[0]!;

  try {
    const result = await createPayMongoSession({
      amount: finalAmount,
      currency: plan.currency,
      description: `${plan.name} access`,
      referenceNumber: payment.id,
      successUrl: `${siteOrigin(request)}/billing/checkout?payment=${payment.id}&state=processing`,
      cancelUrl: `${siteOrigin(request)}/billing/checkout?payment=${payment.id}&state=cancelled`,
      idempotencyKey,
    });
    await rest('payments', {
      admin: true,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(payment.id)}`,
      body: {
        external_checkout_session_id: result.id,
        metadata: { checkoutUrl: result.checkoutUrl },
      },
    });
    await audit(user.profile.id, 'BILLING_CHECKOUT_CREATED', 'BILLING_PAYMENT', payment.id, {
      plan: plan.code,
      amount: finalAmount,
      currency: plan.currency,
    });
    return {
      paymentId: payment.id,
      status: 'PENDING',
      checkoutUrl: result.checkoutUrl,
    };
  } catch (error) {
    await Promise.allSettled([
      rest('payments', {
        admin: true,
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(payment.id)}`,
        body: { status: 'FAILED', failure_code: 'CHECKOUT_CREATE_FAILED' },
      }),
      rest('subscriptions', {
        admin: true,
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(subscription.id)}`,
        body: { status: 'CANCELLED', cancelled_at: new Date().toISOString() },
      }),
    ]);
    throw error;
  }
}

async function resolveDiscount(userId: string, code: string, amount: number) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const rows = await rest<DiscountRow[]>('discount_codes', {
    admin: true,
    query: `code=eq.${encodeURIComponent(normalized)}&is_active=eq.true&select=*`,
  });
  const row = rows[0];
  const now = Date.now();
  if (
    !row ||
    new Date(row.starts_at).getTime() > now ||
    new Date(row.ends_at).getTime() <= now
  )
    throw new ApiError('This discount code is not available.', 409);
  if (row.max_redemptions !== null && row.redemption_count >= row.max_redemptions)
    throw new ApiError('This discount code has reached its limit.', 409);

  const previous = await rest<{ id: string }[]>('payments', {
    admin: true,
    query:
      `user_id=eq.${encodeURIComponent(userId)}&discount_code_id=eq.${encodeURIComponent(row.id)}&status=in.(PENDING,PAID)&select=id`,
  });
  if (previous.length >= row.max_redemptions_per_user)
    throw new ApiError('You have already used this discount code.', 409);

  // Finite global counters require an atomic database reservation RPC. Until one
  // is configured, reject rather than risk oversubscribing a promotion.
  if (row.max_redemptions !== null)
    throw new ApiError('This limited promotion is not enabled for checkout yet.', 409);

  let discount =
    row.kind === 'PERCENTAGE'
      ? Math.floor((amount * Math.min(row.value, 100)) / 100)
      : row.value;
  if (row.max_discount_amount !== null)
    discount = Math.min(discount, row.max_discount_amount);
  return { row, amount: Math.max(0, Math.min(amount, discount)) };
}

async function createPayMongoSession(input: {
  amount: number;
  currency: string;
  description: string;
  referenceNumber: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}) {
  const secret = process.env.PAYMONGO_SECRET_KEY!.trim();
  const configured = (process.env.PAYMONGO_PAYMENT_METHODS ?? 'card,gcash,qrph')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const methods =
    input.currency.toUpperCase() === 'PHP'
      ? configured
      : configured.filter((value) => value === 'card');
  const response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey,
    },
    body: JSON.stringify({
      data: {
        attributes: {
          cancel_url: input.cancelUrl,
          description: input.description,
          line_items: [
            {
              amount: input.amount,
              currency: input.currency,
              name: input.description,
              quantity: 1,
            },
          ],
          metadata: { reference_number: input.referenceNumber },
          payment_method_types: methods.length ? methods : ['card'],
          reference_number: input.referenceNumber,
          success_url: input.successUrl,
        },
      },
    }),
  });
  const body = (await response.json().catch(() => null)) as PayMongoCheckoutResponse | null;
  const id = body?.data?.id;
  const checkoutUrl = body?.data?.attributes?.checkout_url;
  if (!response.ok || !id || !checkoutUrl)
    throw new ApiError('Payment checkout could not be created. Please try again.', 503);
  const url = new URL(checkoutUrl);
  if (
    url.protocol !== 'https:' ||
    (url.hostname !== 'checkout.paymongo.com' &&
      !url.hostname.endsWith('.checkout.paymongo.com'))
  )
    throw new ApiError('Payment provider returned an invalid checkout.', 503);
  return { id: String(id), checkoutUrl: url.href };
}

export async function handlePayMongoWebhook(request: Request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const raw = Buffer.from(bytes);
  const signature =
    request.headers.get('paymongo-signature') ??
    request.headers.get('x-paymongo-signature') ??
    '';
  if (!verifySignature(raw, signature))
    throw new ApiError('Invalid webhook signature.', 401);

  let event: PayMongoEvent;
  try {
    event = JSON.parse(raw.toString('utf8')) as PayMongoEvent;
  } catch {
    throw new ApiError('Invalid webhook payload.', 400);
  }
  const eventId = event.data?.id;
  const eventType = event.data?.attributes?.type;
  if (!eventId || !eventType) return { received: true, processed: false };
  const expectedLive = paymentMode() === 'live';
  if (event.data?.attributes?.livemode !== expectedLive)
    throw new ApiError('Invalid webhook environment.', 401);

  const existing = await rest<
    { id: string; status: string }[]
  >('webhook_events', {
    admin: true,
    query: `external_event_id=eq.${encodeURIComponent(eventId)}&select=id,status`,
  });
  if (existing[0]?.status === 'PROCESSED' || existing[0]?.status === 'IGNORED')
    return { received: true, processed: false, duplicate: true };

  if (!existing[0]) {
    await rest('webhook_events', {
      admin: true,
      method: 'POST',
      body: {
        external_event_id: eventId,
        event_type: eventType,
        status: 'RECEIVED',
        livemode: expectedLive,
        payload_hash: createHash('sha256').update(raw).digest('hex'),
      },
    });
  } else {
    await rest('webhook_events', {
      admin: true,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(existing[0].id)}`,
      body: { status: 'RECEIVED', error_code: null, processed_at: null },
    });
  }

  try {
    if (eventType === 'checkout_session.payment.paid')
      await processCheckoutPaid(event);
    else if (eventType === 'payment.refunded')
      await processRefund(event);
    else {
      await markWebhook(eventId, 'IGNORED');
      return { received: true, processed: false, ignored: true };
    }
    await markWebhook(eventId, 'PROCESSED');
    return { received: true, processed: true };
  } catch (error) {
    await markWebhook(eventId, 'FAILED', 'PROCESSING_FAILED').catch(() => {});
    throw error;
  }
}

async function processCheckoutPaid(event: PayMongoEvent) {
  const resource = event.data?.attributes?.data;
  const attributes = resource?.attributes ?? {};
  const reference =
    typeof attributes.reference_number === 'string'
      ? attributes.reference_number
      : String(attributes.metadata?.reference_number ?? '');
  if (!resource?.id || !reference) throw new Error('Missing checkout identity.');

  const rows = await rest<PaymentRow[]>('payments', {
    admin: true,
    query:
      `id=eq.${encodeURIComponent(reference)}&external_checkout_session_id=eq.${encodeURIComponent(resource.id)}&select=*`,
  });
  const payment = rows[0];
  if (!payment) throw new Error('Unknown checkout session.');
  if (payment.status === 'PAID') return;

  const providerPayments = Array.isArray(attributes.payments) ? attributes.payments : [];
  const paid = providerPayments.find((item) => item?.attributes?.status === 'paid');
  if (
    !paid?.id ||
    Number(paid.attributes?.amount) !== payment.amount ||
    String(paid.attributes?.currency ?? '').toUpperCase() !== payment.currency.toUpperCase() ||
    attributes.livemode !== (paymentMode() === 'live')
  )
    throw new Error('Checkout payment did not match local payment.');

  const plans = await rest<DbPlan[]>('billing_plans', {
    admin: true,
    query: `id=eq.${encodeURIComponent(payment.plan_id ?? '')}&select=*`,
  });
  const plan = plans[0];
  if (!plan || !payment.subscription_id) throw new Error('Payment plan is missing.');

  const activated = new Date();
  const changed = await rest<PaymentRow[]>('payments', {
    admin: true,
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(payment.id)}&status=in.(PENDING,REQUIRES_ACTION,CANCELLED,EXPIRED)`,
    prefer: 'return=representation',
    body: {
      status: 'PAID',
      external_payment_id: String(paid.id),
      paid_at: activated.toISOString(),
      failure_code: null,
    },
  });
  if (!changed[0]) return;
  await rest('subscriptions', {
    admin: true,
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(payment.subscription_id)}`,
    body: {
      status: 'ACTIVE',
      current_period_start: activated.toISOString(),
      current_period_end: new Date(activated.getTime() + periodDays(plan) * 86_400_000).toISOString(),
      cancelled_at: null,
    },
  });
  await audit(null, 'BILLING_PLAN_ACTIVATED', 'BILLING_SUBSCRIPTION', payment.subscription_id, {
    paymentId: payment.id,
    plan: plan.code,
  });
}

async function processRefund(event: PayMongoEvent) {
  const resource = event.data?.attributes?.data;
  const externalId = String(resource?.id ?? '');
  if (!externalId) return;
  const rows = await rest<PaymentRow[]>('payments', {
    admin: true,
    query: `external_payment_id=eq.${encodeURIComponent(externalId)}&select=*`,
  });
  const payment = rows[0];
  if (!payment) return;
  await rest('payments', {
    admin: true,
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(payment.id)}`,
    body: { status: 'REFUNDED' },
  });
  if (payment.subscription_id)
    await rest('subscriptions', {
      admin: true,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(payment.subscription_id)}`,
      body: { status: 'REFUNDED', cancelled_at: new Date().toISOString() },
    });
  await audit(null, 'BILLING_PAYMENT_REFUNDED', 'BILLING_PAYMENT', payment.id);
}

function verifySignature(raw: Buffer, header: string) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return false;
  const direct = createHmac('sha256', secret).update(raw).digest('hex');
  if (safeEqual(header.trim(), direct)) return true;

  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...value] = part.trim().split('=');
      return [key, value.join('=')];
    }),
  ) as Record<string, string | undefined>;
  const timestamp = parts.t;
  const signature = parts[paymentMode() === 'live' ? 'li' : 'te'];
  if (!timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300)
    return false;
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${raw.toString('utf8')}`)
    .digest('hex');
  return safeEqual(signature, digest);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function markWebhook(externalId: string, status: string, errorCode?: string) {
  await rest('webhook_events', {
    admin: true,
    method: 'PATCH',
    query: `external_event_id=eq.${encodeURIComponent(externalId)}`,
    body: {
      status,
      error_code: errorCode ?? null,
      processed_at: new Date().toISOString(),
    },
  });
}

async function expireSubscriptions(userId: string) {
  await rest('subscriptions', {
    admin: true,
    method: 'PATCH',
    query:
      `user_id=eq.${encodeURIComponent(userId)}&status=eq.ACTIVE&current_period_end=lte.${encodeURIComponent(new Date().toISOString())}`,
    body: { status: 'EXPIRED' },
  });
}

async function expirePendingPayment(userId: string, paymentId: string) {
  const rows = await rest<PaymentRow[]>('payments', {
    admin: true,
    query:
      `id=eq.${encodeURIComponent(paymentId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.PENDING&select=*`,
  });
  const payment = rows[0];
  const hours = Math.max(1, Number(process.env.PAYMONGO_CHECKOUT_EXPIRY_HOURS ?? 24));
  if (!payment || new Date(payment.created_at).getTime() > Date.now() - hours * 3_600_000)
    return;
  await rest('payments', {
    admin: true,
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(payment.id)}`,
    body: { status: 'EXPIRED' },
  });
  if (payment.subscription_id)
    await rest('subscriptions', {
      admin: true,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(payment.subscription_id)}`,
      body: { status: 'EXPIRED', cancelled_at: new Date().toISOString() },
    });
}

export async function audit(
  actorId: string | null,
  action: string,
  targetType: string,
  targetId?: string | null,
  metadata?: Record<string, unknown>,
) {
  await rest('audit_logs', {
    admin: true,
    method: 'POST',
    body: {
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId ?? null,
      metadata: metadata ?? null,
    },
  });
}
