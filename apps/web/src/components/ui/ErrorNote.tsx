import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-chili-50 px-4 py-3 text-sm text-chili-700 ring-1 ring-chili-200 ring-inset"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
