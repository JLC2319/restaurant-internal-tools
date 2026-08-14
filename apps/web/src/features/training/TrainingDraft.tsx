import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DraftTrainingsResponse, TrainingDraftProposal } from '@rit/shared';
import {
  MAX_DRAFT_FILES,
  MAX_DRAFT_TOTAL_BYTES,
  MAX_PHOTO_BYTES,
  plainTextToDoc,
  roleAtLeast,
} from '@rit/shared';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  FileImage,
  FilePlus2,
  FileText,
  GraduationCap,
  Info,
  Sparkles,
  X,
} from 'lucide-react';
import { getDraftConfig, draftTrainingsFromMaterials } from '@/lib/api/drafts';
import { createTraining, trainingsScopeKey } from '@/features/training/api';
import { TRAINING_DRAFTING_MESSAGES } from '@/features/training/draftingMessages';
import { useActiveRole } from '@/features/auth/useActiveRole';
import { ScopePicker, defaultScopeSelection } from '@/features/tenancy/ScopePicker';
import type { ScopeSelection } from '@/features/tenancy/ScopePicker';
import { QueryProvider } from '@/lib/QueryProvider';
import { WorkingOverlay } from '@/components/ui/WorkingOverlay';
import {
  EmptyState,
  ErrorNote,
  Skeleton,
  cardClass,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from '@/components/ui';

/**
 * AI training drafting — review-first, like recipe drafting. A description
 * and/or source files (photos, PDFs) go up, proposals come back, and NOTHING
 * is saved until someone reads a proposal and clicks "Create draft training".
 * What that creates is an ordinary unpublished module: invisible to staff
 * until it is published, editable like any other draft. Submitted files feed
 * the one model call only — they are never stored, so proposals arrive as
 * text sections and media is added later in the editor.
 */

const MAX_DESCRIPTION_CHARS = 5000;

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function kindLabel(file: File): string {
  switch (file.type) {
    case 'application/pdf':
      return 'PDF';
    case 'image/jpeg':
      return 'JPEG';
    case 'image/png':
      return 'PNG';
    case 'image/webp':
      return 'WebP';
    default:
      return file.type || 'File';
  }
}

function ProposalCard({ proposal, index }: { proposal: TrainingDraftProposal; index: number }) {
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // Per proposal, not per batch: a handbook often splits into modules that
  // belong to different tiers (an org-wide policy next to one site's opening
  // checklist), so each card picks its own home.
  const [scope, setScope] = useState<ScopeSelection>(defaultScopeSelection);

  const create = useMutation({
    mutationFn: async () => {
      const result = await createTraining({
        title: proposal.title,
        description: proposal.description,
        blocks: proposal.sections.map((text) => ({
          kind: 'text' as const,
          doc: plainTextToDoc(text),
        })),
        propertyId: scope.propertyId || null,
        locationId: scope.locationId || null,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (training) => setCreatedId(training._id),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <article
      className={`${cardClass} animate-fade-up space-y-4 p-5 tablet:p-6`}
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-steel-900">{proposal.title}</h3>
          <p className="font-mono text-xs text-salt-600">
            {proposal.sections.length} {proposal.sections.length === 1 ? 'section' : 'sections'}
          </p>
        </div>
        {createdId ? (
          <a href={`/training/${createdId}/edit`} className={primaryButtonClass}>
            <ArrowUpRight className="size-4" aria-hidden />
            Open in editor
          </a>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null);
              create.mutate();
            }}
            disabled={create.isPending}
            className={primaryButtonClass}
          >
            <GraduationCap className="size-4" aria-hidden />
            {create.isPending ? 'Creating…' : 'Create draft training'}
          </button>
        )}
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}
      {createdId && (
        <p className="flex items-center gap-2 rounded-xl bg-basil-50 px-4 py-2.5 text-sm font-medium text-basil-700 ring-1 ring-basil-200 ring-inset">
          <Check className="size-4" aria-hidden />
          Created as a draft only chefs can see. Review it, add photos or video, then publish.
        </p>
      )}

      {proposal.description && (
        <p className="text-sm leading-relaxed text-steel-800">{proposal.description}</p>
      )}

      {proposal.notes && (
        <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{proposal.notes}</span>
        </p>
      )}

      <section>
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-salt-600 uppercase">
          Sections
        </h4>
        <ol className="divide-y divide-salt-100 overflow-hidden rounded-xl ring-1 ring-salt-200">
          {proposal.sections.map((text, i) => (
            <li
              key={i}
              className="flex gap-2.5 bg-white px-4 py-3 text-sm leading-relaxed text-steel-800"
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-steel-900 font-mono text-2xs font-semibold text-salt-50">
                {i + 1}
              </span>
              <p className="whitespace-pre-line">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {!createdId && (
        <div className="grid gap-4 rounded-xl bg-salt-50 p-4 ring-1 ring-salt-200 ring-inset tablet:grid-cols-3">
          <ScopePicker idPrefix={`training-proposal-${index}`} value={scope} onChange={setScope} />
          <p className="self-end pb-1 text-xs leading-relaxed text-salt-500">
            Where this module lives decides who sees it once published — the whole organization, one
            property, or a single location.
          </p>
        </div>
      )}
    </article>
  );
}

function Drafter() {
  const { role } = useActiveRole();
  const canDraft = role != null && roleAtLeast(role, 'chef');
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftTrainingsResponse | null>(null);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['drafts', ...trainingsScopeKey(), 'config'],
    queryFn: async () => {
      const res = await getDraftConfig();
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
  });

  const draft = useMutation({
    mutationFn: async () => {
      const res = await draftTrainingsFromMaterials(files, description.trim() || undefined);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => setResult(data),
    onError: (err: Error) => setError(err.message),
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    setFiles((prev) => [...prev, ...list].slice(0, MAX_DRAFT_FILES));
  }

  function removeAt(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  if (configLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-12 w-64" />
      </div>
    );
  }

  if (!canDraft) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Chefs draft trainings"
        hint="Drafting from source material creates training modules, which needs a chef role or above in this scope."
      />
    );
  }

  if (config && !config.enabled) {
    return (
      <EmptyState
        icon={Sparkles}
        title="AI drafting is not configured"
        hint="This server has no Anthropic API key set (or AI_DRAFTING_ENABLED is off). Add one to turn handbooks and outlines into draft training modules."
      />
    );
  }

  if (result) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-salt-600">
              {result.proposals.length === 0
                ? 'No training modules found in that material.'
                : `${result.proposals.length} ${result.proposals.length === 1 ? 'module' : 'modules'} proposed. Review each one — nothing is saved until you create it.`}
            </p>
            <p className="mt-0.5 font-mono text-xs text-salt-500">Drafted by {result.model}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setFiles([]);
              setDescription('');
            }}
            className={subtleButtonClass}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Start over
          </button>
        </div>

        {result.notes && (
          <p className="flex items-start gap-2.5 rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-700 ring-1 ring-salt-200 ring-inset">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{result.notes}</span>
          </p>
        )}

        {result.proposals.length === 0 && (
          <EmptyState
            icon={GraduationCap}
            title="Nothing training-shaped in that material"
            hint="Try clearer files, or describe in your own words what the module should teach."
          />
        )}

        <div className="space-y-5">
          {result.proposals.map((proposal, index) => (
            <ProposalCard key={index} proposal={proposal} index={index} />
          ))}
        </div>
      </div>
    );
  }

  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const overBudget = bytes > MAX_DRAFT_TOTAL_BYTES;
  const anyFileTooBig = files.some((file) => file.size > MAX_PHOTO_BYTES);
  const hasInput = description.trim().length > 0 || files.length > 0;

  return (
    <div className="space-y-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className={`${cardClass} space-y-4 p-5 tablet:p-6`}>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label
              htmlFor="training-draft-description"
              className="block text-sm font-medium text-steel-700"
            >
              What should this training cover?{' '}
              <span className="font-normal text-salt-500">(optional if you attach files)</span>
            </label>
            <span
              className={`font-mono text-xs ${description.length >= MAX_DESCRIPTION_CHARS ? 'font-semibold text-chili-600' : 'text-salt-500'}`}
            >
              {description.length.toLocaleString()}/{MAX_DESCRIPTION_CHARS.toLocaleString()}
            </span>
          </div>
          <textarea
            id="training-draft-description"
            rows={6}
            maxLength={MAX_DESCRIPTION_CHARS}
            placeholder="Paste an outline or describe the module in your own words — e.g. opening checklist for front of house: unlock procedure, POS startup, table setup, and the five service standards every host recites."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {files.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-36 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-salt-300 bg-salt-50 px-6 py-8 text-center transition-colors hover:border-ember-400 hover:bg-ember-50/40"
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-white text-ember-600 shadow-xs ring-1 ring-salt-200">
              <FilePlus2 className="size-7" aria-hidden />
            </span>
            <span className="font-semibold text-steel-900">Add files (optional)</span>
            <span className="max-w-md text-sm text-salt-600">
              Handbook pages, SOPs, checklists, slide printouts — photos or PDFs. Up to{' '}
              {MAX_DRAFT_FILES} files, 10MB each, 20MB total.
            </span>
          </button>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-salt-100 overflow-hidden rounded-xl ring-1 ring-salt-200">
              {files.map((file, index) => {
                const isPdf = file.type === 'application/pdf';
                const tooBig = file.size > MAX_PHOTO_BYTES;
                return (
                  <li key={index} className="flex items-center gap-3 bg-white px-3 py-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-salt-100 text-steel-700">
                      {isPdf ? (
                        <FileText className="size-5" aria-hidden />
                      ) : (
                        <FileImage className="size-5" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-steel-900">
                        {file.name}
                      </span>
                      <span
                        className={`text-xs ${tooBig ? 'font-semibold text-chili-600' : 'text-salt-500'}`}
                      >
                        {kindLabel(file)} · {formatMB(file.size)}MB
                        {tooBig && ' — over the 10MB per-file limit'}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeAt(index)}
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-salt-500 transition-colors hover:bg-salt-100 hover:text-chili-600"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p
                className={`text-xs ${overBudget ? 'font-semibold text-chili-600' : 'text-salt-500'}`}
              >
                {files.length} {files.length === 1 ? 'file' : 'files'} · {formatMB(bytes)}MB of 20MB
                {overBudget && ' — remove a file or two'}
              </p>
              {files.length < MAX_DRAFT_FILES && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className={subtleButtonClass}
                >
                  <FilePlus2 className="size-4" aria-hidden />
                  Add more
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              draft.mutate();
            }}
            disabled={!hasInput || overBudget || anyFileTooBig || draft.isPending}
            className={primaryButtonClass}
          >
            <Sparkles className="size-4" aria-hidden />
            {draft.isPending ? 'Reading the material…' : 'Draft trainings'}
          </button>
          {!hasInput && (
            <p className="text-xs text-salt-500">
              Write a description or attach at least one file.
            </p>
          )}
        </div>
      </div>

      <WorkingOverlay
        active={draft.isPending}
        title="Drafting your trainings"
        messages={TRAINING_DRAFTING_MESSAGES}
      />

      <p className="flex items-start gap-2.5 rounded-xl bg-salt-50 px-4 py-3 text-sm text-salt-600 ring-1 ring-salt-200 ring-inset">
        <Info className="mt-0.5 size-4 shrink-0 text-citron-600" aria-hidden />
        <span>
          Proposals are suggestions, not modules. Nothing is saved until you create it, and what you
          create is an unpublished draft staff cannot see — review it and add media before
          publishing.
        </span>
      </p>
    </div>
  );
}

export function TrainingDraft() {
  return (
    <QueryProvider>
      <Drafter />
    </QueryProvider>
  );
}
