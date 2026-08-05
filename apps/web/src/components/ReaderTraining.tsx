import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Clock, Film, GraduationCap, Layers } from 'lucide-react'
import { getTraining, trainingsScopeKey } from '../api/trainings'
import { BlockView, CompletionCard } from './TrainingDetail'
import { QueryProvider } from './QueryProvider'
import { EmptyState, ErrorNote, Skeleton, cardClass } from './ui'

/**
 * A training module as the line reads it. Same block renderer as the main
 * viewer, but with the reader's guarantee: anything short of `published`
 * renders as unavailable, even for the chef who wrote it — this surface only
 * ever shows what staff are meant to see. Marking complete works from here,
 * because the iPad on the line is exactly where people finish a module.
 */
function Reader({ trainingId }: { trainingId: string }) {
  const { data: training, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'reader', 'detail', trainingId],
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

  if (training.status !== 'published') {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={GraduationCap}
          title="Not available in the reader"
          hint="This training is not published. It appears here the moment it is."
          action={
            <a
              href="/reader"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ember-600 transition-colors hover:text-ember-700"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to the reader
            </a>
          }
        />
      </div>
    )
  }

  const visibleBlocks = training.blocks.filter(
    (block) => block.kind === 'text' || block.kind === 'embed' || block.media != null
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 tablet:space-y-8">
      <header className="animate-fade-up space-y-3">
        <a
          href="/reader"
          className="inline-flex min-h-touch items-center gap-1.5 text-sm font-semibold text-salt-600 transition-colors hover:text-steel-900"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Reader
        </a>
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="text-xs font-semibold tracking-widest text-ember-600 uppercase">
            Training module
          </p>
          {training.myCompletion != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-basil-50 px-2.5 py-1 text-2xs font-semibold tracking-wide text-basil-700 uppercase ring-1 ring-basil-200 ring-inset">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Completed
            </span>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-steel-900 tablet:text-4xl">
          {training.title}
        </h1>
        {training.description && (
          <p className="max-w-2xl leading-relaxed text-salt-600">{training.description}</p>
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

export function ReaderTraining({ trainingId }: { trainingId: string }) {
  return (
    <QueryProvider>
      <Reader trainingId={trainingId} />
    </QueryProvider>
  )
}
