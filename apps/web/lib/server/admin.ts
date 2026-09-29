import 'server-only';

import type { Authenticated } from './auth';
import type { DbModel, DbPlan, DbPolicy } from './credits';
import { PROVIDER_USD_PER_CREDIT } from './credits';
import { audit } from './billing';
import { ApiError, bodyJson, integerValue, stringValue, routeId } from './http';
import { syncNvidiaFreeModels } from './nvidia';
import { authAdminJson, rest, supabaseFetch } from './supabase';

type Profile = {
  id: string;
  email: string;
  username: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  account_type: string;
  created_at: string;
};
type Payment = {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
};
type Usage = {
  provider: string;
  model_name: string;
  currency: string;
  estimated_cost: string | number;
  created_at: string;
};
type Economic = {
  currency: string;
  kind: string;
  amount: string | number;
  created_at: string;
};
type WebhookFailure = {
  external_event_id: string;
  event_type: string;
  status: string;
  error_code: string | null;
  received_at: string;
};
type SiteSettingRow = { value: unknown };
type CreatedAuthUser = { id?: string; user?: { id?: string } };
type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type AdminModelRow = DbModel & {
  category?: string | null;
  display_order?: number;
  effective_from?: string | null;
  effective_until?: string | null;
};

type SettingDefinition = {
  key: string;
  group: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  defaultValue: string | number | boolean;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  public: boolean;
};

const settingDefinitions: readonly SettingDefinition[] = [
  {
    key: 'branding.siteName',
    group: 'Branding',
    label: 'Site name',
    description: 'The public product name.',
    type: 'string',
    defaultValue: 'Vrompt',
    maxLength: 80,
    public: true,
  },
  {
    key: 'branding.tagline',
    group: 'Branding',
    label: 'Tagline',
    description: 'Short value proposition shown on public pages.',
    type: 'string',
    defaultValue: 'One workspace. The right AI for every task.',
    maxLength: 160,
    public: true,
  },
  {
    key: 'content.announcement',
    group: 'Content',
    label: 'Announcement',
    description: 'Optional public announcement. Leave blank to hide it.',
    type: 'string',
    defaultValue: '',
    maxLength: 500,
    public: true,
  },
  {
    key: 'registration.enabled',
    group: 'Access',
    label: 'Public registration',
    description: 'Allow new OAuth users to create a Vrompt account.',
    type: 'boolean',
    defaultValue: true,
    public: true,
  },
  {
    key: 'workspace.writePrompt',
    group: 'Starter prompts',
    label: 'Write starter',
    description: 'Starter prompt for writing tasks.',
    type: 'string',
    defaultValue: 'Help me write and improve this.',
    maxLength: 500,
    public: true,
  },
  {
    key: 'workspace.learnPrompt',
    group: 'Starter prompts',
    label: 'Learn starter',
    description: 'Starter prompt for learning tasks.',
    type: 'string',
    defaultValue: 'Explain this clearly and help me understand it.',
    maxLength: 500,
    public: true,
  },
  {
    key: 'workspace.codePrompt',
    group: 'Starter prompts',
    label: 'Code starter',
    description: 'Starter prompt for coding tasks.',
    type: 'string',
    defaultValue: 'Help me build, debug, or improve this code.',
    maxLength: 500,
    public: true,
  },
];

