'use client';
import Link from 'next/link';
import { PageHeading } from '@/components/ui/page-heading';
import { ResourceState } from '@/components/ui/resource-state';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/modal';
import { ProviderIcon } from '@/components/brand/provider-icon';
import { apiRequest } from '@/lib/api';
import { useAdminResource } from './use-admin-resource';

type Values = Record<string, unknown>;
type RecordItem = Values & {
  id: string;
  displayName?: string;
  name?: string;
  provider?: string;
  enabled?: boolean;
  isActive?: boolean;
  planId?: string;
  bucket?: string;
};
type Configuration = {
  creditDesign?: { providerUsdPerCredit: number };
  models: RecordItem[];
  plans: RecordItem[];
  policies: RecordItem[];
};
type Field = {
  key: string;
  label: string;
  type?: 'number' | 'checkbox' | 'textarea';
  min?: number;
  max?: number;
  step?: string;
  options?: string[];
};
const modelFields: Field[] = [
  { key: 'displayName', label: 'Display name' },
  {
    key: 'provider',
    label: 'Provider',
    options: ['OPENAI', 'GOOGLE', 'ANTHROPIC', 'MISTRAL', 'NVIDIA'],
  },
  { key: 'providerModelId', label: 'Provider model ID' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'enabled', label: 'Enabled', type: 'checkbox' },
  { key: 'maintenance', label: 'Maintenance mode', type: 'checkbox' },
  {
    key: 'manualAvailable',
    label: 'Available for manual selection',
    type: 'checkbox',
  },
  { key: 'autoAvailable', label: 'Available to Auto', type: 'checkbox' },
  {
    key: 'defaultReasoningLevel',
    label: 'Default reasoning level',
    options: ['low', 'medium', 'high', 'xhigh'],
  },
  {
    key: 'inputPrice',
    label: 'Input price (USD / million tokens)',
    type: 'number',
    min: 0,
    step: 'any',
  },
  {
    key: 'cachedInputPrice',
    label: 'Cached input price (USD / million tokens)',
    type: 'number',
    min: 0,
    step: 'any',
  },
  {
    key: 'outputPrice',
    label: 'Output price (USD / million tokens)',
    type: 'number',
    min: 0,
    step: 'any',
  },
  {
    key: 'creditCost',
    label: 'Minimum credits per generation (provider costs may require more)',
    type: 'number',
    min: 1,
    max: 100000,
  },
  {
    key: 'maxContext',
    label: 'Context token limit',
    type: 'number',
    min: 1,
    max: 10000000,
  },
  {
    key: 'maxOutput',
    label: 'Output token limit',
    type: 'number',
    min: 1,
    max: 1000000,
  },
  {
    key: 'qualityTier',
    label: 'Quality tier (1–4)',
    type: 'number',
    min: 1,
    max: 4,
  },
  {
    key: 'routingPriority',
    label: 'Routing priority (0–100)',
    type: 'number',
    min: 0,
    max: 100,
  },
  {
    key: 'routingCostScore',
    label: 'Routing cost score',
    type: 'number',
    min: 0,
    step: 'any',
  },
  { key: 'displayOrder', label: 'Display order', type: 'number' },
];
const planFields: Field[] = [
  { key: 'name', label: 'Plan name' },
  { key: 'code', label: 'Plan code' },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'originalPrice',
    label: 'Price in minor currency units (e.g. 100 = 1.00)',
    type: 'number',
    min: 0,
  },
  { key: 'currency', label: 'Currency (ISO code)' },
  {
    key: 'billingInterval',
    label: 'Billing interval',
    options: ['DAY', 'WEEK', 'MONTH', 'YEAR', 'ONE_TIME'],
  },
  { key: 'intervalCount', label: 'Interval count', type: 'number', min: 1 },
  { key: 'isActive', label: 'Available for subscription', type: 'checkbox' },
  {
    key: 'monthlyCredits',
    label: 'Monthly credits',
    type: 'number',
    min: 0,
    max: 10000000,
  },
  {
    key: 'maxProjects',
    label: 'Maximum projects',
    type: 'number',
    min: 0,
    max: 200,
  },
  {
    key: 'maxWorkflows',
    label: 'Maximum workflows',
    type: 'number',
    min: 0,
    max: 200,
  },
  {
    key: 'maxWorkflowSteps',
    label: 'Steps per workflow',
    type: 'number',
    min: 1,
    max: 20,
  },
  {
    key: 'projectContextChars',
    label: 'Project context characters',
    type: 'number',
    min: 0,
    max: 32000,
  },
  { key: 'displayOrder', label: 'Display order', type: 'number' },
];
const policyFields: Field[] = [
  { key: 'enabled', label: 'Policy enabled', type: 'checkbox' },
  { key: 'dailyLimit', label: 'Daily generations', type: 'number', min: 0 },
  { key: 'monthlyLimit', label: 'Monthly generations', type: 'number', min: 0 },
  {
    key: 'maxInputChars',
    label: 'Maximum input characters',
    type: 'number',
    min: 1,
  },
  { key: 'maxContext', label: 'Context token limit', type: 'number', min: 1 },
  { key: 'maxOutput', label: 'Output token limit', type: 'number', min: 1 },
  {
    key: 'maxFiles',
    label: 'Files per request',
    type: 'number',
    min: 0,
    max: 10,
  },
  {
    key: 'maxFileBytes',
    label: 'Bytes per file',
    type: 'number',
    min: 1,
    max: 20000000,
  },
  {
    key: 'maxDurationSeconds',
    label: 'Request timeout (seconds)',
    type: 'number',
    min: 1,
    max: 600,
  },
  {
    key: 'concurrency',
    label: 'Concurrent requests per user',
    type: 'number',
    min: 1,
    max: 10,
  },
  {
    key: 'ratePerMinute',
    label: 'Requests per minute',
    type: 'number',
    min: 1,
    max: 120,
  },
];
const capabilities = [
  'text',
  'vision',
  'files',
  'coding',
  'reasoning',
  'long_context',
  'image_generation',
  'prompt_caching',
  'tools',
  'web_search',
  'code_execution',
  'maps',
  'computer_use',
  'mcp',
];
type Kind = 'model' | 'plan' | 'policy';
const defaults: Record<Kind, Values> = {
  model: {
    displayName: '',
    provider: 'OPENAI',
    providerModelId: '',
    category: 'general',
    description: '',
    enabled: false,
    maintenance: false,
    manualAvailable: true,
    autoAvailable: false,
    reasoningLevels: ['low'],
    defaultReasoningLevel: 'low',
    capabilityStates: '{}',
    inputPrice: 0,
    cachedInputPrice: 0,
    outputPrice: 0,
    creditCost: 1,
    maxContext: 16000,
    maxOutput: 2000,
    qualityTier: 1,
    routingPriority: 0,
    routingCostScore: 0,
    displayOrder: 0,
    capabilities: ['text'],
  },
  plan: {
    name: '',
    code: '',
    description: '',
    originalPrice: 0,
    currency: 'USD',
    billingInterval: 'MONTH',
    intervalCount: 1,
    isActive: false,
    monthlyCredits: 0,
    maxProjects: 0,
    maxWorkflows: 0,
    maxWorkflowSteps: 1,
    projectContextChars: 0,
    displayOrder: 0,
    limits: [],
  },
  policy: {
    planId: '',
    bucket: 'AUTO',
    enabled: false,
    dailyLimit: 0,
    monthlyLimit: 0,
    maxInputChars: 16000,
    maxContext: 16000,
    maxOutput: 2000,
    maxFiles: 0,
    maxFileBytes: 1000000,
    maxDurationSeconds: 60,
    concurrency: 1,
    ratePerMinute: 10,
    allowedFeatures: ['chat'],
    routing: {
      allowedModelIds: [],
      attemptTimeoutSeconds: 30,
      maxAttempts: 3,
      minimumQualityTier: 1,
      costWeight: 1,
      rules: [],
    },
  },
};

