import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chooseAutoModel,
  type DbModel,
  type DbPolicy,
} from '@/lib/server/credits';

const originalEnv = { ...process.env };

function model(
  overrides: Partial<DbModel> & Pick<DbModel, 'id' | 'provider' | 'display_name'>,
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
    input_price: 0.1,
    cached_input_price: 0.05,
    output_price: 0.2,
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

function policy(ids: string[]): DbPolicy {
  return {
    id: 'policy',
    plan_id: 'plan',
    bucket: 'AUTO',
    model_id: null,
    enabled: true,
    daily_limit: 100,
    monthly_limit: 1000,
    max_input_chars: 64000,
    max_context: 16000,
    max_output: 2000,
    max_files: 5,
    max_file_bytes: 10_000_000,
    max_duration_seconds: 120,
    concurrency: 2,
    rate_per_minute: 10,
    allowed_features: ['chat'],
    routing: { creditCost: 1, allowedModelIds: ids },
  };
}

function freePoolPolicy(): DbPolicy {
  return {
    ...policy([]),
    routing: { creditCost: 1, freeEndpointPool: true },
  };
}

describe('smart Auto routing', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test';
    process.env.GOOGLE_AI_API_KEY = 'test';
    process.env.MISTRAL_API_KEY = 'test';
    process.env.NVIDIA_API_KEY = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers task fit over a cheaper general model', () => {
    const general = model({
      id: 'general',
      provider: 'MISTRAL',
      display_name: 'General',
      routing_cost_score: 0.01,
    });
    const coder = model({
      id: 'coder',
      provider: 'OPENAI',
      display_name: 'Coder',
      capabilities: ['text', 'coding'],
      best_for: ['Coding', 'Debugging', 'Code review'],
      routing_cost_score: 0.9,
    });

    expect(
      chooseAutoModel(
        [general, coder],
        policy(['general', 'coder']),
        'chat',
        { prompt: 'Debug this TypeScript API function and refactor the code.' },
      )?.id,
    ).toBe('coder');
  });

  it('treats attachment capabilities as hard requirements', () => {
    const textOnly = model({
      id: 'text',
      provider: 'MISTRAL',
      display_name: 'Text',
      routing_priority: 100,
    });
    const files = model({
      id: 'files',
      provider: 'GOOGLE',
      display_name: 'Files',
      capabilities: ['text', 'files', 'long_context'],
      best_for: ['Files and documents', 'Long-context tasks'],
    });

    expect(
      chooseAutoModel(
        [textOnly, files],
        policy(['text', 'files']),
        'chat',
        {
          prompt: 'Summarize this document.',
          requiredCapabilities: ['files'],
        },
      )?.id,
    ).toBe('files');
  });

  it('never routes to an unhealthy NVIDIA endpoint', () => {
    const unhealthy = model({
      id: 'nvidia-bad',
      provider: 'NVIDIA',
      display_name: 'NVIDIA bad',
      health_status: 'DEGRADED',
      routing_priority: 100,
      capabilities: ['text', 'coding'],
      best_for: ['Coding'],
    });
    const fallback = model({
      id: 'fallback',
      provider: 'MISTRAL',
      display_name: 'Fallback',
      capabilities: ['text', 'coding'],
      best_for: ['Coding'],
    });

    expect(
      chooseAutoModel(
        [unhealthy, fallback],
        policy(['nvidia-bad', 'fallback']),
        'chat',
        { prompt: 'Write code for an API.' },
      )?.id,
    ).toBe('fallback');
  });

  it('routes to healthy NVIDIA when it is the best eligible fit', () => {
    const healthy = model({
      id: 'nvidia-code',
      provider: 'NVIDIA',
      display_name: 'NVIDIA coder',
      health_status: 'HEALTHY',
      capabilities: ['text', 'coding'],
      best_for: ['Coding', 'Debugging', 'Code review'],
      routing_priority: 40,
      routing_cost_score: 0,
      input_price: 0,
      cached_input_price: 0,
      output_price: 0,
    });
    const fallback = model({
      id: 'fallback',
      provider: 'MISTRAL',
      display_name: 'Fallback',
    });

    expect(
      chooseAutoModel(
        [fallback, healthy],
        policy(['fallback', 'nvidia-code']),
        'chat',
        { prompt: 'Debug this code and review the function.' },
      )?.id,
    ).toBe('nvidia-code');
  });

  it('free Auto excludes premium models', () => {
    const premium = model({
      id: 'premium',
      provider: 'OPENAI',
      display_name: 'Premium flagship',
      quality_tier: 4,
      free_endpoint: false,
    });
    const free = model({
      id: 'free',
      provider: 'OPENAI',
      display_name: 'Verified free endpoint',
      quality_tier: 1,
      free_endpoint: true,
    });

    expect(
      chooseAutoModel([premium, free], freePoolPolicy(), 'chat', {
        prompt: 'Answer this question.',
      })?.id,
    ).toBe('free');
  });

  it('free Auto excludes unhealthy and unconfigured endpoints', () => {
    const unhealthy = model({
      id: 'unhealthy-free',
      provider: 'NVIDIA',
      display_name: 'Unhealthy free endpoint',
      free_endpoint: true,
      health_status: 'DEGRADED',
    });
    const unconfigured = model({
      id: 'unconfigured-free',
      provider: 'ANTHROPIC',
      display_name: 'Unconfigured free endpoint',
      free_endpoint: true,
    });

    expect(
      chooseAutoModel([unhealthy, unconfigured], freePoolPolicy(), 'chat'),
    ).toBeUndefined();
  });

  it('free Auto can route image generation without a separate paid image model', () => {
    const freeImage = model({
      id: 'free-image',
      provider: 'GOOGLE',
      display_name: 'Free image endpoint',
      free_endpoint: true,
      capabilities: ['text', 'image_generation'],
    });

    expect(
      chooseAutoModel([freeImage], freePoolPolicy(), 'image_generation', {
        prompt: 'Generate an image of a clean futuristic workspace.',
      })?.id,
    ).toBe('free-image');
  });

  it('free Auto includes marked non-NVIDIA endpoints', () => {
    const free = model({
      id: 'google-free',
      provider: 'GOOGLE',
      display_name: 'Google free endpoint',
      free_endpoint: true,
    });

    expect(chooseAutoModel([free], freePoolPolicy(), 'chat')?.id).toBe(
      'google-free',
    );
  });
});
