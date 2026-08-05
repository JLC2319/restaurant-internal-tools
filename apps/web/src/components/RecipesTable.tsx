import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { RecipeStatus, RecipeSummary, Unit } from '@rit/shared'
import { roleAtLeast, unitValues, unitFamily } from '@rit/shared'
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock,
  CookingPot,
  GitFork,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'
import { createRecipe, listRecipes, recipesScopeKey } from '../api/recipes'
import { useActiveRole } from './useActiveRole'
import { QueryProvider } from './QueryProvider'
import {
  Badge,
  EmptyState,
  ErrorNote,
  Segmented,
  Skeleton,
  cardClass,
  cardHoverClass,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from './ui'

/** Unit select grouped by family, so "qt" is never a scroll past "kg". */
export function UnitSelect({
  id,
  value,
  onChange,
  ariaLabel,
}: {
  id?: string
  value: Unit
  onChange: (unit: Unit) => void
  ariaLabel?: string
}) {
  const families: Record<string, Unit[]> = { weight: [], volume: [], count: [] }
  for (const unit of unitValues) families[unitFamily[unit]].push(unit)
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as Unit)}
      className={inputClass}
    >
      {Object.entries(families).map(([family, units]) => (
        <optgroup key={family} label={family}>
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function NewRecipeForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [yieldAmount, setYieldAmount] = useState('1')
  const [yieldUnit, setYieldUnit] = useState<Unit>('qt')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const result = await createRecipe({
        name,
        content: {
          description: '',
          yield: { amount: Number(yieldAmount), unit: yieldUnit },
          ingredients: [],
          steps: [],
          allergens: [],
          dietary: [],
          photoIds: [],
        },
      })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (recipe) => {
      window.location.href = `/recipes/${recipe._id}/edit`
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!(Number(yieldAmount) > 0)) {
      setError('Yield must be a positive number')
      return
    }
    create.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} animate-fade-up space-y-4 p-5 tablet:p-6`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-steel-900">New recipe</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 cursor-pointer items-center justify-center rounded-full text-salt-500 transition-colors hover:bg-salt-100 hover:text-steel-800"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-4 tablet:grid-cols-3">
        <div className="tablet:col-span-2">
          <label htmlFor="recipe-name" className="mb-1.5 block text-sm font-medium text-steel-700">
            Name
          </label>
          <input
            id="recipe-name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            placeholder="e.g. Bourbon Glaze"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-steel-700">Yield</span>
          <div className="flex gap-2">
            <input
              type="number"
              aria-label="Yield amount"
              required
              min="0"
              step="any"
              value={yieldAmount}
              onChange={(e) => setYieldAmount(e.target.value)}
              className={`${inputClass} font-mono`}
            />
            <UnitSelect ariaLabel="Yield unit" value={yieldUnit} onChange={setYieldUnit} />
          </div>
        </div>
      </div>

      <button type="submit" disabled={create.isPending} className={primaryButtonClass}>
        <Plus className="size-4" aria-hidden />
        {create.isPending ? 'Creating…' : 'Create and edit'}
      </button>
    </form>
  )
}

function RecipeCard({ recipe, index }: { recipe: RecipeSummary; index: number }) {
  const delay = ['', 'fade-delay-1', 'fade-delay-2', 'fade-delay-3'][index % 4]
  return (
    <li className={`animate-fade-up ${delay}`}>
      <a
        href={`/recipes/${recipe._id}`}
        className={`group flex h-full flex-col overflow-hidden ${cardClass} ${cardHoverClass}`}
      >
        {/* The plating shot is what a cook recognises a dish by, so it leads the
            card when there is one. Alt is empty: the name is right below it. */}
        {recipe.heroPhoto && (
          <img
            src={recipe.heroPhoto.url}
            alt=""
            width={recipe.heroPhoto.width ?? undefined}
            height={recipe.heroPhoto.height ?? undefined}
            loading="lazy"
            className="aspect-video w-full bg-salt-100 object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        )}

        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-steel-900 transition-colors group-hover:text-ember-700">
              {recipe.name}
            </h2>
            {recipe.isFork && (
              <span
                title="Forked from another recipe"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-steel-50 text-steel-500 ring-1 ring-steel-200 ring-inset"
              >
                <GitFork className="size-3.5" aria-hidden />
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {recipe.status === 'archived' ? (
              <Badge value="archived" />
            ) : recipe.activeVersion != null ? (
              <Badge value="active" label={`v${recipe.activeVersion} live`} />
            ) : (
              <Badge value="unpublished" label="draft only" />
            )}
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${
                recipe.allergensVerified ? 'text-basil-600' : 'text-citron-600'
              }`}
            >
              {recipe.allergensVerified ? (
                <ShieldCheck className="size-3.5" aria-hidden />
              ) : (
                <ShieldAlert className="size-3.5" aria-hidden />
              )}
              {recipe.allergensVerified ? 'Allergens verified' : 'Allergens unverified'}
            </span>
          </div>

          <p className="mt-auto flex items-center gap-1.5 text-xs text-salt-500">
            <Clock className="size-3.5" aria-hidden />
            Updated {new Date(recipe.modifiedAt).toLocaleDateString()}
          </p>
        </div>
      </a>
    </li>
  )
}

function SkeletonGrid() {
  return (
    <ul className="grid gap-4 phablet:grid-cols-2 desktop:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className={`${cardClass} space-y-3 p-5`}>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-4 w-1/2" />
        </li>
      ))}
    </ul>
  )
}

function Browser() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<RecipeStatus>('active')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const { role } = useActiveRole()
  const canCreate = role != null && roleAtLeast(role, 'chef')

  const { data, error, isLoading } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'list', { q, page, status }],
    queryFn: async () => {
      const result = await listRecipes({ q, page, status })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) return <ErrorNote>{error.message}</ErrorNote>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQ(search)
          }}
          className="relative max-w-md flex-1"
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-salt-500"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search recipes"
            placeholder="Search recipes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </form>

        {canCreate && (
          <>
            <Segmented
              ariaLabel="Recipe status"
              value={status}
              onChange={(next) => {
                setStatus(next)
                setPage(1)
              }}
              options={[
                { id: 'active', label: 'Active' },
                {
                  id: 'archived',
                  label: (
                    <>
                      <Archive className="size-3.5" aria-hidden /> Archived
                    </>
                  ),
                },
              ]}
            />
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className={`${primaryButtonClass} ml-auto`}
            >
              <Plus className="size-4" aria-hidden />
              New recipe
            </button>
          </>
        )}
      </div>

      {showForm && canCreate && <NewRecipeForm onClose={() => setShowForm(false)} />}

      {isLoading && <SkeletonGrid />}

      {data?.items.length === 0 && (
        <EmptyState
          icon={CookingPot}
          title={q ? `No recipes matching “${q}”` : 'No recipes yet'}
          hint={
            q
              ? 'Try a different search, or clear it to see everything in this scope.'
              : canCreate
                ? 'Every dish starts as a draft only you can see. Create the first recipe and start experimenting.'
                : 'Recipes appear here once a chef publishes them.'
          }
          action={
            canCreate && !q ? (
              <button type="button" onClick={() => setShowForm(true)} className={primaryButtonClass}>
                <Plus className="size-4" aria-hidden />
                Create the first recipe
              </button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <ul className="grid gap-4 phablet:grid-cols-2 desktop:grid-cols-3">
          {data.items.map((recipe, index) => (
            <RecipeCard key={recipe._id} recipe={recipe} index={index} />
          ))}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
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
  )
}

export function RecipesTable() {
  return (
    <QueryProvider>
      <Browser />
    </QueryProvider>
  )
}
