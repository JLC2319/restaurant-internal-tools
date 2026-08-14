/**
 * The chef-facing training page: metadata, publish/archive controls,
 * placement, per-person access, and the completions roster. The content
 * itself renders through BlockView/CompletionCard in TrainingContent.tsx,
 * which the staff reader shares.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrainingDetail as TrainingDetailData } from '@rit/shared';
import { roleAtLeast } from '@rit/shared';
import {
  Archive,
  ArchiveRestore,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  Film,
  Languages,
  Layers,
  Lock,
  LockOpen,
  Pencil,
  Radio,
  RotateCcw,
  Users,
} from 'lucide-react';
import {
  archiveTraining,
  getTraining,
  listCompletions,
  listTrainingAccessCandidates,
  moveTraining,
  publishTraining,
  trainingsScopeKey,
  unarchiveTraining,
  unpublishTraining,
  updateTrainingAccess,
} from '@/features/training/api';
import { useActiveRole } from '@/features/auth/useActiveRole';
import { ScopePicker, scopeDisplayLabel, useTenantTree } from '@/features/tenancy/ScopePicker';
import type { ScopeSelection } from '@/features/tenancy/ScopePicker';
import { QueryProvider } from '@/lib/QueryProvider';
import { BlockView, CompletionCard } from '@/features/training/TrainingContent';
import { TrainingTranslationPanel } from '@/features/training/TrainingTranslationPanel';
import {
  Badge,
  ErrorNote,
  Skeleton,
  cardClass,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from '@/components/ui';

function CompletionsPanel({ trainingId }: { trainingId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'completions', trainingId],
    queryFn: async () => {
      const result = await listCompletions(trainingId);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  if (isLoading) return <Skeleton className="h-20" />;
  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (!data || data.length === 0)
    return <p className="py-3 text-sm text-salt-600">No one has completed this training yet.</p>;

  return (
    <ul className="divide-y divide-salt-200">
      {data.map((row) => (
        <li
          key={`${row.userId}-${row.locationId ?? 'org'}`}
          className="flex items-center gap-3 py-2.5"
        >
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
  );
}

function ManagePanel({ training }: { training: TrainingDetailData }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);

  // A hook, called unconditionally three times below — same order every render.
  const useAction = (fn: () => ReturnType<typeof publishTraining>) =>
    useMutation({
      mutationFn: async () => {
        const result = await fn();
        if (result.error) throw new Error(result.error.message);
        return result.data;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainings'] }),
      onError: (err: Error) => setError(err.message),
    });

  const publish = useAction(() => publishTraining(training._id));
  const unpublish = useAction(() => unpublishTraining(training._id));
  const unarchive = useAction(() => unarchiveTraining(training._id));

  const archive = useMutation({
    mutationFn: async () => {
      const result = await archiveTraining(training._id);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainings'] }),
    onError: (err: Error) => setError(err.message),
  });

  const busy = publish.isPending || unpublish.isPending || archive.isPending || unarchive.isPending;

  return (
    <section className={`${cardClass} space-y-4 rounded-3xl p-5`}>
      <header className="flex items-center gap-2.5 border-b border-salt-200/80 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset">
          <Pencil className="size-4" aria-hidden />
        </span>
        <div>
          <h3 className="font-semibold text-steel-900">Module controls</h3>
          <p className="text-xs text-salt-600">Publish state, editing, and roster actions.</p>
        </div>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-2">
        <div className="grid gap-2">
          {training.status !== 'archived' && (
            <a
              href={`/training/${training._id}/edit`}
              className={`${subtleButtonClass} w-full justify-start`}
            >
              <Pencil className="size-4" aria-hidden />
              Edit content
            </a>
          )}

          {training.status === 'draft' && (
            <button
              type="button"
              onClick={() => publish.mutate()}
              disabled={busy || training.blockCount === 0}
              className={`${primaryButtonClass} w-full justify-start`}
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
              className={`${subtleButtonClass} w-full justify-start`}
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
              className={`${subtleButtonClass} w-full justify-start`}
            >
              <ArchiveRestore className="size-4" aria-hidden />
              {unarchive.isPending ? 'Restoring…' : 'Unarchive'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Archive this training? Staff will no longer see it.')) {
                  archive.mutate();
                }
              }}
              disabled={busy}
              className={`${subtleButtonClass} w-full justify-start`}
            >
              <Archive className="size-4" aria-hidden />
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </button>
          )}
        </div>
      </div>

      {training.completedCount != null && (
        <div className="rounded-2xl border border-salt-200 bg-salt-50/70 p-3">
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
            <div className="animate-fade-up mt-2 border-t border-salt-200 pt-2">
              <CompletionsPanel trainingId={training._id} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Where the module lives — and, for managers, the lever to move it. Moving
 * re-validates everything placement touches server-side (media blocks, the
 * allow-list) and rewrites every denormalised copy.
 */
