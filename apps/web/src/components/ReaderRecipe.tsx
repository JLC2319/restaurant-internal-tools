import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RecipeContentView } from '@rit/shared'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  Flame,
  GitFork,
  Leaf,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react'
import { getRecipe, recipesScopeKey } from '../api/recipes'
import { PlatingGallery } from './PlatingGallery'
import { QueryProvider } from './QueryProvider'
import { EmptyState, ErrorNote, Skeleton, cardClass } from './ui'

/**
 * The recipe as the line reads it: the live version, whole and alone. The
 * working copy never renders here even for chefs — this surface exists so that
 * anything on an iPad at the pass is, by construction, approved content.
 *
 * Ingredients and steps are tap-to-check: purely local state, gloved-finger
 * sized, so a cook can keep their place mid-batch. Nothing is written anywhere.
 *
 * SAFETY: allergen chips render only approved tags — an unapproved tag is a
 * claim nobody has verified, and on this screen everything must be a verified
 * claim or clearly flagged as incomplete (the citron banner).
 */

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
    <div className="flex items-center gap-3 rounded-xl bg-salt-50 px-4 py-3.5 ring-1 ring-salt-200 ring-inset">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-ember-600 shadow-xs ring-1 ring-salt-200">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div>
        <p className="text-2xs font-semibold tracking-wide text-salt-600 uppercase">{label}</p>
        <p className="font-mono text-base font-semibold text-steel-900">{value}</p>
      </div>
    </div>
  )
}