export async function publicSettings() {
  const rows = await rest<{ key: string; value: unknown }[]>('site_settings', {
    query: 'is_public=eq.true&select=key,value',
  });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function handleAdmin(
  request: Request,
  actor: Authenticated,
  path: string[],
): Promise<unknown> {
  const [area, item, id] = path;

  if (area === 'dashboard' && request.method === 'GET') return dashboard();
  if (area === 'system' && request.method === 'GET') return systemStatus();

  if (area === 'workspace') {
    if (item === 'analytics' && request.method === 'GET') return analytics();
    if (item === 'configuration' && request.method === 'GET')
      return workspaceConfiguration();
    if (item === 'models')
      return modelMutation(request, actor, id);
    if (item === 'nvidia-sync')
      return syncNvidiaFreeModels(request);
    if (item === 'policies')
      return policyMutation(request, actor);
  }

  if (area === 'billing') {
    if (item === 'configuration' && request.method === 'GET')
      return { plans: (await allPlans()).map(mapPlan), promotions: [] };
    if (item === 'plans') return planMutation(request, actor, id);
    if (item === 'overview' && request.method === 'GET') return billingOverview();
    if (item === 'payments' && request.method === 'GET') return adminPayments();
    if (item === 'webhook-failures' && request.method === 'GET')
      return rest<WebhookFailure[]>('webhook_events', {
        admin: true,
        query: 'status=eq.FAILED&select=external_event_id,event_type,status,error_code,received_at&order=received_at.desc&limit=50',
      }).then((rows: WebhookFailure[]) =>
        rows.map((row) => ({
          externalEventId: row.external_event_id,
          eventType: row.event_type,
          status: row.status,
          errorCode: row.error_code,
          receivedAt: row.received_at,
        })),
      );
  }

  if (area === 'settings') return settingsRoute(request, actor, item);
  if (area === 'users') return usersRoute(request, actor, item);
  if (area === 'audit' && request.method === 'GET') return auditRoute(request);

  throw new ApiError('Admin route not found.', 404);
}

async function countTable(table: string, query = '') {
  const response = await supabaseFetch(
    `/rest/v1/${table}?select=id${query ? `&${query}` : ''}`,
    {
      admin: true,
      method: 'HEAD',
      headers: { prefer: 'count=exact', range: '0-0' },
    },
  );
  if (!response.ok) throw new Error(`Unable to count ${table}.`);
  const range = response.headers.get('content-range') ?? '*/0';
  return Number(range.split('/')[1] ?? 0) || 0;
}

async function dashboard() {
  const [users, generations, models, conversations, savedPrompts, staff] =
    await Promise.all([
      countTable('profiles', 'status=eq.ACTIVE'),
      countTable('usage_records'),
      countTable('ai_models', 'enabled=eq.true&maintenance=eq.false'),
      countTable('conversations'),
      countTable('saved_prompts'),
      countTable('profiles', 'role=eq.ADMIN&status=eq.ACTIVE'),
    ]);
  return { users, generations, models, conversations, savedPrompts, staff };
}

async function systemStatus() {
  const started = performance.now();
  let database = { status: 'healthy', latencyMs: null as number | null };
  try {
    await rest('billing_plans', { admin: true, query: 'select=id&limit=1' });
    database.latencyMs = Math.round(performance.now() - started);
  } catch {
    database = { status: 'unavailable', latencyMs: null };
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? '';
  return {
    environment: process.env.NODE_ENV ?? 'development',
    checkedAt: new Date().toISOString(),
    dependencies: {
      database,
      publicDomain: {
        status: site.startsWith('https://') ? 'healthy' : 'not_configured',
        latencyMs: null,
      },
    },
    integrations: {
      googleOAuth: 'Managed in Supabase Auth',
      githubOAuth: 'Managed in Supabase Auth',
      aiProvider: Boolean(
        process.env.OPENAI_API_KEY ||
          process.env.GOOGLE_AI_API_KEY ||
          process.env.ANTHROPIC_API_KEY ||
          process.env.MISTRAL_API_KEY,
      ),
      payMongo: Boolean(process.env.PAYMONGO_SECRET_KEY && process.env.PAYMONGO_WEBHOOK_SECRET),
      storageDriver: 'Supabase Storage',
    },
  };
}

async function analytics() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [usage, payments, entries, activeSubscriptions] = await Promise.all([
    rest<Usage[]>('usage_records', {
      admin: true,
      query: `created_at=gte.${encodeURIComponent(since)}&select=provider,model_name,currency,estimated_cost,created_at`,
    }),
    rest<Payment[]>('payments', {
      admin: true,
      query: `status=eq.PAID&paid_at=gte.${encodeURIComponent(since)}&select=id,user_id,status,amount,currency,created_at,paid_at`,
    }),
    rest<Economic[]>('economic_entries', {
      admin: true,
      query: `created_at=gte.${encodeURIComponent(since)}&select=currency,kind,amount,created_at`,
    }),
    countTable(
      'subscriptions',
      `status=eq.ACTIVE&current_period_end=gt.${encodeURIComponent(new Date().toISOString())}`,
    ),
  ]);

  const grouped = new Map<string, { provider: string; modelName: string; currency: string; cost: number; count: number }>();
  for (const row of usage) {
    const key = `${row.provider}|${row.model_name}|${row.currency}`;
    const current = grouped.get(key) ?? {
      provider: row.provider,
      modelName: row.model_name,
      currency: row.currency,
      cost: 0,
      count: 0,
    };
    current.cost += Number(row.estimated_cost);
    current.count += 1;
    grouped.set(key, current);
  }

  const currencies = new Set([
    ...usage.map((row) => row.currency),
    ...payments.map((row) => row.currency),
    ...entries.map((row) => row.currency),
  ]);
  const contribution = [...currencies].map((currency) => {
    const revenue =
      payments
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + row.amount / 100, 0) +
      entries
        .filter((row) => row.currency === currency && row.kind === 'REVENUE_ADJUSTMENT')
        .reduce((sum, row) => sum + Number(row.amount), 0);
    const aiCost =
      usage
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + Number(row.estimated_cost), 0) +
      entries
        .filter((row) => row.currency === currency && row.kind === 'AI_COST_ADJUSTMENT')
        .reduce((sum, row) => sum + Number(row.amount), 0);
    const variableCost = entries
      .filter((row) => row.currency === currency && row.kind === 'VARIABLE_COST')
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const contributionProfit = revenue - aiCost - variableCost;
    return {
      currency,
      revenue,
      aiCost,
      contributionProfit,
      margin: revenue > 0 ? contributionProfit / revenue : null,
    };
  });

  return {
    costs: [...grouped.values()].map((row) => ({
      provider: row.provider,
      modelName: row.modelName,
      currency: row.currency,
      _sum: { estimatedCost: String(row.cost) },
      _count: row.count,
    })),
    activeSubscriptions,
    contribution,
    note: 'Contribution is cash received minus recorded AI and variable costs. Payment fees, tax and support are only included when entered as variable costs.',
  };
}

