import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RecipeSummary, TrainingSummary } from '@rit/shared'
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Layers,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { listRecipes, recipesScopeKey } from '../api/recipes'
import { listTrainings, trainingsScopeKey } from '../api/trainings'
import { QueryProvider } from './QueryProvider'
import {
  EmptyState,
  ErrorNote,
  Segmented,
  Skeleton,
  cardClass,
  cardHoverClass,
  inputClass,
  subtleButtonClass,
} from './ui'

/**
 * The reader's shelf: everything the line may cook from or study, and nothing
 * else. Recipes are fetched with `live: true`, so lineages without a live
 * version never even arrive — chefs browsing the reader see exactly what
 * their staff see. Training is published only.
 *
 * iPad-first grid tool: a dense wall of photo tiles, whole tiles as touch
 * targets, every control clearing `min-h-touch` for gloved hands.
 */

type Shelf = 'recipes' | 'training'

const PAGE_SIZE = 24

const gridClass =
  'grid grid-cols-2 gap-3 tablet:grid-cols-3 tablet:gap-4 laptop:grid-cols-4 wide:grid-cols-5'

const tileDelay = (index: number) => ['', 'fade-delay-1', 'fade-delay-2', 'fade-delay-3'][index % 4]

/**
 * The verification state is the first thing a cook needs from a tile: an
 * unverified recipe must read as "do not answer allergen questions from this"
 * before anyone opens it.
 */
function VerifiedChip({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-basil-50 px-2 py-0.5 text-2xs font-semibold tracking-wide text-basil-700 uppercase ring-1 ring-basil-200 ring-inset">
      <ShieldCheck className="size-3.5" aria-hidden />
      Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-citron-50 px-2 py-0.5 text-2xs font-semibold tracking-wide text-citron-700 uppercase ring-1 ring-citron-200 ring-inset">
      <ShieldAlert className="size-3.5" aria-hidden />
      Unverified
    </span>
  )
}

function RecipeTile({ recipe, index }: { recipe: RecipeSummary; index: number }) {
  return (
    <li className={`animate-fade-up ${tileDelay(index)}`}>
      <a
        href={`/reader/recipes/${recipe._id}`}
        className={`group flex h-full flex-col overflow-hidden ${cardClass} ${cardHoverClass}`}
      >
        <div className="relative aspect-4/3 w-full overflow-hidden bg-salt-100">
          {recipe.heroPhoto ? (
            <img
              src={recipe.heroPhoto.url}
              alt=""
              width={recipe.heroPhoto.width ?? undefined}
              height={recipe.heroPhoto.height ?? undefined}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-linear-to-br from-steel-50 via-salt-100 to-ember-50">
              <BookOpen
                className="size-9 text-salt-400 transition-transform duration-300 group-hover:scale-110"
                aria-hidden
              />
            </div>
          )}
          <span className="absolute bottom-2 left-2 inline-flex items-center rounded-full bg-steel-900/80 px-2 py-0.5 font-mono text-2xs font-semibold text-white backdrop-blur-sm">
            v{recipe.activeVersion}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <h2 className="line-clamp-2 text-sm font-semibold text-steel-900 transition-colors group-hover:text-ember-700 tablet:text-base">
            {recipe.name}
          </h2>
          <div className="mt-auto">
            <VerifiedChip verified={recipe.allergensVerified} />
          </div>
        </div>
      </a>
    </li>
  )
}

