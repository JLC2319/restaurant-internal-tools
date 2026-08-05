import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createOrganization, listOrganizations } from '../api/platform'
import { QueryProvider } from './QueryProvider'
import { Badge, ErrorNote, TableShell, inputClass, primaryButtonClass, subtleButtonClass, tdClass, thClass } from './ui'

function NewOrgForm() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const result = await createOrganization({ name, ownerEmail, locales: ['en', 'es'] })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ['platform'] })
      window.location.href = `/organizations/${org._id}`
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    create.mutate()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-salt-300 bg-white p-4 shadow-sm"
    >
      <h2 className="font-semibold text-steel-900">New organization</h2>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 tablet:grid-cols-2">
        <div>
          <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-steel-700">
            Name
          </label>
          <input
            id="org-name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="owner-email" className="mb-1 block text-sm font-medium text-steel-700">
            Owner email
          </label>
          <input
            id="owner-email"
            type="email"
            required
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-salt-600">
            Must be an existing account — it becomes the org's owner.
          </p>
        </div>
      </div>

      <button type="submit" disabled={create.isPending} className={primaryButtonClass}>
        {create.isPending ? 'Creating…' : 'Create organization'}
      </button>
    </form>
  )
}

function Table() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)

  const { data, error, isLoading } = useQuery({
    queryKey: ['platform', 'orgs', { q, page }],
    queryFn: async () => {
      const result = await listOrganizations({ q, page })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) return <ErrorNote>{error.message}</ErrorNote>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQ(search)
          }}
          className="flex max-w-md flex-1 gap-2"
        >
          <input
            type="search"
            aria-label="Search organizations"
            placeholder="Search by name or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
          <button type="submit" className={subtleButtonClass}>
            Search
          </button>
        </form>

        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={`${primaryButtonClass} ml-auto`}
        >
          {showForm ? 'Close' : 'New organization'}
        </button>
      </div>

      {showForm && <NewOrgForm />}

      <TableShell>
        <thead className="bg-salt-100">
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Slug</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Properties</th>
            <th className={thClass}>Locations</th>
            <th className={thClass}>Members</th>
            <th className={thClass}>Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-salt-200">
          {isLoading && (
            <tr>
              <td colSpan={7} className={`${tdClass} text-salt-500`}>
                Loading…
              </td>
            </tr>
          )}
          {data?.items.length === 0 && (
            <tr>
              <td colSpan={7} className={`${tdClass} text-salt-500`}>
                No organizations{q ? ` matching “${q}”` : ' yet'}.
              </td>
            </tr>
          )}
          {data?.items.map((org) => (
            <tr key={org._id} className="hover:bg-salt-50">
              <td className={tdClass}>
                <a
                  href={`/organizations/${org._id}`}
                  className="font-medium text-ember-600 hover:text-ember-700"
                >
                  {org.name}
                </a>
              </td>
              <td className={`${tdClass} font-mono text-xs text-salt-600`}>{org.slug}</td>
              <td className={tdClass}>
                <Badge value={org.status} />
              </td>
              <td className={`${tdClass} tabular-nums`}>{org.counts.properties}</td>
              <td className={`${tdClass} tabular-nums`}>{org.counts.locations}</td>
              <td className={`${tdClass} tabular-nums`}>{org.counts.members}</td>
              <td className={`${tdClass} text-salt-600`}>
                {new Date(org.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {data && data.totalPages > 1 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className={subtleButtonClass}
          >
            Previous
          </button>
          <span className="text-sm text-salt-600">
            Page {data.page} of {data.totalPages} · {data.total} total
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className={subtleButtonClass}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

export function OrgsTable() {
  return (
    <QueryProvider>
      <Table />
    </QueryProvider>
  )
}
