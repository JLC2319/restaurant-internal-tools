import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { TrainingStatus, TrainingSummary } from '@rit/shared'
import { roleAtLeast } from '@rit/shared'
import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  Layers,
  Lock,
  PenLine,
  Play,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { createTraining, listTrainings, trainingsScopeKey } from '@/features/training/api'
import { getDraftConfig } from '@/lib/api/drafts'
import { ScopePicker, defaultScopeSelection } from '@/features/tenancy/ScopePicker'
import type { ScopeSelection } from '@/features/tenancy/ScopePicker'
import { useActiveRole } from '@/features/auth/useActiveRole'
import { QueryProvider } from '@/lib/QueryProvider'
import {
  Badge,
  EmptyState,
  ErrorNote,
  Segmented,
  Skeleton,
  cardClass,
  cardHoverClass,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from '@/components/ui'

function NewTrainingForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<ScopeSelection>(defaultScopeSelection)
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const result = await createTraining({
        title,
        description,
        blocks: [],
        propertyId: scope.propertyId || null,
        locationId: scope.locationId || null,
      })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (training) => {
      window.location.href = `/training/${training._id}/edit`
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    create.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} animate-fade-up space-y-4 p-5 tablet:p-6`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-steel-900">New training</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 cursor-pointer items-center justify-center rounded-full text-salt-500 transition-colors hover:bg-salt-100 hover:text-steel-800"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div>
        <label htmlFor="training-title" className="mb-1.5 block text-sm font-medium text-steel-700">
          Title
        </label>
        <input
          id="training-title"
          type="text"
          required
          minLength={2}
          maxLength={140}
          placeholder="e.g. Knife Safety & Care"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label
          htmlFor="training-description"
          className="mb-1.5 block text-sm font-medium text-steel-700"
        >
          Description <span className="font-normal text-salt-500">(optional)</span>
        </label>
        <textarea
          id="training-description"
          maxLength={500}
          rows={2}
          placeholder="One or two sentences on what this module covers."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 tablet:grid-cols-3">
        <ScopePicker idPrefix="new-training" value={scope} onChange={setScope} />
        <p className="self-end pb-1 text-xs leading-relaxed text-salt-500">
          Where a training lives decides who sees it: the whole organization, one property&rsquo;s
          kitchens, or a single location. Sibling properties never see each other&rsquo;s.
        </p>
      </div>

      <button type="submit" disabled={create.isPending} className={primaryButtonClass}>
        <Plus className="size-4" aria-hidden />
        {create.isPending ? 'Creating…' : 'Create and add content'}
      </button>
    </form>
  )
}

function TrainingCard({ training, index }: { training: TrainingSummary; index: number }) {
  const delay = ['', 'fade-delay-1', 'fade-delay-2', 'fade-delay-3'][index % 4]
  const done = training.myCompletion != null

  return (
    <li className={`animate-fade-up ${delay}`}>
      <a
        href={`/training/${training._id}`}
        className={`group flex h-full flex-col overflow-hidden ${cardClass} ${cardHoverClass}`}
      >
        <div className="relative">
          {training.heroImage ? (
            <img
              src={training.heroImage.url}
              alt=""
              width={training.heroImage.width ?? undefined}
              height={training.heroImage.height ?? undefined}
              loading="lazy"
              className="aspect-video w-full bg-salt-100 object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-linear-to-br from-steel-50 via-salt-100 to-ember-50">
              <GraduationCap
                className="size-10 text-salt-400 transition-transform duration-300 group-hover:scale-110"
                aria-hidden
              />
            </div>
          )}

          {done && (
            <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-basil-500/95 px-2.5 py-1 text-2xs font-semibold tracking-wide text-white uppercase shadow-sm backdrop-blur-sm">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Done
            </span>
          )}
          {training.videoCount > 0 && (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-steel-900/80 px-2.5 py-1 text-2xs font-semibold tracking-wide text-white uppercase backdrop-blur-sm">
              <Play className="size-3 fill-current" aria-hidden />
              {training.videoCount === 1 ? 'Video' : `${training.videoCount} videos`}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-steel-900 transition-colors group-hover:text-ember-700">
              {training.title}
            </h2>
            {training.restricted && (
              <span
                title="Restricted to specific people"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-steel-50 text-steel-500 ring-1 ring-steel-200 ring-inset"
              >
                <Lock className="size-3.5" aria-hidden />
              </span>
            )}
          </div>
          {training.description && (
            <p className="-mt-1 line-clamp-2 text-sm text-salt-600">{training.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {training.status !== 'published' && <Badge value={training.status} />}
            <span className="inline-flex items-center gap-1 text-xs font-medium text-salt-500">
              <Layers className="size-3.5" aria-hidden />
              {training.blockCount} {training.blockCount === 1 ? 'section' : 'sections'}
            </span>
          </div>

          <p className="mt-auto flex items-center gap-1.5 text-xs text-salt-500">
            <Clock className="size-3.5" aria-hidden />
            Updated {new Date(training.modifiedAt).toLocaleDateString()}
          </p>
        </div>
      </a>
    </li>
  )
}

function SkeletonGrid() {
  return (
    <ul className="grid gap-4 phablet:grid-cols-2 desktop:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className={`${cardClass} overflow-hidden`}>
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Browser() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<TrainingStatus>('published')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const { role } = useActiveRole()
  const canCreate = role != null && roleAtLeast(role, 'chef')

  // Only to decide whether the AI-drafting link earns a spot in the toolbar —
  // the draft page itself re-checks and explains when drafting is off.
  const { data: draftConfig } = useQuery({
    queryKey: ['drafts', ...trainingsScopeKey(), 'config'],
    queryFn: async () => {
      const result = await getDraftConfig()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: canCreate,
  })

  const { data, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'list', { q, page, status }],
    queryFn: async () => {
      const result = await listTrainings({ q, page, status })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) return <ErrorNote>{error.message}</ErrorNote>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQ(search)
          }}
          className="relative max-w-md flex-1"
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-salt-500"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search trainings"
            placeholder="Search trainings…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </form>

        {canCreate && (
          <>
            <Segmented
              ariaLabel="Training status"
              value={status}
              onChange={(next) => {
                setStatus(next)
                setPage(1)
              }}
              options={[
                { id: 'published', label: 'Published' },
                {
                  id: 'draft',
                  label: (
                    <>
                      <PenLine className="size-3.5" aria-hidden /> Drafts
                    </>
                  ),
                },
                {
                  id: 'archived',
                  label: (
                    <>
                      <Archive className="size-3.5" aria-hidden /> Archived
                    </>
                  ),
                },
              ]}
            />
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {draftConfig?.enabled && (
                <a href="/training/draft" className={subtleButtonClass}>
                  <Sparkles className="size-4 text-ember-600" aria-hidden />
                  Draft with AI
                </a>
              )}
              <button
                type="button"
                onClick={() => setShowForm((v) => !v)}
                className={primaryButtonClass}
              >
                <Plus className="size-4" aria-hidden />
                New training
              </button>
            </div>
          </>
        )}
      </div>

      {showForm && canCreate && <NewTrainingForm onClose={() => setShowForm(false)} />}

      {isLoading && <SkeletonGrid />}

      {data?.items.length === 0 && (
        <EmptyState
          icon={GraduationCap}
          title={
            q
              ? `No trainings matching “${q}”`
              : canCreate && status === 'draft'
                ? 'No drafts in progress'
                : canCreate && status === 'archived'
                  ? 'Nothing archived'
                  : 'No trainings yet'
          }
          hint={
            q
              ? 'Try a different search, or clear it to see everything in this scope.'
              : canCreate
                ? 'Build modules from rich text, photos and video — staff see them the moment you publish.'
                : 'Training modules appear here once they are published.'
          }
          action={
            canCreate && !q && status === 'published' ? (
              <button type="button" onClick={() => setShowForm(true)} className={primaryButtonClass}>
                <Plus className="size-4" aria-hidden />
                Create the first training
              </button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <ul className="grid gap-4 phablet:grid-cols-2 desktop:grid-cols-3">
          {data.items.map((training, index) => (
            <TrainingCard key={training._id} training={training} index={index} />
          ))}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className={subtleButtonClass}
          >
            <ChevronLeft className="size-4" aria-hidden />
            Previous
          </button>
          <span className="text-sm text-salt-600">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className={subtleButtonClass}
          >
            Next
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}

export function TrainingsBrowser() {
  return (
    <QueryProvider>
      <Browser />
    </QueryProvider>
  )
}
