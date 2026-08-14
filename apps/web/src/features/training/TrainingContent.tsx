import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TrainingBlockView, TrainingDetail as TrainingDetailData } from '@rit/shared';
import { CheckCircle2, GraduationCap, RotateCcw } from 'lucide-react';
import { completeTraining, uncompleteTraining } from '@/features/training/api';
import { RichText } from '@/components/ui/RichText';
import { ErrorNote, primaryButtonClass } from '@/components/ui';

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
const breakoutClass = 'tablet:-mx-6';

function Caption({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <figcaption className="px-4 text-center text-sm leading-relaxed text-salt-500">
      {text}
    </figcaption>
  );
}

export function BlockView({ block, index }: { block: TrainingBlockView; index: number }) {
  switch (block.kind) {
    case 'text':
      return <RichText doc={block.doc} />;

    case 'image':
      // Asset deleted out from under the module — skip rather than render broken.
      if (!block.media) return null;
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
      );

    case 'video':
      if (!block.media) return null;
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
      );

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
      );
  }
}

export function CompletionCard({ training }: { training: TrainingDetailData }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const done = training.myCompletion != null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['trainings'] });

  const complete = useMutation({
    mutationFn: async () => {
      const result = await completeTraining(training._id);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const uncomplete = useMutation({
    mutationFn: async () => {
      const result = await uncompleteTraining(training._id);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  if (training.status !== 'published') return null;

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
  );
}
