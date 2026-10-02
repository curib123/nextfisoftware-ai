import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  autoCredits,
  modelCredits,
  resolveFreeManualModel,
  type DbModel,
  type DbPolicy,
} from '@/lib/server/credits';

const originalEnv = { ...process.env };

function model(
  overrides: Partial<DbModel> &
    Pick<DbModel, 'id' | 'provider' | 'display_name'>,
): DbModel {
  const { id, provider, display_name, ...rest } = overrides;
  return {
    id,
    provider,
    provider_model_id: id,
    display_name,
    description: 'General AI model',
    category: 'general',
    capabilities: ['text'],
    capability_states: {},
    reasoning_levels: ['low'],
    default_reasoning_level: 'low',
    enabled: true,
    manual_available: true,
    auto_available: true,
    maintenance: false,
    quality_tier: 2,
    routing_priority: 10,
    routing_cost_score: 0.2,
    input_price: 0,
    cached_input_price: 0,
    output_price: 0,
    cache_write_input_price: 0,
    image_max_cost_usd: null,
    credit_cost: 1,
    max_context: 128000,
    max_output: 4096,
    currency: 'USD',
    best_for: ['General chat'],
    health_status: 'UNKNOWN',
    ...rest,
  };
}

function freePolicy(): DbPolicy {
  return {
    id: 'free-auto',
    plan_id: 'free',
    bucket: 'AUTO',
    model_id: null,
    enabled: true,
    daily_limit: 5,
    monthly_limit: 30,
    max_input_chars: 4000,
    max_context: 8192,
    max_output: 1024,
    max_files: 0,
    max_file_bytes: 1000000,
    max_duration_seconds: 45,
    concurrency: 1,
    rate_per_minute: 3,
    allowed_features: ['chat'],
    routing: { freeEndpointPool: true, creditCost: 1 },
  };
}

describe('Free model access', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('free manual selection accepts a marked endpoint without a model policy', () => {
    const free = model({
      id: 'free-model',
      provider: 'OPENAI',
      display_name: 'Free endpoint',
      free_endpoint: true,
    });

    expect(resolveFreeManualModel([free], freePolicy(), free.id)?.id).toBe(
      free.id,
    );
  });


  it('charges zero credits for verified free endpoints', () => {
    const free = model({
      id: 'free-zero-credit',
      provider: 'OPENAI',
      display_name: 'Free zero credit',
      free_endpoint: true,
    });

    expect(modelCredits(free, freePolicy(), 'chat')).toBe(0);
    expect(autoCredits(freePolicy(), 'chat')).toBe(0);
  });

  it('keeps premium models billable', () => {
    const premium = model({
      id: 'premium-billable',
      provider: 'OPENAI',
      display_name: 'Premium billable',
      free_endpoint: false,
      input_price: 0.5,
      output_price: 1,
      credit_cost: 2,
    });

    expect(modelCredits(premium, freePolicy(), 'chat')).toBeGreaterThan(0);
  });

  it('free manual selection rejects a premium model', () => {
    const premium = model({
      id: 'premium-model',
      provider: 'OPENAI',
      display_name: 'Premium flagship',
      free_endpoint: false,
    });

    expect(resolveFreeManualModel([premium], freePolicy(), premium.id)).toBe(
      undefined,
    );
  });
});
