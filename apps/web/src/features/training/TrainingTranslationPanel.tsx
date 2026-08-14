import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TrainingBlockView,
  TrainingDetail as TrainingDetailData,
  TrainingTranslationPayloadInput,
  TrainingTranslationView,
  TranslationPublishMode,
} from '@rit/shared';
import { docToPlainText } from '@rit/shared';
import {
  Bot,
  Check,
  Film,
  Image as ImageIcon,
  Languages,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import {
  approveTrainingTranslation,
  getTrainingTranslation,
  machineTranslateTraining,
  rejectTrainingTranslation,
  updateTrainingTranslation,
} from '@/features/translations/api';
import { trainingsScopeKey } from '@/features/training/api';
import { TRANSLATING_MESSAGES } from '@/features/translations/messages';
import { WorkingOverlay } from '@/components/ui/WorkingOverlay';
import {
  Badge,
  ErrorNote,
  SectionCard,
  Skeleton,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from '@/components/ui';

/**
 * The Spanish review gate, on the training page — the same contract as the
 * recipe panel. Machine translation lands here as pending_review; a chef reads
 * it side by side with the published English, optionally edits it, and
 * explicitly approves. Only then does the reader's language toggle light up —
 * and any edit to the published module turns it off again until re-approval.
 *
 * Text blocks translate as plain text (formatting starts fresh in
 * translation); media and embeds always render from the source, so only their
 * captions appear here. Blocks with nothing to translate still get a row —
 * the reviewer should see the whole module in order, not a filtered list that
 * hides what stayed English.
 */

function payloadToDraft(
  payload: TrainingTranslationView['payload'],
): TrainingTranslationPayloadInput {
  return {
    title: payload.title,
    description: payload.description,
    blocks: payload.blocks.map((block) => ({ text: block.text, caption: block.caption })),
  };
}

/**
 * What this training's scope does on publish, in one line. Resolved
 * server-side from the org/property/location settings.
 */
const PUBLISH_MODE_HINT: Record<TranslationPublishMode, string | null> = {
  manual: null,
  auto_review:
    'This scope translates automatically when a module is published. It still waits here for your review.',
  auto_publish:
    'This scope translates automatically when a module is published and publishes it to staff without review.',
};

/**
 * How often to ask whether the background translation has landed. Fast enough
 * that the Spanish appears to arrive on its own, slow enough to be nothing on a
 * page a chef leaves open — and it only runs while a run is actually in flight.
 */
const AUTO_POLL_MS = 2500;

const fieldLabel = 'text-2xs font-semibold tracking-wide text-salt-500 uppercase';
const sourceText = 'text-sm leading-relaxed text-salt-600';
const areaClass = `${inputClass} min-h-0 resize-y py-2 text-sm leading-relaxed`;

/** The blocks without translatable text still hold their row — see above. */
const UNTRANSLATED_LABEL: Record<Exclude<TrainingBlockView['kind'], 'text'>, string> = {
  image: 'Image — nothing to translate',
  video: 'Video — nothing to translate',
  embed: 'Embedded video — nothing to translate',
};

export function TrainingTranslationPanel({ training }: { training: TrainingDetailData }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TrainingTranslationPayloadInput | null>(null);

  const queryKey = ['translations', ...trainingsScopeKey(), training._id, 'es'];
  const { data: state, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await getTrainingTranslation(training._id, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    /**
     * Publishing kicks the translation off in the background, so a chef who
     * opens the module straight afterwards lands on a page whose answer is
     * about to change. Poll while the server says a run is in flight and stop
     * the moment it is not — `autoTranslating` goes false on success, on
     * failure, and on a run whose process died, so this always terminates.
     */
    refetchInterval: (query) => (query.state.data?.autoTranslating ? AUTO_POLL_MS : false),
  });

  const translation = state?.translation ?? null;

  // Reset the editable draft whenever the server document changes.
  useEffect(() => {
    setDraft(translation ? payloadToDraft(translation.payload) : null);
  }, [translation?._id, translation?.modifiedAt]);

  const dirty = useMemo(
    () =>
      translation != null &&
      draft != null &&
      JSON.stringify(draft) !== JSON.stringify(payloadToDraft(translation.payload)),
    [draft, translation],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['translations'] });
  };
  const mutationHandlers = {
    onSuccess: refresh,
    onError: (err: Error) => setError(err.message),
  };

  const translate = useMutation({
    mutationFn: async () => {
      const result = await machineTranslateTraining(training._id, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    ...mutationHandlers,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Nothing to save');
      const cleaned: TrainingTranslationPayloadInput = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        blocks: draft.blocks.map((block) => ({
          text: block.text?.trim() ? block.text.trim() : null,
          caption: block.caption?.trim() ? block.caption.trim() : null,
        })),
      };
      const result = await updateTrainingTranslation(training._id, cleaned, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    ...mutationHandlers,
  });

  const approve = useMutation({
    mutationFn: async () => {
      const result = await approveTrainingTranslation(training._id, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    ...mutationHandlers,
  });

  const reject = useMutation({
    mutationFn: async () => {
      const result = await rejectTrainingTranslation(training._id, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    ...mutationHandlers,
  });

  const busy = translate.isPending || save.isPending || approve.isPending || reject.isPending;

  // Translation follows what staff read — nothing to do before it is published.
  if (training.status !== 'published') {
    return (
      <SectionCard
        icon={Languages}
        title="Spanish translation"
        hint="Translation follows the published module staff read. Publish it first."
      >
        <p className="text-sm text-salt-600">
          Once this training is published, you can machine-translate it here, review the Spanish
          side by side, and approve it for the reader.
        </p>
      </SectionCard>
    );
  }

  if (isLoading) {
    return (
      <SectionCard icon={Languages} title="Spanish translation">
        <div className="space-y-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-24" />
        </div>
      </SectionCard>
    );
  }

  // The English column mirrors the module the translation was made from — the
  // payload aligns with the *full* block list, deleted media included.
  const aligned =
    translation != null && translation.payload.blocks.length === training.blocks.length;
  const editable = translation != null && !translation.stale && aligned;
  const modeHint = state ? PUBLISH_MODE_HINT[state.publishMode] : null;
  // SAFETY: approved, current, and nobody read it — the one state the review
  // gate does not cover, because the org opted out of it.
  const liveUnreviewed =
    translation != null &&
    translation.autoApproved &&
    translation.status === 'approved' &&
    !translation.stale;

  return (
    <SectionCard
      icon={Languages}
      title="Spanish translation"
      hint="Machine translated, human approved. Staff only ever see the approved version."
      actions={
        translation && (
          <div className="flex flex-wrap items-center gap-2">
            {translation.stale ? (
              <Badge value="unverified" label="stale" />
            ) : translation.autoApproved && translation.status === 'approved' ? (
              // Not `approved` green: nobody signed this off, and the badge
              // must not tell a chef at a glance that somebody did.
              <Badge value="unverified" label="auto-published" />
            ) : (
              <Badge value={translation.status} />
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-steel-50 px-2.5 py-1 text-2xs font-semibold text-steel-600 ring-1 ring-steel-200 ring-inset">
              <Bot className="size-3" aria-hidden />
              {translation.origin === 'machine_edited' ? 'AI + edits' : 'AI'}
            </span>
          </div>
        )
      }
    >
      <WorkingOverlay
        active={translate.isPending}
        title="Translating to Spanish"
        messages={TRANSLATING_MESSAGES}
      />

      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        {state && modeHint && (
          <p className="flex items-start gap-2.5 rounded-xl bg-steel-50 px-4 py-3 text-sm text-steel-700 ring-1 ring-steel-200 ring-inset">
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{modeHint}</span>
          </p>
        )}

        {/* Work is already in flight — offering the button here would start the
            same translation a second time, and telling a chef nothing is
            happening seconds after they published is simply untrue. The query
            above polls while this is up, so the finished Spanish replaces it. */}
        {!translation && state?.autoTranslating && (
          <p className="flex items-center gap-2.5 rounded-xl bg-steel-50 px-4 py-3 text-sm text-steel-700 ring-1 ring-steel-200 ring-inset">
            <Loader2 className="size-4 shrink-0 animate-spin text-ember-600" aria-hidden />
            <span>
              Translating this training into Spanish now — it started when the module was published.
              This page updates itself when it lands.
            </span>
          </p>
        )}

        {!translation && !state?.autoTranslating && (
          <div className="space-y-3">
            {state?.autoTranslationFailed && (
              <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  The automatic translation for this training did not finish. Nothing was saved and
                  staff are unaffected — translate it here when you are ready.
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm text-salt-600">
                Translates the published module into Spanish for review. Nothing reaches staff until
                you approve it here.
              </p>
              {state?.enabled ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    translate.mutate();
                  }}
                  disabled={busy}
                  className={primaryButtonClass}
                >
                  <Languages className="size-4" aria-hidden />
                  {translate.isPending ? 'Translating…' : 'Translate to Spanish'}
                </button>
              ) : (
                <p className="text-sm text-salt-500 italic">
                  Machine translation is not configured on this server.
                </p>
              )}
            </div>
          </div>
        )}

        {translation && (
          <>
            {translation.stale && (
              <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  The published module has changed since this translation was made. Staff no longer
                  see it. Re-translate, review and approve again.
                </span>
              </p>
            )}
            {liveUnreviewed && (
              <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Staff are reading this now, and no one has reviewed it — this scope is set to
                  publish translations automatically. Read every line; approving below records your
                  sign-off, and edits go live the moment you approve them.
                </span>
              </p>
            )}
            {!translation.stale && translation.status === 'pending_review' && (
              <p className="flex items-start gap-2.5 rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Awaiting review. Read every line — a mistranslated safety instruction is an
                  incident, not a typo. Approving publishes it to the reader.
                </span>
              </p>
            )}

            {draft && editable && (
              <div className="space-y-5">
                <div className="grid gap-3 tablet:grid-cols-2">
                  <div className="space-y-1">
                    <p className={fieldLabel}>Title — English</p>
                    <p className={sourceText}>{training.title}</p>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="ttr-title" className={fieldLabel}>
                      Español
                    </label>
                    <input
                      id="ttr-title"
                      type="text"
                      maxLength={180}
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>

                {(training.description || draft.description) && (
                  <div className="grid gap-3 tablet:grid-cols-2">
                    <div className="space-y-1">
                      <p className={fieldLabel}>Description — English</p>
                      <p className={sourceText}>{training.description || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="ttr-desc" className={fieldLabel}>
                        Español
                      </label>
                      <textarea
                        id="ttr-desc"
                        rows={3}
                        maxLength={700}
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        className={areaClass}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className={fieldLabel}>Content</p>
                  <ol className="space-y-2">
                    {training.blocks.map((block, index) => {
                      const translated = draft.blocks[index];
                      const setBlock = (patch: Partial<{ text: string; caption: string }>) =>
                        setDraft({
                          ...draft,
                          blocks: draft.blocks.map((v, i) =>
                            i === index ? { ...v, ...patch } : v,
                          ),
                        });
                      const marker = (
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-steel-900 font-mono text-2xs font-semibold text-salt-50">
                          {index + 1}
                        </span>
                      );

                      if (block.kind === 'text') {
                        return (
                          <li key={index} className="grid gap-2 tablet:grid-cols-2">
                            <div className="flex gap-2.5">
                              {marker}
                              <p className={`${sourceText} pt-0.5 whitespace-pre-line`}>
                                {docToPlainText(block.doc)}
                              </p>
                            </div>
                            <textarea
                              aria-label={`Spanish text for section ${index + 1}`}
                              rows={4}
                              maxLength={25000}
                              value={translated?.text ?? ''}
                              onChange={(e) => setBlock({ text: e.target.value })}
                              className={areaClass}
                            />
                          </li>
                        );
                      }

                      // Media and embeds render from the source — only a
                      // caption translates. A caption-less block still gets a
                      // row, so the reviewer sees the whole module in order.
                      if (block.caption == null) {
                        const Icon = block.kind === 'image' ? ImageIcon : Film;
                        return (
                          <li key={index} className="flex items-center gap-2.5">
                            {marker}
                            <p className="text-sm text-salt-400 italic">
                              <Icon className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
                              {UNTRANSLATED_LABEL[block.kind]}
                            </p>
                          </li>
                        );
                      }

                      return (
                        <li key={index} className="grid gap-2 tablet:grid-cols-2">
                          <div className="flex gap-2.5">
                            {marker}
                            <p className={`${sourceText} pt-0.5 italic`}>
                              {block.kind === 'image' ? 'Image caption' : 'Video caption'} —{' '}
                              {block.caption}
                            </p>
                          </div>
                          <input
                            type="text"
                            aria-label={`Spanish caption for block ${index + 1}`}
                            maxLength={400}
                            placeholder="Leyenda"
                            value={translated?.caption ?? ''}
                            onChange={(e) => setBlock({ caption: e.target.value })}
                            className={`${inputClass} py-2 text-sm`}
                          />
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-salt-100 pt-4">
              {/* An auto-published translation is already `approved`, but no
                  one has signed it off — the button stays so a chef can. */}
              {editable &&
                (translation.status !== 'approved' || translation.autoApproved) &&
                !dirty && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      approve.mutate();
                    }}
                    disabled={busy}
                    className={primaryButtonClass}
                  >
                    <Check className="size-4" aria-hidden />
                    {approve.isPending
                      ? 'Approving…'
                      : liveUnreviewed
                        ? 'Confirm reviewed'
                        : 'Approve for staff'}
                  </button>
                )}
              {dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    save.mutate();
                  }}
                  disabled={busy}
                  className={primaryButtonClass}
                >
                  <Save className="size-4" aria-hidden />
                  {save.isPending ? 'Saving…' : 'Save edits for review'}
                </button>
              )}
              {state?.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    translate.mutate();
                  }}
                  disabled={busy}
                  className={subtleButtonClass}
                >
                  <RefreshCw className="size-4" aria-hidden />
                  {translate.isPending ? 'Translating…' : 'Re-translate'}
                </button>
              )}
              {translation.status !== 'rejected' && !dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    reject.mutate();
                  }}
                  disabled={busy}
                  className={subtleButtonClass}
                >
                  <X className="size-4" aria-hidden />
                  Reject
                </button>
              )}
              {translation.status === 'approved' &&
                !translation.stale &&
                !translation.autoApproved && (
                  <p className="text-sm text-basil-700">
                    Live in the reader
                    {translation.approvedAt &&
                      ` — approved ${new Date(translation.approvedAt).toLocaleDateString()}`}
                    .
                  </p>
                )}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
