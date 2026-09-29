'use client';
import { PageHeading } from '@/components/ui/page-heading';
import { CardSkeletons, ResourceSkeleton } from '@/components/ui/skeleton';
import { ResourceState } from '@/components/ui/resource-state';
import { useAdminResource } from '@/components/admin/use-admin-resource';
import { Icon } from '@/components/ui/icon';
import { Suspense } from 'react';
import {
  PlanCards,
  usePlans,
  type PublicPlan,
} from '@/components/billing/plan-cards';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useAuthDialog } from '@/components/providers/auth-dialog-provider';
import { useFeedback } from '@/components/ui/feedback-modal';
import { apiRequest } from '@/lib/api';
import { useSubscription } from '@/components/providers/subscription-provider';

export { Conversations, SavedPrompts } from './library';
export { UsagePage } from './usage';
export function AdminAnalytics() {
  const resource = useAdminResource<{
    costs: {
      provider: string;
      modelName: string;
      currency: string;
      _sum: { estimatedCost: string | null };
      _count: number;
    }[];
    activeSubscriptions: number;
    contribution: {
      currency: string;
      revenue: number;
      aiCost: number;
      contributionProfit: number;
      margin: number | null;
    }[];
    note: string;
  }>('/admin/workspace/analytics');
  const data = resource.data;
  return (
    <div className="content-page">
      <PageHeading
        title="Costs & revenue"
        description="Review revenue and AI costs over the last 30 days, separated by currency."
      />
      <ResourceState
        {...resource}
        onRetry={resource.refresh}
        empty={Boolean(data && !data.costs.length && !data.contribution.length)}
      >
        <h2>No activity recorded yet</h2>
        <p>
          Revenue and provider costs will appear after payments or generations
          are recorded.
        </p>
      </ResourceState>
      <div className="feature-grid">
        {data?.contribution.map((item) => (
          <section className="panel" key={item.currency}>
            <p className="eyebrow">{item.currency} · Last 30 days</p>
            <h2>{item.revenue.toFixed(2)}</h2>
            <p className="muted">Cash received</p>
            <div className="row">
              <span>AI cost</span>
              <strong>{item.aiCost.toFixed(4)}</strong>
            </div>
            <div className="row">
              <span>Contribution</span>
              <strong>{item.contributionProfit.toFixed(2)}</strong>
            </div>
            <p className="muted">
              {item.margin === null
                ? 'No revenue recorded'
                : `${(item.margin * 100).toFixed(1)}% contribution margin`}
            </p>
          </section>
        ))}
      </div>
      <p className="muted">
        Last 30 days. Provider costs are tracked separately from customer-facing
        generations.
      </p>
      {data && (
        <section className="panel">
          <div className="row">
            <strong>Active subscriptions</strong>
            <span>{data?.activeSubscriptions ?? '—'}</span>
          </div>
          {data?.costs.map((c, i) => (
            <div className="row" key={`${c.provider}-${c.modelName}-${i}`}>
              <span>
                {c.provider} · {c.modelName}
                <br />
                <small>{c._count} records</small>
              </span>
              <span>
                {c.currency} {Number(c._sum.estimatedCost ?? 0).toFixed(4)}
              </span>
            </div>
          ))}
        </section>
      )}
      <p className="muted">{data?.note}</p>
    </div>
  );
}

