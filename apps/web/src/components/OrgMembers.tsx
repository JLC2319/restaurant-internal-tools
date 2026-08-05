import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OrgMemberRow, TenantRole, TenantTree } from '@rit/shared'
import { roleAtLeast, tenantRoleValues } from '@rit/shared'
import { ChevronLeft, ChevronRight, UserPlus, Users, X } from 'lucide-react'
import { getMe } from '../api/auth'
import {
  getTenantTree,
  inviteMember,
  listMembers,
  revokeMembership,
  tenancyScopeKey,
  updateMembership,
} from '../api/tenancy'
import { useActiveRole } from './useActiveRole'
import { QueryProvider } from './QueryProvider'
import {
  Badge,
  ErrorNote,
  SectionCard,
  Skeleton,
  TableShell,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
  tdClass,
  thClass,
} from './ui'

function membersKey(page: number) {
  return ['org', 'members', ...tenancyScopeKey(), page]
}

/** "Entire org", "Flagship" or "Flagship › Downtown" from the row's scope ids. */
function scopeLabel(row: OrgMemberRow, tree: TenantTree | undefined): string {
  if (!row.propertyId) return 'Entire org'
  const property = tree?.properties.find((p) => p._id === row.propertyId)
  if (!row.locationId) return property?.name ?? 'One property'
  const location = property?.locations.find((l) => l._id === row.locationId)
  return `${property?.name ?? '…'} › ${location?.name ?? '…'}`
}

