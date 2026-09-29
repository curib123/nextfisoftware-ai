'use client';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { Icon } from '@/components/ui/icon';

export type PublicPlan = {
  id: string;
  name: string;
  description: string;
  priceCentavos: number;
  originalPrice?: number;
  currency: string;
  billingPeriod: string;
  monthlyCredits?: number;
  maxFiles?: number;
  imageGeneration?: boolean;
  maxProjects?: number;
  maxWorkflows?: number;
  manualModelCount?: number;
  allowances?: { bucket: string; dailyLimit: number; monthlyLimit: number }[];
  features: {
    key: string;
    name: string;
    limit: number | null;
    resetPeriod: string;
  }[];
};
export type PublicPlans = {
  plans: PublicPlan[];
  checkoutAvailable?: boolean;
  paymentMode?: string;
};

let publicPlansCache: PublicPlans | undefined;

export function usePlans() {
  const [data, setData] = useState<PublicPlans>(() => publicPlansCache);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<PublicPlans>('/billing/plans', {
      signal: controller.signal,
    })
      .then((value) => {
        publicPlansCache = value;
        setData(value);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [attempt]);
  return { data, error, retry: () => setAttempt((value) => value + 1) };
}
export function PlanCards({
  plans,
  onChoose,
  busy = false,
  selected,
  currentPlan,
  checkoutAvailable = true,
  paidPlanActive = false,
}: {
  plans: PublicPlan[];
  onChoose: (plan: PublicPlan) => void;
  busy?: boolean;
  selected?: string | null;
  currentPlan?: string;
  checkoutAvailable?: boolean;
  paidPlanActive?: boolean;
}) {
  return (
    <div className="pricing-grid">
      {plans.map((plan) => {
        const free = plan.priceCentavos === 0;
        const auto = plan.allowances?.find((item) => item.bucket === 'Auto');
        const current = currentPlan === plan.id;
        return (
          <article
            key={plan.id}
            className={`pricing-card ${selected === plan.id ? 'plan-selected' : ''}`}
          >
            <div className="plan-heading">
              <h3>{plan.name}</h3>
              {current && <span className="status-badge">Current plan</span>}
            </div>
            <p>{plan.description}</p>
            <div className="plan-price">
              <strong>
                {new Intl.NumberFormat('en', {
                  style: 'currency',
                  currency: plan.currency,
                  maximumFractionDigits: 2,
                }).format(plan.priceCentavos / 100)}
              </strong>
              <span>{free ? 'to get started' : plan.billingPeriod}</span>
            </div>
            <button
              className={free ? 'secondary-button' : 'primary-button'}
              onClick={() => onChoose(plan)}
              disabled={
                busy ||
                (!free && (current || paidPlanActive || !checkoutAvailable))
              }
            >
              {busy && selected === plan.id
                ? 'Opening secure checkout…'
                : free
                  ? 'Start for Free'
                  : current
                    ? 'Plan active'
                    : paidPlanActive
                      ? 'Available after current plan'
                      : !checkoutAvailable
                        ? 'Checkout unavailable'
                        : `Get ${plan.name}`}
              <Icon name="arrow" />
            </button>
            <ul className="plan-features">
              <li>
                <Icon name="check" />
                Private conversations and saved history
              </li>
              <li>
                <Icon name="check" />
                {free
                  ? 'Free Auto routing across verified free endpoints'
                  : 'Smart Auto routing across your eligible model pool'}
              </li>
              {free ? (
                <>
                  <li>
                    <Icon name="check" />
                    Generous fair-use access instead of a credit meter
                  </li>
                  <li>
                    <Icon name="check" />
                    Image, PDF, and text-file uploads on compatible free models
                  </li>
                </>
              ) : (
                auto && (
                  <li>
                    <Icon name="check" />
                    Up to {auto.dailyLimit.toLocaleString()} Auto requests per day
                  </li>
                )
              )}
              {free ? (
                <li>
                  <Icon name="check" />
                  Verified free models cost 0 Nextfi credits
                </li>
              ) : (
                plan.monthlyCredits !== undefined && (
                  <li>
                    <Icon name="check" />
                    {plan.monthlyCredits.toLocaleString()} premium credits per
                    month for non-free models
                  </li>
                )
              )}
              {free ? (
                <li>
                  <Icon name="check" />
                  Manual selection across verified free endpoints
                </li>
              ) : (
                Boolean(plan.manualModelCount) && (
                  <li>
                    <Icon name="check" />
                    {plan.manualModelCount} premium models with manual selection
                  </li>
                )
              )}
              <li>
                <Icon name="check" />
                {free
                  ? 'Free access is subject to provider availability and fair-use limits'
                  : 'All free models remain 0 credits; premium prices vary by model and task'}
              </li>
              {Boolean(plan.maxFiles) && (
                <li>
                  <Icon name="check" />
                  Up to {plan.maxFiles} {plan.maxFiles === 1 ? 'file' : 'files'}{' '}
                  per message
                </li>
              )}
              {plan.imageGeneration && (
                <li>
                  <Icon name="check" />
                  Image generation with credits
                </li>
              )}
              {Boolean(plan.maxProjects) && (
                <li>
                  <Icon name="check" />
                  Up to {plan.maxProjects} projects
                </li>
              )}
              {Boolean(plan.maxWorkflows) && (
                <li>
                  <Icon name="check" />
                  Up to {plan.maxWorkflows} workflows
                </li>
              )}
              {plan.features.map((feature, index) => (
                <li key={`${feature.key}-${index}`}>
                  <Icon name="check" />
                  {feature.name}: {feature.limit ?? 'No set limit'} /{' '}
                  {feature.resetPeriod.toLowerCase()}
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
