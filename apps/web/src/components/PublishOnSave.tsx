import { useEffect, useState } from 'react'
import type { RecipePublishMode } from '@rit/shared'
import { Rocket, ShieldCheck } from 'lucide-react'
import { Switch } from './ui'

/**
 * The "Publish on save" control, shared by the editor and the AI draft review.
 *
 * Both places are the same moment in the workflow — a chef looking at a recipe
 * that has never been live, deciding whether it is ready for the line — so they
 * get the same control and the same words rather than two dialects of one idea.
 *
 * SAFETY: the allergen sign-off is a *second*, separate tick. Publishing and
 * signing off are different claims — "staff can cook this" and "I have checked
 * what is in it" — and one switch must never be read as making both. Nothing
 * here approves a tag on its own; the server stamps the chef's id only when
 * this tick is sent, exactly as the standalone Approve allergens button does.
 */

const STORAGE_KEY = 'rit:publish-on-save'

/**
 * Remembers the publish switch across recipes, per browser.
 *
 * A kitchen typing in its whole book flips this once, not two hundred times —
 * that repetition is the friction this feature exists to remove. The allergen
 * tick deliberately does NOT persist: it is a claim about one specific dish,
 * and a remembered signature is a forged one.
 *
 * Reads storage in an effect rather than during render — these are Astro
 * islands, server-rendered before hydration, where `window` does not exist.
 */
export function usePublishOnSave(available: boolean): [boolean, (next: boolean) => void] {
  const [publish, setPublish] = useState(false)

  useEffect(() => {
    if (!available) return
    try {
      setPublish(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // Private browsing, storage disabled — the default (off) is the safe one.
    }
  }, [available])

  return [
    publish && available,
    (next: boolean) => {
      setPublish(next)
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        // Not remembering the choice is a papercut, not an error worth showing.
      }
    },
  ]
}

/** Whether this recipe can take the shortcut at all. */
export function canPublishOnSave(
  mode: RecipePublishMode,
  activeVersionId: string | null
): boolean {
  // A lineage staff already cook from changes the deliberate way, whatever the
  // setting says — the server enforces this too.
  return mode !== 'manual' && activeVersionId == null
}

export function PublishOnSaveControls({
  mode,
  publish,
  onPublishChange,
  signOff,
  onSignOffChange,
  allergenCount,
  disabled = false,
  idPrefix,
}: {
  mode: RecipePublishMode
  publish: boolean
  onPublishChange: (next: boolean) => void
  signOff: boolean
  onSignOffChange: (next: boolean) => void
  /** Tags currently on the recipe — the tick's wording depends on having any. */
  allergenCount: number
  disabled?: boolean
  /** Both controls can appear several times on the drafting page. */
  idPrefix: string
}) {
  const signOffRequired = mode === 'publish_on_save_verified'

  return (
    <div className="space-y-3">
      <Switch
        id={`${idPrefix}-publish`}
        checked={publish}
        onChange={onPublishChange}
        disabled={disabled}
        label={
          <span className="inline-flex items-center gap-1.5">
            <Rocket className="size-4 text-ember-600" aria-hidden />
            Publish on save
          </span>
        }
        hint="Staff can cook from this as soon as you save. Later changes go through versions as usual."
      />

      {publish && (
        <div className="animate-fade-up rounded-xl bg-salt-50 p-3.5 ring-1 ring-salt-200 ring-inset">
          <Switch
            id={`${idPrefix}-signoff`}
            checked={signOff}
            onChange={onSignOffChange}
            disabled={disabled}
            label={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <ShieldCheck className="size-4 text-basil-600" aria-hidden />
                {allergenCount > 0
                  ? `I have verified these ${allergenCount} allergen ${allergenCount === 1 ? 'tag' : 'tags'}`
                  : 'I have checked the allergens on this recipe'}
                {signOffRequired && (
                  <span className="rounded-full bg-citron-100 px-2 py-0.5 text-2xs font-semibold tracking-wide text-citron-700 uppercase">
                    Required
                  </span>
                )}
              </span>
            }
            hint={
              allergenCount > 0
                ? 'Signs the tags off in your name. Without this, staff see the recipe with no allergen tags and an “unverified” warning.'
                : 'No tags means no verified allergens — staff still see the “unverified” warning, because an absent tag is not a claim of safety.'
            }
          />
        </div>
      )}
    </div>
  )
}
