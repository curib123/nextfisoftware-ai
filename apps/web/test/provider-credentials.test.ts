import { afterEach, describe, expect, it } from 'vitest';

import { credentialEncryptionKey } from '@/lib/server/provider-credentials';

const encodedKey = Buffer.alloc(32, 7).toString('base64');

afterEach(() => {
  delete process.env.NEXTFI_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.VROMPT_CREDENTIAL_ENCRYPTION_KEY;
});

describe('provider credential encryption key', () => {
  it('prefers the Nextfi environment variable', () => {
    process.env.NEXTFI_CREDENTIAL_ENCRYPTION_KEY = encodedKey;
    process.env.VROMPT_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      'base64',
    );

    expect(credentialEncryptionKey()).toEqual(Buffer.alloc(32, 7));
  });

  it('falls back to the legacy Vrompt environment variable', () => {
    process.env.VROMPT_CREDENTIAL_ENCRYPTION_KEY = encodedKey;

    expect(credentialEncryptionKey()).toEqual(Buffer.alloc(32, 7));
  });
});
