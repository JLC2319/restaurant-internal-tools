import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MembershipSummary } from '@rit/shared'
import { Building2, Check, Settings, UserRound } from 'lucide-react'
import { getMyMemberships } from '../api/auth'
import { getScope, setScope, clearAuth } from '../api/client'
import { QueryProvider } from './QueryProvider'
import { cardClass } from './ui'

function label(m: MembershipSummary): string {
  if (m.location) return `${m.org.name} › ${m.property?.name} › ${m.location.name}`
  if (m.property) return `${m.org.name} › ${m.property.name}`
  return m.org.name
}

function matchesActive(m: MembershipSummary): boolean {
  const active = getScope()
  if (!active) return false
  return (
    active.orgId === m.org._id &&
    (active.propertyId ?? null) === (m.property?._id ?? null) &&
    (active.locationId ?? null) === (m.location?._id ?? null)
  )
}

const iconButtonClass =
  'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-salt-600 transition-all duration-150 hover:bg-salt-100 hover:text-steel-900'

/** The org menu: switch scope (when there is more than one) + org settings. */
function OrgMenu() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'memberships'],
    queryFn: async () => {
      const result = await getMyMemberships()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  // Close on outside click or Escape — the standard popover contract.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const memberships = data ?? []

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Organization"
        title="Organization"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${iconButtonClass} ${open ? 'bg-salt-100 text-steel-900' : ''}`}
      >
        <Building2 className="size-4.5" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden py-1.5 shadow-lg shadow-steel-900/10 ${cardClass} animate-fade-up`}
        >
          {isLoading ? (
            <p className="px-4 py-2.5 text-sm text-salt-500">Loading…</p>
          ) : (
            memberships.length > 0 && (
              <>
                <p className="px-4 pt-2 pb-1 text-2xs font-semibold tracking-wide text-salt-500 uppercase">
                  Workspace
                </p>
                {memberships.map((m) => {
                  const active = matchesActive(m)
                  return (
                    <button
                      key={m._id}
                      type="button"
                      role="menuitem"
                      disabled={active}
                      onClick={() => {
                        setScope({
                          orgId: m.org._id,
                          propertyId: m.property?._id ?? null,
                          locationId: m.location?._id ?? null,
                        })
                        // A full reload is the honest move here: every cached
                        // query in the app is scoped, so keeping any of it
                        // across a scope change would show one tenant's data
                        // under another's header.
                        window.location.reload()
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors duration-150 ${
                        active
                          ? 'cursor-default font-medium text-steel-900'
                          : 'text-steel-700 hover:bg-salt-50 hover:text-steel-900'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{label(m)}</span>
                      {active && <Check className="size-4 shrink-0 text-ember-600" aria-hidden />}
                    </button>
                  )
                })}
                <div className="my-1.5 border-t border-salt-200" aria-hidden />
              </>
            )
          )}
          <a
            role="menuitem"
            href="/organization"
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-steel-700 transition-colors duration-150 hover:bg-salt-50 hover:text-steel-900"
          >
            <Settings className="size-4 shrink-0 text-salt-500" aria-hidden />
            Organization settings
          </a>
        </div>
      )}
    </div>
  )
}

function Switcher() {
  return (
    <div className="flex items-center gap-1">
      <OrgMenu />

      <a href="/profile" aria-label="Your profile" title="Your profile" className={iconButtonClass}>
        <UserRound className="size-4.5" aria-hidden />
      </a>

      <button
        type="button"
        onClick={() => {
          clearAuth()
          window.location.href = '/login'
        }}
        className="min-h-touch cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium text-salt-600 transition-all duration-150 hover:bg-salt-100 hover:text-steel-900"
      >
        Sign out
      </button>
    </div>
  )
}

export function ScopeSwitcher() {
  return (
    <QueryProvider>
      <Switcher />
    </QueryProvider>
  )
}
