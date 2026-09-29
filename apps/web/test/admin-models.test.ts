import { describe, expect, it } from 'vitest';

import { modelMutationPayload } from '@/lib/server/admin';
import { freePoolModelIds } from '@/lib/server/nvidia';

const baseInput = {
  provider: 'OPENAI',
  providerModelId: 'free-model',
  displayName: 'Free model',
  maxContext: 16000,
  maxOutput: 2000,
};

describe('free endpoint administration', () => {
  it('persists an explicit free endpoint flag', () => {
    expect(
      modelMutationPayload({ ...baseInput, freeEndpoint: true }).free_endpoint,
    ).toBe(true);
  });

  it('defaults new models to non-free when the flag is omitted', () => {
    expect(modelMutationPayload(baseInput).free_endpoint).toBe(false);
  });

  it('builds the pool from eligible free models without a fixed fallback', () => {
    expect(
      freePoolModelIds([
        {
          id: 'mistral-fallback',
          provider: 'MISTRAL',
          free_endpoint: false,
          enabled: true,
          auto_available: true,
          health_status: 'UNKNOWN',
        },
        {
          id: 'google-free',
          provider: 'GOOGLE',
          free_endpoint: true,
          enabled: true,
          auto_available: true,
          health_status: 'UNKNOWN',
        },
        {
          id: 'nvidia-free',
          provider: 'NVIDIA',
          free_endpoint: true,
          enabled: true,
          auto_available: true,
          health_status: 'HEALTHY',
        },
      ]),
    ).toEqual(['google-free', 'nvidia-free']);
  });
});
