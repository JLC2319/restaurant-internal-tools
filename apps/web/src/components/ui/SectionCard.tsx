import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cardClass } from './tokens';

/** A titled section card — the editor and detail pages are built from these. */
export function SectionCard({
  icon: Icon,
  title,
  hint,
  children,
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`${cardClass} p-5 tablet:p-6`}>
      <header className="mb-4 flex flex-wrap items-center gap-3">
        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600 ring-1 ring-ember-100 ring-inset">
            <Icon className="size-4.5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-steel-900">{title}</h2>
          {hint && <p className="text-xs text-salt-600">{hint}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
