import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { Authenticated } from './auth';
import { activePlan } from './auth';
import {
  actualProviderCost,
  autoCredits,
  chooseAutoModel,
  chooseAutoModels,
  isFreeEndpointEligible,
  modelCredits,
  providerConfigured,
  resolveFreeManualModel,
  type CreditFeature,
  type DbModel,
  type DbPlan,
  type DbPolicy,
} from './credits';
import { ApiError, bodyJson, integerValue, json, routeId, stringValue, uuid } from './http';
import { emptyUsage, ProviderFailure, streamProvider, type ProviderFile, type ProviderMessage } from './providers';
import { runAutoAttempts } from './auto-routing';
import {
  connectedProviderSet,
  getUserProviderKey,
} from './provider-credentials';
import { rest, rpc, storageDelete, storageDownload, storageUpload } from './supabase';

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  instructions: string;
  context: string;
  preferred_model_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
type ConversationRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};
type MessageRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  model_id: string | null;
  model_name: string | null;
  routing_mode: string | null;
  request_id: string | null;
  created_at: string;
};
type AttachmentRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  message_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  kind: 'upload' | 'generated';
  created_at: string;
};
type PromptRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};
type WorkflowRow = {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  steps: Array<{ name: string; prompt: string; modelId: string | null }>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
type RunRow = {
  id: string;
  user_id: string;
  workflow_id: string;
  conversation_id: string;
  request_id: string;
  status: string;
  completed_steps: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

const modelSelect =
  'id,provider,provider_model_id,display_name,description,category,capabilities,capability_states,reasoning_levels,default_reasoning_level,enabled,manual_available,auto_available,maintenance,quality_tier,routing_priority,routing_cost_score,input_price,cached_input_price,output_price,cache_write_input_price,image_max_cost_usd,credit_cost,max_context,max_output,currency,best_for,quick_facts,details,free_endpoint,source,health_status,health_checked_at,last_success_at,last_failure_at,health_failure_count,health_message';

function mapModel(
  model: DbModel,
  credits?: { chat: number | null; image_generation: number | null },
  access?: { planAvailable?: boolean; byokAvailable?: boolean },
) {
  const providerHealthy =
    model.provider !== 'NVIDIA' || model.health_status === 'HEALTHY';
  return {
    id: model.id,
    provider: model.provider,
    providerModelId: model.provider_model_id,
    displayName: model.display_name,
    description: model.description,
    category: model.category,
    capabilities: model.capabilities,
    capabilityStates: model.capability_states ?? {},
    reasoningLevels: model.reasoning_levels,
    defaultReasoningLevel: model.default_reasoning_level,
    enabled: model.enabled,
    maintenance: model.maintenance,
    autoAvailable: model.auto_available,
    manualAvailable: model.manual_available,
    available:
      model.enabled &&
      !model.maintenance &&
      providerConfigured(model.provider) &&
      providerHealthy,
    bestFor: model.best_for ?? [],
    quickFacts: model.quick_facts ?? {},
    details: model.details ?? {},
    freeEndpoint: model.free_endpoint,
    source: model.source,
    healthStatus: model.health_status,
    healthCheckedAt: model.health_checked_at,
    healthMessage: model.health_message,
    ...(access ?? {}),
    ...(credits ? { creditCosts: credits } : {}),
  };
}

function mapProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    context: row.context,
    preferredModelId: row.preferred_model_id,
    archived: row.archived,
  };
}
function mapConversation(row: ConversationRow) {
  return { id: row.id, title: row.title, updatedAt: row.updated_at, projectId: row.project_id };
}
function mapFile(row: AttachmentRow) {
  return { id: row.id, name: row.name, size: Number(row.size_bytes), mimeType: row.mime_type };
}
function mapPrompt(row: PromptRow) {
  return { id: row.id, title: row.title, content: row.content };
}
function mapWorkflow(row: WorkflowRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    enabled: row.enabled,
    steps: Array.isArray(row.steps) ? row.steps : [],
  };
}
function mapRun(row: RunRow) {
  return {
    id: row.id,
    status: row.status,
    completedSteps: row.completed_steps,
    conversationId: row.conversation_id,
    error: row.error,
    createdAt: row.created_at,
  };
}

async function configuration(userId: string) {
  const plan = await activePlan(userId);
  const [policies, models] = await Promise.all([
    rest<DbPolicy[]>('generation_policies', {
      admin: true,
      query: `plan_id=eq.${encodeURIComponent(plan.id)}&enabled=eq.true&select=*&order=bucket.asc`,
    }),
    rest<DbModel[]>('ai_models', {
      admin: true,
      query: `select=${modelSelect}`,
    }),
  ]);
  return { plan, policies, models };
}

