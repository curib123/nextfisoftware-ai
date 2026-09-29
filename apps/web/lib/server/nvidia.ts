import 'server-only';

import type { DbModel, DbPolicy } from './credits';
import { ApiError, bodyJson, integerValue } from './http';
import { discoverNvidiaModelIds, probeNvidiaModel } from './providers';
import { rest } from './supabase';

const FREE_PLAN_ID = '10000000-0000-4000-8000-000000000001';

type NvidiaModelRow = DbModel & {
  display_order: number;
};

export function freePoolModelIds(
  models: Array<
    Pick<
      DbModel,
      'id' | 'provider' | 'free_endpoint' | 'enabled' | 'auto_available' | 'health_status'
    >
  >,
) {
  return models
    .filter(
      (model) =>
        model.free_endpoint === true &&
        model.enabled &&
        model.auto_available &&
        (model.provider === 'NVIDIA'
          ? model.health_status === 'HEALTHY'
          : !['UNHEALTHY', 'NOT_CONFIGURED'].includes(
              model.health_status ?? 'UNKNOWN',
            )),
    )
    .map((model) => model.id);
}

function prettifyModelId(value: string) {
  const tail = value.split('/').pop() || value;
  return tail
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 100);
}

function bestFor(modelId: string) {
  const id = modelId.toLowerCase();
  const values = new Set<string>();
  if (/code|coder|codestral|devstral/.test(id)) {
    values.add('Coding');
    values.add('Debugging');
    values.add('Code review');
  }
  if (/reason|r1|nemotron|deepseek|glm|qwq/.test(id)) {
    values.add('Reasoning');
    values.add('Analysis');
    values.add('Math & problem solving');
  }
  if (/vision|vl|multimodal/.test(id)) {
    values.add('Image understanding');
    values.add('Visual analysis');
    values.add('Multimodal chat');
  }
  if (/instruct|chat|llama|mistral|gemma|qwen|kimi|phi/.test(id)) {
    values.add('General chat');
    values.add('Writing');
  }
  if (/small|mini|nano|7b|8b/.test(id)) values.add('Fast responses');
  if (!values.size) {
    values.add('General chat');
    values.add('Experimentation');
  }
  return [...values].slice(0, 5);
}

function inferredCapabilities(modelId: string) {
  const id = modelId.toLowerCase();
  const capabilities = new Set(['text']);
  if (/code|coder|codestral|devstral/.test(id)) capabilities.add('coding');
  if (/reason|r1|nemotron|deepseek|glm|qwq/.test(id))
    capabilities.add('reasoning');
  if (/vision|vl|multimodal/.test(id)) capabilities.add('vision');
  return [...capabilities];
}

async function freeAutoPolicy() {
  const rows = await rest<DbPolicy[]>('generation_policies', {
    admin: true,
    query:
      `plan_id=eq.${FREE_PLAN_ID}&bucket=eq.AUTO&select=*&limit=1`,
  });
  const policy = rows[0];
  if (!policy) throw new ApiError('Free Auto policy is missing.', 500);
  return policy;
}

async function ensureFreeManualPolicy(model: NvidiaModelRow) {
  await rest('generation_policies', {
    admin: true,
    method: 'POST',
    query: 'on_conflict=plan_id,bucket',
    prefer: 'resolution=merge-duplicates',
    body: {
      plan_id: FREE_PLAN_ID,
      bucket: model.id,
      model_id: model.id,
      enabled: true,
      daily_limit: 30,
      monthly_limit: 30,
      max_input_chars: 16000,
      max_context: Math.min(model.max_context, 32768),
      max_output: Math.min(model.max_output, 2048),
      max_files: model.capabilities.includes('vision') ? 2 : 0,
      max_file_bytes: 5_000_000,
      max_duration_seconds: 90,
      concurrency: 1,
      rate_per_minute: 6,
      allowed_features: ['chat'],
      routing: {},
    },
  });
}

async function removeFreeManualPolicy(modelId: string) {
  await rest('generation_policies', {
    admin: true,
    method: 'DELETE',
    query:
      `plan_id=eq.${FREE_PLAN_ID}&bucket=eq.${encodeURIComponent(modelId)}`,
  });
}

async function updateFreeAutoPool(eligibleIds: string[]) {
  const auto = await freeAutoPolicy();
  const currentIds = Array.isArray(auto.routing?.allowedModelIds)
    ? auto.routing.allowedModelIds.map(String)
    : [];
  const next = eligibleIds.filter(
    (id, index, all) => all.indexOf(id) === index,
  );

  await rest('generation_policies', {
    admin: true,
    method: 'PATCH',
    query:
      `plan_id=eq.${FREE_PLAN_ID}&bucket=eq.AUTO`,
    body: {
      routing: {
        ...(auto.routing ?? {}),
        freeEndpointPool: true,
        allowedModelIds: next,
      },
    },
  });

  return {
    previousCount: currentIds.length,
    currentCount: next.length,
  };
}

