import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * The settings-page chrome: a vertical sidebar on laptop and up, a horizontal
 * tab strip below it, and one section rendered at a time.
 *
 * Sections are data, not markup — adding one means adding an entry to the
 * array a page passes in, and the nav, deep link and empty-state handling come
 * with it. That is the point: this page grows every time the product gains a
 * tenant-level setting, and it must not become a scroll.
 *
 * The active section lives in the URL hash, so a link to `#translation` opens
 * there, reloads keep their place, and back/forward work. Nothing reads
 * `window` during render — these islands are server-rendered before hydration.
 */

export interface SettingsSection {
  /** Stable id — it is the URL hash, so treat a rename as a broken bookmark. */
  id: string
  label: string
  icon: LucideIcon
  /**
   * Rendered only while the section is active. Sections carry their own
   * `SectionCard` header, so the shell adds no heading of its own — one title
   * per panel, not two.
   */
  render: () => ReactNode
}

/** Reads the active section from the hash, ignoring hashes we do not own. */
function useHashSection(ids: string[], fallback: string): [string, (id: string) => void] {
  const [active, setActive] = useState(fallback)
  const key = ids.join('|')

  useEffect(() => {
    const read = () => {
      const id = window.location.hash.replace(/^#/, '')
      setActive(id && ids.includes(id) ? id : fallback)
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
    // `key` stands in for the id list; `ids` is a fresh array every render.
  }, [key, fallback])

  return [
    active,
    (id: string) => {
      // Writing the hash drives the state through the listener above, so the
      // URL and what is on screen can never disagree.
      window.location.hash = id
    },
  ]
}

function NavItem({
  section,
  isActive,
  orientation,
  onSelect,
}: {
  section: SettingsSection
  isActive: boolean
  orientation: 'vertical' | 'horizontal'
  onSelect: () => void
}) {
  const Icon = section.icon
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`settings-panel-${section.id}`}
      onClick={onSelect}
      className={`inline-flex min-h-touch cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 ${
        orientation === 'vertical' ? 'w-full justify-start text-left' : 'shrink-0 whitespace-nowrap'
      } ${
        isActive
          ? 'bg-ember-50 text-ember-700 ring-1 ring-ember-200 ring-inset'
          : 'text-salt-600 hover:bg-salt-100 hover:text-steel-900'
      }`}
    >
      <Icon className={`size-4 shrink-0 ${isActive ? 'text-ember-600' : 'text-salt-500'}`} aria-hidden />
      {section.label}
    </button>
  )
}

export function SettingsShell({
  sections,
  ariaLabel,
  aside,
}: {
  sections: SettingsSection[]
  ariaLabel: string
  /** Optional identity block above the nav — the org header, for instance. */
  aside?: ReactNode
}) {
  const ids = sections.map((section) => section.id)
  const [activeId, select] = useHashSection(ids, ids[0] ?? '')
  const active = sections.find((section) => section.id === activeId) ?? sections[0]

  if (!active) return null

  return (
    <div className="space-y-5">
      {aside}

      <div className="flex flex-col gap-6 laptop:flex-row laptop:gap-8">
        {/* Below laptop the nav is a scrollable strip; the page body itself
            must never scroll sideways, so the overflow lives here. */}
        <nav
          role="tablist"
          aria-label={ariaLabel}
          aria-orientation="horizontal"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 laptop:hidden"
        >
          {sections.map((section) => (
            <NavItem
              key={section.id}
              section={section}
              isActive={section.id === active.id}
              orientation="horizontal"
              onSelect={() => select(section.id)}
            />
          ))}
        </nav>

        <nav
          role="tablist"
          aria-label={ariaLabel}
          aria-orientation="vertical"
          className="hidden w-56 shrink-0 laptop:block"
        >
          <div className="sticky top-6 space-y-1">
            {sections.map((section) => (
              <NavItem
                key={section.id}
                section={section}
                isActive={section.id === active.id}
                orientation="vertical"
                onSelect={() => select(section.id)}
              />
            ))}
          </div>
        </nav>

        <div
          key={active.id}
          id={`settings-panel-${active.id}`}
          role="tabpanel"
          aria-label={active.label}
          className="animate-fade-up min-w-0 flex-1 space-y-5"
        >
          {active.render()}
        </div>
      </div>
    </div>
  )
}