function periods(now = new Date()) {
  return {
    day: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    month: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    nextDay: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
    nextMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export async function catalogModels() {
  const models = await rest<DbModel[]>('ai_models', {
    query: `select=${modelSelect}&enabled=eq.true&maintenance=eq.false&order=display_order.asc`,
  });
  return models.map((model) => mapModel(model));
}

export async function workspaceModels(user: Authenticated) {
  const [{ plan, policies, models }, connected] = await Promise.all([
    configuration(user.profile.id),
    connectedProviderSet(user.profile.id),
  ]);
  const policyByModel = new Map(
    policies
      .filter((policy) => policy.model_id)
      .map((policy) => [policy.model_id!, policy]),
  );
  const freePlan = plan.code === 'FREE';
  const freePolicy = policies.find(
    (policy) => policy.bucket === 'AUTO' && policy.enabled,
  );
  return models
    .filter((model) => {
      const policy = policyByModel.get(model.id);
      const freeAvailable =
        freePlan && isFreeEndpointEligible(model, 'chat', 'manual');
      const providerHealthy =
        model.provider !== 'NVIDIA' || model.health_status === 'HEALTHY';
      const planAvailable = Boolean(
        freeAvailable ||
          (policy &&
          model.enabled &&
          model.manual_available &&
          !model.maintenance &&
          providerConfigured(model.provider) &&
          providerHealthy),
      );
      const byokAvailable = Boolean(
        connected.has(model.provider) &&
          model.enabled &&
          model.manual_available &&
          !model.maintenance,
      );
      return planAvailable || byokAvailable;
    })
    .map((model) => {
      const policy = policyByModel.get(model.id);
      const freeAvailable =
        freePlan && isFreeEndpointEligible(model, 'chat', 'manual');
      const effectivePolicy = policy ?? (freeAvailable ? freePolicy : undefined);
      const providerHealthy =
        model.provider !== 'NVIDIA' || model.health_status === 'HEALTHY';
      const planAvailable = Boolean(
        freeAvailable ||
          (policy && providerConfigured(model.provider) && providerHealthy),
      );
      const byokAvailable = connected.has(model.provider);
      return mapModel(
        model,
        effectivePolicy
          ? {
              chat: effectivePolicy.allowed_features.includes('chat')
                ? effectivePolicy.bucket === 'AUTO'
                  ? autoCredits(effectivePolicy, 'chat')
                  : modelCredits(model, effectivePolicy, 'chat')
                : null,
              image_generation: effectivePolicy.allowed_features.includes('image_generation')
                ? effectivePolicy.bucket === 'AUTO'
                  ? autoCredits(effectivePolicy, 'image_generation')
                  : modelCredits(model, effectivePolicy, 'image_generation')
                : null,
            }
          : undefined,
        { planAvailable, byokAvailable },
      );
    });
}

function envLimit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function byokPolicy(): DbPolicy {
  return {
    id: 'BYOK',
    plan_id: 'BYOK',
    bucket: 'BYOK',
    model_id: null,
    enabled: true,
    daily_limit: envLimit('BYOK_DAILY_LIMIT', 100),
    monthly_limit: envLimit('BYOK_MONTHLY_LIMIT', 1000),
    max_input_chars: envLimit('BYOK_MAX_INPUT_CHARS', 64000),
    max_context: envLimit('BYOK_MAX_CONTEXT', 128000),
    max_output: envLimit('BYOK_MAX_OUTPUT', 8192),
    max_files: Math.min(envLimit('BYOK_MAX_FILES', 5), 10),
    max_file_bytes: Math.min(
      envLimit('BYOK_MAX_FILE_BYTES', 10_000_000),
      20_000_000,
    ),
    max_duration_seconds: Math.min(
      envLimit('BYOK_MAX_DURATION_SECONDS', 120),
      600,
    ),
    concurrency: Math.min(envLimit('BYOK_CONCURRENCY', 2), 10),
    rate_per_minute: Math.min(envLimit('BYOK_RATE_PER_MINUTE', 10), 120),
    allowed_features: ['chat', 'image_generation'],
    routing: {},
  };
}

export async function workspaceUsage(user: Authenticated) {
  const [{ plan, policies, models }, connected] = await Promise.all([
    configuration(user.profile.id),
    connectedProviderSet(user.profile.id),
  ]);
  const counters = await rest<
    { bucket: string; period: string; period_start: string; used: number; reserved: number; extra: number }[]
  >('usage_counters', {
    admin: true,
    query: `user_id=eq.${encodeURIComponent(user.profile.id)}&select=bucket,period,period_start,used,reserved,extra`,
  });
  const p = periods();
  const same = (value: string, epoch: number) => new Date(value).getTime() === epoch;
  const credit = counters.find(
    (row) => row.bucket === 'CREDITS' && row.period === 'MONTHLY' && same(row.period_start, p.month),
  );
  const creditLimit = Math.max(0, plan.monthly_credits + (credit?.extra ?? 0));
  const byok = byokPolicy();
  const byokDaily = counters.find(
    (row) =>
      row.bucket === 'BYOK' &&
      row.period === 'DAILY' &&
      same(row.period_start, p.day),
  );
  const byokMonthly = counters.find(
    (row) =>
      row.bucket === 'BYOK' &&
      row.period === 'MONTHLY' &&
      same(row.period_start, p.month),
  );
  return {
    plan: plan.name,
    features: {
      projects: plan.max_projects > 0,
      workflows: plan.max_workflows > 0,
      maxWorkflowSteps: plan.max_workflow_steps,
    },
    credits: {
      limit: creditLimit,
      used: credit?.used ?? 0,
      reserved: credit?.reserved ?? 0,
      remaining: Math.max(0, creditLimit - (credit?.used ?? 0) - (credit?.reserved ?? 0)),
    },
    resets: {
      daily: p.nextDay.toISOString(),
      monthly: p.nextMonth.toISOString(),
    },
    allowances: policies.map((policy) => {
      const model = models.find((item) => item.id === policy.model_id);
      const daily = counters.find(
        (row) => row.bucket === policy.bucket && row.period === 'DAILY' && same(row.period_start, p.day),
      );
      const monthly = counters.find(
        (row) => row.bucket === policy.bucket && row.period === 'MONTHLY' && same(row.period_start, p.month),
      );
      return {
        bucket: policy.bucket,
        modelName: policy.bucket === 'AUTO' ? 'Auto' : model?.display_name ?? null,
        provider: model?.provider ?? null,
        allowedFeatures: policy.allowed_features,
        creditCosts: {
          chat: !policy.allowed_features.includes('chat')
            ? null
            : policy.bucket === 'AUTO'
              ? autoCredits(policy, 'chat')
              : model
                ? modelCredits(model, policy, 'chat')
                : null,
          image_generation: !policy.allowed_features.includes('image_generation')
            ? null
            : policy.bucket === 'AUTO'
              ? autoCredits(policy, 'image_generation')
              : model
                ? modelCredits(model, policy, 'image_generation')
                : null,
        },
        dailyLimit: policy.daily_limit + (daily?.extra ?? 0),
        monthlyLimit: policy.monthly_limit + (monthly?.extra ?? 0),
        dailyRemaining: Math.max(
          0,
          policy.daily_limit + (daily?.extra ?? 0) - (daily?.used ?? 0) - (daily?.reserved ?? 0),
        ),
        monthlyRemaining: Math.max(
          0,
          policy.monthly_limit + (monthly?.extra ?? 0) - (monthly?.used ?? 0) - (monthly?.reserved ?? 0),
        ),
        maxFiles: policy.max_files,
        maxFileBytes: policy.max_file_bytes,
      };
    }),
    byokAllowance: {
      connectedProviders: [...connected],
      allowedFeatures: byok.allowed_features,
      dailyLimit: byok.daily_limit,
      monthlyLimit: byok.monthly_limit,
      dailyRemaining: Math.max(
        0,
        byok.daily_limit -
          (byokDaily?.used ?? 0) -
          (byokDaily?.reserved ?? 0),
      ),
      monthlyRemaining: Math.max(
        0,
        byok.monthly_limit -
          (byokMonthly?.used ?? 0) -
          (byokMonthly?.reserved ?? 0),
      ),
      maxFiles: byok.max_files,
      maxFileBytes: byok.max_file_bytes,
      creditCosts: { chat: 0, image_generation: 0 },
    },
  };
}

export async function preferences(request: Request, user: Authenticated) {
  if (request.method === 'GET') {
    const rows = await rest<
      { display_name: string; send_on_enter: boolean }[]
    >('user_preferences', {
      token: user.token,
      query: `user_id=eq.${encodeURIComponent(user.profile.id)}&select=display_name,send_on_enter`,
    });
    const value = rows[0] ?? { display_name: user.profile.username, send_on_enter: true };
    return { displayName: value.display_name || user.profile.username, defaultModelId: null, sendOnEnter: value.send_on_enter };
  }
  const input = await bodyJson<Record<string, unknown>>(request);
  const displayName = stringValue(input.displayName, 'Display name', { min: 1, max: 80 });
  const sendOnEnter = input.sendOnEnter !== false;
  const rows = await rest<{ display_name: string; send_on_enter: boolean }[]>(
    'user_preferences',
    {
      token: user.token,
      method: 'POST',
      query: 'on_conflict=user_id',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: { user_id: user.profile.id, display_name: displayName, send_on_enter: sendOnEnter },
    },
  );
  return { displayName: rows[0]?.display_name ?? displayName, defaultModelId: null, sendOnEnter: rows[0]?.send_on_enter ?? sendOnEnter };
}

export async function projectsRoute(
  request: Request,
  user: Authenticated,
  id?: string,
) {
  const plan = await activePlan(user.profile.id);
  if (!id && request.method === 'GET') {
    const rows = await rest<ProjectRow[]>('projects', {
      token: user.token,
      query: 'select=*&order=updated_at.desc',
    });
    return rows.map(mapProject);
  }
  if (!id && request.method === 'POST') {
    if (plan.max_projects <= 0) throw new ApiError('Projects are not included in your plan.', 403);
    const existing = await rest<{ id: string }[]>('projects', {
      token: user.token,
      query: 'archived=eq.false&select=id',
    });
    if (existing.length >= plan.max_projects)
      throw new ApiError('Project limit reached. Upgrade or archive a project.', 403);
    const input = await bodyJson<Record<string, unknown>>(request);
    const data = projectInput(input, plan);
    const rows = await rest<ProjectRow[]>('projects', {
      token: user.token,
      method: 'POST',
      prefer: 'return=representation',
      body: { user_id: user.profile.id, ...data },
    });
    return mapProject(rows[0]!);
  }

  const projectId = routeId(id, 'Project ID');
  if (request.method === 'GET') {
    const rows = await rest<ProjectRow[]>('projects', {
      token: user.token,
      query: `id=eq.${encodeURIComponent(projectId)}&select=*`,
    });
    if (!rows[0]) throw new ApiError('Project not found.', 404);
    const [conversations, prompts, files] = await Promise.all([
      rest<ConversationRow[]>('conversations', {
        token: user.token,
        query: `project_id=eq.${encodeURIComponent(projectId)}&select=*&order=updated_at.desc`,
      }),
      rest<PromptRow[]>('saved_prompts', {
        token: user.token,
        query: `project_id=eq.${encodeURIComponent(projectId)}&select=*`,
      }),
      rest<AttachmentRow[]>('attachments', {
        token: user.token,
        query: `select=*&order=created_at.desc`,
      }),
    ]);
    const conversationIds = new Set(conversations.map((row) => row.id));
    return {
      ...mapProject(rows[0]),
      conversations: conversations.map(mapConversation),
      prompts: prompts.map((row) => ({ id: row.id, title: row.title })),
      files: files
        .filter((row) => conversationIds.has(row.conversation_id))
        .map((row) => ({ ...mapFile(row), conversationId: row.conversation_id })),
    };
  }
  if (request.method === 'PATCH') {
    const input = await bodyJson<Record<string, unknown>>(request);
    const rows = await rest<ProjectRow[]>('projects', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(projectId)}`,
      prefer: 'return=representation',
      body: projectInput(input, plan),
    });
    if (!rows[0]) throw new ApiError('Project not found.', 404);
    return mapProject(rows[0]);
  }
  if (request.method === 'DELETE') {
    await rest('projects', {
      token: user.token,
      method: 'DELETE',
      query: `id=eq.${encodeURIComponent(projectId)}`,
    });
    return { deleted: true, id: projectId };
  }
  throw new ApiError('Method not allowed.', 405);
}

function projectInput(input: Record<string, unknown>, plan: DbPlan) {
  const name = stringValue(input.name, 'Project name', { min: 1, max: 160 });
  const instructions = stringValue(input.instructions ?? '', 'Instructions', { max: 8000, optional: true });
  const context = stringValue(input.context ?? '', 'Project context', {
    max: Math.max(1, plan.project_context_chars),
    optional: true,
  });
  const preferred = input.preferredModelId ? uuid(input.preferredModelId, 'Preferred model') : null;
  return {
    name,
    instructions,
    context,
    preferred_model_id: preferred,
    archived: input.archived === true,
  };
}

export async function conversationsRoute(
  request: Request,
  user: Authenticated,
  id?: string,
) {
  if (!id && request.method === 'GET') {
    const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    const filter = q ? `&title=ilike.${encodeURIComponent(`*${q.replaceAll('*', '')}*`)}` : '';
    const rows = await rest<ConversationRow[]>('conversations', {
      token: user.token,
      query: `select=*&order=updated_at.desc${filter}`,
    });
    return rows.map(mapConversation);
  }
  if (!id && request.method === 'POST') {
    const input = await bodyJson<Record<string, unknown>>(request);
    const title = stringValue(input.title ?? 'New conversation', 'Title', { min: 1, max: 160 });
    const projectId = input.projectId ? uuid(input.projectId, 'Project ID') : null;
    if (projectId) await ownedProject(user, projectId);
    const rows = await rest<ConversationRow[]>('conversations', {
      token: user.token,
      method: 'POST',
      prefer: 'return=representation',
      body: { user_id: user.profile.id, title, project_id: projectId },
    });
    return mapConversation(rows[0]!);
  }

  const conversationId = routeId(id, 'Conversation ID');
  if (request.method === 'GET') return conversationDetail(user, conversationId);
  if (request.method === 'PATCH') {
    const input = await bodyJson<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    if ('title' in input) patch.title = stringValue(input.title, 'Title', { min: 1, max: 160 });
    if ('projectId' in input) {
      patch.project_id = input.projectId ? uuid(input.projectId, 'Project ID') : null;
      if (patch.project_id) await ownedProject(user, String(patch.project_id));
    }
    if (!Object.keys(patch).length) throw new ApiError('No supported changes were provided.');
    const rows = await rest<ConversationRow[]>('conversations', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(conversationId)}`,
      prefer: 'return=representation',
      body: patch,
    });
    if (!rows[0]) throw new ApiError('Conversation not found.', 404);
    return mapConversation(rows[0]);
  }
  if (request.method === 'DELETE') {
    const files = await rest<AttachmentRow[]>('attachments', {
      token: user.token,
      query: `conversation_id=eq.${encodeURIComponent(conversationId)}&select=*`,
    });
    await Promise.allSettled(files.map((file) => storageDelete(file.storage_path)));
    await rest('conversations', {
      token: user.token,
      method: 'DELETE',
      query: `id=eq.${encodeURIComponent(conversationId)}`,
    });
    return { deleted: true, id: conversationId };
  }
  throw new ApiError('Method not allowed.', 405);
}

