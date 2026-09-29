import Link from 'next/link';
import { PublicShell } from '@/components/brand/public-shell';

export const metadata = { title: 'Privacy' };
export default function Page() {
  return (
    <PublicShell>
      <p className="eyebrow">YOUR WORKSPACE, YOUR INFORMATION</p>
      <h1>Privacy</h1>
      <p className="muted">
        How information is used when you work with Nextfi Software.
      </p>
      <section className="panel legal-section">
        <h2>Account and workspace information</h2>
        <p>
          Nextfi Software stores your sign-in provider identity, account details,
          preferences, conversations, saved prompts, projects, and uploaded
          files to operate your workspace. Usage and billing records support
          plan allowances and payment status. Security and administration events
          are recorded to protect accounts and investigate problems.
        </p>
        <h2>When you use an AI model</h2>
        <p>
          Your prompt, relevant conversation context, project instructions, and
          selected attachments are sent to the AI provider handling your
          request. Auto may try another eligible provider if a request fails.
          The answering model is identified in the conversation. Providers
          process requests under their own service and privacy terms. Only share
          information you are authorized to send to these services.
        </p>
        <h2>Sign-in, payments, and browser storage</h2>
        <p>
          Google and GitHub handle user sign-in. A protected refresh cookie
          keeps your session active, while access tokens stay in browser memory.
          Browser storage remembers your theme, sign-in destination, and a
          prompt you carry into chat. PayMongo handles checkout; Nextfi Software stores
          payment references and status rather than your full card details.
        </p>
        <h2>Access and your controls</h2>
        <p>
          Conversations and attachments are private by default. The API checks
          account permissions and ownership before serving workspace data. You
          can delete conversations and their attachments from Conversations,
          remove saved prompts from your library, and edit your preferences in
          Settings. Deleting workspace content does not delete associated
          account, payment, or security records.
        </p>
        <div className="row-actions">
          <Link className="text-link" href="/settings">
            Account settings
          </Link>
          <Link className="text-link" href="/docs">
            Help & getting started
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