function PlacementPanel({ training }: { training: TrainingDetailData }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<ScopeSelection>({ propertyId: '', locationId: '' });
  const [error, setError] = useState<string | null>(null);
  const { data: tree } = useTenantTree();

  const move = useMutation({
    mutationFn: async () => {
      const result = await moveTraining(training._id, {
        propertyId: scope.propertyId || null,
        locationId: scope.locationId || null,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainings'] });
      setEditing(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function startEditing() {
    setScope({
      propertyId: training.scope.propertyId ?? '',
      locationId: training.scope.locationId ?? '',
    });
    setError(null);
    setEditing(true);
  }

  const label = scopeDisplayLabel(training.scope, tree) ?? 'the whole organization';

  return (
    <section className={`${cardClass} space-y-3 p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-steel-900">
          <Building2 className="size-4 text-ember-600" aria-hidden />
          Placement
        </h3>
        {!editing && (
          <button type="button" onClick={startEditing} className={subtleButtonClass}>
            Move
          </button>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!editing && (
        <p className="text-sm text-salt-600">
          Lives at <strong className="font-semibold text-steel-800">{label}</strong> — every kitchen
          there (and members above it) sees it.
        </p>
      )}

      {editing && (
        <div className="space-y-3">
          <div className="grid gap-3 phablet:grid-cols-2">
            <ScopePicker idPrefix="move-training" value={scope} onChange={setScope} />
          </div>
          <p className="text-xs leading-relaxed text-salt-500">
            Moving changes who sees this training everywhere — the list, the module, completion
            rosters — the moment it lands. Media blocks and the allow-list are re-checked against
            the new home first.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Move this training? Who can see it changes immediately.'))
                  return;
                setError(null);
                move.mutate();
              }}
              disabled={move.isPending}
              className={primaryButtonClass}
            >
              <Building2 className="size-4" aria-hidden />
              {move.isPending ? 'Moving…' : 'Move training'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={subtleButtonClass}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Who may see this training. Rendered only for managers of it — the server
 * returns `access` under exactly the same condition, and listed viewers are
 * deliberately not shown who else is trusted.
 */
function AccessPanel({ training }: { training: TrainingDetailData }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Fetched lazily — the roster is only needed once the picker opens.
  const { data: candidates, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'access-candidates', training._id],
    queryFn: async () => {
      const result = await listTrainingAccessCandidates(training._id);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    enabled: editing,
  });

  const save = useMutation({
    mutationFn: async (access: { userIds: string[] } | null) => {
      const result = await updateTrainingAccess(training._id, { access });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainings'] });
      setEditing(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function startEditing() {
    setSelected(new Set(training.access?.userIds ?? []));
    setFilter('');
    setError(null);
    setEditing(true);
  }

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const listedUsers = training.access?.users ?? [];
  // Stored ids that no longer resolve to an account — kept server-side so a
  // save never silently drops them, surfaced here so someone prunes them.
  const formerCount = (training.access?.userIds.length ?? 0) - listedUsers.length;
  const needle = filter.trim().toLowerCase();
  const shown = (candidates ?? []).filter(
    (candidate) =>
      !needle ||
      `${candidate.name.first} ${candidate.name.last} ${candidate.email}`
        .toLowerCase()
        .includes(needle),
  );

  return (
    <section className={`${cardClass} space-y-3 p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-steel-900">
          <Lock className="size-4 text-ember-600" aria-hidden />
          Access
        </h3>
        {!editing && (
          <button type="button" onClick={startEditing} className={subtleButtonClass}>
            {training.restricted ? 'Edit' : 'Restrict'}
          </button>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!editing && !training.restricted && (
        <p className="text-sm text-salt-600">
          Everyone who can see this training&rsquo;s scope can open it.
        </p>
      )}

      {!editing && training.restricted && (
        <div className="space-y-3">
          <p className="text-sm text-salt-600">
            Only the people below can open it. Admins, owners and the training&rsquo;s creator
            always keep access.
          </p>
          {listedUsers.length === 0 ? (
            <p className="text-sm text-salt-500 italic">
              Nobody is listed — creator and admins only.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {listedUsers.map((user) => (
                <li key={user._id} className="flex min-w-0 items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-medium text-steel-900">
                    {user.name.first} {user.name.last}
                  </span>
                  <span className="truncate text-xs text-salt-500">{user.email}</span>
                </li>
              ))}
            </ul>
          )}
          {formerCount > 0 && (
            <p className="text-xs text-salt-500">
              {formerCount} entr{formerCount === 1 ? 'y' : 'ies'} belong to accounts that no longer
              exist — edit the list to prune them.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setError(null);
              save.mutate(null);
            }}
            disabled={save.isPending}
            className={subtleButtonClass}
          >
            <LockOpen className="size-4" aria-hidden />
            {save.isPending ? 'Opening…' : 'Remove restriction'}
          </button>
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <p className="text-sm text-salt-600">
            Pick who may open this training. Admins, owners and the creator always keep access;
            everyone else will no longer see it anywhere.
          </p>
          <input
            type="search"
            placeholder="Filter people…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className={inputClass}
          />
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {shown.map((candidate) => (
                <li key={candidate._id}>
                  <label className="flex min-h-touch cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-salt-50">
                    <input
                      type="checkbox"
                      checked={selected.has(candidate._id)}
                      onChange={() => toggle(candidate._id)}
                      className="size-4 shrink-0 accent-ember-600"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-steel-900">
                        {candidate.name.first} {candidate.name.last}
                        {candidate.jobTitle && (
                          <span className="font-normal text-salt-500"> · {candidate.jobTitle}</span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-salt-500">
                        {candidate.email}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-2 text-sm text-salt-500">No matches.</li>}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                save.mutate({ userIds: [...selected] });
              }}
              disabled={save.isPending}
              className={primaryButtonClass}
            >
              <Lock className="size-4" aria-hidden />
              {save.isPending ? 'Saving…' : 'Save access'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={subtleButtonClass}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Detail({ trainingId }: { trainingId: string }) {
  const { role } = useActiveRole();
  const [translationOpen, setTranslationOpen] = useState(false);
  const {
    data: training,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'detail', trainingId],
    queryFn: async () => {
      const result = await getTraining(trainingId);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (isLoading || !training)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );

  const visibleBlocks = training.blocks.filter(
    (block) => block.kind === 'text' || block.kind === 'embed' || block.media != null,
  );
  const isManager = role != null && roleAtLeast(role, 'manager');

  return (
    <div className="mx-auto max-w-6xl space-y-6 tablet:space-y-8">
      <header className="animate-fade-up relative overflow-hidden rounded-3xl border border-salt-200 bg-white/95 p-5 shadow-sm tablet:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 right-[-4rem] size-56 rounded-full bg-basil-100/55 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 left-[-4rem] size-56 rounded-full bg-ember-100/50 blur-3xl"
        />
        <div className="relative space-y-3">
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
          <h1 className="text-3xl font-bold tracking-tight text-steel-900 tablet:text-4xl">
            {training.title}
          </h1>
          {training.description && (
            <p className="max-w-3xl text-sm leading-relaxed text-salt-700 tablet:text-base">
              {training.description}
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

      <div className="grid gap-6 laptop:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
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

        {training.canManage && (
          <aside className="space-y-6 laptop:sticky laptop:top-24 laptop:self-start">
            <ManagePanel training={training} />
            {isManager && <PlacementPanel training={training} />}
            <AccessPanel training={training} />
          </aside>
        )}
      </div>

      {training.canManage && (
        <section className={`${cardClass} overflow-hidden rounded-3xl`}>
          <button
            type="button"
            onClick={() => setTranslationOpen((open) => !open)}
            aria-expanded={translationOpen}
            className="flex min-h-touch w-full cursor-pointer items-center gap-2.5 border-b border-salt-200/80 bg-white px-5 py-4 text-left transition-colors hover:bg-salt-50 tablet:px-6"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset">
              <Languages className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-steel-900">Spanish translation review</p>
              <p className="text-xs text-salt-600">
                Collapsed by default to keep the module view focused.
              </p>
            </div>
            <ChevronDown
              className={`size-4 shrink-0 text-salt-500 transition-transform duration-200 ${translationOpen ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>

          {translationOpen && (
            <div className="animate-fade-up p-3 tablet:p-4">
              <TrainingTranslationPanel training={training} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function TrainingDetail({ trainingId }: { trainingId: string }) {
  return (
    <QueryProvider>
      <Detail trainingId={trainingId} />
    </QueryProvider>
  );
}
