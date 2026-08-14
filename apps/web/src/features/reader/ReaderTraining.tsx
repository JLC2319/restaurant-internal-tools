import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TrainingBlockView } from '@rit/shared'
import { plainTextToDoc } from '@rit/shared'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  Film,
  GraduationCap,
  Languages,
  Layers,
  ShieldAlert,
} from 'lucide-react'
import { getTraining, trainingsScopeKey } from '@/features/training/api'
import { getTrainingTranslation, machineTranslateTraining } from '@/features/translations/api'
import { TRANSLATING_MESSAGES } from '@/features/translations/messages'
import { readerEs } from '@/features/reader/es'
import { BlockView, CompletionCard } from '@/features/training/TrainingContent'
import { QueryProvider } from '@/lib/QueryProvider'
import { WorkingOverlay } from '@/components/ui/WorkingOverlay'
import { EmptyState, ErrorNote, Skeleton, cardClass } from '@/components/ui'

/**
 * A training module as the line reads it. Same block renderer as the main
 * viewer, but with the reader's guarantee: anything short of `published`
 * renders as unavailable, even for the chef who wrote it — this surface only
 * ever shows what staff are meant to see. Marking complete works from here,
 * because the iPad on the line is exactly where people finish a module.
 *
 * That rule covers language too — same as the recipe reader. The Español
 * toggle appears only when an approved, current translation exists; machine
 * output that nobody signed off never renders here, whoever is holding the
 * iPad. Translated text blocks render as plain paragraphs through the same
 * rich-text renderer (formatting starts fresh in translation); media and
 * embeds always render from the source module, with only captions swapped.
 */

type Lang = 'en' | 'es'

/**
 * The EN/ES switch, plus what stands in for it when Spanish is not available:
 * a request button for people who can manage the training, a quiet "not yet"
 * chip for everyone else.
 */
function LanguageControl({
  trainingId,
  lang,
  onLang,
}: {
  trainingId: string
  lang: Lang
  onLang: (next: Lang) => void
}) {
  const queryClient = useQueryClient()
  const [requestError, setRequestError] = useState<string | null>(null)

  const { data: state } = useQuery({
    queryKey: ['translations', ...trainingsScopeKey(), 'reader', trainingId, 'es'],
    queryFn: async () => {
      const result = await getTrainingTranslation(trainingId, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const request = useMutation({
    mutationFn: async () => {
      const result = await machineTranslateTraining(trainingId, 'es')
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
  // it lands pending review on the training page, never directly on this screen.
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
            href={`/training/${trainingId}`}
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

function Reader({ trainingId }: { trainingId: string }) {
  const [lang, setLang] = useState<Lang>('en')

  const { data: training, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'reader', 'detail', trainingId],
    queryFn: async () => {
      const result = await getTraining(trainingId)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const { data: translationState } = useQuery({
    queryKey: ['translations', ...trainingsScopeKey(), 'reader', trainingId, 'es'],
    queryFn: async () => {
      const result = await getTrainingTranslation(trainingId, 'es')
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

  // SAFETY: only an approved, current, correctly aligned translation may
  // render — for every role. The server already narrows what staff receive;
  // this repeats the check for reviewers, whose response carries drafts too.
  // The payload aligns with the *full* block list, deleted media included.
  const translation = translationState?.translation ?? null
  const usableTranslation =
    translation != null &&
    translation.status === 'approved' &&
    !translation.stale &&
    translation.payload.blocks.length === training.blocks.length
      ? translation
      : null

  const esTranslation = lang === 'es' ? usableTranslation : null
  // SAFETY: the Spanish on screen was machine-written and auto-published —
  // nobody read it. Staff are told, in Spanish, before they act on it.
  const aiUnreviewed = esTranslation != null && esTranslation.autoApproved

  const title = esTranslation ? esTranslation.payload.title : training.title
  const description = esTranslation
    ? esTranslation.payload.description || training.description
    : training.description
  const heroImage = training.heroImage?.url ?? null

  // Substitute translated text and captions by original index *before*
  // filtering out blocks whose media has been deleted — the payload aligns
  // with the source list, not the visible one. Media and embeds themselves
  // always render from the source block.
  const displayBlocks: TrainingBlockView[] = training.blocks.map((block, index) => {
    const translated = esTranslation?.payload.blocks[index] ?? null
    if (!translated) return block
    if (block.kind === 'text') {
      return translated.text != null
        ? { kind: 'text' as const, doc: plainTextToDoc(translated.text) }
        : block
    }
    return translated.caption != null ? { ...block, caption: translated.caption } : block
  })
  const visibleBlocks = displayBlocks.filter(
    (block) => block.kind === 'text' || block.kind === 'embed' || block.media != null
  )

  return (
    <div className="mx-auto max-w-5xl space-y-6 tablet:space-y-8">
      <header className="animate-fade-up relative overflow-hidden rounded-3xl border border-salt-200 bg-white/95 p-5 shadow-sm tablet:p-8">
        {heroImage && (
          <>
            <div
              aria-hidden
              className="absolute inset-0 bg-cover bg-center opacity-15"
              style={{ backgroundImage: `url(${heroImage})` }}
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-linear-to-b from-white/80 via-white/92 to-white"
            />
          </>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 right-[-3rem] size-48 rounded-full bg-basil-100/60 blur-3xl"
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
          <LanguageControl trainingId={trainingId} lang={lang} onLang={setLang} />
        </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="text-xs font-semibold tracking-[0.18em] text-ember-700 uppercase">
              Training module
            </p>
            {esTranslation != null && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 ring-inset ${
                  aiUnreviewed
                    ? 'bg-citron-50 text-citron-700 ring-citron-200'
                    : 'bg-steel-50 text-steel-600 ring-steel-200'
                }`}
              >
                <Bot className="size-3" aria-hidden />
                {aiUnreviewed ? readerEs.aiUnreviewed : readerEs.aiAssisted}
              </span>
            )}
            {training.myCompletion != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-basil-50 px-2.5 py-1 text-2xs font-semibold tracking-wide text-basil-700 uppercase ring-1 ring-basil-200 ring-inset">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Completed
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-steel-900 tablet:text-5xl">{title}</h1>
          {description && (
            <p className="max-w-3xl text-sm leading-relaxed text-salt-700 tablet:text-base">
              {description}
            </p>
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
        </div>
      </header>

      {aiUnreviewed && (
        <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{readerEs.unreviewedWarning}</span>
        </p>
      )}

      {visibleBlocks.length === 0 ? (
        <p className="rounded-2xl bg-salt-50 px-4 py-12 text-center text-sm text-salt-500 ring-1 ring-salt-200 ring-inset">
          This training has no content yet.
        </p>
      ) : (
        <article
          className={`${cardClass} animate-fade-up fade-delay-1 space-y-8 rounded-3xl p-5 phablet:p-7 tablet:space-y-10 tablet:p-12`}
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
