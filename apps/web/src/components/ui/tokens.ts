/**
 * The customer app's shared visual atoms. One design language everywhere:
 * soft 2xl radii, ring-based borders, layered shadows, and a restrained
 * motion vocabulary (fade-up entrances, shimmer skeletons — see global.css).
 * Chili stays reserved for allergen tags and danger, per the design system —
 * review states read citron, published/approved reads basil.
 */

export const inputClass =
  'min-h-touch w-full rounded-xl bg-white px-3.5 py-2.5 text-steel-900 shadow-xs ring-1 ring-salt-300 outline-none transition-all duration-150 placeholder:text-salt-500 hover:ring-salt-400 focus:bg-white focus:ring-2 focus:ring-ember-400'

export const primaryButtonClass =
  'inline-flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-xl bg-linear-to-b from-ember-500 to-ember-600 px-4 py-2.5 font-semibold text-white shadow-md shadow-ember-600/25 transition-all duration-150 hover:shadow-lg hover:shadow-ember-600/30 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-500'

export const subtleButtonClass =
  'inline-flex min-h-touch cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-steel-700 shadow-xs ring-1 ring-salt-300 transition-all duration-150 hover:bg-salt-50 hover:ring-salt-400 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel-500'

/** The one card surface. Interactive cards add `cardHoverClass` on top. */
export const cardClass = 'rounded-2xl bg-white shadow-sm ring-1 ring-salt-200'

export const cardHoverClass =
  'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-steel-900/5 hover:ring-salt-300'

export const thClass =
  'px-4 py-3 text-left text-xs font-semibold tracking-wide text-salt-600 uppercase'

export const tdClass = 'px-4 py-3 text-sm text-steel-900'
