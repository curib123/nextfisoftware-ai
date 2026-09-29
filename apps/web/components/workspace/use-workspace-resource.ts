'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { apiRequest } from '@/lib/api';

const resourceCache = new Map<
  string,
  { data: unknown; storedAt: number }
>();
const CACHE_TTL_MS = 30_000;

export function useWorkspaceResource<T>(
  path: string,
  delay = 0,
  enabled = true,
) {
  const { accessToken } = useAuth();
  const cacheKey = accessToken ? `${accessToken}:${path}` : '';
  const cached = cacheKey ? resourceCache.get(cacheKey) : undefined;
  const [result, setResult] = useState<
    | {
        path: string;
        token: string;
        data?: T;
        error?: string;
      }
    | undefined
  >(() =>
    accessToken && cached
      ? { path, token: accessToken, data: cached.data as T }
      : undefined,
  );
  const [loading, setLoading] = useState(!cached);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!accessToken || !enabled) return;
    const controller = new AbortController();
    const currentKey = `${accessToken}:${path}`;
    const warm = resourceCache.get(currentKey);
    const fresh = Boolean(
      warm && Date.now() - warm.storedAt < CACHE_TTL_MS,
    );

    if (warm) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult({ path, token: accessToken, data: warm.data as T });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
    }

    const timer = setTimeout(() => {
      void apiRequest<T>(path, { accessToken, signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          resourceCache.set(currentKey, { data, storedAt: Date.now() });
          setResult({ path, token: accessToken, data });
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted && !warm)
            setResult({ path, token: accessToken, error: error.message });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, fresh && revision === 0 ? Math.max(delay, 50) : delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, path, revision, delay, enabled]);

  const current =
    enabled && result?.path === path && result?.token === accessToken
      ? result
      : undefined;

  return {
    data: current?.data,
    error: current?.error,
    loading: loading || (!current && !cached),
    refresh,
    accessToken,
  };
}