async function workspaceConfiguration() {
  const [models, plans, policies] = await Promise.all([
    rest<AdminModelRow[]>('ai_models', { admin: true, query: 'select=*&order=display_order.asc' }),
    allPlans(),
    rest<DbPolicy[]>('generation_policies', {
      admin: true,
      query: 'select=*&order=plan_id.asc,bucket.asc',
    }),
  ]);
  return {
    creditDesign: { providerUsdPerCredit: PROVIDER_USD_PER_CREDIT },
    models: models.map(mapModelConfig),
    plans: plans.map(mapPlan),
    policies: policies.map(mapPolicy),
  };
}

function mapModelConfig(row: AdminModelRow) {
  return {
    id: row.id,
    provider: row.provider,
    providerModelId: row.provider_model_id,
    displayName: row.display_name,
    description: row.description,
    category: row.category,
    capabilities: row.capabilities,
    capabilityStates: row.capability_states,
    reasoningLevels: row.reasoning_levels,
    defaultReasoningLevel: row.default_reasoning_level,
    enabled: row.enabled,
    manualAvailable: row.manual_available,
    autoAvailable: row.auto_available,
    maintenance: row.maintenance,
    displayOrder: row.display_order,
    qualityTier: row.quality_tier,
    routingPriority: row.routing_priority,
    routingCostScore: Number(row.routing_cost_score),
    inputPrice: Number(row.input_price),
    cachedInputPrice: Number(row.cached_input_price),
    outputPrice: Number(row.output_price),
    creditCost: row.credit_cost,
    maxContext: row.max_context,
    maxOutput: row.max_output,
    currency: row.currency,
    additionalPrices: {
      ...(Number(row.cache_write_input_price) > 0
        ? { cacheWriteInputPrice: Number(row.cache_write_input_price) }
        : {}),
      ...(row.image_max_cost_usd !== null
        ? { maxImageOutputCostUsd: Number(row.image_max_cost_usd) }
        : {}),
    },
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    bestFor: row.best_for,
    quickFacts: row.quick_facts,
    details: row.details,
    freeEndpoint: row.free_endpoint,
    source: row.source,
    healthStatus: row.health_status,
    healthCheckedAt: row.health_checked_at,
    healthMessage: row.health_message,
  };
}

function mapPlan(row: DbPlan) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    originalPrice: row.original_price,
    currency: row.currency,
    billingInterval: row.billing_interval,
    intervalCount: row.interval_count,
    monthlyCredits: row.monthly_credits,
    maxProjects: row.max_projects,
    maxWorkflows: row.max_workflows,
    maxWorkflowSteps: row.max_workflow_steps,
    projectContextChars: row.project_context_chars,
    isActive: row.is_active,
    displayOrder: row.display_order,
    limits: [],
  };
}