async function conversationDetail(user: Authenticated, conversationId: string) {
  const rows = await rest<ConversationRow[]>('conversations', {
    token: user.token,
    query: `id=eq.${encodeURIComponent(conversationId)}&select=*`,
  });
  if (!rows[0]) throw new ApiError('Conversation not found.', 404);
  const [messages, attachments] = await Promise.all([
    rest<MessageRow[]>('messages', {
      token: user.token,
      query: `conversation_id=eq.${encodeURIComponent(conversationId)}&select=*&order=created_at.asc`,
    }),
    rest<AttachmentRow[]>('attachments', {
      token: user.token,
      query: `conversation_id=eq.${encodeURIComponent(conversationId)}&select=*&order=created_at.asc`,
    }),
  ]);
  return {
    ...mapConversation(rows[0]),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      modelName: message.model_name ?? undefined,
      routingMode: message.routing_mode ?? undefined,
      status: message.status,
      artifacts: attachments
        .filter((file) => file.kind === 'generated' && file.message_id === message.id)
        .map(mapFile),
    })),
    attachments: attachments.filter((file) => file.kind === 'upload').map(mapFile),
  };
}

export async function promptsRoute(
  request: Request,
  user: Authenticated,
  id?: string,
) {
  if (!id && request.method === 'GET') {
    const rows = await rest<PromptRow[]>('saved_prompts', {
      token: user.token,
      query: 'select=*&order=updated_at.desc',
    });
    return rows.map(mapPrompt);
  }
  if (!id && request.method === 'POST') {
    const input = await bodyJson<Record<string, unknown>>(request);
    const rows = await rest<PromptRow[]>('saved_prompts', {
      token: user.token,
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: user.profile.id,
        title: stringValue(input.title, 'Prompt name', { min: 1, max: 160 }),
        content: stringValue(input.content, 'Prompt', { min: 1, max: 32000 }),
      },
    });
    return mapPrompt(rows[0]!);
  }
  const promptId = routeId(id, 'Prompt ID');
  if (request.method === 'PATCH') {
    const input = await bodyJson<Record<string, unknown>>(request);
    const rows = await rest<PromptRow[]>('saved_prompts', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(promptId)}`,
      prefer: 'return=representation',
      body: {
        title: stringValue(input.title, 'Prompt name', { min: 1, max: 160 }),
        content: stringValue(input.content, 'Prompt', { min: 1, max: 32000 }),
      },
    });
    if (!rows[0]) throw new ApiError('Saved prompt not found.', 404);
    return mapPrompt(rows[0]);
  }
  if (request.method === 'DELETE') {
    await rest('saved_prompts', {
      token: user.token,
      method: 'DELETE',
      query: `id=eq.${encodeURIComponent(promptId)}`,
    });
    return { deleted: true, id: promptId };
  }
  throw new ApiError('Method not allowed.', 405);
}

export async function fileRoute(
  request: Request,
  user: Authenticated,
  fileId: string,
) {
  const id = routeId(fileId, 'File ID');
  const rows = await rest<AttachmentRow[]>('attachments', {
    token: user.token,
    query: `id=eq.${encodeURIComponent(id)}&select=*`,
  });
  const file = rows[0];
  if (!file) throw new ApiError('File not found.', 404);
  if (request.method === 'GET') {
    const response = await storageDownload(file.storage_path);
    return new Response(response.body, {
      status: 200,
      headers: {
        'content-type': file.mime_type,
        'content-length': String(file.size_bytes),
        'content-disposition': `inline; filename="${file.name.replaceAll('"', '')}"`,
        'cache-control': 'private, no-store',
      },
    });
  }
  if (request.method === 'DELETE') {
    await storageDelete(file.storage_path);
    await rest('attachments', {
      token: user.token,
      method: 'DELETE',
      query: `id=eq.${encodeURIComponent(id)}`,
    });
    return json({ deleted: true, id });
  }
  throw new ApiError('Method not allowed.', 405);
}

