import { useId, useState } from 'react'
import type { MediaAssetView } from '@rit/shared'
import { ChevronDown, Images } from 'lucide-react'

/**
 * Plating photos on a recipe: one large reference shot, with a thumbnail rail
 * when there is more than one.
 *
 * Collapsed by default. Plating sits at the end of the recipe because it is the
 * last thing a chef needs — a cook reads ingredients and method first — so it
 * stays folded away until asked for and the page below the method stays short.
 * The count in the header is what makes it discoverable while closed.
 *
 * Sized for the pass: a cook checks this from arm's length on an iPad, so the
 * active photo gets the room and every control is `min-h-touch` for gloved
 * hands. `width`/`height` come from the asset record so the box is reserved
 * before the bytes arrive and the page never jumps under a finger.
 */
export function PlatingGallery({
  photos,
  recipeName,
}: {
  photos: MediaAssetView[]
  recipeName: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const panelId = useId()

  if (photos.length === 0) return null

  // A photo removed while this was open would leave the index dangling.
  const current = photos[Math.min(active, photos.length - 1)]

  return (
    <section className="overflow-hidden rounded-xl ring-1 ring-salt-200 ring-inset">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-touch w-full cursor-pointer items-center gap-2.5 bg-salt-50 px-4 py-3 text-left transition-colors hover:bg-salt-100"
        >
          <Images className="size-4 shrink-0 text-ember-600" aria-hidden />
          <span className="text-xs font-semibold tracking-wide text-steel-800 uppercase">
            Plating
          </span>
          <span className="text-xs text-salt-500">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
          </span>
          <ChevronDown
            className={`ml-auto size-4 shrink-0 text-salt-500 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden
          />
        </button>
      </h2>

      {open && (
        <div id={panelId} className="animate-fade-up space-y-3 border-t border-salt-200 p-4">
          <figure className="overflow-hidden rounded-xl bg-salt-100 ring-1 ring-salt-200 ring-inset">
            <img
              key={current._id}
              src={current.url}
              alt={`Plating for ${recipeName}${photos.length > 1 ? ` (${active + 1} of ${photos.length})` : ''}`}
              width={current.width ?? undefined}
              height={current.height ?? undefined}
              className="animate-fade-up aspect-4/3 w-full object-cover"
            />
          </figure>

          {photos.length > 1 && (
            <ul className="flex flex-wrap gap-2">
              {photos.map((photo, index) => {
                const selected = photo._id === current._id
                return (
                  <li key={photo._id}>
                    <button
                      type="button"
                      aria-label={`Show plating photo ${index + 1}`}
                      aria-pressed={selected}
                      onClick={() => setActive(index)}
                      className={`block min-h-touch cursor-pointer overflow-hidden rounded-lg ring-2 transition-all duration-150 hover:brightness-105 active:scale-[0.97] ${
                        selected ? 'ring-ember-500' : 'ring-transparent hover:ring-salt-300'
                      }`}
                    >
                      <img
                        src={photo.url}
                        alt=""
                        loading="lazy"
                        className="size-16 object-cover tablet:size-20"
                      />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
