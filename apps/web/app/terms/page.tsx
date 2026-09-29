import Link from 'next/link';
import { PublicShell } from '@/components/brand/public-shell';

export const metadata = { title: 'Terms' };
export default function Page() {
  return (
    <PublicShell>
      <p className="eyebrow">USING NEXTFI SOFTWARE</p>
      <h1>Terms of use</h1>
      <p className="muted">
        Please read these terms before creating an account or using the
        workspace.
      </p>
      <section className="panel legal-section">
        <h2>Your account</h2>
        <p>
          Use your own Google or GitHub identity to sign in and keep that
          account secure. You are responsible for activity under your account
          and for having permission to submit the content and files you share.
        </p>
        <h2>Models and allowances</h2>
        <p>
          Nextfi Software provides access to supported AI models through one workspace.
          Models and features depend on provider availability and your plan.
          Auto selects an eligible model for a request; manual selection is
          available for models included in your plan. Shared credits and daily
          and monthly limits apply together. Your Usage page shows remaining
          allowances and reset dates. A stopped response may count if processing
          has already occurred.
        </p>
        <h2>Paid access</h2>
        <p>
          Review the price, currency, access period, and allowances before
          choosing a plan. Checkout is handled by PayMongo. Paid access begins
          only after the payment is verified. Access is renewed through a new
          checkout; your card is not automatically charged. Test mode is labeled
          and does not make a real charge. A failed or cancelled checkout does
          not activate a paid plan.
        </p>
        <h2>Responsible use</h2>
        <p>
          Do not use Nextfi Software for unlawful activity, attempt to access someone
          else&apos;s private workspace, bypass usage limits, or interfere with
          the service. Accounts may be suspended to address misuse or security
          issues. Applicable AI provider restrictions also apply to requests
          sent to those providers.
        </p>
        <h2>Review AI results</h2>
        <p>
          AI responses can be inaccurate or incomplete. Check important facts
          and review generated content before publishing, running code, or
          making decisions. Model availability and uninterrupted responses
          cannot be guaranteed.
        </p>
        <div className="row-actions">
          <Link className="text-link" href="/#pricing">
            Review plans
          </Link>
          <Link className="text-link" href="/privacy">
            Privacy
          </Link>
          <Link className="text-link" href="/docs">
            Help & getting started
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