export async function uploadFile(
  request: Request,
  user: Authenticated,
  conversationId: string,
) {
  const id = routeId(conversationId, 'Conversation ID');
  await ownedConversation(user, id);
  const { policies } = await configuration(user.profile.id);
  const maxBytes = Math.max(0, ...policies.map((policy) => policy.max_file_bytes));
  const maxFiles = Math.max(0, ...policies.map((policy) => policy.max_files));
  if (!maxFiles) throw new ApiError('File uploads are not included in your plan.', 403);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError('Choose a file to upload.');
  if (!file.size || file.size > maxBytes) throw new ApiError('This file exceeds your plan file limit.', 413);
  const lower = file.name.toLowerCase();
  const mime =
    /\.(txt|md|csv)$/.test(lower)
      ? 'text/plain'
      : file.type;
  if (
    mime !== 'text/plain' &&
    mime !== 'application/pdf' &&
    !mime.startsWith('image/')
  )
    throw new ApiError('Only text, PDF, and image files are supported.', 415);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const storagePath = `${user.profile.id}/${id}/${randomUUID()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await storageUpload(storagePath, bytes, mime);
  try {
    const rows = await rest<AttachmentRow[]>('attachments', {
      token: user.token,
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: user.profile.id,
        conversation_id: id,
        name: file.name.slice(0, 180),
        mime_type: mime,
        size_bytes: bytes.byteLength,
        storage_path: storagePath,
        kind: 'upload',
      },
    });
    return mapFile(rows[0]!);
  } catch (error) {
    await storageDelete(storagePath).catch(() => {});
    throw error;
  }
}

export async function workflowsRoute(
  request: Request,
  user: Authenticated,
  id?: string,
  child?: string,
) {
  const plan = await activePlan(user.profile.id);
  if (!id && request.method === 'GET') {
    const rows = await rest<WorkflowRow[]>('workflows', {
      token: user.token,
      query: 'select=*&order=updated_at.desc',
    });
    return rows.map(mapWorkflow);
  }
  if (!id && request.method === 'POST') {
    if (plan.max_workflows <= 0) throw new ApiError('Workflows are not included in your plan.', 403);
    const existing = await rest<{ id: string }[]>('workflows', {
      token: user.token,
      query: 'select=id',
    });
    if (existing.length >= plan.max_workflows) throw new ApiError('Workflow limit reached.', 403);
    const input = await bodyJson<Record<string, unknown>>(request);
    const data = await workflowInput(input, user, plan);
    const rows = await rest<WorkflowRow[]>('workflows', {
      token: user.token,
      method: 'POST',
      prefer: 'return=representation',
      body: { user_id: user.profile.id, ...data },
    });
    return mapWorkflow(rows[0]!);
  }

  const workflowId = routeId(id, 'Workflow ID');
  if (child === 'runs') {
    if (request.method === 'GET') {
      const rows = await rest<RunRow[]>('workflow_runs', {
        token: user.token,
        query: `workflow_id=eq.${encodeURIComponent(workflowId)}&select=*&order=created_at.desc&limit=50`,
      });
      return rows.map(mapRun);
    }
    if (request.method === 'POST') return runWorkflow(request, user, workflowId);
  }
  if (request.method === 'PATCH') {
    const input = await bodyJson<Record<string, unknown>>(request);
    const data = await workflowInput(input, user, plan);
    const rows = await rest<WorkflowRow[]>('workflows', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(workflowId)}`,
      prefer: 'return=representation',
      body: data,
    });
    if (!rows[0]) throw new ApiError('Workflow not found.', 404);
    return mapWorkflow(rows[0]);
  }
  if (request.method === 'DELETE') {
    await rest('workflows', {
      token: user.token,
      method: 'DELETE',
      query: `id=eq.${encodeURIComponent(workflowId)}`,
    });
    return { deleted: true, id: workflowId };
  }
  throw new ApiError('Method not allowed.', 405);
}

