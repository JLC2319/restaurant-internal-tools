import { useState } from 'react'
import type { SubmitEvent } from 'react'
import type { Locale } from '@rit/shared'
import { register } from '../api/auth'

const inputClass =
  'min-h-touch w-full rounded-md border border-salt-300 bg-white px-3 py-2 text-steel-900 outline-none focus:border-ember-500 focus:ring-2 focus:ring-ember-200'

export function SignUpForm() {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [preferredLocale, setPreferredLocale] = useState<Locale>('en')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setFieldErrors({})

    if (password !== confirm) {
      setFieldErrors({ confirm: 'Passwords do not match' })
      return
    }

    setSubmitting(true)

    const result = await register({
      name: { first, last },
      email,
      password,
      preferredLocale,
    })

    if (result.error) {
      const fields = Object.fromEntries(
        (result.error.errors ?? []).map((e) => [e.field, e.message])
      )
      setFieldErrors(fields)
      if (Object.keys(fields).length === 0) setError(result.error.message)
      setSubmitting(false)
      return
    }

    setCreatedEmail(result.data.email)
  }

  function fieldError(field: string) {
    const message = fieldErrors[field]
    if (!message) return null
    return <p className="mt-1 text-sm text-chili-700">{message}</p>
  }

  // Accounts are created unattached; an admin invites the email afterwards
  // (memberships require an existing account — see inviteMember). So the end
  // state is a hand-off, not an auto-login into an org-less limbo.
  if (createdEmail) {
    return (
      <div role="status" className="space-y-4">
        <p className="rounded-md border border-basil-200 bg-basil-50 px-3 py-2 text-sm text-basil-700">
          Account created for <span className="font-medium">{createdEmail}</span>. Ask your
          organization admin to add you — then sign in.
        </p>
        <a
          href="/login"
          className="block min-h-touch w-full rounded-md bg-ember-500 px-4 py-2 text-center font-semibold text-white transition-colors hover:bg-ember-600"
        >
          Go to sign in
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-chili-200 bg-chili-50 px-3 py-2 text-sm text-chili-700"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 tablet:grid-cols-2">
        <div>
          <label htmlFor="first-name" className="mb-1 block text-sm font-medium text-steel-700">
            First name
          </label>
          <input
            id="first-name"
            type="text"
            autoComplete="given-name"
            required
            maxLength={60}
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            className={inputClass}
          />
          {fieldError('name.first')}
        </div>

        <div>
          <label htmlFor="last-name" className="mb-1 block text-sm font-medium text-steel-700">
            Last name
          </label>
          <input
            id="last-name"
            type="text"
            autoComplete="family-name"
            required
            maxLength={60}
            value={last}
            onChange={(e) => setLast(e.target.value)}
            className={inputClass}
          />
          {fieldError('name.last')}
        </div>
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-steel-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        {fieldError('email')}
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-steel-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-salt-600">At least 12 characters.</p>
        {fieldError('password')}
      </div>

      <div>
        <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-steel-700">
          Confirm password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
        {fieldError('confirm')}
      </div>

      <div>
        <label htmlFor="preferred-locale" className="mb-1 block text-sm font-medium text-steel-700">
          Preferred language
        </label>
        <select
          id="preferred-locale"
          value={preferredLocale}
          onChange={(e) => setPreferredLocale(e.target.value as Locale)}
          className={inputClass}
        >
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="min-h-touch w-full rounded-md bg-ember-500 px-4 py-2 font-semibold text-white transition-colors hover:bg-ember-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
