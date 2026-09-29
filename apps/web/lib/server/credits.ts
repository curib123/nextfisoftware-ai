import 'server-only';

export const PROVIDER_USD_PER_CREDIT = 0.008;

export type DbModel = {
  id: string;
  provider: 'OPENAI' | 'GOOGLE' | 'ANTHROPIC' | 'MISTRAL' | 'NVIDIA';
  provider_model_id: string;
  display_name: string;
  description: string;
  category?: string;
  capabilities: string[];
  capability_states: Record<string, string> | null;
  reasoning_levels: string[];
  default_reasoning_level: string;
  enabled: boolean;
  manual_available: boolean;
  auto_available: boolean;
  maintenance: boolean;
  quality_tier: number;
  routing_priority: number;
  routing_cost_score: number | string;
  input_price: number | string;
  cached_input_price: number | string;
  output_price: number | string;
  cache_write_input_price: number | string;
  image_max_cost_usd: number | string | null;
  credit_cost: number;
  max_context: number;
  max_output: number;
  currency: string;
  best_for?: string[];
  quick_facts?: Record<string, unknown>;
  details?: Record<string, unknown>;
  free_endpoint?: boolean;
  source?: 'MANUAL' | 'NVIDIA_DISCOVERED';
  health_status?: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'NOT_CONFIGURED';
  health_checked_at?: string | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  health_failure_count?: number;
  health_message?: string | null;
};

export type DbPlan = {
  id: string;
  code: string;
  name: string;
  description: string;
  original_price: number;
  currency: string;
  billing_interval: string;
  interval_count: number;
  monthly_credits: number;
  max_projects: number;
  max_workflows: number;
  max_workflow_steps: number;
  project_context_chars: number;
  is_active: boolean;
  display_order: number;
};

export type DbPolicy = {
  id: string;
  plan_id: string;
  bucket: string;
  model_id: string | null;
  enabled: boolean;
  daily_limit: number;
  monthly_limit: number;
  max_input_chars: number;
  max_context: number;
  max_output: number;
  max_files: number;
  max_file_bytes: number;
  max_duration_seconds: number;
  concurrency: number;
  rate_per_minute: number;
  allowed_features: string[];
  routing: Record<string, unknown> | null;
};

export type CreditFeature = 'chat' | 'image_generation';

export function requestCostBound(
  model: DbModel,
  policy: DbPolicy,
  feature: CreditFeature = 'chat',
) {
  if (model.currency !== 'USD') return Infinity;
  const input = Number(model.input_price);
  const cached = Number(model.cached_input_price);
  const cacheWrite = Number(model.cache_write_input_price);
  const output = Number(model.output_price);
  const rates = [input, cached, cacheWrite, output];
  if (rates.some((v) => !Number.isFinite(v) || v < 0)) return Infinity;
  const context = Math.min(policy.max_context, model.max_context);
  const maxOutput = Math.min(policy.max_output, model.max_output);
  let outputCost = (maxOutput * output) / 1_000_000;
  if (feature === 'image_generation') {
    const imageCost = Number(model.image_max_cost_usd);
    if (!Number.isFinite(imageCost) || imageCost <= 0) return Infinity;
    outputCost = Math.max(outputCost, imageCost);
  }
  return (context * Math.max(input, cached, cacheWrite)) / 1_000_000 + outputCost;
}

export function modelCredits(
  model: DbModel,
  policy: DbPolicy,
  feature: CreditFeature = 'chat',
) {
  const bound = requestCostBound(model, policy, feature);
  if (!Number.isFinite(bound)) return null;
  return Math.max(
    Math.max(1, model.credit_cost || 1),
    Math.ceil(bound / PROVIDER_USD_PER_CREDIT - 1e-10),
  );
}

