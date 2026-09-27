import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type { Authenticated } from './auth';
import type { DbModel } from './credits';
import { ApiError, bodyJson, stringValue } from './http';
import { probeProviderCredential } from './providers';
import { rest } from './supabase';

export type ProviderName = DbModel['provider'];

type ProviderKeyRow = {
  id: string;
  user_id: string;
  provider: ProviderName;
  encrypted_key: string;
  key_iv: string;
  key_tag: string;
  key_hint: string;
  enabled: boolean;
  health_status:
    | 'UNKNOWN'
    | 'HEALTHY'
    | 'DEGRADED'
    | 'UNHEALTHY'
    | 'NOT_CONFIGURED';
  health_checked_at: string | null;
  health_message: string | null;
};

const providers: readonly ProviderName[] = [
  'OPENAI',
  'GOOGLE',
  'ANTHROPIC',
  'MISTRAL',
  'NVIDIA',
];

function parseProvider(value: unknown): ProviderName {
  const provider = stringValue(value, 'Provider', { min: 2, max: 20 }).toUpperCase();
  if (!providers.includes(provider as ProviderName))
    throw new ApiError('Unsupported provider.');
  return provider as ProviderName;
}

function credentialEncryptionKey() {
  const encoded = process.env.VROMPT_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!encoded)
    throw new ApiError(
      'BYO API keys are not available until VROMPT_CREDENTIAL_ENCRYPTION_KEY is configured.',
      503,
    );
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32)
    throw new Error(
      'VROMPT_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
    );
  return key;
}

function encryptApiKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptApiKey(row: ProviderKeyRow) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    credentialEncryptionKey(),
    Buffer.from(row.key_iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(row.key_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_key, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function keyHint(key: string) {
  const clean = key.trim();
  return clean.length <= 8
    ? '••••'
    : `${clean.slice(0, 3)}••••${clean.slice(-4)}`;
}

function publicConnection(row: ProviderKeyRow) {
  return {
    provider: row.provider,
    connected: row.enabled,
    keyHint: row.key_hint,
    healthStatus: row.health_status,
    healthCheckedAt: row.health_checked_at,
    healthMessage: row.health_message,
  };
}

export function byoConfigured() {
  try {
    credentialEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export async function listProviderConnections(userId: string) {
  const rows = await rest<ProviderKeyRow[]>('user_provider_keys', {
    admin: true,
    query:
      `user_id=eq.${encodeURIComponent(userId)}&select=*&order=provider.asc`,
  });
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return providers.map((provider) => {
    const row = byProvider.get(provider);
    return row
      ? publicConnection(row)
      : {
          provider,
          connected: false,
          keyHint: '',
          healthStatus: 'NOT_CONFIGURED' as const,
          healthCheckedAt: null,
          healthMessage: null,
        };
  });
}

export async function connectedProviderSet(userId: string) {
  const rows = await rest<Pick<ProviderKeyRow, 'provider' | 'enabled'>[]>(
    'user_provider_keys',
    {
      admin: true,
      query:
        `user_id=eq.${encodeURIComponent(userId)}&enabled=eq.true&select=provider,enabled`,
    },
  );
  return new Set(rows.map((row) => row.provider));
}

export async function getUserProviderKey(
  userId: string,
  provider: ProviderName,
) {
  const rows = await rest<ProviderKeyRow[]>('user_provider_keys', {
    admin: true,
    query:
      `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}&enabled=eq.true&select=*&limit=1`,
  });
  const row = rows[0];
  if (!row) return null;
  try {
    return decryptApiKey(row);
  } catch {
    throw new ApiError(
      'Your saved API key could not be decrypted. Reconnect this provider.',
      409,
    );
  }
}

export async function providerConnectionsRoute(
  request: Request,
  user: Authenticated,
  providerPath?: string,
) {
  if (request.method === 'GET')
    return {
      encryptionReady: byoConfigured(),
      providers: await listProviderConnections(user.profile.id),
    };

  if (request.method === 'DELETE') {
    const provider = parseProvider(providerPath);
    await rest('user_provider_keys', {
      admin: true,
      method: 'DELETE',
      query:
        `user_id=eq.${encodeURIComponent(user.profile.id)}&provider=eq.${encodeURIComponent(provider)}`,
    });
    return { disconnected: true, provider };
  }

  if (request.method !== 'POST')
    throw new ApiError('Method not allowed.', 405);

  const input = await bodyJson<Record<string, unknown>>(request);
  const provider = parseProvider(input.provider);
  const apiKey = stringValue(input.apiKey, 'API key', {
    min: 8,
    max: 1000,
  });

  const probe = await probeProviderCredential(provider, apiKey);
  if (probe.status === 'UNHEALTHY')
    throw new ApiError(probe.message, 400);

  const sealed = encryptApiKey(apiKey);
  const checkedAt = new Date().toISOString();
  const rows = await rest<ProviderKeyRow[]>('user_provider_keys', {
    admin: true,
    method: 'POST',
    query: 'on_conflict=user_id,provider',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      user_id: user.profile.id,
      provider,
      encrypted_key: sealed.encryptedKey,
      key_iv: sealed.iv,
      key_tag: sealed.tag,
      key_hint: keyHint(apiKey),
      enabled: true,
      health_status: probe.status,
      health_checked_at: checkedAt,
      health_message: probe.message,
    },
  });
  if (!rows[0]) throw new ApiError('Unable to save this provider connection.', 502);
  return publicConnection(rows[0]);
}