async function workflowInput(input: Record<string, unknown>, user: Authenticated, plan: DbPlan) {
  const projectId = uuid(input.projectId, 'Project ID');
  await ownedProject(user, projectId);
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (!rawSteps.length || rawSteps.length > plan.max_workflow_steps)
    throw new ApiError(`A workflow must have 1 to ${plan.max_workflow_steps} steps.`);
  const steps = rawSteps.map((value, index) => {
    if (!value || typeof value !== 'object') throw new ApiError(`Step ${index + 1} is invalid.`);
    const step = value as Record<string, unknown>;
    return {
      name: stringValue(step.name, `Step ${index + 1} name`, { min: 1, max: 120 }),
      prompt: stringValue(step.prompt, `Step ${index + 1} instructions`, { min: 1, max: 8000 }),
      modelId: step.modelId ? uuid(step.modelId, 'Model ID') : null,
    };
  });
  return {
    project_id: projectId,
    name: stringValue(input.name, 'Workflow name', { min: 1, max: 160 }),
    steps,
    enabled: input.enabled !== false,
  };
}

async function runWorkflow(request: Request, user: Authenticated, workflowId: string) {
  const input = await bodyJson<Record<string, unknown>>(request);
  const requestId = uuid(input.requestId, 'Request ID');
  const initial = stringValue(input.input ?? '', 'Workflow input', { min: 1, max: 32000 });
  const rows = await rest<WorkflowRow[]>('workflows', {
    token: user.token,
    query: `id=eq.${encodeURIComponent(workflowId)}&select=*`,
  });
  const workflow = rows[0];
  if (!workflow || !workflow.enabled) throw new ApiError('Workflow is unavailable.', 404);
  const project = await ownedProject(user, workflow.project_id);

  const conversations = await rest<ConversationRow[]>('conversations', {
    token: user.token,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: user.profile.id,
      project_id: workflow.project_id,
      title: `${workflow.name} run`.slice(0, 160),
    },
  });
  const conversation = conversations[0]!;
  const runRows = await rest<RunRow[]>('workflow_runs', {
    token: user.token,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: user.profile.id,
      workflow_id: workflow.id,
      conversation_id: conversation.id,
      request_id: requestId,
      status: 'RESERVED',
    },
  });
  const run = runRows[0]!;
  let value = initial;
  let completed = 0;
  try {
    const cfg = await configuration(user.profile.id);
    const system = projectSystem(project, cfg.plan);
    for (const step of workflow.steps) {
      const prompt = `${step.prompt}\n\nInput:\n${value}`;
      const policy = findPolicy(cfg.policies, step.modelId ? 'MANUAL' : 'AUTO', step.modelId);
      const model = resolveModel(
        cfg.models,
        policy,
        step.modelId ? 'MANUAL' : 'AUTO',
        'chat',
        { prompt },
      );
      if (!model) throw new ApiError('No configured model is available for this workflow step.', 503);
      value = await generateOnce(user, cfg.plan, policy, model, conversation.id, prompt, system);
      completed += 1;
      await rest('workflow_runs', {
        token: user.token,
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(run.id)}`,
        body: { completed_steps: completed },
      });
    }
    const updated = await rest<RunRow[]>('workflow_runs', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(run.id)}`,
      prefer: 'return=representation',
      body: { status: 'SUCCEEDED', completed_steps: completed, finished_at: new Date().toISOString() },
    });
    return mapRun(updated[0]!);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow failed.';
    const updated = await rest<RunRow[]>('workflow_runs', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(run.id)}`,
      prefer: 'return=representation',
      body: { status: 'FAILED', completed_steps: completed, error: message.slice(0, 500), finished_at: new Date().toISOString() },
    });
    return mapRun(updated[0]!);
  }
}

async function updateSharedNvidiaHealth(
  model: DbModel,
  healthy: boolean,
  message: string,
) {
  if (
    model.provider !== 'NVIDIA' ||
    model.source !== 'NVIDIA_DISCOVERED'
  )
    return;

  const now = new Date().toISOString();
  await rest('ai_models', {
    admin: true,
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(model.id)}`,
    body: {
      enabled: healthy,
      manual_available: healthy,
      auto_available: healthy,
      free_endpoint: healthy,
      health_status: healthy ? 'HEALTHY' : 'DEGRADED',
      health_checked_at: now,
      health_message: message,
      health_failure_count: healthy
        ? 0
        : (model.health_failure_count ?? 0) + 1,
      ...(healthy
        ? { last_success_at: now }
        : { last_failure_at: now }),
    },
  }).catch(() => {});
}

