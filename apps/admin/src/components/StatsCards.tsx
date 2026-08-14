import { useQuery } from '@tanstack/react-query';
import { getStats } from '../api/platform';
import { QueryProvider } from './QueryProvider';
import { ErrorNote } from './ui';

const TILES = [
  { key: 'organizations', label: 'Organizations' },
  { key: 'properties', label: 'Properties' },
  { key: 'locations', label: 'Locations' },
  { key: 'users', label: 'Users' },
  { key: 'activeMemberships', label: 'Active memberships' },
] as const;

function Tiles() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['platform', 'stats'],
    queryFn: async () => {
      const result = await getStats();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  if (error) return <ErrorNote>{error.message}</ErrorNote>;

  return (
    <ul className="grid grid-cols-2 gap-4 tablet:grid-cols-3 desktop:grid-cols-5">
      {TILES.map(({ key, label }) => (
        <li key={key} className="rounded-lg border border-salt-300 bg-white p-4 shadow-sm">
          <p className="text-sm text-salt-600">{label}</p>
          <p className="mt-1 text-3xl font-semibold text-steel-900">
            {isLoading || !data ? '—' : data[key].toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function StatsCards() {
  return (
    <QueryProvider>
      <Tiles />
    </QueryProvider>
  );
}
