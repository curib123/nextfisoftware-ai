'use client';
import { PageHeading } from '@/components/ui/page-heading';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import { useTheme } from '@/components/theme/theme-provider';
import {
  apiRequest,
  type ProviderConnection,
} from '@/lib/api';
import { useFeedback } from '@/components/ui/feedback-modal';

export type Preferences = {
  displayName: string;
  defaultModelId: string | null;
  sendOnEnter: boolean;
};

type ProviderConnectionsResponse = {
  encryptionReady: boolean;
  providers: ProviderConnection[];
};

const providerLabels: Record<ProviderConnection['provider'], string> = {
  NVIDIA: 'NVIDIA NIM',
  OPENAI: 'OpenAI',
  GOOGLE: 'Google AI',
  ANTHROPIC: 'Anthropic',
  MISTRAL: 'Mistral',
};

export function UserPreferences() {
  const { user, accessToken, logout } = useAuth();
  const { alert, confirm } = useFeedback();
  const { theme, setTheme } = useTheme();
  const [preferences, setPreferences] = useState<Preferences>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Preferences>();
  const [revision, setRevision] = useState(0);
  const [connections, setConnections] =
    useState<ProviderConnectionsResponse>();
  const [provider, setProvider] =
    useState<ProviderConnection['provider']>('NVIDIA');
  const [apiKey, setApiKey] = useState('');
  const [providerBusy, setProviderBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    void apiRequest<Preferences>('/workspace/preferences', {
      accessToken,
      signal: controller.signal,
    })
      .then((value) => {
        setPreferences(value);
        setSaved(value);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [accessToken, revision]);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    void apiRequest<ProviderConnectionsResponse>(
      '/workspace/provider-connections',
      { accessToken, signal: controller.signal },
    )
      .then(setConnections)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [accessToken, revision]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!preferences || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await apiRequest<Preferences>('/workspace/preferences', {
        accessToken: accessToken!,
        method: 'PATCH',
        body: JSON.stringify({ ...preferences, defaultModelId: null }),
      });
      setPreferences(updated);
      setSaved(updated);
      alert({
        tone: 'success',
        title: 'Preferences saved',
        message: 'Your workspace will use these preferences for future chats.',
      });
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function connectProvider(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || !apiKey.trim() || providerBusy) return;
    setProviderBusy(provider);
    setError('');
    try {
      await apiRequest<ProviderConnection>('/workspace/provider-connections', {
        accessToken,
        method: 'POST',
        body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
      });
      setApiKey('');
      setRevision((value) => value + 1);
      alert({
        tone: 'success',
        title: `${providerLabels[provider]} connected`,
        message:
          'The key was verified and encrypted. You can now use eligible models with your own API account.',
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to connect API key.';
      setError(message);
      alert({
        tone: 'error',
        title: 'Could not connect provider',
        message,
      });
    } finally {
      setProviderBusy(null);
    }
  }

  async function disconnectProvider(connection: ProviderConnection) {
    if (!accessToken || providerBusy) return;
    const accepted = await confirm({
      title: `Disconnect ${providerLabels[connection.provider]}?`,
      message:
        'Models that rely on your own API key will stop being available until you reconnect this provider.',
      confirmLabel: 'Disconnect',
    });
    if (!accepted) return;

    setProviderBusy(connection.provider);
    try {
      await apiRequest(
        `/workspace/provider-connections/${encodeURIComponent(connection.provider)}`,
        { accessToken, method: 'DELETE' },
      );
      setRevision((value) => value + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to disconnect provider.';
      setError(message);
    } finally {
      setProviderBusy(null);
    }
  }

  return (
    <div className="content-page">
      <PageHeading
        title="Settings"
        description="Manage your profile, chat behavior, API connections, and appearance."
      />
      {error && (
        <p className="error-banner" role="alert">
          {error}{' '}
          {!preferences && (
            <button
              className="secondary-button"
              onClick={() => {
                setError('');
                setRevision((v) => v + 1);
              }}
            >
              Try again
            </button>
          )}
        </p>
      )}

      <section className="panel">
        <h2>Your account</h2>
        <p>{user?.email}</p>
        <p className="muted">
          Sign-in is managed through your connected Google or GitHub account.
        </p>
      </section>

      <section className="panel">
        <h2>Chat preferences</h2>
        {preferences ? (
          <form onSubmit={save}>
            <label>
              Display name
              <input
                required
                maxLength={80}
                value={preferences.displayName}
                disabled={busy}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    displayName: e.target.value,
                  })
                }
              />
            </label>
            <p className="muted">
              Every new chat starts with Auto (recommended). Choose a model in
              the chat whenever you need one.
            </p>
            <label>
              Send a message with
              <select
                value={preferences.sendOnEnter ? 'enter' : 'button'}
                disabled={busy}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    sendOnEnter: e.target.value === 'enter',
                  })
                }
              >
                <option value="enter">
                  Enter (Shift + Enter for a new line)
                </option>
                <option value="button">
                  Send button (Enter adds a new line)
                </option>
              </select>
            </label>
            <div>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  !preferences.displayName.trim() ||
                  JSON.stringify(preferences) === JSON.stringify(saved)
                }
              >
                {busy ? 'Saving…' : 'Save preferences'}
              </button>
            </div>
          </form>
        ) : (
          !error && (
            <p className="muted" role="status">
              Loading preferences…
            </p>
          )
        )}
      </section>

      <section className="panel provider-connections-panel">
        <div>
          <span className="eyebrow">BRING YOUR OWN API</span>
          <h2>Your AI provider keys</h2>
          <p className="muted">
            Connect your own provider account for manual model access. Your key
            is verified, encrypted on the server, and never returned to the
            browser after it is saved. BYO requests use 0 Vrompt AI credits,
            while normal safety and rate limits still apply.
          </p>
        </div>

        {!connections ? (
          <p className="muted" role="status">
            Loading provider connections…
          </p>
        ) : !connections.encryptionReady ? (
          <div className="service-notice" role="status">
            <p>
              BYO API keys are disabled until the server administrator configures
              <code> VROMPT_CREDENTIAL_ENCRYPTION_KEY</code>.
            </p>
          </div>
        ) : (
          <>
            <div className="provider-connection-grid">
              {connections.providers.map((connection) => (
                <article
                  className={`provider-connection-card ${connection.connected ? 'is-connected' : ''}`}
                  key={connection.provider}
                >
                  <div>
                    <strong>{providerLabels[connection.provider]}</strong>
                    <span
                      className={`provider-health provider-health-${connection.healthStatus.toLowerCase()}`}
                    >
                      {connection.connected
                        ? connection.healthStatus.replaceAll('_', ' ')
                        : 'Not connected'}
                    </span>
                  </div>
                  <p className="muted">
                    {connection.connected
                      ? connection.keyHint
                      : 'Use your own API account for eligible manual models.'}
                  </p>
                  {connection.healthMessage && (
                    <small>{connection.healthMessage}</small>
                  )}
                  {connection.connected && (
                    <button
                      className="text-link"
                      disabled={Boolean(providerBusy)}
                      onClick={() => void disconnectProvider(connection)}
                      type="button"
                    >
                      {providerBusy === connection.provider
                        ? 'Disconnecting…'
                        : 'Disconnect'}
                    </button>
                  )}
                </article>
              ))}
            </div>

            <form className="provider-key-form" onSubmit={connectProvider}>
              <label>
                Provider
                <select
                  value={provider}
                  disabled={Boolean(providerBusy)}
                  onChange={(event) =>
                    setProvider(
                      event.target.value as ProviderConnection['provider'],
                    )
                  }
                >
                  {Object.entries(providerLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                API key
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste provider API key"
                  value={apiKey}
                  disabled={Boolean(providerBusy)}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <button
                className="primary-button"
                disabled={Boolean(providerBusy) || apiKey.trim().length < 8}
              >
                {providerBusy ? 'Verifying…' : 'Verify & connect'}
              </button>
            </form>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Appearance</h2>
        <label className="config-label">
          Theme
          <select
            value={theme}
            onChange={(e) =>
              setTheme(e.target.value as 'system' | 'light' | 'dark')
            }
          >
            <option value="system">Match device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <p className="muted">Appearance is saved on this device.</p>
      </section>

      <section className="panel">
        <h2>Account & privacy</h2>
        <div className="row">
          <Link href="/billing">Manage subscription</Link>
          <Link href="/privacy">Privacy policy</Link>
          <button
            className="secondary-button"
            onClick={async () => {
              const accepted = await confirm({
                title: 'Sign out?',
                message: 'You can sign back in whenever you want to continue.',
                confirmLabel: 'Sign out',
              });
              if (!accepted) return;
              try {
                await logout();
              } catch (logoutError) {
                const message =
                  logoutError instanceof Error
                    ? logoutError.message
                    : 'Unable to sign out. Please retry.';
                setError(message);
                alert({ tone: 'error', title: 'Could not sign out', message });
              }
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
