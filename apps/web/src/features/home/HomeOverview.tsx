import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { roleAtLeast } from '@rit/shared';
import {
  ArrowRight,
  BookOpen,
  Building2,
  GraduationCap,
  Sparkles,
  Tablet,
  UserRound,
} from 'lucide-react';
import { getMe } from '@/features/auth/api';
import { listRecipes, recipesScopeKey } from '@/features/recipes/api';
import { listTrainings, trainingsScopeKey } from '@/features/training/api';
import { siteTagline } from '@/assets/site-content/site-info';
import { QueryProvider } from '@/lib/QueryProvider';
import { useActiveRole } from '@/features/auth/useActiveRole';
import {
  Skeleton,
  cardClass,
  cardHoverClass,
  primaryButtonClass,
  subtleButtonClass,
} from '@/components/ui';

/** Icon-tile tints per surface. Chili stays reserved for allergens/danger. */
const tints = {
  ember: 'bg-linear-to-br from-ember-400 to-ember-600 text-white shadow-md shadow-ember-600/25',
  basil: 'bg-linear-to-br from-basil-400 to-basil-600 text-white shadow-md shadow-basil-600/25',
  steel: 'bg-linear-to-br from-steel-500 to-steel-700 text-white shadow-md shadow-steel-700/25',
} as const;

interface Surface {
  title: string;
  href: string;
  icon: LucideIcon;
  tint: keyof typeof tints;
  blurb: string;
  /** Which live count this card carries, if any. */
  stat?: 'recipes' | 'trainings';
  statLabel?: string;
}

const surfaces: Surface[] = [
  {
    title: 'Recipe book',
    href: '/recipes',
    icon: BookOpen,
    tint: 'ember',
    blurb: 'Structured recipes with versions, forks, allergen sign-off and EN→ES review.',
    stat: 'recipes',
    statLabel: 'active recipes',
  },
  {
    title: 'Draft with AI',
    href: '/recipes/draft',
    icon: Sparkles,
    tint: 'ember',
    blurb:
      'Photograph recipe cards or binder pages; review structured drafts before anything is saved.',
  },
  {
    title: 'Training',
    href: '/training',
    icon: GraduationCap,
    tint: 'basil',
    blurb:
      'Modules built from text, photos and video, published when ready, with completions tracked.',
    stat: 'trainings',
    statLabel: 'published modules',
  },
  {
    title: 'Reader',
    href: '/reader',
    icon: Tablet,
    tint: 'steel',
    blurb: 'iPad-first surface for the line. Live recipes and published training only.',
  },
  {
    title: 'Organization',
    href: '/organization',
    icon: Building2,
    tint: 'steel',
    blurb: 'Properties, locations, members and roles across the group.',
  },
  {
    title: 'Your profile',
    href: '/profile',
    icon: UserRound,
    tint: 'steel',
    blurb: 'Name, contact details, preferred language and password.',
  },
];

function Stat({
  value,
  label,
  isLoading,
}: {
  value: number | undefined;
  label: string;
  isLoading: boolean;
}) {
  if (!isLoading && value === undefined) return null;
  return (
    <p className="mt-4 flex items-baseline gap-1.5">
      {isLoading ? (
        <Skeleton className="h-7 w-10" />
      ) : (
        <span className="font-mono text-2xl font-semibold text-steel-900">{value}</span>
      )}
      <span className="text-xs text-salt-600">{label}</span>
    </p>
  );
}

function Overview() {
  const { role } = useActiveRole();

  // Computed after mount so the prerendered HTML never bakes in a build-time
  // clock; until then the copy falls back to the time-free greeting.
  const [daypart, setDaypart] = useState<string | null>(null);
  useEffect(() => {
    const hour = new Date().getHours();
    setDaypart(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const result = await getMe();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  const recipeCount = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'home-count'],
    queryFn: async () => {
      const result = await listRecipes({ limit: 1, status: 'active' });
      if (result.error) throw new Error(result.error.message);
      return result.data.total;
    },
  });

  const trainingCount = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'home-count'],
    queryFn: async () => {
      const result = await listTrainings({ limit: 1, status: 'published' });
      if (result.error) throw new Error(result.error.message);
      return result.data.total;
    },
  });

  const counts = {
    recipes: recipeCount,
    trainings: trainingCount,
  };

  const firstName = me.data?.name.first;
  const canDraft = role !== null && roleAtLeast(role, 'chef');

  return (
    <>
      <header className="flex flex-col gap-6 tablet:flex-row tablet:items-end tablet:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-widest text-ember-600 uppercase">Home</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-steel-900 tablet:text-4xl">
            {daypart ?? 'Welcome back'}
            {firstName ? (
              <>
                ,{' '}
                <span className="bg-linear-to-r from-ember-500 to-ember-700 bg-clip-text text-transparent">
                  {firstName}
                </span>
              </>
            ) : null}
            .
          </h1>
          <p className="mt-3 text-md text-salt-600">{siteTagline}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canDraft && (
            <a href="/recipes/draft" className={primaryButtonClass}>
              <Sparkles className="size-4" aria-hidden />
              Draft with AI
            </a>
          )}
          <a href="/reader" className={canDraft ? subtleButtonClass : primaryButtonClass}>
            <Tablet className="size-4" aria-hidden />
            Open the reader
          </a>
        </div>
      </header>

      <ul className="mt-8 grid gap-4 tablet:mt-10 tablet:grid-cols-2 desktop:grid-cols-3">
        {surfaces.map(({ title, href, icon: Icon, tint, blurb, stat, statLabel }, index) => {
          const count = stat ? counts[stat] : null;
          return (
            <li
              key={href}
              className={`animate-fade-up ${index % 3 === 1 ? 'fade-delay-1' : index % 3 === 2 ? 'fade-delay-2' : ''}`}
            >
              <a
                href={href}
                className={`group flex h-full flex-col p-5 ${cardClass} ${cardHoverClass}`}
              >
                <span
                  className={`flex size-11 items-center justify-center rounded-xl ${tints[tint]}`}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <h2 className="mt-4 font-semibold text-steel-900">{title}</h2>
                <p className="mt-1.5 flex-1 text-sm text-salt-600">{blurb}</p>
                {count && !count.isError && (
                  <Stat value={count.data} label={statLabel ?? ''} isLoading={count.isLoading} />
                )}
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ember-600 transition-colors group-hover:text-ember-700">
                  Open
                  <ArrowRight
                    className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function HomeOverview() {
  return (
    <QueryProvider>
      <Overview />
    </QueryProvider>
  );
}
