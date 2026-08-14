import type { ReactNode } from 'react';

/**
 * An on/off switch for a setting that takes effect elsewhere — "publish this on
 * save" rather than "select this tag". Distinct from `TogglePill`, which picks
 * items out of a set; a switch answers one yes/no question, so it carries its
 * own label and reads as a state rather than a selection.
 */
export function Switch({
  id,
  checked,
  onChange,
  disabled = false,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full ring-1 transition-colors duration-150 ring-inset ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        } ${checked ? 'bg-ember-600 ring-ember-600' : 'bg-salt-200 ring-salt-300'}`}
      >
        <span
          className={`inline-block size-4.5 rounded-full bg-white shadow-xs transition-transform duration-150 ${
            checked ? 'translate-x-[1.4rem]' : 'translate-x-[0.2rem]'
          }`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-steel-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-salt-600">{hint}</span>}
      </span>
    </label>
  );
}
