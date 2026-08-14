import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MediaAssetView, RichTextDoc, TrainingBlockInput } from '@rit/shared';
import {
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  docToPlainText,
  imageMimeValues,
  parseVideoEmbed,
} from '@rit/shared';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clapperboard,
  FileText,
  Film,
  ImagePlus,
  Loader2,
  MonitorPlay,
  Plus,
  Save,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { uploadPhoto, uploadVideo } from '@/lib/api/media';
import { getTraining, trainingsScopeKey, updateTraining } from '@/features/training/api';
import { QueryProvider } from '@/lib/QueryProvider';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
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
 * The training module editor: title + description, then an ordered list of
 * content blocks — rich text, photos, uploaded video (streamed with a real
 * progress bar), and YouTube/Vimeo embeds.
 *
 * Uploads land immediately (they are their own asset), but attaching one to
 * the module is part of the save like any other content change — this only
 * ever edits local form state, and "Save changes" is what commits it.
 */

interface BlockRow {
  /** Stable identity across reorders — index keys would remount the editors and players. */
  key: number;
  kind: 'text' | 'image' | 'video' | 'embed';
  doc: RichTextDoc | null;
  caption: string;
  url: string;
  media: MediaAssetView | null;
}

interface FormState {
  title: string;
  description: string;
  blocks: BlockRow[];
}

const BLOCK_LABEL: Record<BlockRow['kind'], string> = {
  text: 'Text',
  image: 'Photo',
  video: 'Video',
  embed: 'YouTube / Vimeo',
};

const BLOCK_ICON: Record<BlockRow['kind'], typeof Type> = {
  text: Type,
  image: ImagePlus,
  video: Film,
  embed: MonitorPlay,
};

let nextKey = 1;
function newRow(kind: BlockRow['kind']): BlockRow {
  return { key: nextKey++, kind, doc: null, caption: '', url: '', media: null };
}

// ── Image block ───────────────────────────────────────────────────────────────

function ImageBlockEditor({
  row,
  onChange,
  onError,
}: {
  row: BlockRow;
  onChange: (update: Partial<BlockRow>) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      onError(`“${file.name}” is larger than ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)}MB.`);
      return;
    }
    setUploading(true);
    const result = await uploadPhoto(file);
    setUploading(false);
    if (result.error) {
      onError(result.error.message);
      return;
    }
    onChange({ media: result.data });
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={imageMimeValues.join(',')}
        className="sr-only"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {row.media ? (
        <div className="group relative overflow-hidden rounded-xl bg-salt-100 ring-1 ring-salt-200 ring-inset">
          <img
            src={row.media.url}
            alt=""
            width={row.media.width ?? undefined}
            height={row.media.height ?? undefined}
            className="max-h-80 w-full object-contain"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="absolute right-2.5 bottom-2.5 inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-xl bg-steel-900/80 px-3.5 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-steel-900"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4" aria-hidden />
            )}
            Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-salt-300 bg-salt-50 px-4 py-8 text-sm font-medium text-salt-600 transition-colors hover:border-ember-300 hover:bg-ember-50/40 hover:text-ember-700"
        >
          {uploading ? (
            <Loader2 className="size-6 animate-spin" aria-hidden />
          ) : (
            <ImagePlus className="size-6" aria-hidden />
          )}
          {uploading ? 'Uploading…' : 'Choose a photo — JPEG, PNG or WebP'}
        </button>
      )}

      <input
        type="text"
        aria-label="Photo caption"
        maxLength={300}
        placeholder="Caption (optional)"
        value={row.caption}
        onChange={(e) => onChange({ caption: e.target.value })}
        className={inputClass}
      />
    </div>
  );
}

// ── Video block ───────────────────────────────────────────────────────────────

const VIDEO_MAX_MB = Math.round(MAX_VIDEO_BYTES / 1024 / 1024);