export function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="content-page">
          <ResourceSkeleton rows={5} />
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  );
}
function BillingContent() {
  const { openLogin } = useAuthDialog();
  const { alert } = useFeedback();
  const { accessToken, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlan = searchParams.get('plan');
  const unlockModel = searchParams.get('unlockModel');
  const plans = usePlans();
  const billingResource = useSubscription();
  const billing = billingResource.data;
  const paidPlanActive =
    billing?.subscription?.status === 'ACTIVE' &&
    (billing.planCode ?? billing.plan) !== 'FREE';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(requestedPlan);
  const [code, setCode] = useState('');
  async function checkout(plan: PublicPlan) {
    if (!plan.priceCentavos) {
      if (user) router.push('/chat');
      else openLogin('/chat');
      return;
    }
    if (!accessToken) {
      openLogin('/billing?plan=' + encodeURIComponent(plan.id));
      return;
    }
    setSelected(plan.id);
    if (plans.data?.checkoutAvailable === false) {
      const message =
        'Paid checkout is temporarily unavailable. You can continue using your free workspace.';
      setError(message);
      alert({
        tone: 'warning',
        title: 'Checkout is unavailable',
        message,
      });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ checkoutUrl: string }>(
        '/billing/checkout',
        {
          accessToken,
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            planCode: plan.id,
            ...(code.trim() ? { discountCode: code.trim() } : {}),
          }),
        },
      );
      const url = new URL(result.checkoutUrl);
      if (
        url.protocol !== 'https:' ||
        !(
          url.hostname === 'paymongo.com' ||
          url.hostname.endsWith('.paymongo.com')
        )
      )
        throw new Error(
          'The checkout link could not be verified. Please retry.',
        );
      window.location.assign(url.href);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="content-page billing-content">
      <PageHeading
        title="Billing"
        description="Review your current plan and compare available upgrades."
      />
      <ResourceState {...billingResource} onRetry={billingResource.refresh} />
      {unlockModel && (
        <section className="upgrade-intent-panel" aria-label="Upgrade model access">
          <span className="upgrade-intent-icon">
            <Icon name="lock" />
          </span>
          <div>
            <span className="eyebrow">MODEL LOCKED</span>
            <h2>Unlock {unlockModel}</h2>
            <p>
              This is a premium/flagship model. Choose an eligible paid plan
              below to add premium model access. Verified free models remain
              available at 0 Nextfi credits.
            </p>
          </div>
        </section>
      )}
      {billing && (
        <section className="panel current-plan-panel">
          <div>
            <span className="eyebrow">CURRENT PLAN</span>
            <h2>{billing.planName ?? billing.plan}</h2>
          </div>
          <div>
            {billing.subscription && (
              <p>
                {billing.subscription.status} · Access ends{' '}
                {new Date(
                  billing.subscription.currentPeriodEnd,
                ).toLocaleDateString()}
              </p>
            )}
            <Link href="/usage" className="text-link">
              View your usage <Icon name="arrow" />
            </Link>
          </div>
        </section>
      )}
      {plans.data?.checkoutAvailable === false && (
        <div className="service-notice" role="status">
          <Icon name="card" />
          <div>
            <strong>Paid checkout is temporarily unavailable.</strong>
            <p>
              Your free workspace remains available. No payment will be taken.
            </p>
            <Link href="/chat" className="text-link">
              Continue to chat <Icon name="arrow" />
            </Link>
          </div>
        </div>
      )}
      {plans.data?.checkoutAvailable && plans.data.paymentMode === 'test' && (
        <p className="notice-banner">
          Test payment mode. Checkout will not make a real charge.
        </p>
      )}
      {(error || plans.error) && (
        <p className="error-banner" role="alert">
          {error || plans.error}
        </p>
      )}
      {plans.error && (
        <button className="secondary-button" onClick={plans.retry}>
          Reload plans
        </button>
      )}
      {plans.data?.checkoutAvailable && (
        <label className="promotion-field">
          Promotion code (optional)
          <input
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your code"
          />
        </label>
      )}
      {plans.data ? (
        <PlanCards
          plans={plans.data.plans}
          onChoose={(plan) => void checkout(plan)}
          busy={busy}
          selected={selected}
          currentPlan={billing?.planCode ?? billing?.plan}
          checkoutAvailable={plans.data.checkoutAvailable}
          paidPlanActive={paidPlanActive}
        />
      ) : (
        !plans.error && <CardSkeletons count={3} />
      )}
      {plans.data && !plans.data.plans.length && (
        <div className="service-notice">
          <p>Paid plans are currently unavailable.</p>
          <Link href="/chat" className="primary-button">
            Open your free workspace
          </Link>
        </div>
      )}
      <p className="pricing-footnote">
        {paidPlanActive &&
          'You can choose a different paid plan when your current access period ends. '}
        Paid access is renewed by checkout. Your card is not automatically
        charged. Verified free endpoints always use 0 Nextfi credits; premium
        credits are used only by non-free models and premium Auto routes.
      </p>
    </div>
  );
}
