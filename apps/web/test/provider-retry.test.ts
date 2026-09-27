import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptyUsage, streamProvider, type ProviderMessage } from '@/lib/server/providers';

describe('provider retries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MISTRAL_API_KEY;
  });

  it('retries a rate-limited Mistral request when the retry delay is zero', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }],
          })}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );

    const output: string[] = [];
    const messages: ProviderMessage[] = [{ role: 'user', content: 'Say OK.' }];
    await streamProvider(
      {
        id: 'model-id',
        provider: 'MISTRAL',
        provider_model_id: 'mistral-small-latest',
        display_name: 'Mistral Small',
        description: '',
        capabilities: ['text'],
        capability_states: null,
        reasoning_levels: [],
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
      },
      messages,
      [],
      32,
      new AbortController().signal,
      (text) => output.push(text),
      emptyUsage(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output.join('')).toBe('OK');
  });
});
