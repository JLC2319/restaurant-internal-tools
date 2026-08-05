import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CreateRecipeInput, DraftRecipesResponse, RecipeDraftProposal } from '@rit/shared'
import { MAX_DRAFT_PHOTOS, MAX_DRAFT_TOTAL_BYTES, roleAtLeast } from '@rit/shared'
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  CookingPot,
  ImagePlus,
  Info,
  Leaf,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { getDraftConfig, draftRecipesFromPhotos } from '../api/drafts'
import { createRecipe, recipesScopeKey } from '../api/recipes'
import { useActiveRole } from './useActiveRole'
import { QueryProvider } from './QueryProvider'
import { DRAFTING_MESSAGES, WorkingOverlay } from './WorkingOverlay'
import {
  EmptyState,
  ErrorNote,
  Skeleton,
  cardClass,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from './ui'

/**
 * AI recipe drafting — review-first, by design. Photos go up, proposals come
 * back, and NOTHING is saved until the chef reads a proposal and clicks
 * "Create draft recipe". What that creates is an ordinary unpublished draft:
 * invisible to staff until a version is saved and set live, allergen tags
 * pending review like any other recipe.
 */

interface Picked {
  file: File
  url: string
}

function totalBytes(picked: Picked[]): number {
  return picked.reduce((sum, p) => sum + p.file.size, 0)
}

function proposalToContent(p: RecipeDraftProposal): CreateRecipeInput['content'] {
  const times: { prepMinutes?: number; cookMinutes?: number } = {}
  if (p.times?.prepMinutes != null) times.prepMinutes = p.times.prepMinutes
  if (p.times?.cookMinutes != null) times.cookMinutes = p.times.cookMinutes
  return {
    description: p.description,
    yield: p.yield,
    ingredients: p.ingredients.map((ing) => ({
      kind: 'item' as const,
      name: ing.name,
      quantity: ing.quantity,
      ...(ing.note ? { note: ing.note } : {}),
    })),
    steps: p.steps,
    allergens: p.allergens,
    dietary: p.dietary,
    photoIds: [],
    ...(Object.keys(times).length > 0 ? { times } : {}),
  }
}

function ProposalCard({ proposal, index }: { proposal: RecipeDraftProposal; index: number }) {
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const result = await createRecipe({ name: proposal.name, content: proposalToContent(proposal) })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (recipe) => setCreatedId(recipe._id),
    onError: (err: Error) => setError(err.message),
  })

  return (
    <article
      className={`${cardClass} animate-fade-up space-y-4 p-5 tablet:p-6`}
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-steel-900">{proposal.name}</h3>
          <p className="font-mono text-xs text-salt-600">
            {proposal.yield.amount} {proposal.yield.unit}
            {proposal.times?.prepMinutes != null && ` · prep ${proposal.times.prepMinutes} min`}
            {proposal.times?.cookMinutes != null && ` · cook ${proposal.times.cookMinutes} min`}
          </p>
        </div>
        {createdId ? (
          <a href={`/recipes/${createdId}/edit`} className={primaryButtonClass}>
            <ArrowUpRight className="size-4" aria-hidden />
            Open in editor
          </a>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null)
              create.mutate()
            }}
            disabled={create.isPending}
            className={primaryButtonClass}
          >
            <CookingPot className="size-4" aria-hidden />
            {create.isPending ? 'Creating…' : 'Create draft recipe'}
          </button>
        )}
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}
      {createdId && (
        <p className="flex items-center gap-2 rounded-xl bg-basil-50 px-4 py-2.5 text-sm font-medium text-basil-700 ring-1 ring-basil-200 ring-inset">
          <Check className="size-4" aria-hidden />
          Created as a draft only chefs can see. Review it, save a version, then set it live.
        </p>
      )}

      {proposal.description && (
        <p className="text-sm leading-relaxed text-steel-800">{proposal.description}</p>
      )}

      {proposal.notes && (
        <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{proposal.notes}</span>
        </p>
      )}

      <div className="grid gap-5 tablet:grid-cols-2">
        <section>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
            Ingredients
          </h4>
          <ul className="divide-y divide-salt-100 overflow-hidden rounded-xl ring-1 ring-salt-200">
            {proposal.ingredients.map((line, i) => (
              <li key={i} className="flex items-baseline gap-2.5 bg-white px-3 py-2 text-sm">
                <span className="w-20 shrink-0 rounded-md bg-salt-100 px-1.5 py-0.5 text-center font-mono text-xs font-semibold text-steel-800">
                  {line.quantity.amount} {line.quantity.unit}
                </span>
                <span className="text-steel-900">{line.name}</span>
                {line.note && <span className="text-xs text-salt-500 italic">{line.note}</span>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
            Method
          </h4>
          <ol className="space-y-1.5">
            {proposal.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-steel-800">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-steel-900 font-mono text-2xs font-semibold text-salt-50">
                  {i + 1}
                </span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {(proposal.allergens.length > 0 || proposal.dietary.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-salt-100 pt-3">
          {proposal.allergens.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full bg-citron-50 px-3 py-1 text-xs font-semibold text-citron-700 ring-1 ring-citron-200 ring-inset"
            >
              <ShieldAlert className="size-3.5" aria-hidden />
              {tag.replace('_', ' ')}
              <span className="text-2xs font-medium uppercase">unverified</span>
            </span>
          ))}
          {proposal.dietary.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full bg-basil-50 px-3 py-1 text-xs font-semibold text-basil-700 ring-1 ring-basil-200 ring-inset"
            >
              <Leaf className="size-3.5" aria-hidden />
              {tag.replace('_', ' ')}
            </span>
          ))}
          <span className="text-xs text-salt-500">
            Transcribed from the source only — a chef still signs off allergens on the recipe.
          </span>
        </div>
      )}
    </article>
  )
}