function TrainingTile({ training, index }: { training: TrainingSummary; index: number }) {
  const done = training.myCompletion != null

  return (
    <li className={`animate-fade-up ${tileDelay(index)}`}>
      <a
        href={`/reader/training/${training._id}`}
        className={`group flex h-full flex-col overflow-hidden ${cardClass} ${cardHoverClass}`}
      >
        <div className="relative aspect-4/3 w-full overflow-hidden bg-salt-100">
          {training.heroImage ? (
            <img
              src={training.heroImage.url}
              alt=""
              width={training.heroImage.width ?? undefined}
              height={training.heroImage.height ?? undefined}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-linear-to-br from-steel-50 via-salt-100 to-basil-50">
              <GraduationCap
                className="size-9 text-salt-400 transition-transform duration-300 group-hover:scale-110"
                aria-hidden
              />
            </div>
          )}
          {done && (
            <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-basil-500/95 px-2 py-0.5 text-2xs font-semibold tracking-wide text-white uppercase shadow-sm backdrop-blur-sm">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Done
            </span>
          )}
          {training.videoCount > 0 && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-steel-900/80 px-2 py-0.5 text-2xs font-semibold tracking-wide text-white uppercase backdrop-blur-sm">
              <Play className="size-3 fill-current" aria-hidden />
              {training.videoCount === 1 ? 'Video' : training.videoCount}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <h2 className="line-clamp-2 text-sm font-semibold text-steel-900 transition-colors group-hover:text-ember-700 tablet:text-base">
            {training.title}
          </h2>
          <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-salt-500">
            <Layers className="size-3.5" aria-hidden />
            {training.blockCount} {training.blockCount === 1 ? 'section' : 'sections'}
          </span>
        </div>
      </a>
    </li>
  )
}

function SkeletonGrid() {
  return (
    <ul className={gridClass}>
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className={`${cardClass} overflow-hidden`}>
          <Skeleton className="aspect-4/3 w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (next: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={subtleButtonClass}
      >
        <ChevronLeft className="size-4" aria-hidden />
        Previous
      </button>
      <span className="text-sm text-salt-600">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className={subtleButtonClass}
      >
        Next
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  )
}

function Browser() {
  const [shelf, setShelf] = useState<Shelf>('recipes')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const recipes = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'reader', { q, page }],
    queryFn: async () => {
      const result = await listRecipes({ q, page, limit: PAGE_SIZE, status: 'active', live: true })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: shelf === 'recipes',
  })

  const trainings = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'reader', { q, page }],
    queryFn: async () => {
      const result = await listTrainings({ q, page, limit: PAGE_SIZE, status: 'published' })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: shelf === 'training',
  })

  const active = shelf === 'recipes' ? recipes : trainings
  if (active.error) return <ErrorNote>{active.error.message}</ErrorNote>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="What to read"
          value={shelf}
          onChange={(next) => {
            setShelf(next)
            setPage(1)
          }}
          options={[
            {
              id: 'recipes',
              label: (
                <>
                  <BookOpen className="size-3.5" aria-hidden /> Recipes
                </>
              ),
            },
            {
              id: 'training',
              label: (
                <>
                  <GraduationCap className="size-3.5" aria-hidden /> Training
                </>
              ),
            },
          ]}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQ(search)
          }}
          className="relative max-w-md min-w-56 flex-1"
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-salt-500"
            aria-hidden
          />
          <input
            type="search"
            aria-label={shelf === 'recipes' ? 'Search recipes' : 'Search trainings'}
            placeholder={shelf === 'recipes' ? 'Search recipes…' : 'Search trainings…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </form>
      </div>

      {active.isLoading && <SkeletonGrid />}

      {shelf === 'recipes' && recipes.data && (
        <>
          {recipes.data.items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={q ? `No recipes matching “${q}”` : 'Nothing live yet'}
              hint={
                q
                  ? 'Try a different search, or clear it to see everything in this scope.'
                  : 'Recipes appear here once a chef sets a version live.'
              }
            />
          ) : (
            <ul className={gridClass}>
              {recipes.data.items.map((recipe, index) => (
                <RecipeTile key={recipe._id} recipe={recipe} index={index} />
              ))}
            </ul>
          )}
          <Pager page={recipes.data.page} totalPages={recipes.data.totalPages} onPage={setPage} />
        </>
      )}

      {shelf === 'training' && trainings.data && (
        <>
          {trainings.data.items.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title={q ? `No trainings matching “${q}”` : 'No trainings yet'}
              hint={
                q
                  ? 'Try a different search, or clear it to see everything in this scope.'
                  : 'Training modules appear here the moment they are published.'
              }
            />
          ) : (
            <ul className={gridClass}>
              {trainings.data.items.map((training, index) => (
                <TrainingTile key={training._id} training={training} index={index} />
              ))}
            </ul>
          )}
          <Pager
            page={trainings.data.page}
            totalPages={trainings.data.totalPages}
            onPage={setPage}
          />
        </>
      )}
    </div>
  )
}

export function ReaderBrowser() {
  return (
    <QueryProvider>
      <Browser />
    </QueryProvider>
  )
}
