import { useQuery } from '@tanstack/react-query'
import { Redirect, router } from 'expo-router'
import type { MembershipSummary } from '@rit/shared'
import { Building2, Check, LogOut } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { clearAuth, getScope, setScope } from '../api/client'
import { getMyMemberships } from '../api/auth'
import { ScreenTransition } from '../components/motion'
import { EmptyState, ErrorNote, Skeleton, SubtleButton, cardClass } from '../components/ui'
import { queryClient } from '../lib/queryClient'
import { useSession } from '../lib/useSession'
import colors from '../theme/colors.js'

/**
 * The scope picker — where the user chooses which workspace they are acting
 * in. Reached automatically after login when they belong to more than one,
 * and from the reader's header to switch later. Switching wipes the query
 * cache: every cached query is scope-dependent, and keeping any of it across
 * a switch would render one tenant's data under another's header.
 */

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

export default function ScopeScreen() {
  const session = useSession()

  const { data, error, isLoading } = useQuery({
    queryKey: ['auth', 'memberships'],
    queryFn: async () => {
      const result = await getMyMemberships()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: session.token != null,
  })

  if (!session.token) return <Redirect href="/login" />

  const memberships = data ?? []

  const choose = (m: MembershipSummary) => {
    setScope({
      orgId: m.org._id,
      propertyId: m.property?._id ?? null,
      locationId: m.location?._id ?? null,
    })
    queryClient.clear()
    router.replace('/')
  }

  return (
    <SafeAreaView className="flex-1 bg-salt-100">
      <ScreenTransition>
      <ScrollView contentContainerClassName="flex-grow px-5 py-8">
        <View className="mx-auto w-full max-w-[520px] gap-6">
          <View className="gap-1">
            <Text className="font-sans-semibold text-xs uppercase tracking-widest text-ember-600">
              Workspace
            </Text>
            <Text className="font-sans-bold text-2xl tracking-tight text-steel-900">
              Where are you working?
            </Text>
            <Text className="font-sans text-sm leading-5 text-salt-600">
              Recipes and training are scoped to a workspace. Pick the one you are cooking in.
            </Text>
          </View>

          {error && <ErrorNote>{(error as Error).message}</ErrorNote>}

          {isLoading ? (
            <View className="gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </View>
          ) : memberships.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No workspace yet"
              hint="Your account is not a member of any organization. Ask a manager to invite you."
            />
          ) : (
            <View className={`${cardClass} overflow-hidden`}>
              {memberships.map((m, index) => {
                const active = matchesActive(m)
                return (
                  <Pressable
                    key={m._id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => (active ? router.replace('/') : choose(m))}
                    className={`min-h-touch flex-row items-center gap-3 px-4 py-3.5 active:bg-salt-50 ${
                      index > 0 ? 'border-t border-salt-200' : ''
                    }`}
                  >
                    <View className="size-9 items-center justify-center rounded-xl border border-salt-200 bg-salt-100">
                      <Building2 size={16} color={colors.steel[600]} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text
                        numberOfLines={1}
                        className={`text-base ${
                          active ? 'font-sans-semibold text-steel-900' : 'font-sans text-steel-800'
                        }`}
                      >
                        {label(m)}
                      </Text>
                      <Text className="font-sans text-xs capitalize text-salt-500">{m.role}</Text>
                    </View>
                    {active && <Check size={18} color={colors.ember[600]} />}
                  </Pressable>
                )
              })}
            </View>
          )}

          <View className="flex-row">
            <SubtleButton icon={LogOut} onPress={() => clearAuth()}>
              Sign out
            </SubtleButton>
          </View>
        </View>
      </ScrollView>
      </ScreenTransition>
    </SafeAreaView>
  )
}
