import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformUpdateUserInput, PlatformUserRow } from '@rit/shared';
import { getMe } from '../api/auth';
import { listUsers, updateUser } from '../api/platform';
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

function Actions({
  user,
  isSelf,
  onError,
}: {
  user: PlatformUserRow;
  isSelf: boolean;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: async (input: PlatformUpdateUserInput) => {
      const result = await updateUser(user._id, input);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      onError(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'users'] });
    },
    onError: (err: Error) => onError(err.message),
  });

  function confirmAnd(message: string, input: PlatformUpdateUserInput) {
    if (window.confirm(message)) update.mutate(input);
  }

  const suspended = user.status === 'suspended';
  const isStaff = user.platformRole === 'superAdmin';
  const who = `${user.name.first} ${user.name.last} <${user.email}>`;

  // The API refuses self-suspension and self-demotion anyway; hiding the
  // buttons just keeps the console from offering a dead end.
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {!user.emailVerified && (
        <button
          type="button"
          disabled={update.isPending}
          onClick={() => update.mutate({ emailVerified: true })}
          className={subtleButtonClass}
        >
          Mark verified
        </button>
      )}
      {!isSelf && (
        <>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() =>
              confirmAnd(
                suspended
                  ? `Reactivate ${who}?`
                  : `Suspend ${who}? They are signed out everywhere.`,
                { status: suspended ? 'active' : 'suspended' },
              )
            }
            className={subtleButtonClass}
          >
            {suspended ? 'Reactivate' : 'Suspend'}
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() =>
              confirmAnd(
                isStaff
                  ? `Remove superAdmin from ${who}?`
                  : `Grant superAdmin to ${who}? They will see every tenant.`,
                { platformRole: isStaff ? 'user' : 'superAdmin' },
              )
            }
            className={subtleButtonClass}
          >
            {isStaff ? 'Remove superAdmin' : 'Make superAdmin'}
          </button>
        </>
      )}
    </div>
  );
}

function Table() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const result = await getMe();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  const { data, error, isLoading } = useQuery({
    queryKey: ['platform', 'users', { q, page }],
    queryFn: async () => {
      const result = await listUsers({ q, page });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  if (error) return <ErrorNote>{error.message}</ErrorNote>;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(search);
        }}
        className="flex max-w-md gap-2"
      >
        <input
          type="search"
          aria-label="Search users"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
        />
        <button type="submit" className={subtleButtonClass}>
          Search
        </button>
      </form>

      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      <TableShell>
        <thead className="bg-salt-100">
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Email</th>
            <th className={thClass}>Verified</th>
            <th className={thClass}>Platform role</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Orgs</th>
            <th className={thClass}>Last login</th>
            <th className={`${thClass} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-salt-200">
          {isLoading && (
            <tr>
              <td colSpan={8} className={`${tdClass} text-salt-500`}>
                Loading…
              </td>
            </tr>
          )}
          {data?.items.length === 0 && (
            <tr>
              <td colSpan={8} className={`${tdClass} text-salt-500`}>
                No users{q ? ` matching “${q}”` : ''}.
              </td>
            </tr>
          )}
          {data?.items.map((user) => (
            <tr key={user._id} className="hover:bg-salt-50">
              <td className={tdClass}>
                {user.name.first} {user.name.last}
                {me.data?._id === user._id && (
                  <span className="ml-1 text-xs text-salt-500">(you)</span>
                )}
              </td>
              <td className={`${tdClass} text-salt-600`}>{user.email}</td>
              <td className={tdClass}>{user.emailVerified ? 'Yes' : 'No'}</td>
              <td className={tdClass}>
                {user.platformRole === 'superAdmin' ? <Badge value="superAdmin" /> : 'user'}
              </td>
              <td className={tdClass}>
                <Badge value={user.status} />
              </td>
              <td className={`${tdClass} tabular-nums`}>{user.membershipCount}</td>
              <td className={`${tdClass} text-salt-600`}>
                {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
              </td>
              <td className={tdClass}>
                <Actions user={user} isSelf={me.data?._id === user._id} onError={setActionError} />
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
  );
}

export function UsersTable() {
  return (
    <QueryProvider>
      <Table />
    </QueryProvider>
  );
}