async function generateOnce(
  user: Authenticated,
  plan: DbPlan,
  policy: DbPolicy,
  model: DbModel,
  conversationId: string,
  prompt: string,
  system: string,
) {
  const creditUnits = modelCredits(model, policy, 'chat');
  if (!creditUnits) throw new ApiError('This model does not have safe pricing configured.', 409);
  const requestId = randomUUID();
  await reserve(user.profile.id, requestId, policy, plan, creditUnits, createHash('sha256').update(prompt).digest('hex'));
  const userMessage = await insertMessage(user, conversationId, 'user', prompt, 'SUCCEEDED', null, null, null, requestId);
  const assistant = await insertMessage(user, conversationId, 'assistant', '', 'RESERVED', model.id, model.display_name, policy.bucket === 'AUTO' ? 'AUTO' : 'MANUAL', requestId);
  let output = '';
  const usage = emptyUsage();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.max_duration_seconds * 1000);
  try {
    await streamProvider(
      model,
      [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
      [],
      Math.min(policy.max_output, model.max_output),
      controller.signal,
      (text) => { output += text; },
      usage,
      { feature: 'chat' },
    );
    if (!output.trim()) throw new ProviderFailure('EMPTY_RESPONSE');
    await updateSharedNvidiaHealth(
      model,
      true,
      'A live generation completed successfully.',
    );
    await rest('messages', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(assistant.id)}`,
      body: { content: output, status: 'SUCCEEDED' },
    });
    await recordUsage(user.profile.id, requestId, model, usage, creditUnits, 'chat', prompt, output, false);
    await rpc('finalize_generation', { p_request_id: requestId, p_status: 'SUCCEEDED', p_consume: true });
    await touchConversation(user, conversationId);
    return output;
  } catch (error) {
    if (error instanceof ProviderFailure)
      await updateSharedNvidiaHealth(
        model,
        false,
        `Live generation failed: ${error.category}`,
      );
    await rest('messages', {
      token: user.token,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(assistant.id)}`,
      body: { content: output, status: 'FAILED' },
    }).catch(() => {});
    await rpc('finalize_generation', {
      p_request_id: requestId,
      p_status: 'FAILED',
      p_consume: false,
    }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    void userMessage;
  }
}