/** A round tap target that reads as a checkbox but is sized for gloves. */
function CheckDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150 ${
        checked ? 'border-basil-500 bg-basil-500 text-white' : 'border-salt-300 bg-white'
      }`}
    >
      {checked && <Check className="size-4" strokeWidth={3} />}
    </span>
  )
}

function Ingredients({ content }: { content: RecipeContentView }) {
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const toggle = (index: number) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-steel-900">Ingredients</h2>
      {content.ingredients.length === 0 ? (
        <p className="text-salt-500">No ingredients listed.</p>
      ) : (
        <ul className="divide-y divide-salt-100 overflow-hidden rounded-xl ring-1 ring-salt-200">
          {content.ingredients.map((line, index) => {
            const done = checked.has(index)
            return (
              <li key={index} className="flex items-center bg-white transition-colors hover:bg-salt-50">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  onClick={() => toggle(index)}
                  className={`flex min-h-touch flex-1 cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-opacity ${done ? 'opacity-45' : ''}`}
                >
                  <CheckDot checked={done} />
                  <span className="w-28 shrink-0 rounded-md bg-salt-100 px-2 py-1 text-center font-mono text-sm font-semibold text-steel-800">
                    {line.quantity.amount} {line.quantity.unit}
                  </span>
                  <span className={`text-base text-steel-900 ${done ? 'line-through' : ''}`}>
                    {line.name}
                  </span>
                  {line.note && <span className="text-sm text-salt-500 italic">{line.note}</span>}
                </button>
                {line.kind === 'recipe' && line.recipeId && (
                  <a
                    href={`/reader/recipes/${line.recipeId}`}
                    aria-label={`Open sub-recipe ${line.name}`}
                    className="mr-2 flex min-h-touch shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-ember-600 transition-colors hover:bg-ember-50 hover:text-ember-700"
                  >
                    <GitFork className="size-3.5 rotate-90" aria-hidden />
                    Open
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Method({ content }: { content: RecipeContentView }) {
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const toggle = (index: number) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-steel-900">Method</h2>
      {content.steps.length === 0 ? (
        <p className="text-salt-500">No steps listed.</p>
      ) : (
        <ol className="space-y-2">
          {content.steps.map((step, index) => {
            const done = checked.has(index)
            return (
              <li key={index}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  onClick={() => toggle(index)}
                  className={`flex w-full cursor-pointer gap-4 rounded-xl p-3 text-left transition-all duration-150 hover:bg-salt-50 ${done ? 'opacity-45' : ''}`}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold transition-colors ${
                      done ? 'bg-basil-500 text-white' : 'bg-steel-900 text-salt-50'
                    }`}
                  >
                    {done ? <Check className="size-4.5" strokeWidth={3} aria-hidden /> : index + 1}
                  </span>
                  <p
                    className={`pt-1.5 text-base leading-relaxed text-steel-800 ${done ? 'line-through' : ''}`}
                  >
                    {step}
                  </p>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function Reader({ recipeId }: { recipeId: string }) {
  const { data: recipe, error, isLoading } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'reader', 'detail', recipeId],
    queryFn: async () => {
      const result = await getRecipe(recipeId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) return <ErrorNote>{error.message}</ErrorNote>
  if (isLoading || !recipe)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
      </div>
    )

  const content = recipe.activeContent
  // Chefs can reach an unpublished lineage by URL; staff get a 404 upstream.
  // Either way the reader has nothing it is allowed to show.
  if (recipe.status !== 'active' || !content) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={BookOpen}
          title="Not available in the reader"
          hint="This recipe has no live version. Once a chef sets one live, it appears here."
          action={
            <a href="/reader" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ember-600 transition-colors hover:text-ember-700">
              <ArrowLeft className="size-4" aria-hidden />
              Back to the reader
            </a>
          }
        />
      </div>
    )
  }

  const approvedAllergens = content.allergens.filter((tag) => tag.status === 'approved')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="animate-fade-up space-y-3">
        <a
          href="/reader"
          className="inline-flex min-h-touch items-center gap-1.5 text-sm font-semibold text-salt-600 transition-colors hover:text-steel-900"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Reader
        </a>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-steel-900 tablet:text-4xl">
            {recipe.name}
          </h1>
          <span className="rounded-full bg-steel-900 px-2.5 py-1 font-mono text-2xs font-semibold text-salt-50">
            v{recipe.activeVersion} live
          </span>
        </div>
        {content.description && (
          <p className="max-w-2xl leading-relaxed text-salt-600">{content.description}</p>
        )}
      </header>

      {!recipe.allergensVerified && (
        <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Allergen information on this recipe has not been fully verified. Do not answer guest
            allergen questions from it — ask a chef.
          </span>
        </p>
      )}

      <div className={`${cardClass} animate-fade-up fade-delay-1 space-y-7 p-5 tablet:p-8`}>
        <div className="grid gap-3 phablet:grid-cols-3">
          <StatTile
            icon={Scale}
            label="Yield"
            value={`${content.yield.amount} ${content.yield.unit}`}
          />
          {content.times?.prepMinutes != null && (
            <StatTile icon={Timer} label="Prep" value={`${content.times.prepMinutes} min`} />
          )}
          {content.times?.cookMinutes != null && (
            <StatTile icon={Flame} label="Cook" value={`${content.times.cookMinutes} min`} />
          )}
        </div>

        <Ingredients content={content} />
        <Method content={content} />

        <section className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
              Allergens
            </h2>
            {approvedAllergens.length === 0 ? (
              <p className="text-sm text-salt-500">No verified allergen tags.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {approvedAllergens.map((tag) => (
                  <span
                    key={tag.allergen}
                    className="inline-flex items-center gap-1.5 rounded-full bg-chili-50 px-3 py-1.5 text-sm font-semibold text-chili-700 ring-1 ring-chili-200 ring-inset"
                  >
                    <ShieldCheck className="size-4" aria-hidden />
                    {tag.allergen.replace('_', ' ')}
                  </span>
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
                    className="inline-flex items-center gap-1.5 rounded-full bg-basil-50 px-3 py-1.5 text-sm font-semibold text-basil-700 ring-1 ring-basil-200 ring-inset"
                  >
                    <Leaf className="size-4" aria-hidden />
                    {tag.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <PlatingGallery photos={content.photos} recipeName={recipe.name} />
      </div>
    </div>
  )
}

export function ReaderRecipe({ recipeId }: { recipeId: string }) {
  return (
    <QueryProvider>
      <Reader recipeId={recipeId} />
    </QueryProvider>
  )
}
