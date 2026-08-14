import { useState } from 'react';
import type { SubmitEvent } from 'react';
import type { MembershipSummary } from '@rit/shared';
import { login } from '@/features/auth/api';
import { setScope, setToken } from '@/lib/api/client';
import { ErrorNote, inputClass, primaryButtonClass } from '@/components/ui';

/**
 * Picks the scope to land in after login. The broadest membership wins — an
 * area director should see the whole property by default rather than whichever
 * location happened to be created first. A user with several equally-broad
 * memberships gets the first; the scope switcher lets them change it.
 */
function defaultScope(memberships: MembershipSummary[]): MembershipSummary | null {
  const width = { org: 0, property: 1, location: 2 } as const;
  return [...memberships].sort((a, b) => width[a.tier] - width[b.tier])[0] ?? null;
}

export function LoginForm({ next = '/' }: { next?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await login({ email, password });

    if (result.error) {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }

    setToken(result.data.token);

    const chosen = defaultScope(result.data.memberships);
    if (!chosen) {
      // Authenticated but in no org yet. Onboarding (create-an-org) is not
      // built, so say so rather than dropping them on an empty dashboard.
      setError('Your account is not attached to an organization yet. Ask an admin to invite you.');
      setSubmitting(false);
      return;
    }

    setScope({
      orgId: chosen.org._id,
      propertyId: chosen.property?._id ?? null,
      locationId: chosen.location?._id ?? null,
    });

    window.location.href = next;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-steel-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-steel-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <button type="submit" disabled={submitting} className={`${primaryButtonClass} w-full`}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
