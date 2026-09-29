'use client';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import { useSubscription } from '@/components/providers/subscription-provider';
import { Skeleton } from '@/components/ui/skeleton';

export function PlanBadge() {
  const { user } = useAuth();
  const { data, error, loading } = useSubscription();
  if (!user) return null;
  if (user.role === 'ADMIN') return <span className="plan-badge">Admin</span>;
  if (!data || loading)
    return error ? (
      <Link className="plan-badge" href="/billing">
        Check plan
      </Link>
    ) : (
      <span className="plan-badge plan-badge-loading" aria-label="Loading plan">
        <Skeleton width={42} height={10} />
      </span>
    );
  const code = data.planCode ?? data.plan;
  const name =
    data.planName ??
    { FREE: 'Free', STARTER: 'Starter', PRO: 'Pro', MAX: 'Max' }[code] ??
    code;
  return (
    <Link
      href="/billing"
      className="plan-badge"
      data-plan={code.toLowerCase()}
      aria-label={`Current plan: ${name}. View billing`}
    >
      {name}
    </Link>
  );
}
