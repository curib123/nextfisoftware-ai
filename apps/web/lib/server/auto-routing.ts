import type { DbModel } from './credits';
import { ProviderFailure } from './providers';

export type AutoAttemptControl = {
  markOutput: () => void;
  markArtifact: () => void;
};

export async function runAutoAttempts<T>(
  candidates: DbModel[],
  maxAttempts: number,
  attempt: (model: DbModel, control: AutoAttemptControl) => Promise<T>,
) {
  const limit = Math.min(Math.max(1, maxAttempts), 5);
  let lastError: unknown;

  for (const model of candidates.slice(0, limit)) {
    let outputStarted = false;
    let artifactCreated = false;
    const control: AutoAttemptControl = {
      markOutput: () => {
        outputStarted = true;
      },
      markArtifact: () => {
        artifactCreated = true;
      },
    };

    try {
      return { model, value: await attempt(model, control) };
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof ProviderFailure) ||
        !error.retryable ||
        outputStarted ||
        artifactCreated
      )
        throw error;
    }
  }

  if (lastError) throw lastError;
  throw new ProviderFailure('RETRY_EXHAUSTED');
}
