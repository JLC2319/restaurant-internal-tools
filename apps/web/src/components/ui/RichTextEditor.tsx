import { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { emptyRichTextDoc } from '@rit/shared';
import type { RichTextDoc } from '@rit/shared';
import type { LucideIcon } from 'lucide-react';
import {
  Bold,
  Check,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
  Unlink,
  X,
} from 'lucide-react';

/**
 * The rich-text editor for training text — real WYSIWYG on TipTap
 * (ProseMirror): staff press Bold and see bold, pick sizes from a familiar
 * style dropdown, and paste from Word/Docs with the formatting we support
 * kept and everything else silently dropped by the editor schema.
 *
 * What leaves this component is the editor's JSON document, not HTML. The
 * server re-validates it against `richTextDocSchema` — an allow-list that
 * strips unknown nodes, marks and attributes — and the reader renders it
 * straight to React elements. No HTML is stored or injected anywhere.
 *
 * The extension set below and the shared schema must move together: enabling
 * a TipTap feature the schema does not know means saves start failing
 * validation.
 */

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    // Not offered in the toolbar and not in the shared schema:
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: {
      // Editing, not browsing: clicks place the caret instead of navigating.
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      protocols: ['http', 'https'],
    },
  }),
];

/** `https://` is assumed when omitted — staff paste bare domains constantly. */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function ToolButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's selection — a normal click would steal focus before
      // the command runs and the highlight would collapse.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'bg-ember-100 text-ember-700 shadow-xs ring-1 ring-ember-200 ring-inset'
          : 'text-steel-600 hover:bg-salt-100 hover:text-steel-900'
      }`}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-salt-300" />;
}

/** The Docs-style size picker: semantic styles, not raw pixel sizes. */
function textStyleOf(editor: Editor): string {
  if (editor.isActive('heading', { level: 1 })) return '1';
  if (editor.isActive('heading', { level: 2 })) return '2';
  if (editor.isActive('heading', { level: 3 })) return '3';
  return 'p';
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  ariaLabel = 'Rich text',
}: {
  /** The stored document, read once on mount — the editor owns it afterwards. */
  value: RichTextDoc | null;
  onChange: (doc: RichTextDoc) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [linkPanel, setLinkPanel] = useState<{ url: string; hasLink: boolean } | null>(null);

  const editor = useEditor(
    {
      extensions,
      content: value ?? emptyRichTextDoc(),
      // The page is server-rendered by Astro; the editor exists client-side only.
      immediatelyRender: false,
      // The toolbar reads isActive()/can() during render, so every transaction
      // (including selection moves) must re-render this component.
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: {
          class: 'rte-surface',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': ariaLabel,
          'data-placeholder': placeholder,
        },
      },
      onCreate: ({ editor }) => {
        editor.view.dom.dataset.empty = String(editor.isEmpty);
      },
      onUpdate: ({ editor }) => {
        onChange(editor.getJSON() as RichTextDoc);
        editor.view.dom.dataset.empty = String(editor.isEmpty);
      },
    },
    [],
  );

  const chain = () => editor!.chain().focus();
  const canLink = editor != null && (!editor.state.selection.empty || editor.isActive('link'));

  function applyTextStyle(next: string) {
    if (!editor) return;
    if (next === 'p') chain().setParagraph().run();
    else
      chain()
        .setHeading({ level: Number(next) as 1 | 2 | 3 })
        .run();
  }

  function openLinkPanel() {
    if (!editor) return;
    const existing = editor.getAttributes('link').href as string | undefined;
    setLinkPanel({ url: existing ?? '', hasLink: existing != null });
  }

  function applyLink() {
    if (!editor || !linkPanel) return;
    const url = normalizeUrl(linkPanel.url);
    if (!url) return;
    chain().extendMarkRange('link').setLink({ href: url }).run();
    setLinkPanel(null);
  }

  function removeLink() {
    if (!editor) return;
    chain().extendMarkRange('link').unsetLink().run();
    setLinkPanel(null);
  }

  const linkUrlValid = linkPanel != null && normalizeUrl(linkPanel.url) != null;

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-salt-300 transition-all duration-150 focus-within:ring-2 focus-within:ring-ember-400 hover:ring-salt-400 focus-within:hover:ring-ember-400">
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="flex flex-wrap items-center gap-0.5 border-b border-salt-200 bg-salt-50/70 px-1.5 py-1"
      >
        <select
          value={editor ? textStyleOf(editor) : 'p'}
          onChange={(e) => applyTextStyle(e.target.value)}
          disabled={!editor}
          aria-label="Text style"
          className="mr-1 min-h-touch cursor-pointer rounded-lg bg-white px-2.5 py-1.5 text-sm font-medium text-steel-800 shadow-xs ring-1 ring-salt-300 outline-none transition-all duration-150 hover:ring-salt-400 focus:ring-2 focus:ring-ember-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="p">Normal text</option>
          <option value="1">Heading</option>
          <option value="2">Subheading</option>
          <option value="3">Small heading</option>
        </select>

        <ToolButton
          icon={Bold}
          label="Bold"
          disabled={!editor}
          active={editor?.isActive('bold') ?? false}
          onPress={() => chain().toggleBold().run()}
        />
        <ToolButton
          icon={Italic}
          label="Italic"
          disabled={!editor}
          active={editor?.isActive('italic') ?? false}
          onPress={() => chain().toggleItalic().run()}
        />
        <ToolButton
          icon={Underline}
          label="Underline"
          disabled={!editor}
          active={editor?.isActive('underline') ?? false}
          onPress={() => chain().toggleUnderline().run()}
        />
        <ToolButton
          icon={Strikethrough}
          label="Strikethrough"
          disabled={!editor}
          active={editor?.isActive('strike') ?? false}
          onPress={() => chain().toggleStrike().run()}
        />
        <Divider />
        <ToolButton
          icon={List}
          label="Bullet list"
          disabled={!editor}
          active={editor?.isActive('bulletList') ?? false}
          onPress={() => chain().toggleBulletList().run()}
        />
        <ToolButton
          icon={ListOrdered}
          label="Numbered list"
          disabled={!editor}
          active={editor?.isActive('orderedList') ?? false}
          onPress={() => chain().toggleOrderedList().run()}
        />
        <ToolButton
          icon={TextQuote}
          label="Callout"
          disabled={!editor}
          active={editor?.isActive('blockquote') ?? false}
          onPress={() => chain().toggleBlockquote().run()}
        />
        <Divider />
        <ToolButton
          icon={Link2}
          label={
            editor?.isActive('link')
              ? 'Edit link'
              : canLink
                ? 'Add link'
                : 'Select some text to link it'
          }
          active={editor?.isActive('link') ?? false}
          disabled={!canLink}
          onPress={openLinkPanel}
        />
        <span className="ml-auto flex items-center gap-0.5">
          <ToolButton
            icon={Undo2}
            label="Undo"
            disabled={!editor?.can().undo()}
            onPress={() => chain().undo().run()}
          />
          <ToolButton
            icon={Redo2}
            label="Redo"
            disabled={!editor?.can().redo()}
            onPress={() => chain().redo().run()}
          />
        </span>
      </div>

      {linkPanel && (
        <div className="animate-fade-up flex items-center gap-2 border-b border-salt-200 bg-salt-50/70 px-2.5 py-2">
          <Link2 className="size-4 shrink-0 text-salt-500" aria-hidden />
          <input
            type="url"
            autoFocus
            aria-label="Link address"
            placeholder="Paste or type a link — example.com"
            value={linkPanel.url}
            onChange={(e) => setLinkPanel({ ...linkPanel, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') setLinkPanel(null);
            }}
            className="min-h-touch w-full flex-1 rounded-lg bg-white px-3 py-1.5 text-sm text-steel-900 shadow-xs ring-1 ring-salt-300 outline-none placeholder:text-salt-500 focus:ring-2 focus:ring-ember-400"
          />
          <button
            type="button"
            onClick={applyLink}
            disabled={!linkUrlValid}
            className="inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-lg bg-steel-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-steel-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="size-4" aria-hidden />
            Apply
          </button>
          {linkPanel.hasLink && (
            <button
              type="button"
              onClick={removeLink}
              title="Remove link"
              aria-label="Remove link"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-steel-600 transition-colors hover:bg-salt-100 hover:text-steel-900"
            >
              <Unlink className="size-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => setLinkPanel(null)}
            title="Close"
            aria-label="Close link editor"
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-salt-500 transition-colors hover:bg-salt-100 hover:text-steel-800"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Before the client-side editor exists (SSR + first frame) an empty
          surface keeps the layout stable. */}
      {editor ? <EditorContent editor={editor} /> : <div className="rte-surface" aria-hidden />}
    </div>
  );
}
