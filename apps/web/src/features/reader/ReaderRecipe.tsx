import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RecipeContentView, RecipeTranslationView } from '@rit/shared'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  Flame,
  GitFork,
  Languages,
  Leaf,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react'
import { getRecipe, recipesScopeKey } from '@/features/recipes/api'
import { getRecipeTranslation, machineTranslateRecipe } from '@/features/translations/api'
import { TRANSLATING_MESSAGES } from '@/features/translations/messages'
import { allergenEs, dietaryEs, readerEs, unitEs } from '@/features/reader/es'
import { PlatingGallery } from '@/features/recipes/PlatingGallery'
import { QueryProvider } from '@/lib/QueryProvider'
import { WorkingOverlay } from '@/components/ui/WorkingOverlay'
import { EmptyState, ErrorNote, Skeleton, cardClass } from '@/components/ui'

/**
 * The recipe as the line reads it: the live version, whole and alone. The
 * working copy never renders here even for chefs — this surface exists so that
 * anything on an iPad at the pass is, by construction, approved content.
 *
 * That rule covers language too. The Español toggle appears only when an
 * approved, current translation exists — machine output that nobody signed
 * off never renders here, whoever is holding the iPad. Enum labels (units,
 * allergens, dietary) come from a static dictionary, not the LLM.
 *
 * Ingredients and steps are tap-to-check: purely local state, gloved-finger
 * sized, so a cook can keep their place mid-batch. Nothing is written anywhere.
 *
 * SAFETY: allergen chips render only approved tags — an unapproved tag is a
 * claim nobody has verified, and on this screen everything must be a verified
 * claim or clearly flagged as incomplete (the citron banner).
 */

type Lang = 'en' | 'es'

/** The reader's chrome in the active language. */
interface ReaderStrings {
  ingredients: string
  method: string
  allergens: string
  dietary: string
  yield: string
  prep: string
  cook: string
  live: string
  noIngredients: string
  noSteps: string
  noVerifiedAllergens: string
  openSubRecipe: string
  allergenWarning: string
}

const EN_STRINGS: ReaderStrings = {
  ingredients: 'Ingredients',
  method: 'Method',
  allergens: 'Allergens',
  dietary: 'Dietary',
  yield: 'Yield',
  prep: 'Prep',
  cook: 'Cook',
  live: 'live',
  noIngredients: 'No ingredients listed.',
  noSteps: 'No steps listed.',
  noVerifiedAllergens: 'No verified allergen tags.',
  openSubRecipe: 'Open',
  allergenWarning:
    'Allergen information on this recipe has not been fully verified. Do not answer guest allergen questions from it — ask a chef.',
}

const ES_STRINGS: ReaderStrings = {
  ingredients: readerEs.ingredients,
  method: readerEs.method,
  allergens: readerEs.allergens,
  dietary: readerEs.dietary,
  yield: readerEs.yield,
  prep: readerEs.prep,
  cook: readerEs.cook,
  live: readerEs.live,
  noIngredients: readerEs.noIngredients,
  noSteps: readerEs.noSteps,
  noVerifiedAllergens: readerEs.noVerifiedAllergens,
  openSubRecipe: readerEs.openSubRecipe,
  allergenWarning: readerEs.allergenWarning,
}

/** One ingredient row, already localised for display. */
interface DisplayLine {
  name: string
  note: string | null
  quantityLabel: string
  kind: 'item' | 'recipe'
  recipeId: string | null
}

/**
 * Everything the presentation below needs, in one language. Built from the
 * source content alone (EN) or the source plus an approved translation (ES) —
 * numbers always come from the source either way.
 */
interface DisplayModel {
  name: string
  description: string
  lines: DisplayLine[]
  steps: string[]
  allergenLabels: string[]
  dietaryLabels: string[]
  t: ReaderStrings
  aiAssisted: boolean
  /**
   * SAFETY: the Spanish on screen was machine-written and auto-published —
   * nobody read it. Staff are told, in Spanish, before they act on it.
   */
  aiUnreviewed: boolean
}

