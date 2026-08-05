import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  RecipeDetail as RecipeDetailData,
  RecipeTranslationView,
  TranslationPayloadInput,
} from '@rit/shared'
import { Bot, Check, Languages, RefreshCw, Save, ShieldAlert, X } from 'lucide-react'
import {
  approveRecipeTranslation,
  getRecipeTranslation,
  machineTranslateRecipe,
  rejectRecipeTranslation,
  updateRecipeTranslation,
} from '../api/translations'
import { recipesScopeKey } from '../api/recipes'
import { TRANSLATING_MESSAGES, WorkingOverlay } from './WorkingOverlay'
import {
  Badge,
  ErrorNote,
  SectionCard,
  Skeleton,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from './ui'

/**
 * The Spanish review gate, on the recipe page. Machine translation lands here
 * as pending_review; a chef reads it side by side with the live English,
 * optionally edits it, and explicitly approves. Only then does the reader's
 * language toggle light up — and any change to the live source turns it off
 * again until re-approval.
 */

function payloadToDraft(payload: RecipeTranslationView['payload']): TranslationPayloadInput {
  return {
    name: payload.name,
    description: payload.description,
    ingredients: payload.ingredients.map((ing) => ({ name: ing.name, note: ing.note })),
    steps: [...payload.steps],
  }
}

const fieldLabel = 'text-2xs font-semibold tracking-wide text-salt-500 uppercase'
const sourceText = 'text-sm leading-relaxed text-salt-600'
const areaClass = `${inputClass} min-h-0 resize-y py-2 text-sm leading-relaxed`

export function TranslationPanel({ recipe }: { recipe: RecipeDetailData }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<TranslationPayloadInput | null>(null)

  const queryKey = ['translations', ...recipesScopeKey(), recipe._id, 'es']
  const { data: state, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await getRecipeTranslation(recipe._id, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const translation = state?.translation ?? null

  // Reset the editable draft whenever the server document changes.
  useEffect(() => {
    setDraft(translation ? payloadToDraft(translation.payload) : null)
  }, [translation?._id, translation?.modifiedAt])

  const dirty = useMemo(
    () =>
      translation != null &&
      draft != null &&
      JSON.stringify(draft) !== JSON.stringify(payloadToDraft(translation.payload)),
    [draft, translation]
  )

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['translations'] })
  }
  const mutationHandlers = {
    onSuccess: refresh,
    onError: (err: Error) => setError(err.message),
  }

  const translate = useMutation({
    mutationFn: async () => {
      const result = await machineTranslateRecipe(recipe._id, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Nothing to save')
      const cleaned: TranslationPayloadInput = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        ingredients: draft.ingredients.map((ing) => ({
          name: ing.name?.trim() ? ing.name.trim() : null,
          note: ing.note?.trim() ? ing.note.trim() : null,
        })),
        steps: draft.steps.map((step) => step.trim()),
      }
      const result = await updateRecipeTranslation(recipe._id, cleaned, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  const approve = useMutation({
    mutationFn: async () => {
      const result = await approveRecipeTranslation(recipe._id, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  const reject = useMutation({
    mutationFn: async () => {
      const result = await rejectRecipeTranslation(recipe._id, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    ...mutationHandlers,
  })

  const busy = translate.isPending || save.isPending || approve.isPending || reject.isPending

  // Translation follows the live version — nothing to do before one exists.
  if (!recipe.activeVersionId) {
    return (
      <SectionCard
        icon={Languages}
        title="Spanish translation"
        hint="Translation follows the live version staff read. Set a version live first."
      >
        <p className="text-sm text-salt-600">
          Once this recipe has a live version, you can machine-translate it here, review the
          Spanish side by side, and approve it for the reader.
        </p>
      </SectionCard>
    )
  }

  if (isLoading) {
    return (
      <SectionCard icon={Languages} title="Spanish translation">
        <div className="space-y-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-24" />
        </div>
      </SectionCard>
    )
  }

  // The English column mirrors the live snapshot the translation was made from.
  const source = recipe.activeContent
  const aligned =
    translation != null &&
    source != null &&
    translation.payload.ingredients.length === source.ingredients.length &&
    translation.payload.steps.length === source.steps.length
  const editable = translation != null && !translation.stale && aligned

  return (
    <SectionCard
      icon={Languages}
      title="Spanish translation"
      hint="Machine translated, human approved. Staff only ever see the approved version."
      actions={
        translation && (
          <div className="flex flex-wrap items-center gap-2">
            {translation.stale ? (
              <Badge value="unverified" label="stale" />
            ) : (
              <Badge value={translation.status} />
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-steel-50 px-2.5 py-1 text-2xs font-semibold text-steel-600 ring-1 ring-steel-200 ring-inset">
              <Bot className="size-3" aria-hidden />
              {translation.origin === 'machine_edited' ? 'AI + edits' : 'AI'} · from v
              {translation.sourceVersion}
            </span>
          </div>
        )
      }
    >
      <WorkingOverlay
        active={translate.isPending}
        title="Translating to Spanish"
        messages={TRANSLATING_MESSAGES}
      />

      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        {!translation && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-salt-600">
              Translates the live version (v{recipe.activeVersion}) into Spanish for review.
              Nothing reaches staff until you approve it here.
            </p>
            {state?.enabled ? (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  translate.mutate()
                }}
                disabled={busy}
                className={primaryButtonClass}
              >
                <Languages className="size-4" aria-hidden />
                {translate.isPending ? 'Translating…' : 'Translate to Spanish'}
              </button>
            ) : (
              <p className="text-sm text-salt-500 italic">
                Machine translation is not configured on this server.
              </p>
            )}
          </div>
        )}

        {translation && (
          <>
            {translation.stale && (
              <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  The live recipe has changed since this translation was made (it covered v
                  {translation.sourceVersion}). Staff no longer see it. Re-translate, review and
                  approve again.
                </span>
              </p>
            )}
            {!translation.stale && translation.status === 'pending_review' && (
              <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Awaiting review. Read every line — a mistranslated temperature or allergen note
                  is a food-safety incident, not a typo. Approving publishes it to the reader.
                </span>
              </p>
            )}

            {draft && editable && source && (
              <div className="space-y-5">
                <div className="grid gap-3 tablet:grid-cols-2">
                  <div className="space-y-1">
                    <p className={fieldLabel}>Name — English</p>
                    <p className={sourceText}>{recipe.name}</p>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="tr-name" className={fieldLabel}>
                      Español
                    </label>
                    <input
                      id="tr-name"
                      type="text"
                      maxLength={160}
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>

                {(source.description || draft.description) && (
                  <div className="grid gap-3 tablet:grid-cols-2">
                    <div className="space-y-1">
                      <p className={fieldLabel}>Description — English</p>
                      <p className={sourceText}>{source.description || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="tr-desc" className={fieldLabel}>
                        Español
                      </label>
                      <textarea
                        id="tr-desc"
                        rows={3}
                        maxLength={3000}
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        className={areaClass}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className={fieldLabel}>Ingredients</p>
                  <ul className="divide-y divide-salt-100 overflow-hidden rounded-xl ring-1 ring-salt-200">
                    {source.ingredients.map((line, index) => {
                      const ing = draft.ingredients[index]
                      const subRecipe = line.kind === 'recipe'
                      return (
                        <li key={index} className="grid gap-2 bg-white p-3 tablet:grid-cols-2">
                          <div className="flex items-baseline gap-2 text-sm">
                            <span className="shrink-0 rounded-md bg-salt-100 px-2 py-0.5 font-mono text-xs font-semibold text-steel-800">
                              {line.quantity.amount} {line.quantity.unit}
                            </span>
                            <span className="text-steel-900">{line.name}</span>
                            {line.note && <span className="text-salt-500 italic">{line.note}</span>}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              aria-label={`Spanish name for ${line.name}`}
                              maxLength={160}
                              placeholder={subRecipe ? 'Sub-recipe — name stays as-is' : 'Nombre'}
                              disabled={subRecipe}
                              value={ing?.name ?? ''}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  ingredients: draft.ingredients.map((v, i) =>
                                    i === index ? { ...v, name: e.target.value } : v
                                  ),
                                })
                              }
                              className={`${inputClass} py-2 text-sm disabled:bg-salt-50 disabled:text-salt-400`}
                            />
                            {(line.note || ing?.note) && (
                              <input
                                type="text"
                                aria-label={`Spanish note for ${line.name}`}
                                maxLength={400}
                                placeholder="Nota"
                                value={ing?.note ?? ''}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    ingredients: draft.ingredients.map((v, i) =>
                                      i === index ? { ...v, note: e.target.value } : v
                                    ),
                                  })
                                }
                                className={`${inputClass} py-2 text-sm`}
                              />
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>

                <div className="space-y-2">
                  <p className={fieldLabel}>Method</p>
                  <ol className="space-y-2">
                    {source.steps.map((step, index) => (
                      <li key={index} className="grid gap-2 tablet:grid-cols-2">
                        <div className="flex gap-2.5">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-steel-900 font-mono text-2xs font-semibold text-salt-50">
                            {index + 1}
                          </span>
                          <p className={`${sourceText} pt-0.5`}>{step}</p>
                        </div>
                        <textarea
                          aria-label={`Spanish step ${index + 1}`}
                          rows={2}
                          maxLength={3000}
                          value={draft.steps[index] ?? ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              steps: draft.steps.map((v, i) => (i === index ? e.target.value : v)),
                            })
                          }
                          className={areaClass}
                        />
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-salt-100 pt-4">
              {editable && translation.status !== 'approved' && !dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    approve.mutate()
                  }}
                  disabled={busy}
                  className={primaryButtonClass}
                >
                  <Check className="size-4" aria-hidden />
                  {approve.isPending ? 'Approving…' : 'Approve for staff'}
                </button>
              )}
              {dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    save.mutate()
                  }}
                  disabled={busy}
                  className={primaryButtonClass}
                >
                  <Save className="size-4" aria-hidden />
                  {save.isPending ? 'Saving…' : 'Save edits for review'}
                </button>
              )}
              {state?.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    translate.mutate()
                  }}
                  disabled={busy}
                  className={subtleButtonClass}
                >
                  <RefreshCw className="size-4" aria-hidden />
                  {translate.isPending ? 'Translating…' : 'Re-translate'}
                </button>
              )}
              {translation.status !== 'rejected' && !dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    reject.mutate()
                  }}
                  disabled={busy}
                  className={subtleButtonClass}
                >
                  <X className="size-4" aria-hidden />
                  Reject
                </button>
              )}
              {translation.status === 'approved' && !translation.stale && (
                <p className="text-sm text-basil-700">
                  Live in the reader
                  {translation.approvedAt &&
                    ` — approved ${new Date(translation.approvedAt).toLocaleDateString()}`}
                  .
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}
