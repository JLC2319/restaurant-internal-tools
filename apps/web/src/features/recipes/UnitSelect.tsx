import type { Unit } from '@rit/shared';
import { unitValues, unitFamily } from '@rit/shared';
import { inputClass } from '@/components/ui';

/** Unit select grouped by family, so "qt" is never a scroll past "kg". */
export function UnitSelect({
  id,
  value,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: Unit;
  onChange: (unit: Unit) => void;
  ariaLabel?: string;
}) {
  const families: Record<string, Unit[]> = { weight: [], volume: [], count: [] };
  for (const unit of unitValues) families[unitFamily[unit]].push(unit);
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as Unit)}
      className={inputClass}
    >
      {Object.entries(families).map(([family, units]) => (
        <optgroup key={family} label={family}>
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
