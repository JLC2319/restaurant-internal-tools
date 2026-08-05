import { useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OrganizationProfile, UpdateOrganizationInput } from '@rit/shared'
import { roleAtLeast } from '@rit/shared'
import {
  Building2,
  Check,
  Contact,
  ImageIcon,
  MapPin,
  Network,
  Trash2,
  Upload,
} from 'lucide-react'
import { getOrganization, getTenantTree, tenancyScopeKey, updateOrganization } from '../api/tenancy'
import { uploadPhoto } from '../api/media'
import { getScope } from '../api/client'
import { useActiveRole } from './useActiveRole'
import { QueryProvider } from './QueryProvider'
import {
  Badge,
  ErrorNote,
  SectionCard,
  Skeleton,
  TogglePill,
  inputClass,
  primaryButtonClass,
  subtleButtonClass,
} from './ui'

/** '' → null so a cleared field clears the stored value instead of failing Zod. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function SavedTick({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-basil-600">
      <Check className="size-4" aria-hidden />
      Saved
    </span>
  )
}

/** One mutation shape shared by every card below: PATCH then refresh the cache. */
function useOrgMutation(onDone: () => void, onError: (message: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateOrganizationInput) => {
      const result = await updateOrganization(input)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', 'profile', ...tenancyScopeKey()], updated)
      onDone()
    },
    onError: (err: Error) => onError(err.message),
  })
}