function VideoBlockEditor({
  row,
  onChange,
  onError,
}: {
  row: BlockRow;
  onChange: (update: Partial<BlockRow>) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      onError(`“${file.name}” is larger than ${VIDEO_MAX_MB}MB.`);
      return;
    }
    if (file.type === 'video/quicktime') {
      onError(
        `“${file.name}” is a QuickTime (.mov) file, which many devices cannot play. Export it as MP4 and upload that.`,
      );
      return;
    }
    setProgress(0);
    const result = await uploadVideo(file, setProgress);
    setProgress(null);
    if (result.error) {
      onError(result.error.message);
      return;
    }
    onChange({ media: result.data });
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="sr-only"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {row.media ? (
        <div className="space-y-2">
          {/* preload="metadata": the player fetches only the header, then
              range-requests the rest from the CDN as it plays. */}
          <video
            src={row.media.url}
            controls
            preload="metadata"
            playsInline
            className="max-h-96 w-full rounded-xl bg-steel-900 ring-1 ring-salt-200"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={subtleButtonClass}
          >
            <Upload className="size-4" aria-hidden />
            Replace video
          </button>
        </div>
      ) : progress != null ? (
        <div className="space-y-2.5 rounded-xl bg-salt-50 px-4 py-5 ring-1 ring-salt-200 ring-inset">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-2 font-medium text-steel-800">
              <Loader2 className="size-4 animate-spin text-ember-600" aria-hidden />
              Streaming to storage…
            </span>
            <span className="font-mono text-xs font-semibold text-steel-700">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded-full bg-salt-200"
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-ember-400 to-ember-600 transition-[width] duration-200"
              style={{ width: `${Math.max(2, progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-salt-500">
            Keep this page open — the video is streaming straight through to storage.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-salt-300 bg-salt-50 px-4 py-8 text-sm font-medium text-salt-600 transition-colors hover:border-ember-300 hover:bg-ember-50/40 hover:text-ember-700"
        >
          <Clapperboard className="size-6" aria-hidden />
          Choose a video — MP4 or WebM, up to {VIDEO_MAX_MB}MB
        </button>
      )}

      <input
        type="text"
        aria-label="Video caption"
        maxLength={300}
        placeholder="Caption (optional)"
        value={row.caption}
        onChange={(e) => onChange({ caption: e.target.value })}
        className={inputClass}
      />
    </div>
  );
}

// ── Embed block ───────────────────────────────────────────────────────────────

function EmbedBlockEditor({
  row,
  onChange,
}: {
  row: BlockRow;
  onChange: (update: Partial<BlockRow>) => void;
}) {
  const embed = row.url.trim() ? parseVideoEmbed(row.url) : null;

  return (
    <div className="space-y-3">
      <div>
        <input
          type="url"
          aria-label="Video URL"
          placeholder="Paste a YouTube or Vimeo link…"
          value={row.url}
          onChange={(e) => onChange({ url: e.target.value })}
          className={inputClass}
        />
        {row.url.trim() !== '' && !embed && (
          <p className="mt-1.5 text-xs font-medium text-citron-600">
            That does not look like a YouTube or Vimeo video link.
          </p>
        )}
      </div>

      {/* No sandbox: YouTube's player refuses playback in a sandboxed frame,
          and the src is already the server-side allow-list construction. */}
      {embed && (
        <iframe
          src={embed.embedSrc}
          title="Embedded video preview"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video w-full rounded-xl bg-steel-900 ring-1 ring-salt-200"
        />
      )}

      <input
        type="text"
        aria-label="Embed caption"
        maxLength={300}
        placeholder="Caption (optional)"
        value={row.caption}
        onChange={(e) => onChange({ caption: e.target.value })}
        className={inputClass}
      />
    </div>
  );
}

// ── The editor ────────────────────────────────────────────────────────────────

function Editor({ trainingId }: { trainingId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: training, error: loadError } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'detail', trainingId],
    queryFn: async () => {
      const result = await getTraining(trainingId);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  useEffect(() => {
    if (!training || form !== null) return;
    setForm({
      title: training.title,
      description: training.description,
      blocks: training.blocks
        // A media block whose asset was deleted has nothing left to save.
        .filter((block) => block.kind === 'text' || block.kind === 'embed' || block.media != null)
        .map((block) => ({
          ...newRow(block.kind),
          doc: block.kind === 'text' ? block.doc : null,
          caption: block.kind !== 'text' ? (block.caption ?? '') : '',
          url: block.kind === 'embed' ? block.url : '',
          media: block.kind === 'image' || block.kind === 'video' ? block.media : null,
        })),
    });
  }, [training, form]);

  const save = useMutation({
    mutationFn: async (state: FormState) => {
      const blocks: TrainingBlockInput[] = state.blocks.map((row) => {
        switch (row.kind) {
          case 'text':
            // Validated non-empty in handleSubmit before this runs.
            return { kind: 'text', doc: row.doc! };
          case 'image':
          case 'video':
            return {
              kind: row.kind,
              mediaId: row.media?._id ?? '',
              ...(row.caption.trim() ? { caption: row.caption } : {}),
            };
          case 'embed':
            return {
              kind: 'embed',
              url: row.url,
              ...(row.caption.trim() ? { caption: row.caption } : {}),
            };
        }
      });
      const result = await updateTraining(trainingId, {
        title: state.title,
        description: state.description,
        blocks,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainings'] });
      window.location.href = `/training/${trainingId}`;
    },
    onError: (err: Error) => setError(err.message),
  });

  if (loadError) return <ErrorNote>{loadError.message}</ErrorNote>;
  if (!training || !form)
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  if (!training.canManage)
    return <ErrorNote>You do not have access to edit this training.</ErrorNote>;

  const patch = (update: Partial<FormState>) => setForm({ ...form, ...update });
  const patchRow = (key: number, update: Partial<BlockRow>) =>
    patch({ blocks: form.blocks.map((row) => (row.key === key ? { ...row, ...update } : row)) });
  const moveRow = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= form.blocks.length) return;
    const blocks = [...form.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    patch({ blocks });
  };
  const addRow = (kind: BlockRow['kind']) => patch({ blocks: [...form.blocks, newRow(kind)] });

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!form) return;

    for (const [index, row] of form.blocks.entries()) {
      const label = `Section ${index + 1}`;
      if (row.kind === 'text' && (!row.doc || docToPlainText(row.doc).trim() === '')) {
        setError(`${label} is an empty text block — write something or remove it.`);
        return;
      }
      if ((row.kind === 'image' || row.kind === 'video') && !row.media) {
        setError(
          `${label} has no ${row.kind === 'image' ? 'photo' : 'video'} yet — upload one or remove it.`,
        );
        return;
      }
      if (row.kind === 'embed' && !parseVideoEmbed(row.url)) {
        setError(`${label} needs a valid YouTube or Vimeo link.`);
        return;
      }
    }
    save.mutate(form);
  }

  const addButtons: { kind: BlockRow['kind']; icon: typeof Type; label: string }[] = [
    { kind: 'text', icon: Type, label: 'Text' },
    { kind: 'image', icon: ImagePlus, label: 'Photo' },
    { kind: 'video', icon: Film, label: 'Video' },
    { kind: 'embed', icon: MonitorPlay, label: 'YouTube / Vimeo' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-24">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-steel-900">Edit training</h1>
        <Badge value={training.status} />
      </header>
      {training.status === 'archived' && (
        <ErrorNote>This training is archived and read-only. Unarchive it to edit.</ErrorNote>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      <SectionCard icon={FileText} title="Basics" hint="What staff see on the training card.">
        <div className="grid gap-4">
          <div>
            <label htmlFor="edit-title" className="mb-1.5 block text-sm font-medium text-steel-700">
              Title
            </label>
            <input
              id="edit-title"
              type="text"
              required
              minLength={2}
              maxLength={140}
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="edit-description"
              className="mb-1.5 block text-sm font-medium text-steel-700"
            >
              Description
            </label>
            <textarea
              id="edit-description"
              maxLength={500}
              rows={2}
              placeholder="One or two sentences on what this module covers."
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>
      </SectionCard>

      {form.blocks.length === 0 && (
        <p className="rounded-2xl bg-salt-50 px-4 py-10 text-center text-sm text-salt-500 ring-1 ring-salt-200 ring-inset">
          No content yet — add the first section below.
        </p>
      )}

      <ol className="space-y-5">
        {form.blocks.map((row, index) => {
          const Icon = BLOCK_ICON[row.kind];
          return (
            <li key={row.key} className="animate-fade-up">
              <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-salt-200 transition-shadow duration-200 focus-within:shadow-md hover:shadow-md tablet:p-6">
                <header className="mb-5 flex items-center gap-3 border-b border-salt-100 pb-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs font-semibold tracking-widest text-salt-500 uppercase">
                      Section {index + 1}
                    </p>
                    <p className="text-sm font-semibold text-steel-900">{BLOCK_LABEL[row.kind]}</p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`Move section ${index + 1} up`}
                      onClick={() => moveRow(index, -1)}
                      disabled={index === 0}
                      className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-salt-500 transition-colors hover:bg-salt-100 hover:text-steel-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move section ${index + 1} down`}
                      onClick={() => moveRow(index, 1)}
                      disabled={index === form.blocks.length - 1}
                      className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-salt-500 transition-colors hover:bg-salt-100 hover:text-steel-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove section ${index + 1}`}
                      onClick={() =>
                        patch({ blocks: form.blocks.filter((other) => other.key !== row.key) })
                      }
                      className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-salt-500 transition-colors hover:bg-chili-50 hover:text-chili-600"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </header>

                {row.kind === 'text' && (
                  <RichTextEditor
                    value={row.doc}
                    onChange={(doc) => patchRow(row.key, { doc })}
                    ariaLabel={`Section ${index + 1} text`}
                    placeholder="Write this section — sizes, bold text, lists and links live in the toolbar above."
                  />
                )}
                {row.kind === 'image' && (
                  <ImageBlockEditor
                    row={row}
                    onChange={(update) => patchRow(row.key, update)}
                    onError={setError}
                  />
                )}
                {row.kind === 'video' && (
                  <VideoBlockEditor
                    row={row}
                    onChange={(update) => patchRow(row.key, update)}
                    onError={setError}
                  />
                )}
                {row.kind === 'embed' && (
                  <EmbedBlockEditor row={row} onChange={(update) => patchRow(row.key, update)} />
                )}
              </section>
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border-2 border-dashed border-salt-300 bg-salt-50/60 p-4 tablet:p-5">
        <p className="mb-3.5 flex items-center gap-1.5 text-sm font-semibold text-steel-800">
          <Plus className="size-4 text-ember-600" aria-hidden />
          Add a section
        </p>
        <div className="grid grid-cols-2 gap-2.5 tablet:grid-cols-4">
          {addButtons.map(({ kind, icon: Icon, label }) => (
            <button
              key={kind}
              type="button"
              onClick={() => addRow(kind)}
              className="group flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl bg-white px-3 py-4 text-sm font-medium text-steel-700 shadow-xs ring-1 ring-salt-200 transition-all duration-150 hover:-translate-y-0.5 hover:text-steel-900 hover:shadow-md hover:shadow-steel-900/5 hover:ring-salt-300 active:scale-[0.98]"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset transition-transform duration-200 group-hover:scale-110">
                <Icon className="size-4.5" aria-hidden />
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-salt-200/80 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-3 tablet:px-6">
          <button
            type="submit"
            disabled={save.isPending || training.status === 'archived'}
            className={primaryButtonClass}
          >
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <a href={`/training/${trainingId}`} className={subtleButtonClass}>
            Cancel
          </a>
          <p className="ml-auto hidden items-center gap-1.5 text-xs text-salt-500 tablet:flex">
            {training.status === 'published' ? (
              <>
                <Check className="size-3.5 text-basil-600" aria-hidden />
                This training is live — saved changes reach staff immediately.
              </>
            ) : (
              'Drafts are only visible to chefs and managers until published.'
            )}
          </p>
        </div>
      </div>
    </form>
  );
}

export function TrainingEditor({ trainingId }: { trainingId: string }) {
  return (
    <QueryProvider>
      <Editor trainingId={trainingId} />
    </QueryProvider>
  );
}
