import { useRef, useState } from 'react'
import type { MediaAssetView } from '@rit/shared'
import { MAX_PHOTO_BYTES, MAX_RECIPE_PHOTOS, imageMimeValues } from '@rit/shared'
import { ArrowLeft, ArrowRight, ImagePlus, Images, Loader2, Star, Trash2 } from 'lucide-react'
import { uploadPhoto } from '../api/media'
import { ErrorNote, SectionCard, subtleButtonClass } from './ui'

/**
 * Plating photos for the recipe editor.
 *
 * Uploads land immediately (they are their own asset), but attaching one to the
 * recipe is part of the working-copy save like any other content change — so
 * this only ever edits local form state, and "Save changes" is what commits it.
 *
 * Order is meaning here: index 0 is the hero shot the recipe list and the
 * reader's header use, which is why reordering is explicit rather than an
 * upload-time accident.
 */

const ACCEPT = imageMimeValues.join(',')
const MAX_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024))

/** Client-side pre-check. The server re-decides from the bytes — this is only
 * so a chef learns about a 40MB RAW file before uploading it over kitchen wifi. */
function rejectionReason(file: File): string | null {
  if (file.size > MAX_PHOTO_BYTES) {
    return `“${file.name}” is larger than ${MAX_MB}MB.`
  }
  // An empty type is normal on some Android pickers — let the server decide.
  if (file.type && !imageMimeValues.includes(file.type as (typeof imageMimeValues)[number])) {
    return `“${file.name}” is not a JPEG, PNG or WebP image.`
  }
  return null
}

export function PlatingPhotoPicker({
  photos,
  onChange,
  disabled = false,
}: {
  photos: MediaAssetView[]
  onChange: (next: MediaAssetView[]) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const remaining = MAX_RECIPE_PHOTOS - photos.length
  const full = remaining <= 0

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setError(null)

    const chosen = [...fileList]
    if (chosen.length > remaining) {
      setError(
        `Only ${remaining} more photo${remaining === 1 ? '' : 's'} will fit on this recipe — the rest were skipped.`
      )
    }

    // Sequential rather than parallel: the upload limiter is per-IP and a whole
    // kitchen shares one, so a burst of eight is worth spending a second on.
    const accepted: MediaAssetView[] = []
    for (const file of chosen.slice(0, Math.max(remaining, 0))) {
      const reason = rejectionReason(file)
      if (reason) {
        setError(reason)
        continue
      }
      setUploading((n) => n + 1)
      const result = await uploadPhoto(file)
      setUploading((n) => n - 1)

      if (result.error) {
        setError(result.error.message)
        break
      }
      accepted.push(result.data)
    }

    if (accepted.length > 0) onChange([...photos, ...accepted])
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= photos.length) return
    const next = [...photos]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <SectionCard
      icon={Images}
      title="Plating photos"
      hint="How the dish should look leaving the pass. The first photo is the one staff see first."
      actions={
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            disabled={disabled || full}
            onChange={(e) => {
              void handleFiles(e.target.files)
              // Reset so re-picking the same file still fires a change event.
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || full || uploading > 0}
            className={subtleButtonClass}
          >
            {uploading > 0 ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4" aria-hidden />
            )}
            {uploading > 0 ? 'Uploading…' : 'Add photos'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {photos.length === 0 && uploading === 0 ? (
        <p className="rounded-xl bg-salt-50 px-4 py-8 text-center text-sm text-salt-500 ring-1 ring-salt-200 ring-inset">
          No plating photos yet — add one so the line has a reference to match.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4">
          {photos.map((photo, index) => (
            <li
              key={photo._id}
              className="group animate-fade-up relative overflow-hidden rounded-xl bg-salt-100 ring-1 ring-salt-200 ring-inset"
            >
              <img
                src={photo.url}
                alt={`Plating photo ${index + 1}`}
                width={photo.width ?? undefined}
                height={photo.height ?? undefined}
                loading="lazy"
                className="aspect-4/3 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />

              {index === 0 && (
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-steel-900/80 px-2 py-1 text-2xs font-semibold tracking-wide text-white uppercase backdrop-blur-sm">
                  <Star className="size-3 fill-current" aria-hidden />
                  Hero
                </span>
              )}

              {/* Controls stay visible on touch — hover is not available on the
                  iPads this is used from. */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-linear-to-t from-steel-900/85 to-transparent p-1.5 pt-6">
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move photo ${index + 1} earlier`}
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowLeft className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move photo ${index + 1} later`}
                    onClick={() => move(index, 1)}
                    disabled={disabled || index === photos.length - 1}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowRight className="size-4" aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => onChange(photos.filter((_, i) => i !== index))}
                  disabled={disabled}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-chili-500/80 disabled:opacity-40"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}

          {Array.from({ length: uploading }, (_, i) => (
            <li
              key={`uploading-${i}`}
              className="skeleton flex aspect-4/3 items-center justify-center rounded-xl"
            >
              <Loader2 className="size-5 animate-spin text-salt-500" aria-hidden />
              <span className="sr-only">Uploading photo</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-salt-500">
        JPEG, PNG or WebP, up to {MAX_MB}MB each — {MAX_RECIPE_PHOTOS} photos maximum.
        {photos.length > 0 && ' Photos are saved with the recipe when you save changes.'}
      </p>
    </SectionCard>
  )
}