export async function syncNvidiaFreeModels(request: Request) {
  if (request.method !== 'POST')
    throw new ApiError('Method not allowed.', 405);

  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key)
    throw new ApiError(
      'NVIDIA_API_KEY is not configured. Add it to the server environment before syncing.',
      503,
    );

  const input: Record<string, unknown> = await bodyJson<Record<string, unknown>>(
    request,
  ).catch(() => ({}));
  const probeLimit = integerValue(input.probeLimit ?? 8, 'Probe limit', 1, 12);
  const discovered = await discoverNvidiaModelIds(key);
  const existing = await rest<NvidiaModelRow[]>('ai_models', {
    admin: true,
    query: 'provider=eq.NVIDIA&select=*&order=display_order.asc',
  });
  const byProviderId = new Map(
    existing.map((model) => [model.provider_model_id, model]),
  );
  let nextOrder =
    Math.max(1000, ...existing.map((model) => model.display_order ?? 0)) + 1;

  for (const providerModelId of discovered) {
    if (byProviderId.has(providerModelId)) continue;
    const rows = await rest<NvidiaModelRow[]>('ai_models', {
      admin: true,
      method: 'POST',
      query: 'on_conflict=provider,provider_model_id',
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: {
        provider: 'NVIDIA',
        provider_model_id: providerModelId,
        display_name: prettifyModelId(providerModelId),
        description:
          'Discovered from the NVIDIA hosted inference catalog. Nextfi Software enables it only after a successful live chat health check.',
        category: 'nvidia-hosted',
        capabilities: inferredCapabilities(providerModelId),
        capability_states: {},
        reasoning_levels: ['low'],
        default_reasoning_level: 'low',
        enabled: false,
        manual_available: false,
        auto_available: false,
        maintenance: false,
        display_order: nextOrder++,
        quality_tier: 2,
        routing_priority: 40,
        routing_cost_score: 0,
        input_price: 0,
        cached_input_price: 0,
        output_price: 0,
        cache_write_input_price: 0,
        image_max_cost_usd: null,
        credit_cost: 1,
        max_context: 32768,
        max_output: 4096,
        currency: 'USD',
        best_for: bestFor(providerModelId),
        quick_facts: {
          hostedBy: 'NVIDIA',
          apiStyle: 'OpenAI-compatible chat completions',
          discoveredDynamically: true,
        },
        details: {
          providerModelId,
          endpoint: '/v1/chat/completions',
          availabilityRule:
            'Enabled only after a successful live completion request.',
          usageNote:
            'NVIDIA hosted developer endpoints are subject to NVIDIA account and model rate limits.',
        },
        free_endpoint: false,
        source: 'NVIDIA_DISCOVERED',
        health_status: 'UNKNOWN',
      },
    });
    if (rows[0]) byProviderId.set(providerModelId, rows[0]);
  }

  const allModels = await rest<NvidiaModelRow[]>('ai_models', {
    admin: true,
    query:
      'provider=eq.NVIDIA&source=eq.NVIDIA_DISCOVERED&select=*&order=health_checked_at.asc.nullsfirst,display_order.asc',
  });

  const discoveredSet = new Set(discovered);
  for (const stale of allModels.filter(
    (model) => !discoveredSet.has(model.provider_model_id),
  )) {
    await rest('ai_models', {
      admin: true,
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(stale.id)}`,
      body: {
        enabled: false,
        manual_available: false,
        auto_available: false,
        free_endpoint: false,
        health_status: 'UNHEALTHY',
        health_checked_at: new Date().toISOString(),
        health_message: 'This model is no longer returned by the NVIDIA model catalog.',
      },
    });
    await removeFreeManualPolicy(stale.id);
  }

  const unprobed = allModels.filter(
    (model) =>
      discoveredSet.has(model.provider_model_id) && !model.health_checked_at,
  );
  const candidates = (
    unprobed.length
      ? unprobed
      : allModels.filter((model) =>
          discoveredSet.has(model.provider_model_id),
        )
  ).slice(0, probeLimit);

  const results: Array<{
    id: string;
    providerModelId: string;
    status: string;
    message: string;
  }> = [];

  for (let index = 0; index < candidates.length; index += 3) {
    const chunk = candidates.slice(index, index + 3);
    const chunkResults = await Promise.all(
      chunk.map(async (model) => {
        const probe = await probeNvidiaModel(model.provider_model_id, key);
        const now = new Date().toISOString();
        const healthy = probe.status === 'HEALTHY';
        const failureCount = healthy
          ? 0
          : (model.health_failure_count ?? 0) + 1;

        await rest('ai_models', {
          admin: true,
          method: 'PATCH',
          query: `id=eq.${encodeURIComponent(model.id)}`,
          body: {
            enabled: healthy,
            manual_available: healthy,
            auto_available: healthy,
            free_endpoint: healthy,
            health_status: probe.status,
            health_checked_at: now,
            health_message: probe.message,
            health_failure_count: failureCount,
            ...(healthy
              ? { last_success_at: now }
              : { last_failure_at: now }),
          },
        });

        if (healthy)
          await ensureFreeManualPolicy({
            ...model,
            enabled: true,
            free_endpoint: true,
          });
        else await removeFreeManualPolicy(model.id);

        return {
          id: model.id,
          providerModelId: model.provider_model_id,
          status: probe.status,
          message: probe.message,
        };
      }),
    );
    results.push(...chunkResults);
  }

  const freeEndpoints = await rest<
    Pick<
      NvidiaModelRow,
      'id' | 'provider' | 'free_endpoint' | 'enabled' | 'auto_available' | 'health_status'
    >[]
  >('ai_models', {
    admin: true,
    query:
      'free_endpoint=eq.true&enabled=eq.true&auto_available=eq.true&select=id,provider,free_endpoint,enabled,auto_available,health_status',
  });
  const healthy = freeEndpoints.filter(
    (model) => model.provider === 'NVIDIA' && model.health_status === 'HEALTHY',
  );
  const pool = await updateFreeAutoPool(freePoolModelIds(freeEndpoints));

  return {
    discovered: discovered.length,
    cataloged: allModels.length,
    probed: candidates.length,
    healthy: healthy.length,
    remainingToProbe: Math.max(
      0,
      unprobed.length - candidates.length,
    ),
    autoPool: pool,
    results,
  };
}
