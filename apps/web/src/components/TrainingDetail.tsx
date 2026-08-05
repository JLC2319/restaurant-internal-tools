import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TrainingBlockView, TrainingDetail as TrainingDetailData } from '@rit/shared'
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  Clock,
  Film,
  GraduationCap,
  Layers,
  Pencil,
  Radio,
  RotateCcw,
  Users,
} from 'lucide-react'
import {
  archiveTraining,
  completeTraining,
  getTraining,
  listCompletions,
  publishTraining,
  trainingsScopeKey,
  unarchiveTraining,
  uncompleteTraining,
  unpublishTraining,
} from '../api/trainings'
import { QueryProvider } from './QueryProvider'
import { RichText } from './RichText'
import {
  Badge,
  ErrorNote,
  Skeleton,
  cardClass,
  primaryButtonClass,
  subtleButtonClass,
} from './ui'

/**
 * The training viewer — what staff actually read on the line. Content renders
 * in a single readable column; uploaded video streams from the CDN via range
 * requests (`preload="metadata"`), embeds play inside an iframe whose src is
 * always the server-derived allow-list construction.
 *
 * No `sandbox` on the embed iframes, deliberately: YouTube's player detects a
 * sandboxed context and refuses playback ("Video unavailable"). The security
 * control is upstream — `parseVideoEmbed` rebuilds the src from the extracted
 * video id, so only youtube-nocookie.com/player.vimeo.com ever get framed.
 */

/** Media stretches slightly past the text measure — editorial, not boxed-in. */
const breakoutClass = 'tablet:-mx-6'

function Caption({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <figcaption className="px-4 text-center text-sm leading-relaxed text-salt-500">
      {text}
    </figcaption>
  )
}