export async function streamMessage(
  request: Request,
  user: Authenticated,
  conversationId: string,
) {
  const id = routeId(conversationId, 'Conversation ID');
  const conversation = await ownedConversation(user, id);
  const input = await bodyJson<Record<string, unknown>>(request);
  const requestId = uuid(input.requestId, 'Request ID');
  const feature: CreditFeature =
    input.feature === 'image_generation' ? 'image_generation' : 'chat';
  const mode =
    input.mode === 'BYOK'
      ? 'BYOK'
      : input.mode === 'MANUAL'
        ? 'MANUAL'
        : 'AUTO';
  const modelId = mode === 'AUTO' ? null : uuid(input.modelId, 'Model ID');
  const content = stringValue(input.content, 'Message', { min: 1, max: 64000 });
  const attachmentIds = Array.isArray(input.attachmentIds)
    ? input.attachmentIds.map((value) => uuid(value, 'Attachment ID'))
    : [];
  const selectedAttachments = await selectedAttachmentRows(
    user,
    id,
    attachmentIds,
  );
  const requiredCapabilities = [
    ...new Set(
      selectedAttachments.flatMap((file) =>
        file.mime_type === 'application/pdf'
          ? ['files']
          : file.mime_type.startsWith('image/')
            ? ['vision']
            : [],
      ),
    ),
  ];
  const cfg = await configuration(user.profile.id);
  let policy: DbPolicy;
  let model: DbModel | undefined;
  let candidateModels: DbModel[] = [];
  let userApiKey: string | undefined;

  if (mode === 'BYOK') {
    policy = byokPolicy();
    model = cfg.models.find((item) => item.id === modelId);
    if (!model || !model.enabled || model.maintenance || !model.manual_available)
      throw new ApiError('This model is unavailable.', 404);
    userApiKey =
      (await getUserProviderKey(user.profile.id, model.provider)) ?? undefined;
    if (!userApiKey)
      throw new ApiError(
        `Connect your ${model.provider} API key in Settings before using BYO mode.`,
        403,
      );
    candidateModels = [model];
  } else if (mode === 'MANUAL' && cfg.plan.code === 'FREE') {
    policy = findPolicy(cfg.policies, 'AUTO', null);
    model = resolveFreeManualModel(cfg.models, policy, modelId, feature);
    if (!model)
      throw new ApiError('This model is not included in your plan.', 403);
    candidateModels = [model];
  } else {
    policy = findPolicy(cfg.policies, mode, modelId);
    candidateModels =
      mode === 'AUTO'
        ? chooseAutoModels(cfg.models, policy, feature, {
            prompt: content,
            requiredCapabilities,
          })
        : resolveModel(cfg.models, policy, mode, feature, {
            prompt: content,
            requiredCapabilities,
          })
          ? [
              resolveModel(cfg.models, policy, mode, feature, {
                prompt: content,
                requiredCapabilities,
              })!,
            ]
          : [];
    model = candidateModels[0];
  }

  if (!policy.allowed_features.includes(feature))
    throw new ApiError('This task is not included in the selected allowance.', 403);
  if (content.length > policy.max_input_chars)
    throw new ApiError('This message is longer than the selected allowance.', 413);
  if (attachmentIds.length > policy.max_files)
    throw new ApiError('Too many files are selected for this request.', 413);

  if (!model) throw new ApiError('No configured model can safely handle this request.', 503);
  if (
    feature === 'image_generation' &&
    !model.capabilities.includes('image_generation')
  )
    throw new ApiError('This model does not support image generation.', 403);

  const serverCredits =
    mode === 'BYOK'
      ? 0
      : mode === 'AUTO'
        ? autoCredits(policy, feature)
        : modelCredits(model, policy, feature);
  if (serverCredits === null || serverCredits === undefined)
    throw new ApiError('Pricing for this model is not configured safely.', 409);

  if (mode !== 'BYOK') {
    const maxCredits = integerValue(
      input.maxCredits ?? serverCredits,
      'Maximum credits',
      1,
      100000,
    );
    if (serverCredits > maxCredits)
      throw new ApiError(
        `This task now costs ${serverCredits} credits. Refresh usage before sending.`,
        409,
      );
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ id, content, attachmentIds, feature, mode, modelId }))
    .digest('hex');
  await reserve(user.profile.id, requestId, policy, cfg.plan, serverCredits, fingerprint);

  if (!input.regenerateMessageId)
    await insertMessage(user, id, 'user', content, 'SUCCEEDED', null, null, null, requestId);
  const assistant = await insertMessage(
    user,
    id,
    'assistant',
    '',
    'RESERVED',
    model.id,
    model.display_name,
    mode,
    requestId,
  );

  const history = await rest<MessageRow[]>('messages', {
    token: user.token,
    query: `conversation_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc&limit=40`,
  });
  const project = conversation.project_id ? await ownedProject(user, conversation.project_id) : null;
  const system = project ? projectSystem(project, cfg.plan) : '';
  const providerMessages: ProviderMessage[] = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...history
      .filter((message) => message.id !== assistant.id && message.status === 'SUCCEEDED')
      .slice(-30)
      .map((message) => ({ role: message.role, content: message.content })),
    ...(input.regenerateMessageId ? [{ role: 'user', content: 'Regenerate the previous answer.' }] : []),
  ];

  const encoder = new TextEncoder();
  const responseStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected.
        }
      };
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      request.signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => abort.abort(), policy.max_duration_seconds * 1000);
      void (async () => {
        let output = '';
        let generated = false;
        let usage = emptyUsage();
        try {
          const configuredAttempts = Number(policy.routing?.maxAttempts ?? 3);
          const maxAttempts =
            mode === 'AUTO' && Number.isInteger(configuredAttempts)
              ? configuredAttempts
              : 1;
          const attemptResult = await runAutoAttempts(
            candidateModels,
            maxAttempts,
            async (candidate, control) => {
              let attemptOutput = '';
              let attemptGenerated = false;
              const attemptUsage = emptyUsage();
              push({ type: 'model', model: candidate.display_name, mode });
              try {
                const files = await loadFiles(selectedAttachments, policy, candidate);
                await streamProvider(
                  candidate,
                  providerMessages,
                  files,
                  Math.min(policy.max_output, candidate.max_output),
                  abort.signal,
                  (text) => {
                    control.markOutput();
                    attemptOutput += text;
                    push({ type: 'delta', text });
                  },
                  attemptUsage,
                  {
                    feature,
                    apiKey: userApiKey,
                    image: async (mimeType, base64) => {
                      const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
                      if (bytes.byteLength > 10_000_000)
                        throw new ProviderFailure('OUTPUT_LIMIT', false);
                      const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
                      const storagePath = `${user.profile.id}/${id}/generated-${randomUUID()}.${ext}`;
                      await storageUpload(storagePath, bytes, mimeType);
                      try {
                        const rows = await rest<AttachmentRow[]>('attachments', {
                          token: user.token,
                          method: 'POST',
                          prefer: 'return=representation',
                          body: {
                            user_id: user.profile.id,
                            conversation_id: id,
                            message_id: assistant.id,
                            name: `vrompt-image.${ext}`,
                            mime_type: mimeType,
                            size_bytes: bytes.byteLength,
                            storage_path: storagePath,
                            kind: 'generated',
                          },
                        });
                        attemptGenerated = true;
                        control.markArtifact();
                        push({ type: 'artifact', artifact: mapFile(rows[0]!) });
                      } catch (error) {
                        await storageDelete(storagePath).catch(() => {});
                        throw error;
                      }
                    },
                  },
                );
                if (!attemptOutput.trim() && !attemptGenerated)
                  throw new ProviderFailure('EMPTY_RESPONSE');
                if (mode !== 'BYOK')
                  await updateSharedNvidiaHealth(
                    candidate,
                    true,
                    'A live generation completed successfully.',
                  );
                return {
                  output: attemptOutput,
                  generated: attemptGenerated,
                  usage: attemptUsage,
                };
              } catch (error) {
                output = attemptOutput;
                generated = attemptGenerated;
                usage = attemptUsage;
                if (mode !== 'BYOK' && error instanceof ProviderFailure)
                  await updateSharedNvidiaHealth(
                    candidate,
                    false,
                    `Live generation failed: ${error.category}`,
                  );
                throw error;
              }
            },
          );
          model = attemptResult.model;
          output = attemptResult.value.output;
          generated = attemptResult.value.generated;
          usage = attemptResult.value.usage;
          await rest('messages', {
            token: user.token,
            method: 'PATCH',
            query: `id=eq.${encodeURIComponent(assistant.id)}`,
            body: {
              content: output,
              status: 'SUCCEEDED',
              model_id: model.id,
              model_name: model.display_name,
            },
          });
          await recordUsage(
            user.profile.id,
            requestId,
            model,
            usage,
            serverCredits,
            feature,
            providerMessages.map((item) => item.content).join('\n'),
            output,
            generated,
            mode === 'BYOK',
          );
          await rpc('finalize_generation', {
            p_request_id: requestId,
            p_status: 'SUCCEEDED',
            p_consume: true,
          });
          await touchConversation(user, id);
          push({
            type: 'done',
            status: 'SUCCEEDED',
            messageId: assistant.id,
            usage: await workspaceUsage(user),
          });
        } catch (error) {
          if (mode !== 'BYOK' && model && error instanceof ProviderFailure)
            await updateSharedNvidiaHealth(
              model,
              false,
              `Live generation failed: ${error.category}`,
            );
          await rest('messages', {
            token: user.token,
            method: 'PATCH',
            query: `id=eq.${encodeURIComponent(assistant.id)}`,
            body: { content: output, status: 'FAILED' },
          }).catch(() => {});
          await rpc('finalize_generation', {
            p_request_id: requestId,
            p_status:
              error instanceof DOMException && error.name === 'AbortError'
                ? 'INTERRUPTED'
                : 'FAILED',
            p_consume: false,
          }).catch(() => {});
          push({
            type: 'error',
            message:
              error instanceof ProviderFailure
                ? 'The selected AI model could not complete this response. Please retry or switch models.'
                : error instanceof Error
                  ? error.message
                  : 'The response could not be completed.',
          });
          push({
            type: 'done',
            status: 'FAILED',
            messageId: assistant.id,
            usage: await workspaceUsage(user).catch(() => undefined),
          });
        } finally {
          clearTimeout(timer);
          request.signal.removeEventListener('abort', onAbort);
          try { controller.close(); } catch {}
        }
      })();
    },
  });

  return new Response(responseStream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-content-type-options': 'nosniff',
    },
  });
}

function findPolicy(policies: DbPolicy[], mode: 'AUTO' | 'MANUAL', modelId: string | null) {
  const bucket = mode === 'AUTO' ? 'AUTO' : modelId;
  const policy = policies.find((item) => item.bucket === bucket && item.enabled);
  if (!policy) throw new ApiError('This model is not included in your plan.', 403);
  return policy;
}