function buildDisplay(
  name: string,
  content: RecipeContentView,
  translation: RecipeTranslationView | null
): DisplayModel {
  const es = translation != null
  const approvedAllergens = content.allergens.filter((tag) => tag.status === 'approved')
  return {
    name: es ? translation.payload.name : name,
    description: es
      ? translation.payload.description || content.description
      : content.description,
    lines: content.ingredients.map((line, index) => {
      const translated = es ? translation.payload.ingredients[index] : null
      return {
        name: translated?.name ?? line.name,
        note: es ? (translated?.note ?? line.note) : line.note,
        quantityLabel: `${line.quantity.amount} ${
          es ? unitEs[line.quantity.unit] : line.quantity.unit
        }`,
        kind: line.kind,
        recipeId: line.recipeId,
      }
    }),
    steps: es ? translation.payload.steps : content.steps,
    allergenLabels: approvedAllergens.map((tag) =>
      es ? allergenEs[tag.allergen] : tag.allergen.replace('_', ' ')
    ),
    dietaryLabels: content.dietary.map((tag) => (es ? dietaryEs[tag] : tag.replace('_', ' '))),
    t: es ? ES_STRINGS : EN_STRINGS,
    aiAssisted: es,
    aiUnreviewed: es && translation.autoApproved,
  }
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

function Ingredients({ display }: { display: DisplayModel }) {
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
      <h2 className="mb-3 text-lg font-semibold text-steel-900">{display.t.ingredients}</h2>
      {display.lines.length === 0 ? (
        <p className="text-salt-500">{display.t.noIngredients}</p>
      ) : (
        <ul className="divide-y divide-salt-100 overflow-hidden rounded-xl ring-1 ring-salt-200">
          {display.lines.map((line, index) => {
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
                    {line.quantityLabel}
                  </span>
                  <span className={`text-base text-steel-900 ${done ? 'line-through' : ''}`}>
                    {line.name}
                  </span>
                  {line.note && <span className="text-sm text-salt-500 italic">{line.note}</span>}
                </button>
                {line.kind === 'recipe' && line.recipeId && (
                  <a
                    href={`/reader/recipes/${line.recipeId}`}
                    aria-label={`${display.t.openSubRecipe}: ${line.name}`}
                    className="mr-2 flex min-h-touch shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-ember-600 transition-colors hover:bg-ember-50 hover:text-ember-700"
                  >
                    <GitFork className="size-3.5 rotate-90" aria-hidden />
                    {display.t.openSubRecipe}
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

function Method({ display }: { display: DisplayModel }) {
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
      <h2 className="mb-3 text-lg font-semibold text-steel-900">{display.t.method}</h2>
      {display.steps.length === 0 ? (
        <p className="text-salt-500">{display.t.noSteps}</p>
      ) : (
        <ol className="space-y-2">
          {display.steps.map((step, index) => {
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

/**
 * The EN/ES switch, plus what stands in for it when Spanish is not available:
 * a request button for people who can manage the recipe, a quiet "not yet"
 * chip for everyone else.
 */
function LanguageControl({
  recipeId,
  lang,
  onLang,
}: {
  recipeId: string
  lang: Lang
  onLang: (next: Lang) => void
}) {
  const queryClient = useQueryClient()
  const [requestError, setRequestError] = useState<string | null>(null)

  const { data: state } = useQuery({
    queryKey: ['translations', ...recipesScopeKey(), 'reader', recipeId, 'es'],
    queryFn: async () => {
      const result = await getRecipeTranslation(recipeId, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const request = useMutation({
    mutationFn: async () => {
      const result = await machineTranslateRecipe(recipeId, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['translations'] }),
    onError: (err: Error) => setRequestError(err.message),
  })

  if (!state) return null

  const approved =
    state.translation != null &&
    state.translation.status === 'approved' &&
    !state.translation.stale

  if (approved) {
    return (
      <div
        role="group"
        aria-label="Language"
        className="inline-flex items-center gap-1 rounded-xl bg-salt-100 p-1 ring-1 ring-salt-200 ring-inset"
      >
        {(['en', 'es'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={lang === option}
            onClick={() => onLang(option)}
            className={`inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold uppercase transition-all duration-150 ${
              lang === option
                ? 'bg-white text-steel-900 shadow-sm ring-1 ring-salt-300'
                : 'text-salt-600 hover:text-steel-800'
            }`}
          >
            {option === 'es' && <Languages className="size-3.5" aria-hidden />}
            {option}
          </button>
        ))}
      </div>
    )
  }

  // No approved Spanish yet. Reviewers can kick off a translation from here —
  // it lands pending review on the recipe page, never directly on this screen.
  if (state.canManage) {
    const pending =
      state.translation != null &&
      state.translation.status !== 'rejected' &&
      !state.translation.stale
    return (
      <div className="flex flex-col items-end gap-1">
        <WorkingOverlay
          active={request.isPending}
          title="Translating to Spanish"
          messages={TRANSLATING_MESSAGES}
        />
        {pending ? (
          <a
            href={`/recipes/${recipeId}`}
            className="inline-flex min-h-touch items-center gap-1.5 rounded-xl bg-citron-50 px-3.5 py-2 text-sm font-semibold text-citron-700 ring-1 ring-citron-200 transition-colors hover:bg-citron-100"
          >
            <Languages className="size-4" aria-hidden />
            Spanish pending review
          </a>
        ) : state.enabled ? (
          <button
            type="button"
            onClick={() => {
              setRequestError(null)
              request.mutate()
            }}
            disabled={request.isPending}
            className="inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-steel-700 ring-1 ring-salt-300 transition-all hover:bg-salt-50 disabled:opacity-60"
          >
            <Languages className="size-4" aria-hidden />
            {request.isPending ? 'Translating…' : 'Request Spanish'}
          </button>
        ) : null}
        {requestError && <p className="text-xs text-chili-600">{requestError}</p>}
      </div>
    )
  }

  return (
    <span
      title="Español no disponible todavía"
      className="inline-flex items-center gap-1.5 rounded-xl bg-salt-100 px-3.5 py-2 text-sm font-medium text-salt-500 ring-1 ring-salt-200 ring-inset"
    >
      <Languages className="size-4" aria-hidden />
      ES no disponible
    </span>
  )
}

function Reader({ recipeId }: { recipeId: string }) {
  const [lang, setLang] = useState<Lang>('en')

  const { data: recipe, error, isLoading } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'reader', 'detail', recipeId],
    queryFn: async () => {
      const result = await getRecipe(recipeId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const { data: translationState } = useQuery({
    queryKey: ['translations', ...recipesScopeKey(), 'reader', recipeId, 'es'],
    queryFn: async () => {
      const result = await getRecipeTranslation(recipeId, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) {
    // 404 covers everything the server hides: removed, out of scope, or
    // restricted to specific people. Same calm empty state either way.
    if (/not found/i.test(error.message)) {
      return (
        <div className="mx-auto max-w-3xl">
          <EmptyState
            icon={BookOpen}
            title="This recipe isn’t available"
            hint="It may be restricted to specific people or no longer on the shelf. Ask a chef or manager if you think you should have access."
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
    return <ErrorNote>{error.message}</ErrorNote>
  }
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

  // SAFETY: only an approved, current, correctly aligned translation may
  // render — for every role. The server already narrows what staff receive;
  // this repeats the check for reviewers, whose response carries drafts too.
  const translation = translationState?.translation ?? null
  const usableTranslation =
    translation != null &&
    translation.status === 'approved' &&
    !translation.stale &&
    translation.payload.ingredients.length === content.ingredients.length &&
    translation.payload.steps.length === content.steps.length
      ? translation
      : null

  const display = buildDisplay(
    recipe.name,
    content,
    lang === 'es' && usableTranslation ? usableTranslation : null
  )
  const heroPhoto = content.photos[0]?.url ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-6 tablet:space-y-8">
      <header className="animate-fade-up relative overflow-hidden rounded-3xl border border-salt-200 bg-white/95 p-5 shadow-sm tablet:p-8">
        {heroPhoto && (
          <>
            <div
              aria-hidden
              className="absolute inset-0 bg-cover bg-center opacity-15"
              style={{ backgroundImage: `url(${heroPhoto})` }}
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-linear-to-b from-white/80 via-white/92 to-white"
            />
          </>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 right-[-3rem] size-48 rounded-full bg-ember-100/55 blur-3xl"
        />
        <div className="relative space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href="/reader"
            className="inline-flex min-h-touch items-center gap-1.5 text-sm font-semibold text-salt-600 transition-colors hover:text-steel-900"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Reader
          </a>
          <LanguageControl recipeId={recipeId} lang={lang} onLang={setLang} />
        </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold tracking-[0.18em] text-ember-700 uppercase">
              Active recipe
            </p>
            <span className="rounded-full bg-steel-900 px-2.5 py-1 font-mono text-2xs font-semibold text-salt-50">
              v{recipe.activeVersion} {display.t.live}
            </span>
            {display.aiAssisted && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 ring-inset ${
                  display.aiUnreviewed
                    ? 'bg-citron-50 text-citron-700 ring-citron-200'
                    : 'bg-steel-50 text-steel-600 ring-steel-200'
                }`}
              >
                <Bot className="size-3" aria-hidden />
                {display.aiUnreviewed ? readerEs.aiUnreviewed : readerEs.aiAssisted}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-steel-900 tablet:text-5xl">
            {display.name}
          </h1>
          {display.description && (
            <p className="max-w-3xl text-sm leading-relaxed text-salt-700 tablet:text-base">
              {display.description}
            </p>
          )}
        </div>
      </header>

      {display.aiUnreviewed && (
        <p className="flex items-start gap-2.5 rounded-2xl bg-citron-50 px-4 py-3.5 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{readerEs.unreviewedWarning}</span>
        </p>
      )}

      {!recipe.allergensVerified && (
        <p className="flex items-start gap-2.5 rounded-2xl bg-citron-50 px-4 py-3.5 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{display.t.allergenWarning}</span>
        </p>
      )}

      <div className={`${cardClass} animate-fade-up fade-delay-1 space-y-8 rounded-3xl p-5 tablet:p-9`}>
        <div className="grid gap-3 phablet:grid-cols-3 tablet:gap-4">
          <StatTile
            icon={Scale}
            label={display.t.yield}
            value={`${content.yield.amount} ${
              display.aiAssisted ? unitEs[content.yield.unit] : content.yield.unit
            }`}
          />
          {content.times?.prepMinutes != null && (
            <StatTile icon={Timer} label={display.t.prep} value={`${content.times.prepMinutes} min`} />
          )}
          {content.times?.cookMinutes != null && (
            <StatTile icon={Flame} label={display.t.cook} value={`${content.times.cookMinutes} min`} />
          )}
        </div>

        <Ingredients display={display} />
        <Method display={display} />

        <section className="grid gap-5 tablet:grid-cols-2">
          <div className="rounded-2xl bg-salt-50 p-4 ring-1 ring-salt-200 ring-inset">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
              {display.t.allergens}
            </h2>
            {display.allergenLabels.length === 0 ? (
              <p className="text-sm text-salt-500">{display.t.noVerifiedAllergens}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {display.allergenLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full bg-chili-50 px-3 py-1.5 text-sm font-semibold text-chili-700 ring-1 ring-chili-200 ring-inset"
                  >
                    <ShieldCheck className="size-4" aria-hidden />
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {display.dietaryLabels.length > 0 && (
            <div className="rounded-2xl bg-salt-50 p-4 ring-1 ring-salt-200 ring-inset">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
                {display.t.dietary}
              </h2>
              <div className="flex flex-wrap gap-2">
                {display.dietaryLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full bg-basil-50 px-3 py-1.5 text-sm font-semibold text-basil-700 ring-1 ring-basil-200 ring-inset"
                  >
                    <Leaf className="size-4" aria-hidden />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <PlatingGallery photos={content.photos} recipeName={display.name} />
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
