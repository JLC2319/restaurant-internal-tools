import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthUser, Locale, MembershipSummary } from '@rit/shared'
import { BadgeCheck, Building2, KeyRound, MailWarning, UserRound } from 'lucide-react'
import { changePassword, getMe, getMyMemberships, updateMe } from '@/features/auth/api'
import { QueryProvider } from '@/lib/QueryProvider'
import { SettingsShell } from '@/components/ui/SettingsShell'
import type { SettingsSection } from '@/components/ui/SettingsShell'
import {
  Badge,
  ErrorNote,
  SavedTick,
  SectionCard,
  Segmented,
  Skeleton,
  inputClass,
  primaryButtonClass,
} from '@/components/ui'

/** '' → null so a cleared field clears the stored value instead of failing Zod. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function initials(user: AuthUser): string {
  return `${user.name.first[0] ?? ''}${user.name.last[0] ?? ''}`.toUpperCase()
}

function IdentityCard({ user }: { user: AuthUser }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-salt-200 tablet:p-6">
      <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-ember-400 to-ember-600 text-xl font-bold text-white shadow-md shadow-ember-600/25">
        {initials(user)}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold text-steel-900">
          {user.name.first} {user.name.last}
        </h2>
        <p className="truncate text-sm text-salt-600">{user.email}</p>
        {user.jobTitle && <p className="mt-0.5 text-sm text-salt-500">{user.jobTitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {user.emailVerified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-basil-50 px-2.5 py-1 text-2xs font-semibold tracking-wide text-basil-700 uppercase ring-1 ring-basil-200 ring-inset">
            <BadgeCheck className="size-3.5" aria-hidden />
            Email verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-citron-50 px-2.5 py-1 text-2xs font-semibold tracking-wide text-citron-700 uppercase ring-1 ring-citron-200 ring-inset">
            <MailWarning className="size-3.5" aria-hidden />
            Email unverified
          </span>
        )}
        {user.platformRole === 'superAdmin' && <Badge value="fork" label="platform admin" />}
      </div>
    </div>
  )
}

function DetailsForm({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient()
  const [first, setFirst] = useState(user.name.first)
  const [last, setLast] = useState(user.name.last)
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [locale, setLocale] = useState<Locale>(user.preferredLocale)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      const result = await updateMe({
        name: { first: first.trim(), last: last.trim() },
        preferredLocale: locale,
        jobTitle: orNull(jobTitle),
        phone: orNull(phone),
      })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['auth', 'me'], updated)
      setSaved(true)
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    save.mutate()
  }

  return (
    <SectionCard
      icon={UserRound}
      title="Your details"
      hint="How you appear to teammates across the app"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="grid gap-4 tablet:grid-cols-2">
          <div>
            <label htmlFor="profile-first" className="mb-1.5 block text-sm font-medium text-steel-700">
              First name
            </label>
            <input
              id="profile-first"
              type="text"
              required
              maxLength={60}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="profile-last" className="mb-1.5 block text-sm font-medium text-steel-700">
              Last name
            </label>
            <input
              id="profile-last"
              type="text"
              required
              maxLength={60}
              value={last}
              onChange={(e) => setLast(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="profile-title" className="mb-1.5 block text-sm font-medium text-steel-700">
              Job title <span className="font-normal text-salt-500">(optional)</span>
            </label>
            <input
              id="profile-title"
              type="text"
              maxLength={80}
              placeholder="e.g. Sous Chef"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="profile-phone" className="mb-1.5 block text-sm font-medium text-steel-700">
              Phone <span className="font-normal text-salt-500">(optional)</span>
            </label>
            <input
              id="profile-phone"
              type="tel"
              maxLength={40}
              placeholder="e.g. (555) 010-0193"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-steel-700">Preferred language</span>
          <Segmented
            ariaLabel="Preferred language"
            value={locale}
            onChange={setLocale}
            options={[
              { id: 'en', label: 'English' },
              { id: 'es', label: 'Español' },
            ]}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-steel-700">Email</span>
          <input type="email" value={user.email} disabled className={`${inputClass} opacity-60`} />
          <p className="mt-1.5 text-xs text-salt-500">
            Your email is your sign-in and can't be changed here.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <SavedTick show={saved && !save.isPending} />
        </div>
      </form>
    </SectionCard>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const change = useMutation({
    mutationFn: async () => {
      const result = await changePassword({ currentPassword: current, newPassword: next })
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () => {
      setSaved(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    if (next.length < 12) {
      setError('New password must be at least 12 characters')
      return
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match')
      return
    }
    change.mutate()
  }

  return (
    <SectionCard icon={KeyRound} title="Password" hint="At least 12 characters — length beats complexity">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="grid gap-4 tablet:grid-cols-3">
          <div>
            <label htmlFor="pw-current" className="mb-1.5 block text-sm font-medium text-steel-700">
              Current password
            </label>
            <input
              id="pw-current"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="pw-next" className="mb-1.5 block text-sm font-medium text-steel-700">
              New password
            </label>
            <input
              id="pw-next"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="pw-confirm" className="mb-1.5 block text-sm font-medium text-steel-700">
              Confirm new password
            </label>
            <input
              id="pw-confirm"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={change.isPending} className={primaryButtonClass}>
            {change.isPending ? 'Updating…' : 'Update password'}
          </button>
          <SavedTick show={saved && !change.isPending} />
        </div>
      </form>
    </SectionCard>
  )
}

function membershipLabel(m: MembershipSummary): string {
  if (m.location) return `${m.org.name} › ${m.property?.name} › ${m.location.name}`
  if (m.property) return `${m.org.name} › ${m.property.name}`
  return `${m.org.name} · entire organization`
}

function AccessList() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'memberships'],
    queryFn: async () => {
      const result = await getMyMemberships()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  return (
    <SectionCard
      icon={Building2}
      title="Your access"
      hint="Where you can work, and your role in each scope"
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : (
        <ul className="divide-y divide-salt-200">
          {(data ?? []).map((m) => (
            <li key={m._id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-sm text-steel-800">{membershipLabel(m)}</span>
              <span className="inline-flex items-center rounded-full bg-steel-50 px-2.5 py-1 text-2xs font-semibold tracking-wide text-steel-700 uppercase ring-1 ring-steel-200 ring-inset">
                {m.role}
              </span>
            </li>
          ))}
          {data?.length === 0 && (
            <li className="py-3 text-sm text-salt-600">
              You aren't a member of any organization yet.
            </li>
          )}
        </ul>
      )}
    </SectionCard>
  )
}

function Profile() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const result = await getMe()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) return <ErrorNote>{error.message}</ErrorNote>

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  /**
   * The page, as data — same shell as organization settings. Ids are URL
   * hashes, so `/profile#password` is a link worth keeping stable.
   */
  const sections: SettingsSection[] = [
    {
      id: 'details',
      label: 'Your details',
      icon: UserRound,
      render: () => <DetailsForm key={data._id} user={data} />,
    },
    {
      id: 'password',
      label: 'Password',
      icon: KeyRound,
      render: () => <PasswordForm />,
    },
    {
      id: 'access',
      label: 'Your access',
      icon: Building2,
      render: () => <AccessList />,
    },
  ]

  return (
    <SettingsShell
      ariaLabel="Profile settings"
      sections={sections}
      aside={<IdentityCard user={data} />}
    />
  )
}

export function ProfileSettings() {
  return (
    <QueryProvider>
      <Profile />
    </QueryProvider>
  )
}
