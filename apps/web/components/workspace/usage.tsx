'use client';

import Link from 'next/link';
import { ProviderIcon, providerNames } from '@/components/brand/provider-icon';
import { Icon } from '@/components/ui/icon';
import { PageHeading } from '@/components/ui/page-heading';
import { ResourceState } from '@/components/ui/resource-state';
import type { Usage } from '@/lib/api';
import { useWorkspaceResource } from './use-workspace-resource';

function count(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function ResetTime({ value }: { value: string }) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return <span>Not available</span>;
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })}
    </time>
  );
}

function RemainingMeter({
  label,
  name,
  remaining,
  limit,
}: {
  label: string;
  name: string;
  remaining: number;
  limit: number;
}) {
  const total = count(limit);
  const left = Math.min(count(remaining), total);
  return (
    <div className="usage-limit">
      <div className="usage-limit-label">
        <span>{label}</span>
        <strong>
          {total
            ? `${left.toLocaleString()} / ${total.toLocaleString()}`
            : 'Not included'}
        </strong>
      </div>
      {total > 0 && (
        <progress
          className="usage-meter"
          aria-label={name}
          aria-valuetext={`${left.toLocaleString()} of ${total.toLocaleString()} remaining`}
          max={total}
          value={left}
        />
      )}
    </div>
  );
}