function OrgHeader({ org }: { org: OrganizationProfile }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-salt-200 tablet:p-6">
      {org.logo ? (
        <img
          src={org.logo.url}
          alt={`${org.name} logo`}
          className="size-16 shrink-0 rounded-2xl bg-salt-100 object-cover ring-1 ring-salt-200"
        />
      ) : (
        <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-steel-500 to-steel-700 text-white shadow-md shadow-steel-700/25">
          <Building2 className="size-7" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold text-steel-900">{org.name}</h2>
        <p className="truncate font-mono text-sm text-salt-500">/{org.slug}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge value={org.status} />
        <span className="text-xs text-salt-500">
          Since {new Date(org.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}

function DetailsForm({ org, canEdit }: { org: OrganizationProfile; canEdit: boolean }) {
  const [name, setName] = useState(org.name)
  const [spanish, setSpanish] = useState(org.locales.includes('es'))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = useOrgMutation(() => setSaved(true), setError)

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    save.mutate({
      name: name.trim(),
      locales: spanish ? ['en', 'es'] : ['en'],
    })
  }

  return (
    <SectionCard icon={Building2} title="Details" hint="Name and publishing languages">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <div>
          <label htmlFor="org-name" className="mb-1.5 block text-sm font-medium text-steel-700">
            Organization name
          </label>
          <input
            id="org-name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} ${canEdit ? '' : 'opacity-60'}`}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-steel-700">Languages</span>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex min-h-touch items-center gap-1.5 rounded-full bg-basil-50 px-3.5 py-2 text-sm font-medium text-basil-700 ring-1 ring-basil-200">
              English · always on
            </span>
            <TogglePill
              selected={spanish}
              onToggle={() => canEdit && setSpanish((v) => !v)}
              selectedClass="bg-basil-50 text-basil-700 ring-basil-300"
            >
              Español
            </TogglePill>
          </div>
          <p className="mt-1.5 text-xs text-salt-500">
            English is the authoring language; others are reviewed translations.
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
              {save.isPending ? 'Saving…' : 'Save details'}
            </button>
            <SavedTick show={saved && !save.isPending} />
          </div>
        )}
      </form>
    </SectionCard>
  )
}

function LogoSection({ org, canEdit }: { org: OrganizationProfile; canEdit: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const change = useMutation({
    mutationFn: async (file: File | null) => {
      let logoMediaId: string | null = null
      if (file) {
        const uploaded = await uploadPhoto(file)
        if (uploaded.error) throw new Error(uploaded.error.message)
        logoMediaId = uploaded.data._id
      }
      const result = await updateOrganization({ logoMediaId })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['org', 'profile', ...tenancyScopeKey()], updated)
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <SectionCard icon={ImageIcon} title="Logo" hint="Shown across the app and on printed sheets">
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex flex-wrap items-center gap-4">
          {org.logo ? (
            <img
              src={org.logo.url}
              alt={`${org.name} logo`}
              className="size-24 rounded-2xl bg-salt-100 object-cover ring-1 ring-salt-200"
            />
          ) : (
            <span className="flex size-24 items-center justify-center rounded-2xl bg-salt-100 text-salt-400 ring-1 ring-salt-200 ring-inset">
              <ImageIcon className="size-8" aria-hidden />
            </span>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    setError(null)
                    change.mutate(file)
                  }
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                disabled={change.isPending}
                onClick={() => fileInput.current?.click()}
                className={primaryButtonClass}
              >
                <Upload className="size-4" aria-hidden />
                {change.isPending ? 'Working…' : org.logo ? 'Replace logo' : 'Upload logo'}
              </button>
              {org.logo && (
                <button
                  type="button"
                  disabled={change.isPending}
                  onClick={() => {
                    setError(null)
                    change.mutate(null)
                  }}
                  className={subtleButtonClass}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-salt-500">JPEG, PNG or WebP, up to 10MB. Square crops look best.</p>
      </div>
    </SectionCard>
  )
}

function AddressContactForm({ org, canEdit }: { org: OrganizationProfile; canEdit: boolean }) {
  const [line1, setLine1] = useState(org.address?.line1 ?? '')
  const [line2, setLine2] = useState(org.address?.line2 ?? '')
  const [city, setCity] = useState(org.address?.city ?? '')
  const [region, setRegion] = useState(org.address?.region ?? '')
  const [postalCode, setPostalCode] = useState(org.address?.postalCode ?? '')
  const [country, setCountry] = useState(org.address?.country ?? '')
  const [phone, setPhone] = useState(org.contact.phone ?? '')
  const [email, setEmail] = useState(org.contact.email ?? '')
  const [website, setWebsite] = useState(org.contact.website ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = useOrgMutation(() => setSaved(true), setError)

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    const parts = { line1, line2, city, region, postalCode, country }
    const hasAddress = Object.values(parts).some((v) => v.trim() !== '')

    save.mutate({
      address: hasAddress
        ? Object.fromEntries(
            Object.entries(parts)
              .map(([k, v]) => [k, v.trim()])
              .filter(([, v]) => v !== '')
          )
        : null,
      contact: {
        phone: orNull(phone),
        email: orNull(email.toLowerCase()),
        website: orNull(website),
      },
    })
  }

  const disabled = !canEdit
  const fieldClass = `${inputClass} ${disabled ? 'opacity-60' : ''}`

  return (
    <SectionCard
      icon={MapPin}
      title="Address & contact"
      hint="Head-office details for invoices and printed material"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="grid gap-4 tablet:grid-cols-2">
          <div className="tablet:col-span-2">
            <label htmlFor="org-line1" className="mb-1.5 block text-sm font-medium text-steel-700">
              Address line 1
            </label>
            <input id="org-line1" type="text" maxLength={160} value={line1} disabled={disabled} onChange={(e) => setLine1(e.target.value)} className={fieldClass} />
          </div>
          <div className="tablet:col-span-2">
            <label htmlFor="org-line2" className="mb-1.5 block text-sm font-medium text-steel-700">
              Address line 2 <span className="font-normal text-salt-500">(optional)</span>
            </label>
            <input id="org-line2" type="text" maxLength={160} value={line2} disabled={disabled} onChange={(e) => setLine2(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="org-city" className="mb-1.5 block text-sm font-medium text-steel-700">
              City
            </label>
            <input id="org-city" type="text" maxLength={80} value={city} disabled={disabled} onChange={(e) => setCity(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="org-region" className="mb-1.5 block text-sm font-medium text-steel-700">
              State / region
            </label>
            <input id="org-region" type="text" maxLength={80} value={region} disabled={disabled} onChange={(e) => setRegion(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="org-postal" className="mb-1.5 block text-sm font-medium text-steel-700">
              Postal code
            </label>
            <input id="org-postal" type="text" maxLength={20} value={postalCode} disabled={disabled} onChange={(e) => setPostalCode(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="org-country" className="mb-1.5 block text-sm font-medium text-steel-700">
              Country <span className="font-normal text-salt-500">(2-letter code)</span>
            </label>
            <input id="org-country" type="text" maxLength={2} placeholder="US" value={country} disabled={disabled} onChange={(e) => setCountry(e.target.value.toUpperCase())} className={`${fieldClass} font-mono uppercase`} />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 text-sm font-medium text-steel-700">
          <Contact className="size-4 text-salt-500" aria-hidden />
          Contact
        </div>
        <div className="grid gap-4 tablet:grid-cols-3">
          <div>
            <label htmlFor="org-phone" className="mb-1.5 block text-sm font-medium text-steel-700">
              Phone
            </label>
            <input id="org-phone" type="tel" maxLength={40} value={phone} disabled={disabled} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="org-email" className="mb-1.5 block text-sm font-medium text-steel-700">
              Email
            </label>
            <input id="org-email" type="email" value={email} disabled={disabled} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="org-website" className="mb-1.5 block text-sm font-medium text-steel-700">
              Website
            </label>
            <input id="org-website" type="url" maxLength={200} placeholder="https://…" value={website} disabled={disabled} onChange={(e) => setWebsite(e.target.value)} className={fieldClass} />
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
              {save.isPending ? 'Saving…' : 'Save address & contact'}
            </button>
            <SavedTick show={saved && !save.isPending} />
          </div>
        )}
      </form>
    </SectionCard>
  )
}

function TreeSection() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['tenancy', 'tree', ...tenancyScopeKey()],
    queryFn: async () => {
      const result = await getTenantTree()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  return (
    <SectionCard
      icon={Network}
      title="Properties & locations"
      hint="The structure your recipes, training and memberships are scoped to"
    >
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {isLoading && <Skeleton className="h-24 w-full" />}
      {data && data.properties.length === 0 && (
        <p className="text-sm text-salt-600">
          No properties yet. Properties and locations are set up by your organization's admins.
        </p>
      )}
      {data && data.properties.length > 0 && (
        <ul className="space-y-3">
          {data.properties.map((property) => (
            <li key={property._id} className="rounded-xl bg-salt-50 p-4 ring-1 ring-salt-200 ring-inset">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-steel-900">{property.name}</span>
                <Badge value={property.status} />
              </div>
              {property.locations.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-l-2 border-salt-200 pl-4">
                  {property.locations.map((location) => (
                    <li
                      key={location._id}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span className="text-steel-800">{location.name}</span>
                      <span className="text-xs text-salt-500">{location.timezone}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function Settings() {
  const { role, isLoading: roleLoading } = useActiveRole()
  const scope = getScope()
  // The API refuses org edits from a property- or location-scoped membership,
  // so the controls only render for an org-wide admin. Cosmetic — the server
  // is the enforcement.
  const orgWideScope = !scope?.propertyId && !scope?.locationId
  const canEdit = role != null && roleAtLeast(role, 'admin') && orgWideScope

  const { data, error, isLoading } = useQuery({
    queryKey: ['org', 'profile', ...tenancyScopeKey()],
    queryFn: async () => {
      const result = await getOrganization()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  if (error) return <ErrorNote>{error.message}</ErrorNote>

  if (isLoading || roleLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <OrgHeader org={data} />
      {role != null && roleAtLeast(role, 'admin') && !orgWideScope && (
        <p className="rounded-xl bg-citron-50 px-4 py-3 text-sm text-citron-700 ring-1 ring-citron-200 ring-inset">
          You're viewing a property or location scope. Switch to the organization-wide scope to
          edit these settings.
        </p>
      )}
      <DetailsForm key={`d-${data._id}`} org={data} canEdit={canEdit} />
      <LogoSection org={data} canEdit={canEdit} />
      <AddressContactForm key={`a-${data._id}`} org={data} canEdit={canEdit} />
      <TreeSection />
    </div>
  )
}

export function OrgSettings() {
  return (
    <QueryProvider>
      <Settings />
    </QueryProvider>
  )
}