function Editor({
  onBusyChange,
  kind,
  item,
  config,
  accessToken,
  onSaved,
  onClose,
}: {
  kind: Kind;
  item?: RecordItem;
  config: Configuration;
  accessToken: string;
  onSaved: () => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const fields =
    kind === 'model'
      ? modelFields
      : kind === 'plan'
        ? planFields
        : policyFields;
  const [values, setValues] = useState<Values>({
    ...defaults[kind],
    ...item,
    ...(kind === 'model'
      ? {
          capabilityStates: JSON.stringify(
            item?.capabilityStates ?? {},
            null,
            2,
          ),
        }
      : {}),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(
    JSON.stringify(
      kind === 'plan'
        ? (item?.limits ?? [])
        : kind === 'policy'
          ? (item?.routing ?? defaults.policy.routing)
          : (item?.additionalPrices ?? {}),
      null,
      2,
    ),
  );
  const set = (key: string, value: unknown) =>
    setValues((old) => ({ ...old, [key]: value }));
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    try {
      const body = Object.fromEntries(
        fields.map((field) => [field.key, values[field.key]]),
      );
      if (kind === 'model')
        Object.assign(body, {
          capabilities: values.capabilities,
          capabilityStates: JSON.parse(String(values.capabilityStates ?? '{}')),
          reasoningLevels: values.reasoningLevels,
          currency: 'USD',
          fallbackId: values.fallbackId || null,
          additionalPrices: JSON.parse(advanced),
          ...(item?.effectiveFrom ? { effectiveFrom: item.effectiveFrom } : {}),
          effectiveUntil: values.effectiveUntil || null,
        });
      if (kind === 'plan') body.limits = JSON.parse(advanced);
      if (kind === 'policy')
        Object.assign(body, {
          planId: values.planId,
          bucket: values.bucket,
          modelId: values.bucket === 'AUTO' ? null : values.bucket,
          allowedFeatures: values.allowedFeatures,
          routing: JSON.parse(advanced),
        });
      setBusy(true);
      onBusyChange(true);
      const path =
        kind === 'plan'
          ? '/admin/billing/plans'
          : `/admin/workspace/${kind === 'model' ? 'models' : 'policies'}`;
      await apiRequest(
        `${path}${item && kind !== 'policy' ? `/${item.id}` : ''}`,
        {
          accessToken,
          method: item && kind !== 'policy' ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        },
      );
      onSaved();
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? 'The advanced configuration must contain valid JSON.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const selected = (key: string) => (values[key] as string[]) ?? [];
  const providerBudget =
    config.creditDesign &&
    Number(values.monthlyCredits) * config.creditDesign.providerUsdPerCredit;
  return (
    <form onSubmit={save} className="config-editor">
      <fieldset disabled={busy}>
        {kind === 'plan' &&
          providerBudget !== undefined &&
          Number.isFinite(providerBudget) && (
            <p className="muted" role="status">
              Monthly provider budget: US${providerBudget.toFixed(2)} per fully
              used allowance.
              {values.currency === 'USD' &&
              values.billingInterval === 'MONTH' &&
              Number(values.intervalCount ?? 1) === 1 &&
              Number(values.originalPrice) > 0
                ? ` That leaves US$${(Number(values.originalPrice) / 100 - providerBudget).toFixed(2)} at the regular monthly price, before payment fees, hosting, refunds, promotions and free-user costs.`
                : 'Fund free allowances from your operating budget; compare paid prices in the same currency and period.'}
            </p>
          )}
        {kind === 'policy' && (
          <div className="form-grid">
            <label>
              Plan
              <select
                aria-label="Plan"
                required
                value={String(values.planId)}
                disabled={Boolean(item)}
                onChange={(e) => set('planId', e.target.value)}
              >
                <option value="">Choose a plan</option>
                {config.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model selection
              <select
                aria-label="Model selection"
                value={String(values.bucket)}
                disabled={Boolean(item)}
                onChange={(e) => set('bucket', e.target.value)}
              >
                <option value="AUTO">Auto</option>
                {config.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="form-grid">
          {fields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.type === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(e) => set(field.key, e.target.checked)}
                />
              ) : field.options ? (
                <select
                  aria-label={field.label}
                  value={String(values[field.key] ?? '')}
                  onChange={(e) => set(field.key, e.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={String(values[field.key] ?? '')}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              ) : (
                <input
                  required
                  type={field.type ?? 'text'}
                  min={field.min}
                  max={field.max}
                  step={field.step ?? '1'}
                  value={String(values[field.key] ?? '')}
                  onChange={(e) =>
                    set(
                      field.key,
                      field.type === 'number'
                        ? e.target.value === ''
                          ? ''
                          : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              )}
            </label>
          ))}
        </div>
        {kind !== 'plan' && (
          <fieldset className="capability-fieldset">
            <legend>
              {kind === 'model' ? 'Capabilities' : 'Allowed tasks'}
            </legend>
            {(kind === 'model'
              ? capabilities
              : ['chat', 'image_generation']
            ).map((capability) => {
              const key = kind === 'model' ? 'capabilities' : 'allowedFeatures';
              return (
                <label key={capability}>
                  <input
                    type="checkbox"
                    checked={selected(key).includes(capability)}
                    onChange={(e) =>
                      set(
                        key,
                        e.target.checked
                          ? [...selected(key), capability]
                          : selected(key).filter(
                              (value) => value !== capability,
                            ),
                      )
                    }
                  />
                  {capability.replaceAll('_', ' ')}
                </label>
              );
            })}
          </fieldset>
        )}
        {kind === 'model' && (
          <>
            <fieldset className="capability-fieldset">
              <legend>Supported reasoning levels</legend>
              {['low', 'medium', 'high', 'xhigh'].map((level) => (
                <label key={level}>
                  <input
                    type="checkbox"
                    checked={selected('reasoningLevels').includes(level)}
                    onChange={(e) =>
                      set(
                        'reasoningLevels',
                        e.target.checked
                          ? [...selected('reasoningLevels'), level]
                          : selected('reasoningLevels').filter(
                              (value) => value !== level,
                            ),
                      )
                    }
                  />
                  {level}
                </label>
              ))}
            </fieldset>
            <details className="advanced-config">
              <summary>Capability availability</summary>
              <p className="muted">
                Map a capability to NATIVE_PROVIDER, VROMPT, or UNAVAILABLE.
                Only enabled, non-unavailable capabilities are exposed to users
                and routing.
              </p>
              <textarea
                aria-label="Capability availability"
                rows={8}
                value={String(values.capabilityStates ?? '{}')}
                onChange={(e) => set('capabilityStates', e.target.value)}
              />
            </details>
          </>
        )}
        {kind === 'model' && (
          <label className="config-label">
            Fallback model
            <select
              value={String(values.fallbackId || '')}
              onChange={(e) => set('fallbackId', e.target.value)}
            >
              <option value="">No fallback</option>
              {config.models
                .filter((model) => model.id !== item?.id)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === 'policy' && (
          <fieldset className="capability-fieldset">
            <legend>Auto model pool</legend>
            {config.models.map((model) => {
              let routing: { allowedModelIds?: string[] };
              try {
                routing = JSON.parse(advanced);
              } catch {
                return null;
              }
              return (
                <label key={model.id}>
                  <input
                    type="checkbox"
                    checked={
                      routing.allowedModelIds?.includes(model.id) ?? false
                    }
                    onChange={(e) =>
                      setAdvanced(
                        JSON.stringify(
                          {
                            ...routing,
                            allowedModelIds: e.target.checked
                              ? [...(routing.allowedModelIds ?? []), model.id]
                              : (routing.allowedModelIds ?? []).filter(
                                  (id) => id !== model.id,
                                ),
                          },
                          null,
                          2,
                        ),
                      )
                    }
                  />
                  {model.displayName}
                </label>
              );
            })}
          </fieldset>
        )}
        <details className="advanced-config">
          <summary>
            {kind === 'plan'
              ? 'Feature limits'
              : kind === 'policy'
                ? 'Advanced routing rules'
                : 'Additional provider pricing'}
          </summary>
          <p className="muted">
            {kind === 'plan'
              ? 'Optional feature limits as JSON: featureKey, featureName, resetPeriod (DAILY or MONTHLY), and limit. Generation allowances are configured separately below.'
              : kind === 'policy'
                ? 'Set creditCost for Auto chat and imageCreditCost for images, plus timeouts, maximum attempts, quality and routing rules. All Auto attempts must fit within the shared credit budget.'
                : 'Optional cacheWriteInputPrice (USD per million tokens). Image tasks require maxImageOutputCostUsd: a verified USD cap covering all output and tool charges per request.'}
          </p>
          <textarea
            aria-label="Advanced configuration"
            rows={8}
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
          />
        </details>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button">
            {busy ? 'Saving…' : 'Save configuration'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function AdminRegistry({ plans = false }: { plans?: boolean }) {
  const resource = useAdminResource<Configuration>(
    '/admin/workspace/configuration',
  );
  const planResource = useAdminResource<{ plans: RecordItem[] }>(
    plans ? '/admin/billing/configuration' : null,
  );
  const [editing, setEditing] = useState<{ kind: Kind; item?: RecordItem }>();
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncingNvidia, setSyncingNvidia] = useState(false);
  const config = resource.data;
  const planItems = planResource.data?.plans;
  const visibleItems = (plans ? planItems : config?.models)?.filter((item) =>
    `${item.name ?? ''} ${item.displayName ?? ''} ${item.provider ?? ''} ${item.providerModelId ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  async function syncNvidia() {
    if (!resource.accessToken || syncingNvidia) return;
    setSyncingNvidia(true);
    setNotice('');
    try {
      let remaining = 1;
      let rounds = 0;
      let totalProbed = 0;
      let discovered = 0;
      let healthy = 0;

      while (remaining > 0 && rounds < 20) {
        const result = await apiRequest<{
          discovered: number;
          cataloged: number;
          probed: number;
          healthy: number;
          remainingToProbe: number;
        }>('/admin/workspace/nvidia-sync', {
          accessToken: resource.accessToken,
          method: 'POST',
          body: JSON.stringify({ probeLimit: 12 }),
        });
        discovered = result.discovered;
        healthy = result.healthy;
        totalProbed += result.probed;
        remaining = result.remainingToProbe;
        rounds += 1;
      }

      setNotice(
        `NVIDIA sync: ${discovered} discovered · ${totalProbed} probes completed · ${healthy} healthy${remaining ? ` · ${remaining} still waiting` : ' · catalog scan complete'}.`,
      );
      resource.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `NVIDIA sync failed: ${error.message}`
          : 'NVIDIA sync failed.',
      );
    } finally {
      setSyncingNvidia(false);
    }
  }

  // Normalize nested feature records from the billing API into its write DTO.
  function editPlan(plan: RecordItem) {
    const limits = (
      (plan.limits ?? []) as {
        feature: {
          key: string;
          name: string;
          description: string;
          unitLabel: string;
        };
        resetPeriod: string;
        limit: number | null;
        warningAt: number;
      }[]
    ).map((limit) => ({
      featureKey: limit.feature.key,
      featureName: limit.feature.name,
      description: limit.feature.description,
      unitLabel: limit.feature.unitLabel,
      resetPeriod: limit.resetPeriod,
      limit: limit.limit,
      warningAt: limit.warningAt,
    }));
    setEditing({ kind: 'plan', item: { ...plan, limits } });
  }
  return (
    <div className="content-page">
      <PageHeading
        title={plans ? 'Plans & allowances' : 'Models & routing'}
        description={
          plans
            ? 'Set subscription pricing, workspace capacity, and generation allowances.'
            : 'Manage model availability, capabilities, costs, and fallback models.'
        }
      />
      <ResourceState
        loading={resource.loading || planResource.loading}
        error={resource.error || planResource.error}
        onRetry={() => {
          resource.refresh();
          planResource.refresh();
        }}
      />
      {notice && (
        <p className="success-banner" role="status">
          {notice}
        </p>
      )}
      <div className="admin-toolbar">
        <button
          className="primary-button"
          disabled={!config || (plans && !planItems)}
          onClick={() => setEditing({ kind: plans ? 'plan' : 'model' })}
        >
          + Add {plans ? 'plan' : 'model'}
        </button>
        {!plans && (
          <button
            className="secondary-button"
            disabled={!resource.accessToken || syncingNvidia}
            onClick={() => void syncNvidia()}
          >
            {syncingNvidia ? 'Checking NVIDIA…' : 'Sync NVIDIA free models'}
          </button>
        )}
        <button
          className="secondary-button"
          onClick={() => {
            resource.refresh();
            planResource.refresh();
          }}
        >
          Refresh
        </button>
      </div>
      <div className="list-toolbar">
        <input
          type="search"
          aria-label={plans ? 'Search plans' : 'Search models'}
          placeholder={
            plans ? 'Search plans' : 'Search model names or providers'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="secondary-button" onClick={() => setQuery('')}>
            Clear search
          </button>
        )}
      </div>
      <div className="panel">
        {visibleItems?.map((item) => (
          <div className="row" key={item.id}>
            <div className="registry-name">
              {!plans && <ProviderIcon provider={item.provider ?? ''} />}
              <div>
                <strong>{plans ? item.name : item.displayName}</strong>
                <p className="muted">
                  {plans
                    ? `${item.currency} ${(Number(item.originalPrice) / 100).toFixed(2)} · ${String(item.monthlyCredits)} monthly credits`
                    : `${item.provider} · ${String(item.providerModelId)}${item.provider === 'NVIDIA' ? ` · ${String(item.healthStatus ?? 'UNKNOWN')}` : ''}`}
                </p>
              </div>
            </div>
            <div className="row-actions">
              <span
                className={`status-badge ${(plans ? item.isActive : item.enabled) ? 'active' : ''}`}
              >
                {(plans ? item.isActive : item.enabled)
                  ? 'Enabled'
                  : 'Disabled'}
              </span>
              <button
                className="secondary-button"
                onClick={() =>
                  plans ? editPlan(item) : setEditing({ kind: 'model', item })
                }
              >
                Edit
              </button>
            </div>
          </div>
        ))}
        {!visibleItems?.length &&
          !resource.loading &&
          !planResource.loading &&
          !resource.error &&
          !planResource.error && (
            <p className="muted">
              {query
                ? 'No results match your search. Try a different name or clear the search.'
                : `No ${plans ? 'plans' : 'models'} configured yet.`}
            </p>
          )}
      </div>
      {plans ? (
        <>
          <div className="admin-toolbar" id="generation-allowances">
            <h2>Generation allowances & routing</h2>
            <button
              className="secondary-button"
              disabled={!config?.plans.length}
              onClick={() => setEditing({ kind: 'policy' })}
            >
              + Add allowance
            </button>
          </div>
          <div className="panel">
            {config?.policies.map((policy) => (
              <div className="row" key={policy.id}>
                <div>
                  <strong>
                    {config.plans.find((plan) => plan.id === policy.planId)
                      ?.name ?? 'Plan'}{' '}
                    ·{' '}
                    {policy.bucket === 'AUTO'
                      ? 'Auto'
                      : (config.models.find(
                          (model) => model.id === policy.bucket,
                        )?.displayName ?? 'Model')}
                  </strong>
                  <p className="muted">
                    {String(policy.dailyLimit)} daily ·{' '}
                    {String(policy.monthlyLimit)} monthly ·{' '}
                    {policy.enabled ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => setEditing({ kind: 'policy', item: policy })}
                >
                  Edit allowance
                </button>
              </div>
            ))}
            {config && !config.policies.length && (
              <p className="muted">
                Add a policy to give a plan access to Auto or a specific model.
              </p>
            )}
          </div>
        </>
      ) : (
        <section className="panel row">
          <div>
            <h2>Plan access & Auto routing</h2>
            <p className="muted">
              Manage generation limits and Auto model pools in one place.
            </p>
          </div>
          <Link
            className="secondary-button"
            href="/admin/plans#generation-allowances"
          >
            Manage allowances & routing
          </Link>
        </section>
      )}
      <Modal
        open={Boolean(editing)}
        title={`${editing?.item ? 'Edit' : 'Add'} ${editing?.kind ?? 'configuration'}`}
        description="Changes are validated and saved to the workspace configuration."
        onClose={() => {
          if (!saving) setEditing(undefined);
        }}
        className="max-w-3xl"
      >
        {editing && config && (
          <Editor
            key={`${editing.kind}-${editing.item?.id ?? 'new'}`}
            onBusyChange={setSaving}
            kind={editing.kind}
            item={editing.item}
            config={config}
            accessToken={resource.accessToken!}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined);
              setNotice('Configuration saved.');
              resource.refresh();
              planResource.refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
