import type { ReactNode } from 'react';

/**
 * Selectable pill for tag pickers (allergens, dietary). A checkbox in modern
 * clothes — `selectedClass` sets the tone so allergens can read chili while
 * dietary reads basil.
 */
export function TogglePill({
  selected,
  onToggle,
  selectedClass,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  selectedClass: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={`inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition-all duration-150 active:scale-[0.97] ${
        selected
          ? selectedClass
          : 'bg-white text-salt-600 ring-salt-300 hover:text-steel-800 hover:ring-salt-400'
      }`}
    >
      {children}
    </button>
  );
}