function Drafter() {
  const { role } = useActiveRole()
  const canDraft = role != null && roleAtLeast(role, 'chef')
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<Picked[]>([])
  const [hint, setHint] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DraftRecipesResponse | null>(null)

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['drafts', ...recipesScopeKey(), 'config'],
    queryFn: async () => {
      const res = await getDraftConfig()
      if (res.error) throw new Error(res.error.message)
      return res.data
    },
  })

  // Object URLs are revoked when their thumbnail is removed (below) and, as a
  // backstop, all together on unmount — via a ref so this cleanup runs once.
  const pickedRef = useRef<Picked[]>(picked)
  pickedRef.current = picked
  useEffect(() => () => pickedRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  const draft = useMutation({
    mutationFn: async () => {
      const res = await draftRecipesFromPhotos(
        picked.map((p) => p.file),
        hint.trim() || undefined
      )
      if (res.error) throw new Error(res.error.message)
      return res.data
    },
    onSuccess: (data) => setResult(data),
    onError: (err: Error) => setError(err.message),
  })

  function addFiles(list: FileList | null) {
    if (!list) return
    setError(null)
    const incoming = [...list].map((file) => ({ file, url: URL.createObjectURL(file) }))
    setPicked((prev) => {
      const next = [...prev, ...incoming].slice(0, MAX_DRAFT_PHOTOS)
      incoming.slice(next.length - prev.length).forEach((p) => URL.revokeObjectURL(p.url))
      return next
    })
  }

  function removeAt(index: number) {
    setPicked((prev) => {
      URL.revokeObjectURL(prev[index].url)
      return prev.filter((_, i) => i !== index)
    })
  }

  if (configLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-12 w-64" />
      </div>
    )
  }

  if (!canDraft) {
    return (
      <EmptyState
        icon={Camera}
        title="Chefs draft recipes"
        hint="Drafting from photos creates recipes, which needs a chef role or above in this scope."
      />
    )
  }

  if (config && !config.enabled) {
    return (
      <EmptyState
        icon={Sparkles}
        title="AI drafting is not configured"
        hint="This server has no Anthropic API key set (or AI_DRAFTING_ENABLED is off). Add one to turn photos of recipe cards into drafts."
      />
    )
  }

  if (result) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-salt-600">
            {result.proposals.length === 0
              ? 'No recipes found in those photos.'
              : `${result.proposals.length} ${result.proposals.length === 1 ? 'recipe' : 'recipes'} found. Review each one — nothing is saved until you create it.`}
          </p>
          <button
            type="button"
            onClick={() => {
              setResult(null)
              setPicked([])
              setHint('')
            }}
            className={subtleButtonClass}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Start over
          </button>
        </div>

        {result.notes && (
          <p className="flex items-start gap-2.5 rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-700 ring-1 ring-salt-200 ring-inset">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{result.notes}</span>
          </p>
        )}

        {result.proposals.length === 0 && (
          <EmptyState
            icon={Camera}
            title="Nothing recipe-shaped in those photos"
            hint="Try clearer shots of the recipe text, or add a hint describing what the photos show."
          />
        )}

        <div className="space-y-5">
          {result.proposals.map((proposal, index) => (
            <ProposalCard key={index} proposal={proposal} index={index} />
          ))}
        </div>
      </div>
    )
  }

  const bytes = totalBytes(picked)
  const overBudget = bytes > MAX_DRAFT_TOTAL_BYTES

  return (
    <div className="space-y-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className={`${cardClass} space-y-4 p-5 tablet:p-6`}>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />

        {picked.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-48 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-salt-300 bg-salt-50 px-6 py-10 text-center transition-colors hover:border-ember-400 hover:bg-ember-50/40"
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-white text-ember-600 shadow-xs ring-1 ring-salt-200">
              <ImagePlus className="size-7" aria-hidden />
            </span>
            <span className="font-semibold text-steel-900">Add photos</span>
            <span className="max-w-md text-sm text-salt-600">
              Recipe cards, cookbook pages, printed sheets, whiteboards — even a plated dish.
              Up to {MAX_DRAFT_PHOTOS} photos, 20MB total.
            </span>
          </button>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 phablet:grid-cols-4 tablet:grid-cols-6">
              {picked.map((p, index) => (
                <div key={p.url} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-salt-200">
                  <img src={p.url} alt={`Photo ${index + 1}`} className="size-full object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove photo ${index + 1}`}
                    onClick={() => removeAt(index)}
                    className="absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-steel-900/70 text-white transition-colors hover:bg-chili-600"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              {picked.length < MAX_DRAFT_PHOTOS && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  aria-label="Add more photos"
                  className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-salt-300 text-salt-500 transition-colors hover:border-ember-400 hover:text-ember-600"
                >
                  <ImagePlus className="size-6" aria-hidden />
                  <span className="text-xs font-medium">Add</span>
                </button>
              )}
            </div>
            <p className={`text-xs ${overBudget ? 'font-semibold text-chili-600' : 'text-salt-500'}`}>
              {picked.length} {picked.length === 1 ? 'photo' : 'photos'} ·{' '}
              {(bytes / (1024 * 1024)).toFixed(1)}MB of 20MB
              {overBudget && ' — remove a photo or two'}
            </p>
          </div>
        )}

        <div>
          <label htmlFor="draft-hint" className="mb-1.5 block text-sm font-medium text-steel-700">
            Hint <span className="font-normal text-salt-500">(optional)</span>
          </label>
          <input
            id="draft-hint"
            type="text"
            maxLength={500}
            placeholder="e.g. pages 1–3 are one braise; the last card is a dessert"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null)
              draft.mutate()
            }}
            disabled={picked.length === 0 || overBudget || draft.isPending}
            className={primaryButtonClass}
          >
            <Sparkles className="size-4" aria-hidden />
            {draft.isPending ? 'Reading photos…' : 'Draft recipes'}
          </button>
        </div>
      </div>

      <WorkingOverlay
        active={draft.isPending}
        title="Drafting your recipes"
        messages={DRAFTING_MESSAGES}
      />

      <p className="flex items-start gap-2.5 rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-600 ring-1 ring-salt-200 ring-inset">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-citron-600" aria-hidden />
        <span>
          Proposals are suggestions, not recipes. Nothing is saved until you create it, what you
          create is a draft staff cannot see, and allergen tags always need a chef's sign-off.
        </span>
      </p>
    </div>
  )
}

export function RecipeDraft() {
  return (
    <QueryProvider>
      <Drafter />
    </QueryProvider>
  )
}
