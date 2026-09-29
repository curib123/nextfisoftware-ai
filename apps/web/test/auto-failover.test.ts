import { describe, expect, it } from 'vitest';

import { runAutoAttempts } from '@/lib/server/auto-routing';
import { ProviderFailure } from '@/lib/server/providers';
import type { DbModel } from '@/lib/server/credits';

function model(id: string): DbModel {
  return {
    id,
    provider: 'OPENAI',
    provider_model_id: id,
    display_name: id,
    description: '',
    capabilities: ['text'],
    capability_states: {},
    reasoning_levels: ['low'],
    default_reasoning_level: 'low',
    enabled: true,
    manual_available: true,
    auto_available: true,
    maintenance: false,
    quality_tier: 1,
    routing_priority: 1,
    routing_cost_score: 1,
    input_price: 0,
    cached_input_price: 0,
    output_price: 0,
    cache_write_input_price: 0,
    image_max_cost_usd: null,
    credit_cost: 1,
    max_context: 1000,
    max_output: 100,
    currency: 'USD',
  };
}

describe('Auto candidate failover', () => {
  it('tries the next candidate after a pre-output retryable failure', async () => {
    const calls: string[] = [];
    const result = await runAutoAttempts(
      [model('first'), model('second')],
      2,
      async (candidate) => {
        calls.push(candidate.id);
        if (candidate.id === 'first') throw new ProviderFailure('HTTP_503');
        return 'success';
      },
    );

    expect(calls).toEqual(['first', 'second']);
    expect(result).toEqual({
      model: expect.objectContaining({ id: 'second' }),
      value: 'success',
    });
  });

  it('stops after partial output', async () => {
    const calls: string[] = [];

    await expect(
      runAutoAttempts(
        [model('first'), model('second')],
        2,
        async (candidate, control) => {
          calls.push(candidate.id);
          control.markOutput();
          throw new ProviderFailure('HTTP_503');
        },
      ),
    ).rejects.toMatchObject({ category: 'HTTP_503' });

    expect(calls).toEqual(['first']);
  });

  it('keeps the candidate loop independent from quota reservation', async () => {
    let reservations = 0;
    const result = await runAutoAttempts(
      [model('first'), model('second')],
      2,
      async (candidate) => {
        if (candidate.id === 'first') throw new ProviderFailure('HTTP_503');
        reservations += 1;
        return 'success';
      },
    );

    expect(result.value).toBe('success');
    expect(reservations).toBe(1);
  });
});
