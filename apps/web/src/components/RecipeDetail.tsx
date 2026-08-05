import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RecipeContentView, RecipeDetail as RecipeDetailData } from '@rit/shared'
import { roleAtLeast } from '@rit/shared'
import {
  Archive,
  ArchiveRestore,
  Flame,
  GitCommitVertical,
  GitFork,
  History,
  Leaf,
  Pencil,
  PencilRuler,
  Radio,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react'
import {
  activateVersion,
  approveAllergens,
  archiveRecipe,
  deactivateRecipe,
  forkRecipe,
  getRecipe,
  listVersions,
  recipesScopeKey,
  restoreVersion,
  saveVersion,
  unarchiveRecipe,
} from '../api/recipes'
import { getTenantTree } from '../api/tenancy'
import { useActiveRole } from './useActiveRole'
import { PlatingGallery } from './PlatingGallery'
import { QueryProvider } from './QueryProvider'
import {
  Badge,
  ErrorNote,
  Segmented,
  Skeleton,
  cardClass,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from './ui'

/**
 * Allergen chips are the design system's one sanctioned use of chili. A tag
 * still awaiting sign-off renders citron instead — it is a claim nobody has
 * verified yet, and it must not look like one somebody has.
 */
function AllergenChip({ allergen, status }: { allergen: string; status: string }) {
  const approved = status === 'approved'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${
        approved
          ? 'bg-chili-50 text-chili-700 ring-chili-200'
          : 'bg-citron-50 text-citron-700 ring-citron-200'
      }`}
    >
      {approved ? (
        <ShieldCheck className="size-3.5" aria-hidden />
      ) : (
        <ShieldAlert className="size-3.5" aria-hidden />
      )}
      {allergen.replace('_', ' ')}
      {!approved && <span className="text-2xs font-medium uppercase">unverified</span>}
    </span>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Scale
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-salt-50 px-4 py-3 ring-1 ring-salt-200 ring-inset">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-ember-600 shadow-xs ring-1 ring-salt-200">
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-2xs font-semibold tracking-wide text-salt-600 uppercase">{label}</p>
        <p className="font-mono text-sm font-semibold text-steel-900">{value}</p>
      </div>
    </div>
  )
}

function ContentSection({
  content,
  recipeName,
}: {
  content: RecipeContentView
  recipeName: string
}) {
  return (
    <div className="space-y-6">
      {content.description && (
        <p className="text-sm leading-relaxed text-steel-800">{content.description}</p>
      )}

      <div className="grid gap-3 phablet:grid-cols-3">
        <StatTile icon={Scale} label="Yield" value={`${content.yield.amount} ${content.yield.unit}`} />
        {content.times?.prepMinutes != null && (
          <StatTile icon={Timer} label="Prep" value={`${content.times.prepMinutes} min`} />
        )}
        {content.times?.cookMinutes != null && (
          <StatTile icon={Flame} label="Cook" value={`${content.times.cookMinutes} min`} />
        )}
      </div>

      <section>
        <h2 className="mb-3 font-semibold text-steel-900">Ingredients</h2>
        {content.ingredients.length === 0 ? (
          <p className="text-sm text-salt-500">No ingredients yet.</p>
        ) : (
          <ul className="divide-y divide-salt-100 overflow-hidden rounded-xl ring-1 ring-salt-200">
            {content.ingredients.map((line, index) => (
              <li
                key={index}
                className="flex items-baseline gap-3 bg-white px-4 py-3 text-sm transition-colors hover:bg-salt-50"
              >
                <span className="w-24 shrink-0 rounded-md bg-salt-100 px-2 py-0.5 text-center font-mono text-xs font-semibold text-steel-800">
                  {line.quantity.amount} {line.quantity.unit}
                </span>
                {line.kind === 'recipe' && line.recipeId ? (
                  <a
                    href={`/recipes/${line.recipeId}`}
                    className="inline-flex items-center gap-1.5 font-semibold text-ember-600 transition-colors hover:text-ember-700"
                  >
                    <GitFork className="size-3.5 rotate-90" aria-hidden />
                    {line.name}
                  </a>
                ) : (
                  <span className="text-steel-900">{line.name}</span>
                )}
                {line.note && <span className="text-salt-500 italic">{line.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-steel-900">Method</h2>
        {content.steps.length === 0 ? (
          <p className="text-sm text-salt-500">No steps yet.</p>
        ) : (
          <ol className="space-y-3">
            {content.steps.map((step, index) => (
              <li key={index} className="flex gap-3.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-steel-900 font-mono text-xs font-semibold text-salt-50">
                  {index + 1}
                </span>
                <p className="pt-0.5 text-sm leading-relaxed text-steel-800">{step}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
            Allergens
          </h2>
          {content.allergens.length === 0 ? (
            <p className="text-sm text-salt-500">No allergen tags.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {content.allergens.map((tag) => (
                <AllergenChip key={tag.allergen} allergen={tag.allergen} status={tag.status} />
              ))}
            </div>
          )}
        </div>
        {content.dietary.length > 0 && (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
              Dietary
            </h2>
            <div className="flex flex-wrap gap-2">
              {content.dietary.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded-full bg-basil-50 px-3 py-1.5 text-xs font-semibold text-basil-700 ring-1 ring-basil-200 ring-inset"
                >
                  <Leaf className="size-3.5" aria-hidden />
                  {tag.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <PlatingGallery photos={content.photos} recipeName={recipeName} />
    </div>
  )
}

function SaveVersionForm({ recipeId, onDone }: { recipeId: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      const result = await saveVersion(recipeId, note ? { note } : {})
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      onDone()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    save.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} animate-fade-up space-y-3 p-4`}>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <label htmlFor="version-note" className="mb-1.5 block text-sm font-medium text-steel-700">
            Version note <span className="font-normal text-salt-500">(optional)</span>
          </label>
          <input
            id="version-note"
            type="text"
            maxLength={300}
            placeholder="e.g. reduced sugar, doubled batch"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          <GitCommitVertical className="size-4" aria-hidden />
          {save.isPending ? 'Saving…' : 'Save version'}
        </button>
        <button type="button" onClick={onDone} className={subtleButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function ForkForm({ recipe, onDone }: { recipe: RecipeDetailData; onDone: () => void }) {
  const [name, setName] = useState(`${recipe.name} (fork)`)
  const [propertyId, setPropertyId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: tree } = useQuery({
    queryKey: ['tenancy', ...recipesScopeKey(), 'tree'],
    queryFn: async () => {
      const result = await getTenantTree()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const fork = useMutation({
    mutationFn: async () => {
      const result = await forkRecipe(recipe._id, {
        name,
        propertyId: propertyId || null,
        locationId: locationId || null,
      })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (created) => {
      window.location.href = `/recipes/${created._id}`
    },
    onError: (err: Error) => setError(err.message),
  })

  const locations = tree?.properties.find((p) => p._id === propertyId)?.locations ?? []

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    fork.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} animate-fade-up space-y-4 p-5`}>
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-steel-900">
          <GitFork className="size-4 text-ember-600" aria-hidden />
          Fork this recipe
        </h3>
        <p className="mt-1 text-sm text-salt-600">
          Copies the{' '}
          {recipe.activeVersion != null ? `live version (v${recipe.activeVersion})` : 'recipe'} into a
          new, independent recipe at the scope you choose. Allergen tags start unverified — the
          receiving kitchen signs off for itself.
        </p>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 tablet:grid-cols-3">
        <div>
          <label htmlFor="fork-name" className="mb-1.5 block text-sm font-medium text-steel-700">
            New name
          </label>
          <input
            id="fork-name"
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
          <label htmlFor="fork-property" className="mb-1.5 block text-sm font-medium text-steel-700">
            Property
          </label>
          <select
            id="fork-property"
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value)
              setLocationId('')
            }}
            className={inputClass}
          >
            <option value="">Whole organization</option>
            {tree?.properties.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fork-location" className="mb-1.5 block text-sm font-medium text-steel-700">
            Location
          </label>
          <select
            id="fork-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            disabled={!propertyId}
            className={inputClass}
          >
            <option value="">Whole property</option>
            {locations.map((l) => (
              <option key={l._id} value={l._id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={fork.isPending} className={primaryButtonClass}>
          <GitFork className="size-4" aria-hidden />
          {fork.isPending ? 'Forking…' : 'Fork'}
        </button>
        <button type="button" onClick={onDone} className={subtleButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function VersionTimeline({ recipe }: { recipe: RecipeDetailData }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: versions, isLoading } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'versions', recipe._id],
    queryFn: async () => {
      const result = await listVersions(recipe._id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const activate = useMutation({
    mutationFn: async (versionId: string) => {
      const result = await activateVersion(recipe._id, versionId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recipes'] }),
    onError: (err: Error) => setError(err.message),
  })

  const restore = useMutation({
    mutationFn: async (versionId: string) => {
      const result = await restoreVersion(recipe._id, versionId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recipes'] }),
    onError: (err: Error) => setError(err.message),
  })

  return (
    <section className={`${cardClass} p-5`}>
      <h2 className="mb-4 flex items-center gap-2 font-semibold text-steel-900">
        <History className="size-4 text-ember-600" aria-hidden />
        Version history
      </h2>
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {versions?.length === 0 && (
        <p className="text-sm text-salt-600">
          No saved versions yet. Staff can only see this recipe once a version is saved and set live.
        </p>
      )}
      <ol className="relative space-y-1">
        {versions && versions.length > 0 && (
          <span
            aria-hidden
            className="absolute top-3 bottom-3 left-1.75 w-px bg-salt-200"
          />
        )}
        {versions?.map((v) => (
          <li key={v._id} className="relative flex gap-3 rounded-xl p-2 transition-colors hover:bg-salt-50">
            <span
              aria-hidden
              className={`relative z-10 mt-1 size-3.75 shrink-0 rounded-full border-2 ${
                v.isActive
                  ? 'border-basil-500 bg-basil-100 shadow-sm shadow-basil-500/40'
                  : 'border-salt-300 bg-white'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-steel-900">v{v.version}</span>
                {v.isActive && <Badge value="active" label="live" />}
                <span className="text-xs text-salt-500">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="truncate text-sm text-salt-600">
                {v.note || <span className="italic">no note</span>}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                {!v.isActive && (
                  <button
                    type="button"
                    onClick={() => activate.mutate(v._id)}
                    disabled={activate.isPending}
                    className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-basil-700 transition-colors hover:bg-basil-50 disabled:opacity-60"
                  >
                    <Radio className="size-3.5" aria-hidden />
                    Set live
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Replace the working copy with v${v.version}? Unsaved working-copy changes are lost.`
                      )
                    ) {
                      restore.mutate(v._id)
                    }
                  }}
                  disabled={restore.isPending}
                  className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-steel-600 transition-colors hover:bg-salt-100 disabled:opacity-60"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Restore
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-6 w-48 rounded-full" />
      <div className={`${cardClass} space-y-4 p-6`}>
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    </div>
  )
}

function Detail({ recipeId }: { recipeId: string }) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<'working' | 'active'>('working')
  const [openForm, setOpenForm] = useState<'none' | 'saveVersion' | 'fork'>('none')
  const [actionError, setActionError] = useState<string | null>(null)
  const { role } = useActiveRole()

  const { data: recipe, error, isLoading } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'detail', recipeId],
    queryFn: async () => {
      const result = await getRecipe(recipeId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const mutationHandlers = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recipes'] }),
    onError: (err: Error) => setActionError(err.message),
  }

  const deactivate = useMutation({
    mutationFn: async () => {
      const result = await deactivateRecipe(recipeId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  const unarchive = useMutation({
    mutationFn: async () => {
      const result = await unarchiveRecipe(recipeId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  const approve = useMutation({
    mutationFn: async () => {
      const result = await approveAllergens(recipeId, {})
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  const archive = useMutation({
    mutationFn: async () => {
      const result = await archiveRecipe(recipeId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  if (isLoading) return <DetailSkeleton />
  if (error) return <ErrorNote>{error.message}</ErrorNote>
  if (!recipe) return null

  const isChefView = recipe.workingCopy != null
  const content =
    isChefView && view === 'working'
      ? recipe.workingCopy
      : (recipe.activeContent ?? recipe.workingCopy)
  const pendingAllergens =
    recipe.workingCopy?.allergens.some((t) => t.status !== 'approved') ?? false
  const isManager = role != null && roleAtLeast(role, 'manager')

  /**
   * True when the content on screen is the published snapshot rather than the
   * working copy. Editing, versioning and allergen sign-off all act on the
   * working copy, so offering them here would imply they change what is being
   * read — they do not. Derived from `activeContent` rather than `view` alone
   * so that taking a recipe offline while viewing it falls back correctly.
   */
  const viewingLive = isChefView && view === 'active' && recipe.activeContent != null

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-steel-900">{recipe.name}</h1>
          {recipe.status === 'archived' && <Badge value="archived" />}
          {recipe.activeVersion != null ? (
            <Badge value="active" label={`v${recipe.activeVersion} live`} />
          ) : (
            <Badge value="unpublished" label="draft only" />
          )}
        </div>
        {recipe.forkedFrom && (
          <p className="flex items-center gap-1.5 text-sm text-salt-600">
            <GitFork className="size-4" aria-hidden />
            Forked from{' '}
            <a
              href={`/recipes/${recipe.forkedFrom.recipeId}`}
              className="font-semibold text-ember-600 transition-colors hover:text-ember-700"
            >
              this recipe
            </a>{' '}
            at v{recipe.forkedFrom.version}.
          </p>
        )}
      </header>

      {!recipe.allergensVerified && (
        <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Allergen information on this recipe has not been fully verified. Do not rely on it for
            guest safety questions.
          </span>
        </p>
      )}

      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      {isChefView && (
        <div className="flex flex-wrap items-center gap-2">
          {recipe.activeContent && (
            <div className="mr-auto">
              <Segmented
                ariaLabel="Content view"
                value={view}
                onChange={(next) => {
                  setView(next)
                  // The version form acts on the working copy; leaving it open
                  // over the live snapshot is the same lie as the Edit button.
                  if (next === 'active') setOpenForm('none')
                }}
                options={[
                  {
                    id: 'working',
                    label: (
                      <>
                        <PencilRuler className="size-3.5" aria-hidden /> Working copy
                      </>
                    ),
                  },
                  {
                    id: 'active',
                    label: (
                      <>
                        <Radio className="size-3.5" aria-hidden /> Live (v{recipe.activeVersion})
                      </>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {recipe.canManage && (
            <>
              {/* Working-copy actions only. A published version is immutable, so
                  none of these belong beside it — see `viewingLive` above. */}
              {!viewingLive && (
                <>
                  <a href={`/recipes/${recipe._id}/edit`} className={subtleButtonClass}>
                    <Pencil className="size-4" aria-hidden />
                    Edit
                  </a>
                  <button
                    type="button"
                    onClick={() => setOpenForm(openForm === 'saveVersion' ? 'none' : 'saveVersion')}
                    className={subtleButtonClass}
                  >
                    <GitCommitVertical className="size-4" aria-hidden />
                    Save as version
                  </button>
                  {pendingAllergens && (
                    <button
                      type="button"
                      onClick={() => approve.mutate()}
                      disabled={approve.isPending}
                      className={subtleButtonClass}
                    >
                      <ShieldCheck className="size-4 text-basil-600" aria-hidden />
                      Approve allergens
                    </button>
                  )}
                </>
              )}
              {recipe.activeVersionId && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Staff will immediately lose access to this recipe. Continue?')) {
                      deactivate.mutate()
                    }
                  }}
                  disabled={deactivate.isPending}
                  className={subtleButtonClass}
                >
                  Take offline
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setOpenForm(openForm === 'fork' ? 'none' : 'fork')}
            className={subtleButtonClass}
          >
            <GitFork className="size-4" aria-hidden />
            Fork
          </button>
          {isManager &&
            (recipe.status === 'archived' ? (
              <button
                type="button"
                onClick={() => unarchive.mutate()}
                disabled={unarchive.isPending}
                className={subtleButtonClass}
              >
                <ArchiveRestore className="size-4" aria-hidden />
                Unarchive
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Archive this recipe? It disappears from staff lists.')) {
                    archive.mutate()
                  }
                }}
                disabled={archive.isPending}
                className={subtleButtonClass}
              >
                <Archive className="size-4" aria-hidden />
                Archive
              </button>
            ))}
        </div>
      )}

      {viewingLive && recipe.canManage && (
        <p className="flex items-start gap-2.5 rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-600 ring-1 ring-salt-200 ring-inset">
          <Radio className="mt-0.5 size-4 shrink-0 text-basil-600" aria-hidden />
          <span>
            This is v{recipe.activeVersion}, exactly as staff see it. Published versions are never
            edited — switch to the working copy to make changes, then save a new version.
          </span>
        </p>
      )}

      {openForm === 'saveVersion' && (
        <SaveVersionForm recipeId={recipe._id} onDone={() => setOpenForm('none')} />
      )}
      {openForm === 'fork' && <ForkForm recipe={recipe} onDone={() => setOpenForm('none')} />}

      <div className={isChefView ? 'grid gap-6 laptop:grid-cols-[minmax(0,1fr)_340px]' : ''}>
        <div className={`${cardClass} p-5 tablet:p-7`}>
          {content ? (
            <ContentSection content={content} recipeName={recipe.name} />
          ) : (
            <p className="text-sm text-salt-500">Nothing to show.</p>
          )}
        </div>

        {isChefView && (
          <div className="laptop:sticky laptop:top-24 laptop:self-start">
            <VersionTimeline recipe={recipe} />
          </div>
        )}
      </div>
    </div>
  )
}

export function RecipeDetail({ recipeId }: { recipeId: string }) {
  return (
    <QueryProvider>
      <Detail recipeId={recipeId} />
    </QueryProvider>
  )
}
