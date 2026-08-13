import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Allergen, Dietary, IngredientLineInput, MediaAssetView, Unit } from '@rit/shared'
import { allergenValues, dietaryValues } from '@rit/shared'
import {
  ArrowDown,
  ArrowUp,
  Carrot,
  Check,
  FileText,
  Leaf,
  ListOrdered,
  Plus,
  Rocket,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { getRecipe, listRecipes, publishRecipe, recipesScopeKey, updateRecipe } from '../api/recipes'
import { PlatingPhotoPicker } from './PlatingPhotoPicker'
import { QueryProvider } from './QueryProvider'
import { canPublishOnSave, PublishOnSaveControls, usePublishOnSave } from './PublishOnSave'
import { UnitSelect } from './RecipesTable'
import {
  Badge,
  ErrorNote,
  SectionCard,
  Segmented,
  Skeleton,
  TogglePill,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from './ui'

interface IngredientRow {
  kind: 'item' | 'recipe'
  name: string
  recipeId: string
  amount: string
  unit: Unit
  note: string
}

interface FormState {
  name: string
  description: string
  yieldAmount: string
  yieldUnit: Unit
  ingredients: IngredientRow[]
  steps: string[]
  allergens: Allergen[]
  dietary: Dietary[]
  /** Full assets, not just ids, so the grid can render without a second fetch. */
  photos: MediaAssetView[]
  prepMinutes: string
  cookMinutes: string
}

function Editor({ recipeId }: { recipeId: string }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: recipe, error: loadError } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'detail', recipeId],
    queryFn: async () => {
      const result = await getRecipe(recipeId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  // Sub-recipe options for `recipe`-kind ingredient lines. A searchable
  // combobox is a v2 nicety; 100 covers a realistic org's recipe book.
  const { data: recipeOptions } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'list', { forPicker: true }],
    queryFn: async () => {
      const result = await listRecipes({ limit: 100 })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  useEffect(() => {
    if (!recipe || form !== null) return
    const wc = recipe.workingCopy
    if (!wc) return
    setForm({
      name: recipe.name,
      description: wc.description,
      yieldAmount: String(wc.yield.amount),
      yieldUnit: wc.yield.unit,
      ingredients: wc.ingredients.map((line) => ({
        kind: line.kind,
        name: line.kind === 'item' ? line.name : '',
        recipeId: line.recipeId ?? '',
        amount: String(line.quantity.amount),
        unit: line.quantity.unit,
        note: line.note ?? '',
      })),
      steps: [...wc.steps],
      allergens: wc.allergens.map((t) => t.allergen),
      dietary: [...wc.dietary],
      photos: [...wc.photos],
      prepMinutes: wc.times?.prepMinutes != null ? String(wc.times.prepMinutes) : '',
      cookMinutes: wc.times?.cookMinutes != null ? String(wc.times.cookMinutes) : '',
    })
  }, [recipe, form])

  /**
   * The one-save shortcut, offered only where the server would accept it: a
   * lineage nobody has ever cooked from, in a scope whose `recipePublishMode`
   * allows it. `publishMode` is resolved server-side from the *recipe's* scope,
   * so this cannot disagree with what the publish call will do.
   */
  const shortcutAvailable =
    recipe != null &&
    recipe.canManage &&
    recipe.status !== 'archived' &&
    canPublishOnSave(recipe.publishMode, recipe.activeVersionId)
  const [publishOnSave, setPublishOnSave] = usePublishOnSave(shortcutAvailable)
  // Not remembered between recipes, unlike the switch above: this is a claim
  // about one dish's allergens, and it must be made again for the next one.
  const [signOff, setSignOff] = useState(false)

  const save = useMutation({
    mutationFn: async (state: FormState) => {
      const ingredients: IngredientLineInput[] = state.ingredients.map((row) =>
        row.kind === 'item'
          ? {
              kind: 'item',
              name: row.name,
              quantity: { amount: Number(row.amount), unit: row.unit },
              ...(row.note ? { note: row.note } : {}),
            }
          : {
              kind: 'recipe',
              recipeId: row.recipeId,
              quantity: { amount: Number(row.amount), unit: row.unit },
              ...(row.note ? { note: row.note } : {}),
            }
      )
      const times =
        state.prepMinutes || state.cookMinutes
          ? {
              ...(state.prepMinutes ? { prepMinutes: Number(state.prepMinutes) } : {}),
              ...(state.cookMinutes ? { cookMinutes: Number(state.cookMinutes) } : {}),
            }
          : undefined
      const result = await updateRecipe(recipeId, {
        name: state.name,
        content: {
          description: state.description,
          yield: { amount: Number(state.yieldAmount), unit: state.yieldUnit },
          ingredients,
          steps: state.steps.filter((s) => s.trim().length > 0),
          allergens: state.allergens,
          dietary: state.dietary,
          photoIds: state.photos.map((photo) => photo._id),
          ...(times ? { times } : {}),
        },
      })
      if (result.error) throw new Error(result.error.message)
      if (!publishOnSave) return result.data

      // Two calls, deliberately in this order: the content is saved before
      // anything is published, so a failure here leaves a saved draft rather
      // than a live recipe missing the edit. The message says as much — the
      // chef's work is not lost and the recipe is simply not live yet.
      const published = await publishRecipe(recipeId, { approveAllergens: signOff })
      if (published.error) {
        throw new Error(`Your changes were saved, but publishing failed: ${published.error.message}`)
      }
      return published.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      window.location.href = `/recipes/${recipeId}`
    },
    onError: (err: Error) => setError(err.message),
  })

  if (loadError) return <ErrorNote>{loadError.message}</ErrorNote>
  if (!recipe || !form)
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  if (!recipe.workingCopy) return <ErrorNote>You do not have access to edit this recipe.</ErrorNote>

  const patch = (update: Partial<FormState>) => setForm({ ...form, ...update })
  const patchRow = (index: number, update: Partial<IngredientRow>) =>
    patch({
      ingredients: form.ingredients.map((row, i) => (i === index ? { ...row, ...update } : row)),
    })
  const moveStep = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= form.steps.length) return
    const steps = [...form.steps]
    ;[steps[index], steps[target]] = [steps[target], steps[index]]
    patch({ steps })
  }
  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  const priorTagStatus = new Map(recipe.workingCopy.allergens.map((t) => [t.allergen, t.status]))

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!form) return
    if (!(Number(form.yieldAmount) > 0)) {
      setError('Yield must be a positive number')
      return
    }
    const badLine = form.ingredients.findIndex(
      (row) =>
        !(Number(row.amount) > 0) ||
        (row.kind === 'item' ? row.name.trim().length === 0 : row.recipeId === '')
    )
    if (badLine !== -1) {
      setError(
        `Ingredient ${badLine + 1} needs a ${form.ingredients[badLine].kind === 'item' ? 'name' : 'recipe'} and a positive amount`
      )
      return
    }
    // The server refuses this too; catching it here keeps the chef's work on
    // screen instead of saving the content and failing on the publish call.
    if (publishOnSave && recipe?.publishMode === 'publish_on_save_verified' && !signOff) {
      setError('Verify the allergen tags before publishing, or turn off “Publish on save”.')
      return
    }
    save.mutate(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-24">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-steel-900">Edit recipe</h1>
        {recipe.status === 'archived' && <Badge value="archived" />}
      </header>
      {recipe.status === 'archived' && (
        <ErrorNote>This recipe is archived and read-only. Unarchive it to edit.</ErrorNote>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      <SectionCard icon={FileText} title="Basics" hint="Name, yield, timing and description.">
        <div className="grid gap-4 tablet:grid-cols-3">
          <div className="tablet:col-span-2">
            <label htmlFor="edit-name" className="mb-1.5 block text-sm font-medium text-steel-700">
              Name
            </label>
            <input
              id="edit-name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
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
                value={form.yieldAmount}
                onChange={(e) => patch({ yieldAmount: e.target.value })}
                className={`${inputClass} font-mono`}
              />
              <UnitSelect
                ariaLabel="Yield unit"
                value={form.yieldUnit}
                onChange={(unit) => patch({ yieldUnit: unit })}
              />
            </div>
          </div>
          <div className="tablet:col-span-3">
            <label
              htmlFor="edit-description"
              className="mb-1.5 block text-sm font-medium text-steel-700"
            >
              Description
            </label>
            <textarea
              id="edit-description"
              maxLength={2000}
              rows={2}
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="edit-prep" className="mb-1.5 block text-sm font-medium text-steel-700">
              Prep minutes
            </label>
            <input
              id="edit-prep"
              type="number"
              min="0"
              value={form.prepMinutes}
              onChange={(e) => patch({ prepMinutes: e.target.value })}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="edit-cook" className="mb-1.5 block text-sm font-medium text-steel-700">
              Cook minutes
            </label>
            <input
              id="edit-cook"
              type="number"
              min="0"
              value={form.cookMinutes}
              onChange={(e) => patch({ cookMinutes: e.target.value })}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon={Carrot}
        title="Ingredients"
        hint="Raw items, or other recipes used as sub-recipes."
        actions={
          <button
            type="button"
            onClick={() =>
              patch({
                ingredients: [
                  ...form.ingredients,
                  { kind: 'item', name: '', recipeId: '', amount: '1', unit: 'each', note: '' },
                ],
              })
            }
            className={subtleButtonClass}
          >
            <Plus className="size-4" aria-hidden />
            Add
          </button>
        }
      >
        {form.ingredients.length === 0 && (
          <p className="rounded-xl bg-salt-50 px-4 py-6 text-center text-sm text-salt-500 ring-1 ring-salt-200 ring-inset">
            No ingredients yet — add the first one.
          </p>
        )}
        <div className="space-y-3">
          {form.ingredients.map((row, index) => (
            <div
              key={index}
              className="grid items-end gap-2.5 rounded-xl bg-salt-50 p-3.5 ring-1 ring-salt-200 ring-inset tablet:grid-cols-[auto_1fr_5.5rem_6rem_1fr_auto]"
            >
              <div>
                <span className="mb-1.5 block text-xs font-medium text-salt-600">Type</span>
                <Segmented
                  ariaLabel={`Ingredient ${index + 1} type`}
                  value={row.kind}
                  onChange={(kind) => patchRow(index, { kind })}
                  options={[
                    { id: 'item', label: 'Item' },
                    { id: 'recipe', label: 'Recipe' },
                  ]}
                />
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-salt-600">
                  {row.kind === 'item' ? 'Ingredient' : 'Sub-recipe'}
                </span>
                {row.kind === 'item' ? (
                  <input
                    type="text"
                    aria-label={`Ingredient ${index + 1} name`}
                    maxLength={120}
                    placeholder="e.g. Yellow onion"
                    value={row.name}
                    onChange={(e) => patchRow(index, { name: e.target.value })}
                    className={inputClass}
                  />
                ) : (
                  <select
                    aria-label={`Ingredient ${index + 1} sub-recipe`}
                    value={row.recipeId}
                    onChange={(e) => patchRow(index, { recipeId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Choose a recipe…</option>
                    {recipeOptions?.items
                      .filter((r) => r._id !== recipeId)
                      .map((r) => (
                        <option key={r._id} value={r._id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-salt-600">Amount</span>
                <input
                  type="number"
                  aria-label={`Ingredient ${index + 1} amount`}
                  min="0"
                  step="any"
                  value={row.amount}
                  onChange={(e) => patchRow(index, { amount: e.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-salt-600">Unit</span>
                <UnitSelect
                  ariaLabel={`Ingredient ${index + 1} unit`}
                  value={row.unit}
                  onChange={(unit) => patchRow(index, { unit })}
                />
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-salt-600">Note</span>
                <input
                  type="text"
                  aria-label={`Ingredient ${index + 1} note`}
                  maxLength={300}
                  placeholder="e.g. finely diced"
                  value={row.note}
                  onChange={(e) => patchRow(index, { note: e.target.value })}
                  className={inputClass}
                />
              </div>
              <button
                type="button"
                aria-label={`Remove ingredient ${index + 1}`}
                onClick={() =>
                  patch({ ingredients: form.ingredients.filter((_, i) => i !== index) })
                }
                className="flex min-h-touch min-w-touch cursor-pointer items-center justify-center rounded-xl text-salt-500 transition-colors hover:bg-chili-50 hover:text-chili-600"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        icon={ListOrdered}
        title="Method"
        hint="One step per line, in order."
        actions={
          <button
            type="button"
            onClick={() => patch({ steps: [...form.steps, ''] })}
            className={subtleButtonClass}
          >
            <Plus className="size-4" aria-hidden />
            Add step
          </button>
        }
      >
        {form.steps.length === 0 && (
          <p className="rounded-xl bg-salt-50 px-4 py-6 text-center text-sm text-salt-500 ring-1 ring-salt-200 ring-inset">
            No steps yet — write the first one.
          </p>
        )}
        <div className="space-y-3">
          {form.steps.map((step, index) => (
            <div key={index} className="flex items-start gap-3">
              <span className="mt-2.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-steel-900 font-mono text-xs font-semibold text-salt-50">
                {index + 1}
              </span>
              <textarea
                aria-label={`Step ${index + 1}`}
                rows={2}
                maxLength={2000}
                value={step}
                onChange={(e) =>
                  patch({ steps: form.steps.map((s, i) => (i === index ? e.target.value : s)) })
                }
                className={inputClass}
              />
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  aria-label={`Move step ${index + 1} up`}
                  onClick={() => moveStep(index, -1)}
                  disabled={index === 0}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-salt-500 transition-colors hover:bg-salt-100 hover:text-steel-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Move step ${index + 1} down`}
                  onClick={() => moveStep(index, 1)}
                  disabled={index === form.steps.length - 1}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-salt-500 transition-colors hover:bg-salt-100 hover:text-steel-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => patch({ steps: form.steps.filter((_, i) => i !== index) })}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-salt-500 transition-colors hover:bg-chili-50 hover:text-chili-600"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        icon={ShieldAlert}
        title="Allergens"
        hint="Tap to tag. Changing the ingredient list resets verification — every tag returns to pending review until someone signs off again."
      >
        <div className="flex flex-wrap gap-2">
          {allergenValues.map((allergen) => {
            const selected = form.allergens.includes(allergen)
            const status = priorTagStatus.get(allergen)
            return (
              <TogglePill
                key={allergen}
                selected={selected}
                onToggle={() => patch({ allergens: toggle(form.allergens, allergen) })}
                selectedClass="bg-chili-50 text-chili-700 ring-chili-300"
              >
                {selected && <Check className="size-3.5" aria-hidden />}
                {allergen.replace('_', ' ')}
                {selected && (
                  <span
                    className={`text-2xs font-semibold uppercase ${
                      status === 'approved' ? 'text-basil-600' : 'text-citron-600'
                    }`}
                  >
                    {status === 'approved' ? 'verified' : 'pending'}
                  </span>
                )}
              </TogglePill>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard icon={Leaf} title="Dietary" hint="Tap to tag.">
        <div className="flex flex-wrap gap-2">
          {dietaryValues.map((tag) => (
            <TogglePill
              key={tag}
              selected={form.dietary.includes(tag)}
              onToggle={() => patch({ dietary: toggle(form.dietary, tag) })}
              selectedClass="bg-basil-50 text-basil-700 ring-basil-300"
            >
              {form.dietary.includes(tag) && <Check className="size-3.5" aria-hidden />}
              {tag.replace('_', ' ')}
            </TogglePill>
          ))}
        </div>
      </SectionCard>

      <PlatingPhotoPicker
        photos={form.photos}
        onChange={(photos) => patch({ photos })}
        disabled={recipe.status === 'archived'}
      />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-salt-200/80 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] space-y-3 px-4 py-3 tablet:px-6">
          {shortcutAvailable && (
            <PublishOnSaveControls
              idPrefix="editor"
              mode={recipe.publishMode}
              publish={publishOnSave}
              onPublishChange={setPublishOnSave}
              signOff={signOff}
              onSignOffChange={setSignOff}
              allergenCount={form.allergens.length}
              disabled={save.isPending}
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={save.isPending || recipe.status === 'archived'}
              className={primaryButtonClass}
            >
              {publishOnSave ? (
                <Rocket className="size-4" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              {save.isPending
                ? publishOnSave
                  ? 'Publishing…'
                  : 'Saving…'
                : publishOnSave
                  ? 'Save and publish'
                  : 'Save changes'}
            </button>
            <a href={`/recipes/${recipeId}`} className={subtleButtonClass}>
              Cancel
            </a>
            <p className="ml-auto hidden text-xs text-salt-500 tablet:block">
              {publishOnSave
                ? 'Saving mints v1 and puts this in front of staff.'
                : 'Saving updates the working copy only — staff keep seeing the live version.'}
            </p>
          </div>
        </div>
      </div>
    </form>
  )
}

export function RecipeEditor({ recipeId }: { recipeId: string }) {
  return (
    <QueryProvider>
      <Editor recipeId={recipeId} />
    </QueryProvider>
  )
}
