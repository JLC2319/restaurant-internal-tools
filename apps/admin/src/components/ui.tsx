import type { ReactNode } from 'react';

/**
 * The console's few repeated visual atoms. Class strings the customer app
 * writes inline are shared here instead — the console repeats them across
 * four tables, and a drifting table style is the kind of thing nobody catches
 * in an internal tool until it's everywhere.
 */

export const inputClass =
  'min-h-touch w-full rounded-md border border-salt-300 bg-white px-3 py-2 text-steel-900 outline-none focus:border-ember-500 focus:ring-2 focus:ring-ember-200';

export const primaryButtonClass =
  'min-h-touch rounded-md bg-ember-500 px-4 py-2 font-semibold text-white transition-colors hover:bg-ember-600 disabled:cursor-not-allowed disabled:opacity-60';

export const subtleButtonClass =
  'min-h-touch rounded-md border border-salt-300 bg-white px-3 py-1.5 text-sm font-medium text-steel-700 transition-colors hover:bg-salt-100 disabled:cursor-not-allowed disabled:opacity-60';

export const thClass =
  'px-3 py-2 text-left text-xs font-semibold tracking-wide text-salt-600 uppercase';

export const tdClass = 'px-3 py-2 text-sm text-steel-900';

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-chili-200 bg-chili-50 px-3 py-2 text-sm text-chili-700"
    >
      {children}
    </p>
  );
}

/**
 * Status → hue, consistent console-wide: active reads basil, suspended citron
 * (an administrative state someone should resolve), archived/revoked salt.
 * Chili stays reserved for allergen and danger, per the design system.
 */
const badgeTones: Record<string, string> = {
  active: 'bg-basil-100 text-basil-700',
  invited: 'bg-citron-100 text-citron-700',
  suspended: 'bg-citron-100 text-citron-700',
  archived: 'bg-salt-200 text-salt-700',
  revoked: 'bg-salt-200 text-salt-700',
  superAdmin: 'bg-ember-100 text-ember-700',
};

export function Badge({ value }: { value: string }) {
  const tone = badgeTones[value] ?? 'bg-salt-200 text-salt-700';
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-2xs font-medium tracking-wide uppercase ${tone}`}
    >
      {value}
    </span>
  );
}

/** Wraps a wide table so the page body never scrolls horizontally. */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-salt-300 bg-white shadow-sm">
      <table className="w-full min-w-[640px] divide-y divide-salt-200">{children}</table>
    </div>
  );
}