function mapPolicy(row: DbPolicy) {
  return {
    id: row.id,
    planId: row.plan_id,
    bucket: row.bucket,
    modelId: row.model_id,
    enabled: row.enabled,
    dailyLimit: row.daily_limit,
    monthlyLimit: row.monthly_limit,
    maxInputChars: row.max_input_chars,
    maxContext: row.max_context,
    maxOutput: row.max_output,
    maxFiles: row.max_files,
    maxFileBytes: row.max_file_bytes,
    maxDurationSeconds: row.max_duration_seconds,
    concurrency: row.concurrency,
    ratePerMinute: row.rate_per_minute,
    allowedFeatures: row.allowed_features,
    routing: row.routing,
  };
}

export function modelMutationPayload(input: Record<string, unknown>) {
  const additional =
    input.additionalPrices && typeof input.additionalPrices === 'object'
      ? (input.additionalPrices as Record<string, unknown>)
      : {};
  const data = {
    provider: stringValue(input.provider, 'Provider', { min: 2, max: 20 }),
    provider_model_id: stringValue(input.providerModelId, 'Provider model ID', { min: 1, max: 160 }),
    display_name: stringValue(input.displayName, 'Display name', { min: 1, max: 100 }),
    description: stringValue(input.description ?? '', 'Description', { max: 500, optional: true }),
    category: stringValue(input.category ?? 'general', 'Category', { min: 1, max: 40 }),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String).slice(0, 32) : ['text'],
    capability_states: input.capabilityStates && typeof input.capabilityStates === 'object' ? input.capabilityStates : {},
    reasoning_levels: Array.isArray(input.reasoningLevels) ? input.reasoningLevels.map(String).slice(0, 4) : ['low'],
    default_reasoning_level: String(input.defaultReasoningLevel ?? 'low'),
    enabled: input.enabled === true,
    manual_available: input.manualAvailable !== false,
    auto_available: input.autoAvailable === true,
    free_endpoint: input.freeEndpoint === true,
    maintenance: input.maintenance === true,
    display_order: integerValue(input.displayOrder ?? 0, 'Display order', -10000, 10000),
    quality_tier: integerValue(input.qualityTier ?? 1, 'Quality tier', 1, 4),
    routing_priority: integerValue(input.routingPriority ?? 0, 'Routing priority', 0, 100),
    routing_cost_score: Number(input.routingCostScore ?? 1),
    input_price: Number(input.inputPrice ?? 0),
    cached_input_price: Number(input.cachedInputPrice ?? 0),
    output_price: Number(input.outputPrice ?? 0),
    cache_write_input_price: Number(additional.cacheWriteInputPrice ?? 0),
    image_max_cost_usd:
      additional.maxImageOutputCostUsd === undefined
        ? null
        : Number(additional.maxImageOutputCostUsd),
    credit_cost: integerValue(input.creditCost ?? 1, 'Minimum credits', 1, 100000),
    max_context: integerValue(input.maxContext, 'Context limit', 1, 10_000_000),
    max_output: integerValue(input.maxOutput, 'Output limit', 1, 1_000_000),
    currency: 'USD',
    best_for: Array.isArray(input.bestFor)
      ? input.bestFor
          .map((value) => String(value).trim())
          .filter(Boolean)
          .slice(0, 12)
      : [],
    quick_facts:
      input.quickFacts &&
      typeof input.quickFacts === 'object' &&
      !Array.isArray(input.quickFacts)
        ? input.quickFacts
        : {},
    details:
      input.details &&
      typeof input.details === 'object' &&
      !Array.isArray(input.details)
        ? input.details
        : {},
  };
  for (const value of [
    data.routing_cost_score,
    data.input_price,
    data.cached_input_price,
    data.output_price,
    data.cache_write_input_price,
    data.image_max_cost_usd ?? 0,
  ])
    if (!Number.isFinite(value) || value < 0)
      throw new ApiError('Model pricing must be non-negative numbers.');
  return data;
}

