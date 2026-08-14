import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, TriangleAlert } from 'lucide-react';
import { cardClass } from './tokens';

/**
 * The "the AI is cooking" modal. LLM calls run tens of seconds — long enough
 * that a silent disabled button reads as a hang — so anything that triggers
 * one raises this overlay: a spinner, a rotating line of playful status text,
 * and the one instruction that matters (don't close the page — the request
 * dies with the tab).
 *
 * Purely presentational: it appears while `active` and cannot be dismissed,
 * because there is nothing sensible to do but wait or leave.
 *
 * Rendered into `document.body` rather than in place. `position: fixed` is
 * resolved against the nearest ancestor with a transform, filter or
 * backdrop-filter — not the viewport — and this overlay is mounted deep inside
 * page content that may have any of those. A modal that dims "most of the
 * screen" looks broken, so it does not rely on its ancestors behaving.
 */

const ROTATE_MS = 2600;

export function WorkingOverlay({
  active,
  title,
  messages,
}: {
  active: boolean;
  title: string;
  messages: readonly string[];
}) {
  const [index, setIndex] = useState(0);
  // These are Astro islands: the first render happens on the server, where
  // there is no `document` to portal into.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const timer = window.setInterval(
      () => setIndex((previous) => (previous + 1) % messages.length),
      ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [active, messages.length]);

  if (!active || !mounted) return null;

  return createPortal(
    <div
      role="alert"
      aria-busy="true"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-steel-900/40 p-6 backdrop-blur-sm"
    >
      <div className={`${cardClass} animate-fade-up w-full max-w-sm space-y-4 p-6 text-center`}>
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset">
          <Loader2 className="size-7 animate-spin" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="font-semibold text-steel-900">{title}</p>
          {/* Keyed so each line re-enters with the house fade-up. */}
          <p key={index} className="animate-fade-up min-h-10 text-sm text-salt-600">
            {messages[index]}
          </p>
        </div>
        <p className="flex items-center justify-center gap-1.5 rounded-xl bg-citron-50 px-3 py-2 text-xs font-medium text-citron-700 ring-1 ring-citron-200 ring-inset">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          Please keep this page open — closing it cancels the work.
        </p>
      </div>
    </div>,
    document.body,
  );
}