export function UsagePage() {
  const resource = useWorkspaceResource<Usage>('/workspace/usage');
  const usage = resource.data;
  const freePlan = usage?.plan.toLowerCase() === 'free';
  const creditLimit = count(usage?.credits?.limit ?? 0);
  const creditRemaining = Math.min(
    count(usage?.credits?.remaining ?? 0),
    creditLimit,
  );
  const creditReserved = count(usage?.credits?.reserved ?? 0);
  const creditUsed = count(
    usage?.credits?.used ?? creditLimit - creditRemaining - creditReserved,
  );
  const allowances = [...(usage?.allowances ?? [])].sort((a, b) =>
    a.bucket === 'AUTO'
      ? -1
      : b.bucket === 'AUTO'
        ? 1
        : (a.modelName ?? '').localeCompare(b.modelName ?? ''),
  );
  return (
    <div className="content-page usage-page">
      <PageHeading
        title="Your usage"
        description="See what’s available and when your limits reset."
      >
        <button
          className="secondary-button"
          onClick={resource.refresh}
          disabled={resource.loading}
        >
          {resource.loading && usage ? 'Refreshing…' : 'Refresh usage'}
        </button>
        <Link href="/billing" className="secondary-button">
          Manage subscription
        </Link>
      </PageHeading>
      {!usage && <ResourceState {...resource} onRetry={resource.refresh} />}
      {usage && (
        <>
          <div className="usage-overview" aria-busy={resource.loading}>
            <section
              className="panel usage-credit-card"
              aria-labelledby="usage-credit-title"
            >
              <div className="usage-card-heading">
                <h2 id="usage-credit-title">
                  {freePlan ? 'Free model access' : 'Premium credits'}
                </h2>
                <span className="usage-plan">{usage.plan}</span>
              </div>
              {freePlan ? (
                <>
                  <p className="usage-credit-total">
                    <strong>0</strong>
                    <span>credits required for verified free models</span>
                  </p>
                  <p className="usage-credit-note">
                    Free endpoints never spend Nextfi credits. Request, rate,
                    and provider availability limits still protect the shared
                    service from abuse and upstream outages.
                  </p>
                </>
              ) : usage.credits ? (
                <>
                  <p className="usage-credit-total">
                    <strong>{creditRemaining.toLocaleString()}</strong>
                    <span>
                      {' '}
                      / {creditLimit.toLocaleString()} premium credits remaining
                    </span>
                  </p>
                  {creditLimit > 0 && (
                    <progress
                      className="usage-meter"
                      aria-label="Premium credits remaining"
                      aria-valuetext={`${creditRemaining.toLocaleString()} of ${creditLimit.toLocaleString()} premium credits remaining`}
                      max={creditLimit}
                      value={creditRemaining}
                    />
                  )}
                  <p className="usage-credit-note">
                    {creditLimit === 0
                      ? 'No premium credits are included in this plan.'
                      : `${creditUsed.toLocaleString()} used${creditReserved ? ` · ${creditReserved.toLocaleString()} pending` : ''} · Free models remain 0 credits.`}
                  </p>
                  {creditLimit > 0 && creditRemaining === 0 && (
                    <p className="usage-limit-notice" role="status">
                      Your premium balance is empty. Free models still work.
                    </p>
                  )}
                </>
              ) : (
                <p className="muted">
                  This plan uses the request limits shown below.
                </p>
              )}
            </section>
            <section
              className="panel usage-reset-card"
              aria-labelledby="usage-reset-title"
            >
              <h2 id="usage-reset-title">Reset schedule</h2>
              <dl>
                <div>
                  <dt>Daily limits</dt>
                  <dd>
                    <ResetTime value={usage.resets.daily} />
                  </dd>
                </div>
                <div>
                  <dt>Monthly limits & credits</dt>
                  <dd>
                    <ResetTime value={usage.resets.monthly} />
                  </dd>
                </div>
              </dl>
              <p>Times are shown in your local time zone.</p>
            </section>
          </div>
          <section
            className="usage-model-section"
            aria-labelledby="usage-model-title"
          >
            <div className="usage-section-heading">
              <h2 id="usage-model-title">Model limits</h2>
              <p>Messages remaining. Daily and monthly limits both apply.</p>
            </div>
            {allowances.length ? (
              <div className="usage-model-list">
                {allowances.map((allowance, index) => {
                  const name =
                    allowance.bucket === 'AUTO'
                      ? 'Auto'
                      : allowance.modelName || `Model ${index + 1}`;
                  const provider = allowance.provider?.toLowerCase();
                  const limitReached =
                    allowance.dailyLimit <= 0 || allowance.monthlyLimit <= 0
                      ? 'Not included'
                      : allowance.monthlyRemaining <= 0
                        ? 'Monthly limit reached'
                        : allowance.dailyRemaining <= 0
                          ? 'Daily limit reached'
                          : null;
                  return (
                    <article
                      className="usage-model-card"
                      key={allowance.bucket}
                      aria-label={`${name} allowance`}
                    >
                      <div className="usage-model-identity">
                        {allowance.bucket === 'AUTO' || provider ? (
                          <ProviderIcon
                            provider={
                              allowance.bucket === 'AUTO' ? 'auto' : provider!
                            }
                          />
                        ) : (
                          <Icon name="cube" />
                        )}
                        <div>
                          <h3>{name}</h3>
                          <p>
                            {allowance.bucket === 'AUTO'
                              ? 'Automatic model selection'
                              : (providerNames[provider ?? ''] ??
                                'Manual selection')}
                          </p>
                          {allowance.creditCosts && (
                            <p>
                              {allowance.creditCosts.chat === null
                                ? 'Chat pricing unavailable'
                                : allowance.creditCosts.chat === 0
                                  ? 'Free · 0 Nextfi credits'
                                  : `${allowance.creditCosts.chat} ${allowance.creditCosts.chat === 1 ? 'premium credit' : 'premium credits'} per chat response`}
                              {allowance.creditCosts.image_generation !==
                                  null &&
                                allowance.creditCosts.image_generation !== 0 &&
                                ` · ${allowance.creditCosts.image_generation} premium credits per image request`}
                            </p>
                          )}
                          {limitReached && (
                            <span className="usage-limit-notice">
                              {limitReached}
                            </span>
                          )}
                        </div>
                      </div>
                      <RemainingMeter
                        label="Today"
                        name={`${name}: daily messages remaining`}
                        remaining={allowance.dailyRemaining}
                        limit={allowance.dailyLimit}
                      />
                      <RemainingMeter
                        label="This month"
                        name={`${name}: monthly messages remaining`}
                        remaining={allowance.monthlyRemaining}
                        limit={allowance.monthlyLimit}
                      />
                      <details className="usage-model-details">
                        <summary>Included tools</summary>
                        <p>
                          {allowance.allowedFeatures
                            .map((feature) =>
                              feature === 'image_generation'
                                ? 'Image generation'
                                : feature === 'chat'
                                  ? 'Chat'
                                  : feature.replaceAll('_', ' '),
                            )
                            .join(' · ') || 'No tools included'}
                        </p>
                        <p>
                          {allowance.maxFiles > 0
                            ? `Up to ${allowance.maxFiles} ${allowance.maxFiles === 1 ? 'file' : 'files'} per message${allowance.maxFileBytes > 0 ? ` · ${(allowance.maxFileBytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB per file` : ''}`
                            : 'File attachments are not included.'}
                        </p>
                      </details>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="resource-state">
                <h3>No model allowances yet</h3>
                <p>
                  Your model limits will appear here when they are added to your
                  plan.
                </p>
              </div>
            )}
          </section>
          <details className="usage-explanation">
            <summary>How usage is counted</summary>
            <p>
              Verified free endpoints use 0 Nextfi credits. Requests can still
              count toward fair-use, rate, and provider limits. Premium
              flagship models use credits based on the selected model and task,
              and the cost is shown before you send.
            </p>
            <p>
              Responses in progress reserve their allowance. A stopped response
              may count if processing has already occurred.
            </p>
            <p>
              Premium credits renew with the plan schedule and do not roll
              over. Free model access does not depend on the premium balance.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