function BlockView({ block, index }: { block: TrainingBlockView; index: number }) {
  switch (block.kind) {
    case 'text':
      return <RichText doc={block.doc} />

    case 'image':
      // Asset deleted out from under the module — skip rather than render broken.
      if (!block.media) return null
      return (
        <figure className={`space-y-3 ${breakoutClass}`}>
          <img
            src={block.media.url}
            alt={block.caption ?? `Training illustration ${index + 1}`}
            width={block.media.width ?? undefined}
            height={block.media.height ?? undefined}
            loading="lazy"
            className="w-full rounded-2xl bg-salt-100 shadow-sm ring-1 ring-salt-200"
          />
          <Caption text={block.caption} />
        </figure>
      )

    case 'video':
      if (!block.media) return null
      return (
        <figure className={`space-y-3 ${breakoutClass}`}>
          {/* preload="metadata" + playsInline: fetch the header only, then
              range-stream from the CDN as playback progresses — kitchen wifi
              never downloads a video nobody pressed play on. */}
          <video
            src={block.media.url}
            controls
            preload="metadata"
            playsInline
            className="w-full rounded-2xl bg-steel-900 shadow-lg shadow-steel-900/10 ring-1 ring-salt-200"
          />
          <Caption text={block.caption} />
        </figure>
      )

    case 'embed':
      return (
        <figure className={`space-y-3 ${breakoutClass}`}>
          <iframe
            src={block.embedSrc}
            title={block.caption ?? `Embedded video ${index + 1}`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="aspect-video w-full rounded-2xl bg-steel-900 shadow-lg shadow-steel-900/10 ring-1 ring-salt-200"
          />
          <Caption text={block.caption} />
        </figure>
      )
  }
}

function CompletionsPanel({ trainingId }: { trainingId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'completions', trainingId],
    queryFn: async () => {
      const result = await listCompletions(trainingId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (isLoading) return <Skeleton className="h-20" />
  if (error) return <ErrorNote>{error.message}</ErrorNote>
  if (!data || data.length === 0)
    return <p className="py-3 text-sm text-salt-600">No one has completed this training yet.</p>

  return (
    <ul className="divide-y divide-salt-200">
      {data.map((row) => (
        <li key={`${row.userId}-${row.locationId ?? 'org'}`} className="flex items-center gap-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-basil-50 text-basil-600 ring-1 ring-basil-200 ring-inset">
            <CheckCircle2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-steel-900">
              {row.name ? `${row.name.first} ${row.name.last}` : (row.email ?? 'Former member')}
            </p>
          </div>
          <time className="shrink-0 text-xs text-salt-500" dateTime={row.completedAt}>
            {new Date(row.completedAt).toLocaleDateString()}
          </time>
        </li>
      ))}
    </ul>
  )
}

function CompletionCard({ training }: { training: TrainingDetailData }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const done = training.myCompletion != null

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['trainings'] })

  const complete = useMutation({
    mutationFn: async () => {
      const result = await completeTraining(training._id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  })

  const uncomplete = useMutation({
    mutationFn: async () => {
      const result = await uncompleteTraining(training._id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  })

  if (training.status !== 'published') return null

  return (
    <section
      className={`animate-fade-up rounded-2xl p-6 ring-1 transition-colors tablet:p-8 ${
        done ? 'bg-basil-50 ring-basil-200' : 'bg-white shadow-sm ring-salt-200'
      }`}
    >
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {done ? (
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-basil-500 text-white shadow-md shadow-basil-500/30">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-basil-800">Training complete</p>
            <p className="text-sm text-basil-700">
              You finished this on {new Date(training.myCompletion!).toLocaleDateString()}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => uncomplete.mutate()}
            disabled={uncomplete.isPending}
            className="inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-basil-700 transition-colors hover:bg-basil-100 disabled:opacity-60"
          >
            <RotateCcw className="size-4" aria-hidden />
            Undo
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset">
            <GraduationCap className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-steel-900">Done reading?</p>
            <p className="text-sm text-salt-600">
              Mark it complete so your manager knows you are up to speed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => complete.mutate()}
            disabled={complete.isPending}
            className={primaryButtonClass}
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {complete.isPending ? 'Saving…' : 'Mark complete'}
          </button>
        </div>
      )}
    </section>
  )
}

function ManagePanel({ training }: { training: TrainingDetailData }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [showRoster, setShowRoster] = useState(false)

  // A hook, called unconditionally three times below — same order every render.
  const useAction = (fn: () => ReturnType<typeof publishTraining>) =>
    useMutation({
      mutationFn: async () => {
        const result = await fn()
        if (result.error) throw new Error(result.error.message)
        return result.data
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainings'] }),
      onError: (err: Error) => setError(err.message),
    })

  const publish = useAction(() => publishTraining(training._id))
  const unpublish = useAction(() => unpublishTraining(training._id))
  const unarchive = useAction(() => unarchiveTraining(training._id))

  const archive = useMutation({
    mutationFn: async () => {
      const result = await archiveTraining(training._id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainings'] }),
    onError: (err: Error) => setError(err.message),
  })

  const busy =
    publish.isPending || unpublish.isPending || archive.isPending || unarchive.isPending

  return (
    <section className={`${cardClass} space-y-4 p-5`}>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-center gap-2">
        {training.status !== 'archived' && (
          <a href={`/training/${training._id}/edit`} className={subtleButtonClass}>
            <Pencil className="size-4" aria-hidden />
            Edit content
          </a>
        )}

        {training.status === 'draft' && (
          <button
            type="button"
            onClick={() => publish.mutate()}
            disabled={busy || training.blockCount === 0}
            className={primaryButtonClass}
            title={training.blockCount === 0 ? 'Add content before publishing' : undefined}
          >
            <Radio className="size-4" aria-hidden />
            {publish.isPending ? 'Publishing…' : 'Publish to staff'}
          </button>
        )}
        {training.status === 'published' && (
          <button
            type="button"
            onClick={() => unpublish.mutate()}
            disabled={busy}
            className={subtleButtonClass}
          >
            <RotateCcw className="size-4" aria-hidden />
            {unpublish.isPending ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}

        {training.status === 'archived' ? (
          <button
            type="button"
            onClick={() => unarchive.mutate()}
            disabled={busy}
            className={subtleButtonClass}
          >
            <ArchiveRestore className="size-4" aria-hidden />
            {unarchive.isPending ? 'Restoring…' : 'Unarchive'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Archive this training? Staff will no longer see it.')) {
                archive.mutate()
              }
            }}
            disabled={busy}
            className={`${subtleButtonClass} ml-auto`}
          >
            <Archive className="size-4" aria-hidden />
            {archive.isPending ? 'Archiving…' : 'Archive'}
          </button>
        )}
      </div>

      {training.completedCount != null && (
        <div className="border-t border-salt-200 pt-4">
          <button
            type="button"
            onClick={() => setShowRoster((v) => !v)}
            aria-expanded={showRoster}
            className="flex min-h-touch w-full cursor-pointer items-center gap-2 text-left text-sm font-medium text-steel-800 transition-colors hover:text-ember-700"
          >
            <Users className="size-4 text-salt-500" aria-hidden />
            {training.completedCount === 0
              ? 'No completions yet'
              : `Completed by ${training.completedCount} ${training.completedCount === 1 ? 'person' : 'people'}`}
            <ChevronDown
              className={`ml-auto size-4 text-salt-500 transition-transform duration-200 ${showRoster ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
          {showRoster && (
            <div className="animate-fade-up pt-2">
              <CompletionsPanel trainingId={training._id} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Detail({ trainingId }: { trainingId: string }) {
  const { data: training, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'detail', trainingId],
    queryFn: async () => {
      const result = await getTraining(trainingId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) return <ErrorNote>{error.message}</ErrorNote>
  if (isLoading || !training)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    )

  const visibleBlocks = training.blocks.filter(
    (block) => block.kind === 'text' || block.kind === 'embed' || block.media != null
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 tablet:space-y-8">
      <header className="animate-fade-up space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="text-xs font-semibold tracking-widest text-ember-600 uppercase">
            Training module
          </p>
          {(training.canManage || training.status !== 'published') && (
            <Badge value={training.status} />
          )}
          {training.myCompletion != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-basil-50 px-2.5 py-1 text-2xs font-semibold tracking-wide text-basil-700 uppercase ring-1 ring-basil-200 ring-inset">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Completed
            </span>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-steel-900">{training.title}</h1>
        {training.description && (
          <p className="max-w-2xl text-salt-600">{training.description}</p>
        )}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-salt-500">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="size-3.5" aria-hidden />
            {visibleBlocks.length} {visibleBlocks.length === 1 ? 'section' : 'sections'}
          </span>
          {training.videoCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Film className="size-3.5" aria-hidden />
              {training.videoCount} {training.videoCount === 1 ? 'video' : 'videos'}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            Updated {new Date(training.modifiedAt).toLocaleDateString()}
          </span>
        </p>
      </header>

      {training.canManage && <ManagePanel training={training} />}

      {visibleBlocks.length === 0 ? (
        <p className="rounded-2xl bg-salt-50 px-4 py-12 text-center text-sm text-salt-500 ring-1 ring-salt-200 ring-inset">
          This training has no content yet.
        </p>
      ) : (
        <article
          className={`${cardClass} animate-fade-up fade-delay-1 space-y-8 p-5 phablet:p-7 tablet:space-y-10 tablet:p-12`}
        >
          {visibleBlocks.map((block, index) => (
            <BlockView key={index} block={block} index={index} />
          ))}
        </article>
      )}

      <CompletionCard training={training} />
    </div>
  )
}

export function TrainingDetail({ trainingId }: { trainingId: string }) {
  return (
    <QueryProvider>
      <Detail trainingId={trainingId} />
    </QueryProvider>
  )
}
