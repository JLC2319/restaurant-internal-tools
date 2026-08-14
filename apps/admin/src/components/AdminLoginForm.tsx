import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { login } from '../api/auth';
import { setToken } from '../api/client';
import { ErrorNote, inputClass, primaryButtonClass } from './ui';

export function AdminLoginForm({ next = '/' }: { next?: string }) {
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

    // The API will 404 every console route for a non-superAdmin anyway; the
    // check here just turns that dead end into an honest message.
    if (result.data.user.platformRole !== 'superAdmin') {
      setError('This console is for platform staff only.');
      setSubmitting(false);
      return;
    }

    setToken(result.data.token);
    window.location.href = next;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-steel-700">
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
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-steel-700">
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
