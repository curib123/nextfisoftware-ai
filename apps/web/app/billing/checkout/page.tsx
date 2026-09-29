'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { SignInButton } from '@/components/providers/auth-dialog-provider';
import { ResourceSkeleton } from '@/components/ui/skeleton';
function PaymentStatus() {
  const { accessToken } = useAuth();
  const id = useSearchParams().get('payment');
  const [status, setStatus] = useState('Checking payment…');
  useEffect(() => {
    if (!accessToken || !id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const payment = await apiRequest<{ status: string }>(
          `/billing/payments/${encodeURIComponent(id!)}`,
          { accessToken: accessToken!, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setStatus(payment.status);
        if (
          !['PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'].includes(
            payment.status,
          )
        )
          timer = setTimeout(() => void poll(), 5000);
      } catch (e) {
        if (!controller.signal.aborted) setStatus((e as Error).message);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [accessToken, id]);
  return (
    <main className="center-page">
      <h1>Payment status</h1>
      <p role="status">
        {!id
          ? 'No payment selected.'
          : !accessToken
            ? 'Sign in to view this payment.'
            : status}
      </p>
      <p className="muted">Access updates only after payment confirmation.</p>
      {!accessToken && (
        <SignInButton className="primary-button">
          Sign in to view payment
        </SignInButton>
      )}
      <Link href="/billing">Back to billing</Link>
    </main>
  );
}
export default function Checkout() {
  return (
    <Suspense
      fallback={
        <main className="center-page">
          <ResourceSkeleton rows={3} />
        </main>
      }
    >
      <PaymentStatus />
    </Suspense>
  );
}
