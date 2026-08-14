import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformUpdateOrganizationInput } from '@rit/shared';
import { getOrganizationDetail, updateOrganization } from '../api/platform';
import { QueryProvider } from './QueryProvider';
import {
  Badge,
  ErrorNote,
  TableShell,
  inputClass,
  subtleButtonClass,
  tdClass,
  thClass,
} from './ui';

function Detail({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');

  const { data, error, isLoading } = useQuery({
    queryKey: ['platform', 'org', orgId],
    queryFn: async () => {
      const result = await getOrganizationDetail(orgId);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  const update = useMutation({
    mutationFn: async (input: PlatformUpdateOrganizationInput) => {
      const result = await updateOrganization(orgId, input);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setActionError(null);
      setRenaming(false);
      queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  if (isLoading) return <p className="text-sm text-salt-500">Loading…</p>;
  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (!data) return null;

  const { org, properties, locations, members } = data;
  const propertyName = new Map(properties.map((p) => [p._id, p.name]));
  const suspended = org.status === 'suspended';

  function handleRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate({ name: newName });
  }

  return (
    <div className="space-y-8">
      <div>
        <a
          href="/organizations"
          className="text-sm font-medium text-ember-600 hover:text-ember-700"
        >
          ← All organizations
        </a>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          {renaming ? (
            <form onSubmit={handleRename} className="flex flex-1 items-center gap-2">
              <input
                aria-label="Organization name"
                required
                minLength={2}
                maxLength={120}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={`${inputClass} max-w-md`}
              />
              <button type="submit" disabled={update.isPending} className={subtleButtonClass}>
                Save
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className={subtleButtonClass}
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-steel-900">{org.name}</h1>
              <Badge value={org.status} />
              <button
                type="button"
                onClick={() => {
                  setNewName(org.name);
                  setRenaming(true);
                }}
                className={subtleButtonClass}
              >
                Rename
              </button>
            </>
          )}

          <button
            type="button"
            disabled={update.isPending}
            onClick={() => {
              const next = suspended ? 'active' : 'suspended';
              if (window.confirm(`Set “${org.name}” to ${next}?`)) {
                update.mutate({ status: next });
              }
            }}
            className={`${subtleButtonClass} ml-auto`}
          >
            {suspended ? 'Reactivate' : 'Suspend'}
          </button>
        </div>

        <p className="mt-1 text-sm text-salt-600">
          <span className="font-mono text-xs">{org.slug}</span> · locales {org.locales.join(', ')} ·
          created {new Date(org.createdAt).toLocaleDateString()} · {org.counts.properties}{' '}
          properties · {org.counts.locations} locations · {org.counts.members} members
        </p>

        {actionError && (
          <div className="mt-3">
            <ErrorNote>{actionError}</ErrorNote>
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-steel-900">Members</h2>
        <TableShell>
          <thead className="bg-salt-100">
            <tr>
              <th className={thClass}>Name</th>
              <th className={thClass}>Email</th>
              <th className={thClass}>Role</th>
              <th className={thClass}>Scope</th>
              <th className={thClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-salt-200">
            {members.map((m) => (
              <tr key={m.membershipId}>
                <td className={tdClass}>
                  {m.user.name.first} {m.user.name.last}
                </td>
                <td className={`${tdClass} text-salt-600`}>{m.user.email}</td>
                <td className={tdClass}>{m.role}</td>
                <td className={tdClass}>
                  {m.tier === 'org'
                    ? 'Whole org'
                    : (propertyName.get(m.propertyId ?? '') ?? m.tier)}
                </td>
                <td className={tdClass}>
                  <Badge value={m.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-steel-900">Properties</h2>
        {properties.length === 0 ? (
          <p className="text-sm text-salt-500">None yet.</p>
        ) : (
          <TableShell>
            <thead className="bg-salt-100">
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Slug</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-salt-200">
              {properties.map((p) => (
                <tr key={p._id}>
                  <td className={tdClass}>{p.name}</td>
                  <td className={`${tdClass} font-mono text-xs text-salt-600`}>{p.slug}</td>
                  <td className={tdClass}>
                    <Badge value={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-steel-900">Locations</h2>
        {locations.length === 0 ? (
          <p className="text-sm text-salt-500">None yet.</p>
        ) : (
          <TableShell>
            <thead className="bg-salt-100">
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Property</th>
                <th className={thClass}>Timezone</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-salt-200">
              {locations.map((l) => (
                <tr key={l._id}>
                  <td className={tdClass}>{l.name}</td>
                  <td className={`${tdClass} text-salt-600`}>
                    {propertyName.get(l.propertyId) ?? '—'}
                  </td>
                  <td className={`${tdClass} font-mono text-xs text-salt-600`}>{l.timezone}</td>
                  <td className={tdClass}>
                    <Badge value={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </section>
    </div>
  );
}

export function OrgDetail({ orgId }: { orgId: string }) {
  return (
    <QueryProvider>
      <Detail orgId={orgId} />
    </QueryProvider>
  );
}