function InviteForm({ myRole, onClose }: { myRole: TenantRole; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TenantRole>('staff')
  const [error, setError] = useState<string | null>(null)

  // The server refuses granting above the caller's own role; don't offer it.
  const grantable = tenantRoleValues.filter((r) => roleAtLeast(myRole, r))

  const invite = useMutation({
    mutationFn: async () => {
      const result = await inviteMember({ email: email.trim().toLowerCase(), role })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org', 'members'] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    invite.mutate()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="animate-fade-up space-y-4 rounded-xl bg-salt-50 p-4 ring-1 ring-salt-200 ring-inset"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-steel-900">Add a member</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 cursor-pointer items-center justify-center rounded-full text-salt-500 transition-colors hover:bg-salt-200 hover:text-steel-800"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-4 tablet:grid-cols-3">
        <div className="tablet:col-span-2">
          <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium text-steel-700">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="mb-1.5 block text-sm font-medium text-steel-700">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as TenantRole)}
            className={inputClass}
          >
            {grantable.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-salt-500">
        They join in your current scope. They need an existing account — invite emails aren't sent
        yet.
      </p>

      <button type="submit" disabled={invite.isPending} className={primaryButtonClass}>
        <UserPlus className="size-4" aria-hidden />
        {invite.isPending ? 'Adding…' : 'Add member'}
      </button>
    </form>
  )
}

function MemberRow({
  row,
  tree,
  myRole,
  myUserId,
  canManage,
}: {
  row: OrgMemberRow
  tree: TenantTree | undefined
  myRole: TenantRole
  myUserId: string | null
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const isSelf = row.user != null && row.user._id === myUserId
  // Editable: an active row of someone else, at or below my own role.
  const editable = canManage && !isSelf && row.status === 'active' && roleAtLeast(myRole, row.role)
  const grantable = tenantRoleValues.filter((r) => roleAtLeast(myRole, r))

  const setRole = useMutation({
    mutationFn: async (role: TenantRole) => {
      const result = await updateMembership(row._id, { role })
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', 'members'] }),
    onError: (err: Error) => setError(err.message),
  })

  const revoke = useMutation({
    mutationFn: async () => {
      const result = await revokeMembership(row._id)
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', 'members'] }),
    onError: (err: Error) => setError(err.message),
  })

  return (
    <tr className="transition-colors hover:bg-salt-50">
      <td className={tdClass}>
        <span className="font-medium text-steel-900">
          {row.user ? `${row.user.name.first} ${row.user.name.last}` : 'Deleted account'}
          {isSelf && <span className="ml-1.5 text-xs font-normal text-salt-500">(you)</span>}
        </span>
        {row.user?.jobTitle && <p className="text-xs text-salt-500">{row.user.jobTitle}</p>}
        {error && <p className="mt-1 text-xs text-chili-600">{error}</p>}
      </td>
      <td className={`${tdClass} text-salt-600`}>{row.user?.email ?? '—'}</td>
      <td className={tdClass}>
        {editable ? (
          <select
            aria-label={`Role for ${row.user?.email ?? 'member'}`}
            value={row.role}
            disabled={setRole.isPending}
            onChange={(e) => {
              setError(null)
              setRole.mutate(e.target.value as TenantRole)
            }}
            className="min-h-touch cursor-pointer rounded-lg bg-white px-2.5 py-1.5 text-sm font-medium text-steel-800 shadow-xs ring-1 ring-salt-300 transition-all duration-150 hover:ring-salt-400 focus:ring-2 focus:ring-ember-400 focus:outline-none"
          >
            {grantable.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <span className="inline-flex items-center rounded-full bg-steel-50 px-2.5 py-1 text-2xs font-semibold tracking-wide text-steel-700 uppercase ring-1 ring-steel-200 ring-inset">
            {row.role}
          </span>
        )}
      </td>
      <td className={`${tdClass} text-salt-600`}>{scopeLabel(row, tree)}</td>
      <td className={tdClass}>
        <Badge value={row.status} />
      </td>
      <td className={`${tdClass} text-right`}>
        {editable && (
          <button
            type="button"
            disabled={revoke.isPending}
            onClick={() => {
              const who = row.user ? `${row.user.name.first} ${row.user.name.last}` : 'this member'
              if (window.confirm(`Remove ${who} from this scope? They lose access immediately.`)) {
                setError(null)
                revoke.mutate()
              }
            }}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm font-medium text-chili-600 transition-colors hover:bg-chili-50 disabled:opacity-60"
          >
            {revoke.isPending ? 'Removing…' : 'Remove'}
          </button>
        )}
      </td>
    </tr>
  )
}

function Members() {
  const { role, isLoading: roleLoading } = useActiveRole()
  const [page, setPage] = useState(1)
  const [showInvite, setShowInvite] = useState(false)

  const canView = role != null && roleAtLeast(role, 'manager')
  const canManage = role != null && roleAtLeast(role, 'admin')

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const result = await getMe()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: canView,
  })

  const tree = useQuery({
    queryKey: ['tenancy', 'tree', ...tenancyScopeKey()],
    queryFn: async () => {
      const result = await getTenantTree()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: canView,
  })

  const { data, error, isLoading } = useQuery({
    queryKey: membersKey(page),
    queryFn: async () => {
      const result = await listMembers(page)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: canView,
  })

  // Below manager the server refuses the roster, so the whole card stays off
  // their screen rather than rendering an error they can't act on.
  if (roleLoading || !canView) return null

  return (
    <SectionCard
      icon={Users}
      title="Members"
      hint="Who has access in your current scope"
      actions={
        canManage ? (
          <button type="button" onClick={() => setShowInvite((v) => !v)} className={subtleButtonClass}>
            <UserPlus className="size-4" aria-hidden />
            Add member
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {showInvite && canManage && role && (
          <InviteForm myRole={role} onClose={() => setShowInvite(false)} />
        )}

        {error && <ErrorNote>{error.message}</ErrorNote>}
        {isLoading && <Skeleton className="h-40 w-full" />}

        {data && (
          <TableShell>
            <thead>
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Email</th>
                <th className={thClass}>Role</th>
                <th className={thClass}>Scope</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-salt-200">
              {data.items.map((row) => (
                <MemberRow
                  key={row._id}
                  row={row}
                  tree={tree.data}
                  myRole={role}
                  myUserId={me.data?._id ?? null}
                  canManage={canManage}
                />
              ))}
            </tbody>
          </TableShell>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className={subtleButtonClass}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Previous
            </button>
            <span className="text-sm text-salt-600">
              Page {data.page} of {data.totalPages}
            </span>
            <button
              type="button"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className={subtleButtonClass}
            >
              Next
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

export function OrgMembers() {
  return (
    <QueryProvider>
      <Members />
    </QueryProvider>
  )
}
