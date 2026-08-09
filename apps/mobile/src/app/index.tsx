import { useInfiniteQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link, Redirect, router } from 'expo-router'
import type { RecipeSummary, TrainingSummary } from '@rit/shared'
import {
  BookOpen,
  Building2,
  CheckCircle2,
  GraduationCap,
  Layers,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react-native'
import { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { listRecipes, recipesScopeKey } from '../api/recipes'
import { listTrainings, trainingsScopeKey } from '../api/trainings'
import { Chip, EmptyState, ErrorNote, Segmented, Skeleton, cardClass } from '../components/ui'
import { useSession } from '../lib/useSession'
import colors from '../theme/colors.js'

/**
 * The reader's shelf: everything the line may cook from or study, and nothing
 * else. Recipes are fetched with `live: true`, so lineages without a live
 * version never even arrive. Training is published only. Same guarantee as
 * the web reader — this surface is approved content by construction.
 *
 * Phone-first: two photo tiles per row, three on iPad portrait, four in
 * landscape. Infinite scroll instead of the web's pager — the native idiom
 * for the same 24-a-page API.
 */

type Shelf = 'recipes' | 'training'

const PAGE_SIZE = 24

function VerifiedChip({ verified }: { verified: boolean }) {
  return verified ? (
    <Chip tone="basil" icon={ShieldCheck} label="Verified" />
  ) : (
    <Chip tone="citron" icon={ShieldAlert} label="Unverified" />
  )
}

/** Photo area shared by both tiles: image, or a soft placeholder icon. */
function TileArt({
  url,
  placeholder: Placeholder,
  children,
}: {
  url: string | null
  placeholder: typeof BookOpen
  children?: React.ReactNode
}) {
  return (
    <View className="aspect-[4/3] w-full overflow-hidden bg-salt-100">
      {url ? (
        <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : (
        <View className="size-full items-center justify-center">
          <Placeholder size={36} color={colors.salt[400]} />
        </View>
      )}
      {children}
    </View>
  )
}

function RecipeTile({ recipe }: { recipe: RecipeSummary }) {
  return (
    <Link href={{ pathname: '/recipes/[id]', params: { id: recipe._id } }} asChild>
      <Pressable className={`flex-1 overflow-hidden ${cardClass} active:opacity-90`}>
        <TileArt url={recipe.heroPhoto?.url ?? null} placeholder={BookOpen}>
          <View className="absolute bottom-2 left-2 rounded-full bg-steel-900/80 px-2 py-0.5">
            <Text className="font-mono-semibold text-2xs text-white">v{recipe.activeVersion}</Text>
          </View>
        </TileArt>
        <View className="flex-1 gap-1.5 p-3">
          <Text numberOfLines={2} className="font-sans-semibold text-sm leading-5 text-steel-900">
            {recipe.name}
          </Text>
          <View className="mt-auto">
            <VerifiedChip verified={recipe.allergensVerified} />
          </View>
        </View>
      </Pressable>
    </Link>
  )
}

function TrainingTile({ training }: { training: TrainingSummary }) {
  const done = training.myCompletion != null

  return (
    <Link href={{ pathname: '/training/[id]', params: { id: training._id } }} asChild>
      <Pressable className={`flex-1 overflow-hidden ${cardClass} active:opacity-90`}>
        <TileArt url={training.heroImage?.url ?? null} placeholder={GraduationCap}>
          {done && (
            <View className="absolute right-2 top-2 flex-row items-center gap-1 rounded-full bg-basil-500/95 px-2 py-0.5">
              <CheckCircle2 size={12} color="#ffffff" />
              <Text className="font-sans-semibold text-2xs uppercase tracking-wide text-white">
                Done
              </Text>
            </View>
          )}
          {training.videoCount > 0 && (
            <View className="absolute bottom-2 left-2 flex-row items-center gap-1 rounded-full bg-steel-900/80 px-2 py-0.5">
              <Play size={10} color="#ffffff" fill="#ffffff" />
              <Text className="font-sans-semibold text-2xs uppercase tracking-wide text-white">
                {training.videoCount === 1 ? 'Video' : training.videoCount}
              </Text>
            </View>
          )}
        </TileArt>
        <View className="flex-1 gap-1.5 p-3">
          <Text numberOfLines={2} className="font-sans-semibold text-sm leading-5 text-steel-900">
            {training.title}
          </Text>
          <View className="mt-auto flex-row items-center gap-1">
            <Layers size={14} color={colors.salt[500]} />
            <Text className="font-sans-medium text-xs text-salt-500">
              {training.blockCount} {training.blockCount === 1 ? 'section' : 'sections'}
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  )
}

function SkeletonGrid({ columns }: { columns: number }) {
  return (
    <View className="gap-3 px-4">
      {Array.from({ length: 3 }, (_, row) => (
        <View key={row} className="flex-row gap-3">
          {Array.from({ length: columns }, (_, col) => (
            <View key={col} className={`flex-1 ${cardClass} overflow-hidden`}>
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <View className="gap-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

export default function ShelfScreen() {
  const session = useSession()
  const { width } = useWindowDimensions()
  const [shelf, setShelf] = useState<Shelf>('recipes')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2

  const recipes = useInfiniteQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'reader', { q }],
    queryFn: async ({ pageParam }) => {
      const result = await listRecipes({
        q,
        page: pageParam,
        limit: PAGE_SIZE,
        status: 'active',
        live: true,
      })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: session.token != null && session.scope != null && shelf === 'recipes',
  })

  const trainings = useInfiniteQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'reader', { q }],
    queryFn: async ({ pageParam }) => {
      const result = await listTrainings({ q, page: pageParam, limit: PAGE_SIZE, status: 'published' })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: session.token != null && session.scope != null && shelf === 'training',
  })

  if (!session.token) return <Redirect href="/login" />
  if (!session.scope) return <Redirect href="/scope" />

  const active = shelf === 'recipes' ? recipes : trainings
  const items: (RecipeSummary | TrainingSummary)[] =
    shelf === 'recipes'
      ? (recipes.data?.pages.flatMap((page) => page.items) ?? [])
      : (trainings.data?.pages.flatMap((page) => page.items) ?? [])

  return (
    <SafeAreaView className="flex-1 bg-salt-100" edges={['top', 'left', 'right']}>
      <View className="gap-4 px-4 pb-3 pt-2">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="font-sans-semibold text-xs uppercase tracking-widest text-ember-600">
              Reader
            </Text>
            <Text className="font-sans-bold text-2xl tracking-tight text-steel-900">
              On the line
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch workspace"
            onPress={() => router.push('/scope')}
            className="size-11 items-center justify-center rounded-full border border-salt-200 bg-white active:bg-salt-50"
          >
            <Building2 size={18} color={colors.steel[700]} />
          </Pressable>
        </View>

        <View className="gap-3">
          <Segmented
            value={shelf}
            onChange={(next) => setShelf(next)}
            options={[
              { id: 'recipes', label: 'Recipes', icon: BookOpen },
              { id: 'training', label: 'Training', icon: GraduationCap },
            ]}
          />
          <View className="min-h-touch flex-row items-center gap-2.5 rounded-full border border-salt-300 bg-white px-4">
            <Search size={16} color={colors.salt[500]} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => setQ(search)}
              returnKeyType="search"
              placeholder={shelf === 'recipes' ? 'Search recipes…' : 'Search trainings…'}
              placeholderTextColor={colors.salt[500]}
              className="min-h-touch flex-1 font-sans text-base text-steel-900"
            />
            {search.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                onPress={() => {
                  setSearch('')
                  setQ('')
                }}
                hitSlop={12}
                className="size-5 items-center justify-center rounded-full bg-salt-300 active:bg-salt-400"
              >
                <X size={12} color={colors.steel[700]} strokeWidth={3} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {active.error ? (
        <View className="px-4">
          <ErrorNote>{(active.error as Error).message}</ErrorNote>
        </View>
      ) : active.isLoading ? (
        <SkeletonGrid columns={columns} />
      ) : (
        <FlatList
          key={`${shelf}-${columns}`}
          data={items}
          numColumns={columns}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            // maxWidth keeps a lone tile in the last row at column width
            // instead of stretching across the screen.
            <View style={{ flex: 1, maxWidth: `${100 / columns}%` }}>
              {'title' in item ? <TrainingTile training={item} /> : <RecipeTile recipe={item} />}
            </View>
          )}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
          onEndReached={() => {
            if (active.hasNextPage && !active.isFetchingNextPage) void active.fetchNextPage()
          }}
          onEndReachedThreshold={0.4}
          refreshing={active.isRefetching && !active.isFetchingNextPage}
          onRefresh={() => void active.refetch()}
          ListEmptyComponent={
            <View className="px-0">
              {shelf === 'recipes' ? (
                <EmptyState
                  icon={BookOpen}
                  title={q ? `No recipes matching “${q}”` : 'Nothing live yet'}
                  hint={
                    q
                      ? 'Try a different search, or clear it to see everything in this scope.'
                      : 'Recipes appear here once a chef sets a version live.'
                  }
                />
              ) : (
                <EmptyState
                  icon={GraduationCap}
                  title={q ? `No trainings matching “${q}”` : 'No trainings yet'}
                  hint={
                    q
                      ? 'Try a different search, or clear it to see everything in this scope.'
                      : 'Training modules appear here the moment they are published.'
                  }
                />
              )}
            </View>
          }
          ListFooterComponent={
            active.isFetchingNextPage ? (
              <View className="items-center py-4">
                <ActivityIndicator size="small" color={colors.ember[600]} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  )
}