async function modelMutation(request: Request, actor: Authenticated, id?: string) {
  if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE')
    throw new ApiError('Method not allowed.', 405);
  if (request.method === 'DELETE') {
    const modelId = routeId(id, 'Model ID');
    await rest('ai_models', {
      admin: true,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(modelId)}`,
      body: { enabled: false, manual_available: false, auto_available: false },
    });
    await audit(actor.profile.id, 'MODEL_DISABLED', 'MODEL', modelId);
    return { disabled: true, id: modelId };
  }
  const input = await bodyJson<Record<string, unknown>>(request);
  const data = modelMutationPayload(input);

  const method = id ? 'PATCH' : 'POST';
  const rows = await rest<AdminModelRow[]>('ai_models', {
    admin: true,
    method,
    query: id ? `id=eq.${encodeURIComponent(routeId(id, 'Model ID'))}` : undefined,
    prefer: 'return=representation',
    body: data,
  });
  if (!rows[0]) throw new ApiError('Model not found.', 404);
  await audit(actor.profile.id, id ? 'MODEL_UPDATED' : 'MODEL_CREATED', 'MODEL', rows[0].id);
  return mapModelConfig(rows[0]);
}

async function policyMutation(request: Request, actor: Authenticated) {
  if (request.method !== 'POST') throw new ApiError('Method not allowed.', 405);
  const input = await bodyJson<Record<string, unknown>>(request);
  const planId = routeId(String(input.planId ?? ''), 'Plan ID');
  const bucket = stringValue(input.bucket, 'Policy bucket', { min: 1, max: 80 });
  const data = {
    plan_id: planId,
    bucket,
    model_id: input.modelId ? routeId(String(input.modelId), 'Model ID') : null,
    enabled: input.enabled !== false,
    daily_limit: integerValue(input.dailyLimit, 'Daily limit', 0, 100000),
    monthly_limit: integerValue(input.monthlyLimit, 'Monthly limit', 0, 10_000_000),
    max_input_chars: integerValue(input.maxInputChars, 'Input limit', 1, 1_000_000),
    max_context: integerValue(input.maxContext, 'Context limit', 1, 10_000_000),
    max_output: integerValue(input.maxOutput, 'Output limit', 1, 1_000_000),
    max_files: integerValue(input.maxFiles, 'File count', 0, 10),
    max_file_bytes: integerValue(input.maxFileBytes, 'File size', 1, 20_000_000),
    max_duration_seconds: integerValue(input.maxDurationSeconds, 'Timeout', 1, 600),
    concurrency: integerValue(input.concurrency, 'Concurrency', 1, 10),
    rate_per_minute: integerValue(input.ratePerMinute, 'Rate limit', 1, 120),
    allowed_features: Array.isArray(input.allowedFeatures) ? input.allowedFeatures.map(String) : ['chat'],
    routing: input.routing && typeof input.routing === 'object' ? input.routing : {},
  };
  const rows = await rest<DbPolicy[]>('generation_policies', {
    admin: true,
    method: 'POST',
    query: 'on_conflict=plan_id,bucket',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: data,
  });
  await audit(actor.profile.id, 'GENERATION_POLICY_CONFIGURED', 'GENERATION_POLICY', rows[0]?.id);
  return rows[0] ? mapPolicy(rows[0]) : data;
}

async function allPlans() {
  return rest<DbPlan[]>('billing_plans', {
    admin: true,
    query: 'select=*&order=display_order.asc',
  });
}

async function planMutation(request: Request, actor: Authenticated, id?: string) {
  if (request.method !== 'POST' && request.method !== 'PATCH')
    throw new ApiError('Method not allowed.', 405);
  const input = await bodyJson<Record<string, unknown>>(request);
  const data = {
    code: stringValue(input.code, 'Plan code', { min: 2, max: 50 }).toUpperCase(),
    name: stringValue(input.name, 'Plan name', { min: 1, max: 100 }),
    description: stringValue(input.description ?? '', 'Description', { max: 1000, optional: true }),
    original_price: integerValue(input.originalPrice, 'Price', 0, 100_000_000),
    currency: stringValue(input.currency ?? 'USD', 'Currency', { min: 3, max: 3 }).toUpperCase(),
    billing_interval: String(input.billingInterval ?? 'MONTH'),
    interval_count: integerValue(input.intervalCount ?? 1, 'Interval', 1, 120),
    monthly_credits: integerValue(input.monthlyCredits, 'Credits', 0, 10_000_000),
    max_projects: integerValue(input.maxProjects ?? 0, 'Projects', 0, 200),
    max_workflows: integerValue(input.maxWorkflows ?? 0, 'Workflows', 0, 200),
    max_workflow_steps: integerValue(input.maxWorkflowSteps ?? 5, 'Workflow steps', 1, 20),
    project_context_chars: integerValue(input.projectContextChars ?? 8000, 'Project context', 0, 32000),
    is_active: input.isActive !== false,
    display_order: integerValue(input.displayOrder ?? 0, 'Display order', -1000, 1000),
  };
  const rows = await rest<DbPlan[]>('billing_plans', {
    admin: true,
    method: id ? 'PATCH' : 'POST',
    query: id ? `id=eq.${encodeURIComponent(routeId(id, 'Plan ID'))}` : undefined,
    prefer: 'return=representation',
    body: data,
  });
  if (!rows[0]) throw new ApiError('Plan not found.', 404);
  await audit(actor.profile.id, id ? 'BILLING_PLAN_CHANGED' : 'BILLING_PLAN_CREATED', 'BILLING_PLAN', rows[0].id);
  return mapPlan(rows[0]);
}

async function billingOverview() {
  const [payments, activeSubscriptions, failedWebhooks] = await Promise.all([
    rest<{ status: string }[]>('payments', { admin: true, query: 'select=status' }),
    countTable('subscriptions', `status=eq.ACTIVE&current_period_end=gt.${encodeURIComponent(new Date().toISOString())}`),
    countTable('webhook_events', 'status=eq.FAILED'),
  ]);
  const counts: Record<string, number> = {};
  for (const row of payments) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return { activeSubscriptions, failedWebhooks, payments: counts };
}

async function adminPayments() {
  const payments = await rest<Payment[]>('payments', {
    admin: true,
    query: 'select=id,user_id,status,amount,currency,created_at,paid_at&order=created_at.desc&limit=100',
  });
  const ids = [...new Set(payments.map((row) => row.user_id))];
  const profiles = ids.length
    ? await rest<Profile[]>('profiles', {
        admin: true,
        query: `id=in.(${ids.join(',')})&select=*`,
      })
    : [];
  const byId = new Map(profiles.map((row) => [row.id, row]));
  return payments.map((payment) => ({
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    createdAt: payment.created_at,
    user: byId.get(payment.user_id)
      ? {
          username: byId.get(payment.user_id)!.username,
          email: byId.get(payment.user_id)!.email,
        }
      : null,
  }));
}

async function settingsRoute(request: Request, actor: Authenticated, key?: string) {
  if (!key && request.method === 'GET') {
    const rows = await rest<{ key: string; value: unknown; updated_at: string }[]>('site_settings', {
      admin: true,
      query: 'select=key,value,updated_at',
    });
    const values = new Map(rows.map((row) => [row.key, row]));
    return settingDefinitions.map((definition) => {
      const row = values.get(definition.key);
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        type: definition.type,
        value: row?.value ?? definition.defaultValue,
        defaultValue: definition.defaultValue,
        ...('maxLength' in definition ? { maxLength: definition.maxLength } : {}),
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  const decoded = decodeURIComponent(key ?? '');
  const definition = settingDefinitions.find((item) => item.key === decoded);
  if (!definition) throw new ApiError('Setting not found.', 404);
  let value: unknown = definition.defaultValue;
  if (request.method === 'PATCH') {
    const input = await bodyJson<Record<string, unknown>>(request);
    if (definition.type === 'boolean') value = input.value === true;
    else if (definition.type === 'number')
      value = integerValue(input.value, definition.label, 0, Number.MAX_SAFE_INTEGER);
    else value = stringValue(input.value ?? '', definition.label, {
      max: 'maxLength' in definition ? definition.maxLength : 500,
      optional: true,
    });
  } else if (request.method !== 'DELETE') {
    throw new ApiError('Method not allowed.', 405);
  }

  const rows = await rest<SiteSettingRow[]>('site_settings', {
    admin: true,
    method: 'POST',
    query: 'on_conflict=key',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { key: definition.key, value, is_public: definition.public },
  });
  await audit(actor.profile.id, request.method === 'DELETE' ? 'SETTING_RESET' : 'SETTING_UPDATED', 'SETTING', definition.key);
  return { value: rows[0]?.value ?? value };
}

async function usersRoute(request: Request, actor: Authenticated, id?: string) {
  if (!id && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const q = (params.get('q') ?? '').trim().toLowerCase();
    const role = (params.get('role') ?? '').trim().toUpperCase();
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
    const rows = await rest<Profile[]>('profiles', {
      admin: true,
      query: 'select=*&order=created_at.desc',
    });
    const filtered = rows.filter(
      (row) =>
        (!q || `${row.username} ${row.email}`.toLowerCase().includes(q)) &&
        (!role || row.role === role),
    );
    const size = 20;
    const items = filtered.slice((page - 1) * size, page * size).map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      staffCredential: row.role === 'ADMIN' ? { lastLoginAt: null } : null,
    }));
    return { items, total: filtered.length, page, hasNextPage: page * size < filtered.length };
  }

  if (!id && request.method === 'POST') {
    const input = await bodyJson<Record<string, unknown>>(request);
    const email = stringValue(input.email, 'Email', { min: 3, max: 320 }).toLowerCase();
    const password = stringValue(input.password, 'Password', { min: 12, max: 128 });
    const username = stringValue(input.username, 'Username', { min: 2, max: 32 });
    const created = await authAdminJson<CreatedAuthUser>('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: username },
      }),
    });
    const userId = String(created.id ?? created.user?.id ?? '');
    if (!userId) throw new Error('Supabase did not return the new user ID.');
    await rest('profiles', {
      admin: true,
      method: 'POST',
      query: 'on_conflict=id',
      prefer: 'resolution=merge-duplicates',
      body: {
        id: userId,
        email,
        username,
        role: 'ADMIN',
        status: 'ACTIVE',
        account_type: 'OFFICIAL',
      },
    });
    await audit(actor.profile.id, 'ADMIN_CREATED', 'USER', userId);
    return { id: userId, email, username, role: 'ADMIN', status: 'ACTIVE' };
  }

  const userId = routeId(id, 'User ID');
  if (request.method !== 'PATCH') throw new ApiError('Method not allowed.', 405);
  const input = await bodyJson<Record<string, unknown>>(request);
  const profiles = await rest<Profile[]>('profiles', {
    admin: true,
    query: `id=eq.${encodeURIComponent(userId)}&select=*`,
  });
  const target = profiles[0];
  if (!target) throw new ApiError('User not found.', 404);

  const role = input.role ? String(input.role).toUpperCase() : target.role;
  const status = input.status ? String(input.status).toUpperCase() : target.status;
  if (!['USER', 'ADMIN'].includes(role) || !['ACTIVE', 'SUSPENDED', 'DELETED'].includes(status))
    throw new ApiError('Invalid account role or status.');
  if (userId === actor.profile.id && (role !== 'ADMIN' || status !== 'ACTIVE'))
    throw new ApiError('You cannot remove your own active administrator access.', 409);

  await rest('profiles', {
    admin: true,
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(userId)}`,
    body: { role, status },
  });
  if (typeof input.password === 'string' && input.password) {
    const password = stringValue(input.password, 'Password', { min: 12, max: 128 });
    await authAdminJson(`/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  }
  await audit(actor.profile.id, 'USER_UPDATED', 'USER', userId, { role, status });
  return { id: userId, role, status };
}

async function auditRoute(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const actorName = (params.get('actor') ?? '').trim();
  const rows = await rest<AuditRow[]>('audit_logs', {
    admin: true,
    query: 'select=*&order=created_at.desc',
  });
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))] as string[];
  const profiles = actorIds.length
    ? await rest<Profile[]>('profiles', {
        admin: true,
        query: `id=in.(${actorIds.join(',')})&select=*`,
      })
    : [];
  const byId = new Map(profiles.map((row) => [row.id, row]));
  const filtered = rows.filter((row) => {
    if (!actorName) return true;
    return row.actor_id ? byId.get(row.actor_id)?.username === actorName : false;
  });
  const size = 25;
  const pageRows = filtered.slice((page - 1) * size, page * size);
  return {
    items: pageRows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: row.metadata,
      createdAt: row.created_at,
      actor: row.actor_id && byId.get(row.actor_id)
        ? { username: byId.get(row.actor_id)!.username }
        : null,
    })),
    total: filtered.length,
    hasNextPage: page * size < filtered.length,
  };
}