function resolveModel(
  models: DbModel[],
  policy: DbPolicy,
  mode: 'AUTO' | 'MANUAL',
  feature: CreditFeature,
  context: {
    prompt?: string;
    requiredCapabilities?: string[];
  } = {},
) {
  if (mode === 'AUTO')
    return chooseAutoModel(models, policy, feature, context);
  const model = models.find((item) => item.id === policy.model_id);
  if (
    !model ||
    !model.enabled ||
    model.maintenance ||
    !providerConfigured(model.provider) ||
    (model.provider === 'NVIDIA' && model.health_status !== 'HEALTHY') ||
    (feature === 'image_generation' && !model.capabilities.includes('image_generation'))
  )
    return undefined;
  return model;
}

async function reserve(
  userId: string,
  requestId: string,
  policy: DbPolicy,
  plan: DbPlan,
  creditUnits: number,
  fingerprint: string,
) {
  try {
    await rpc('reserve_generation', {
      p_request_id: requestId,
      p_user_id: userId,
      p_bucket: policy.bucket,
      p_fingerprint: fingerprint,
      p_credit_units: creditUnits,
      p_plan_credit_limit: plan.monthly_credits,
      p_daily_limit: policy.daily_limit,
      p_monthly_limit: policy.monthly_limit,
      p_concurrency: policy.concurrency,
      p_rate_per_minute: policy.rate_per_minute,
      p_ttl_seconds: policy.max_duration_seconds + 60,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('duplicate_request')) throw new ApiError('This request has already been submitted.', 409);
    if (message.includes('credit_limit')) throw new ApiError('Monthly credits reached. Upgrade or wait for reset.', 403);
    if (message.includes('daily_limit')) throw new ApiError('Daily generation limit reached.', 403);
    if (message.includes('monthly_limit')) throw new ApiError('Monthly generation limit reached.', 403);
    if (message.includes('concurrency_limit')) throw new ApiError('Another response is still generating.', 429);
    if (message.includes('rate_limit')) throw new ApiError('Please wait before sending another request.', 429);
    throw error;
  }
}

async function insertMessage(
  user: Authenticated,
  conversationId: string,
  role: string,
  content: string,
  status: string,
  modelId: string | null,
  modelName: string | null,
  routingMode: string | null,
  requestId: string,
) {
  const rows = await rest<MessageRow[]>('messages', {
    token: user.token,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: user.profile.id,
      conversation_id: conversationId,
      role,
      content,
      status,
      model_id: modelId,
      model_name: modelName,
      routing_mode: routingMode,
      request_id: requestId,
    },
  });
  return rows[0]!;
}

async function recordUsage(
  userId: string,
  requestId: string,
  model: DbModel,
  usage: ReturnType<typeof emptyUsage>,
  creditUnits: number,
  feature: CreditFeature,
  inputText: string,
  outputText: string,
  generatedImage: boolean,
  userOwnedProviderCost = false,
) {
  const normalized = usage.reported
    ? usage
    : {
        ...usage,
        input: Math.ceil(inputText.length / 4),
        output: Math.ceil(outputText.length / 4),
      };
  const estimatedCost = userOwnedProviderCost
    ? 0
    : actualProviderCost(model, {
        inputTokens: normalized.input,
        cachedInputTokens: normalized.cached,
        cacheWriteInputTokens: normalized.cacheWrite,
        outputTokens: normalized.output,
        imageCostUsd: generatedImage
          ? Number(model.image_max_cost_usd ?? 0)
          : 0,
      });
  await rest('usage_records', {
    admin: true,
    method: 'POST',
    body: {
      user_id: userId,
      request_id: requestId,
      model_id: model.id,
      provider: model.provider,
      model_name: model.display_name,
      currency: 'USD',
      input_tokens: normalized.input,
      cached_input_tokens: normalized.cached,
      output_tokens: normalized.output,
      credit_units: creditUnits,
      estimated_cost: estimatedCost,
      feature,
      credential_mode: userOwnedProviderCost ? 'BYOK' : 'VROMPT',
    },
  });
}

async function selectedAttachmentRows(
  user: Authenticated,
  conversationId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  const rows = await rest<AttachmentRow[]>('attachments', {
    token: user.token,
    query: `conversation_id=eq.${encodeURIComponent(conversationId)}&select=*`,
  });
  const wanted = rows.filter(
    (row) => ids.includes(row.id) && row.kind === 'upload',
  );
  if (wanted.length !== ids.length)
    throw new ApiError('One or more selected files are unavailable.', 404);
  return wanted;
}

async function loadFiles(
  selected: AttachmentRow[],
  policy: DbPolicy,
  model: DbModel,
): Promise<ProviderFile[]> {
  if (!selected.length) return [];
  for (const file of selected) {
    if (Number(file.size_bytes) > policy.max_file_bytes)
      throw new ApiError('A selected file exceeds your plan limit.', 413);
    if (
      file.mime_type === 'application/pdf' &&
      !model.capabilities.includes('files')
    )
      throw new ApiError('The selected model does not support PDF files.', 409);
    if (
      file.mime_type.startsWith('image/') &&
      !model.capabilities.includes('vision')
    )
      throw new ApiError('The selected model does not support image input.', 409);
  }
  return Promise.all(
    selected.map(async (file) => {
      const response = await storageDownload(file.storage_path);
      return {
        name: file.name,
        mimeType: file.mime_type,
        data: new Uint8Array(await response.arrayBuffer()),
      };
    }),
  );
}

async function ownedProject(user: Authenticated, id: string) {
  const rows = await rest<ProjectRow[]>('projects', {
    token: user.token,
    query: `id=eq.${encodeURIComponent(id)}&select=*`,
  });
  if (!rows[0]) throw new ApiError('Project not found.', 404);
  return rows[0];
}

async function ownedConversation(user: Authenticated, id: string) {
  const rows = await rest<ConversationRow[]>('conversations', {
    token: user.token,
    query: `id=eq.${encodeURIComponent(id)}&select=*`,
  });
  if (!rows[0]) throw new ApiError('Conversation not found.', 404);
  return rows[0];
}

function projectSystem(project: ProjectRow, plan: DbPlan) {
  const context = project.context.slice(0, plan.project_context_chars);
  return [
    project.instructions ? `Project instructions:\n${project.instructions}` : '',
    context ? `Project reference context:\n${context}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function touchConversation(user: Authenticated, id: string) {
  await rest('conversations', {
    token: user.token,
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(id)}`,
    body: { updated_at: new Date().toISOString() },
  });
}