export function autoCredits(policy: DbPolicy, feature: CreditFeature = 'chat') {
  const routing = policy.routing ?? {};
  const value = Number(
    feature === 'image_generation'
      ? routing.imageCreditCost
      : (routing.creditCost ?? 1),
  );
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function providerConfigured(provider: DbModel['provider']) {
  return Boolean(
    (
      {
        OPENAI: process.env.OPENAI_API_KEY,
        GOOGLE: process.env.GOOGLE_AI_API_KEY,
        ANTHROPIC: process.env.ANTHROPIC_API_KEY,
        MISTRAL: process.env.MISTRAL_API_KEY,
        NVIDIA: process.env.NVIDIA_API_KEY,
      } as const
    )[provider]?.trim(),
  );
}

export type AutoRouteContext = {
  prompt?: string;
  requiredCapabilities?: string[];
};

function capabilityAvailable(model: DbModel, capability: string) {
  return (
    model.capabilities.includes(capability) &&
    model.capability_states?.[capability] !== 'UNAVAILABLE'
  );
}

export function isFreeEndpointEligible(
  model: DbModel,
  feature: CreditFeature = 'chat',
  access: 'manual' | 'auto' = 'manual',
) {
  return (
    model.free_endpoint === true &&
    (access === 'auto' ? model.auto_available : model.manual_available) &&
    modelOperational(model) &&
    capabilityAvailable(
      model,
      feature === 'image_generation' ? 'image_generation' : 'text',
    )
  );
}

export function modelOperational(model: DbModel) {
  if (
    !model.enabled ||
    model.maintenance ||
    !providerConfigured(model.provider)
  )
    return false;

  if (model.provider === 'NVIDIA')
    return model.health_status === 'HEALTHY';

  return !['UNHEALTHY', 'NOT_CONFIGURED'].includes(
    model.health_status ?? 'UNKNOWN',
  );
}

function autoSignals(prompt = '') {
  const value = prompt.toLowerCase();
  const signals = new Set<string>();

  if (
    /\b(code|coding|debug|bug|typescript|javascript|python|sql|api|refactor|function|class|repository|repo)\b/.test(
      value,
    )
  )
    signals.add('coding');
  if (
    /\b(reason|reasoning|analy[sz]e|analysis|compare|evaluate|solve|math|logic|architecture|trade-?off)\b/.test(
      value,
    )
  )
    signals.add('reasoning');
  if (
    /\b(write|rewrite|draft|email|essay|story|caption|copy|grammar|tone)\b/.test(
      value,
    )
  )
    signals.add('writing');
  if (/\b(image|photo|screenshot|diagram|visual|picture)\b/.test(value))
    signals.add('vision');
  if (/\b(pdf|document|file|attachment|spreadsheet|csv)\b/.test(value))
    signals.add('files');
  if (
    value.length > 12000 ||
    /\b(long context|large document|entire document|whole file|full document)\b/.test(
      value,
    )
  )
    signals.add('long_context');
  if (!signals.size) signals.add('general');

  return signals;
}

function autoFitScore(model: DbModel, context: AutoRouteContext) {
  const signals = autoSignals(context.prompt);
  const tagText = [
    model.display_name,
    model.description,
    model.category ?? '',
    ...(model.best_for ?? []),
  ]
    .join(' ')
    .toLowerCase();

  let score = model.quality_tier * 18 + model.routing_priority * 0.35;
  if (model.health_status === 'HEALTHY') score += 3;

  const capabilityWeights: Record<string, number> = {
    coding: 34,
    reasoning: 38,
    vision: 30,
    files: 30,
    long_context: 34,
  };
  for (const [capability, weight] of Object.entries(capabilityWeights)) {
    if (signals.has(capability) && capabilityAvailable(model, capability))
      score += weight;
  }

  if (
    signals.has('writing') &&
    /writing|draft|instruction|chat|creative/.test(tagText)
  )
    score += 26;
  if (
    signals.has('general') &&
    /general|everyday|chat|fast/.test(tagText)
  )
    score += 14;
  if (signals.has('coding') && /coding|debug|code/.test(tagText)) score += 16;
  if (signals.has('reasoning') && /reason|problem|analysis/.test(tagText))
    score += 16;
  if (signals.has('vision') && /vision|image|visual|multimodal/.test(tagText))
    score += 12;
  if (signals.has('files') && /file|document|context/.test(tagText)) score += 12;
  if (
    signals.has('long_context') &&
    /long.?context|document|context/.test(tagText)
  )
    score += 14;

  return score;
}

export function chooseAutoModels(
  models: DbModel[],
  policy: DbPolicy,
  feature: CreditFeature,
  context: AutoRouteContext = {},
) {
  const routing = policy.routing ?? {};

  if (feature === 'image_generation') {
    const imageId = String(routing.imageModelId ?? '');
    const image = models.find(
      (model) =>
        model.id === imageId &&
        modelOperational(model) &&
        capabilityAvailable(model, 'image_generation'),
    );
    return image ? [image] : [];
  }

  const ids = Array.isArray(routing.allowedModelIds)
    ? routing.allowedModelIds.map(String)
    : [];
  const budgetCredits = autoCredits(policy, 'chat');
  if (!budgetCredits) return [];
  const budget = budgetCredits * PROVIDER_USD_PER_CREDIT;
  const required = [...new Set(context.requiredCapabilities ?? [])];

  return models
    .filter(
      (model) =>
        (routing.freeEndpointPool === true
          ? isFreeEndpointEligible(model, feature, 'auto')
          : ids.includes(model.id) && model.auto_available && modelOperational(model)) &&
        required.every((capability) =>
          capabilityAvailable(model, capability),
        ) &&
        requestCostBound(model, policy) <= budget + 1e-10,
    )
    .sort((a, b) => {
      const fit = autoFitScore(b, context) - autoFitScore(a, context);
      if (Math.abs(fit) > 1e-9) return fit;
      return (
        b.quality_tier - a.quality_tier ||
        b.routing_priority - a.routing_priority ||
        Number(a.routing_cost_score) - Number(b.routing_cost_score)
      );
    });
}

export function chooseAutoModel(
  models: DbModel[],
  policy: DbPolicy,
  feature: CreditFeature,
  context: AutoRouteContext = {},
) {
  return chooseAutoModels(models, policy, feature, context)[0];
}

export function actualProviderCost(
  model: DbModel,
  usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    outputTokens: number;
    imageCostUsd?: number;
  },
) {
  const cached = Math.max(0, usage.cachedInputTokens ?? 0);
  const written = Math.max(0, usage.cacheWriteInputTokens ?? 0);
  const regular = Math.max(0, usage.inputTokens - cached - written);
  return (
    (regular * Number(model.input_price) +
      cached * Number(model.cached_input_price) +
      written * Number(model.cache_write_input_price) +
      Math.max(0, usage.outputTokens) * Number(model.output_price)) /
      1_000_000 +
    Math.max(0, usage.imageCostUsd ?? 0)
  );
}
