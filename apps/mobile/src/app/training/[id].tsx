import { useMutation, useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { VideoView, useVideoPlayer } from 'expo-video'
import type { MediaAssetView, TrainingBlockView, TrainingDetail } from '@rit/shared'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Film,
  GraduationCap,
  Layers,
  RotateCcw,
} from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { completeTraining, getTraining, trainingsScopeKey, uncompleteTraining } from '../../api/trainings'
import { RichText } from '../../components/RichText'
import { EmptyState, ErrorNote, PrimaryButton, Skeleton, cardClass } from '../../components/ui'
import { queryClient } from '../../lib/queryClient'
import { useSession } from '../../lib/useSession'
import colors from '../../theme/colors.js'

/**
 * A training module as the line reads it. Same guarantee as the web reader:
 * anything short of `published` renders as unavailable, even for the chef who
 * wrote it. Marking complete works from here, because the device in the
 * kitchen is exactly where people finish a module.
 *
 * Embeds render in a WebView whose src is always the server-derived
 * allow-list construction (`embedSrc`) — the client never builds an embed URL
 * from the raw stored link.
 */

function Caption({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <Text className="px-4 text-center font-sans text-sm leading-5 text-salt-500">{text}</Text>
  )
}

function mediaAspect(media: MediaAssetView): number {
  if (media.width && media.height) return media.width / media.height
  return 4 / 3
}

function VideoBlock({ media, caption }: { media: MediaAssetView; caption: string | null }) {
  // Streams via range requests as playback progresses — kitchen wifi never
  // downloads a video nobody pressed play on.
  const player = useVideoPlayer(media.url)
  return (
    <View className="gap-3">
      <VideoView
        player={player}
        style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: colors.steel[900] }}
        contentFit="contain"
      />
      <Caption text={caption} />
    </View>
  )
}

function EmbedBlock({ src, caption }: { src: string; caption: string | null }) {
  return (
    <View className="gap-3">
      <View className="aspect-video w-full overflow-hidden rounded-2xl bg-steel-900">
        <WebView
          source={{ uri: src }}
          style={{ flex: 1, backgroundColor: colors.steel[900] }}
          allowsFullscreenVideo
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction
        />
      </View>
      <Caption text={caption} />
    </View>
  )
}

function BlockView({ block, index }: { block: TrainingBlockView; index: number }) {
  switch (block.kind) {
    case 'text':
      return <RichText doc={block.doc} />

    case 'image':
      // Asset deleted out from under the module — skip rather than render broken.
      if (!block.media) return null
      return (
        <View className="gap-3">
          <View
            className="w-full overflow-hidden rounded-2xl border border-salt-200 bg-salt-100"
            style={{ aspectRatio: mediaAspect(block.media) }}
          >
            <Image
              source={{ uri: block.media.url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              accessibilityLabel={block.caption ?? `Training illustration ${index + 1}`}
            />
          </View>
          <Caption text={block.caption} />
        </View>
      )

    case 'video':
      if (!block.media) return null
      return <VideoBlock media={block.media} caption={block.caption} />

    case 'embed':
      return <EmbedBlock src={block.embedSrc} caption={block.caption} />
  }
}

function CompletionCard({ training }: { training: TrainingDetail }) {
  const [error, setError] = useState<string | null>(null)
  const done = training.myCompletion != null

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['trainings'] })

  const complete = useMutation({
    mutationFn: async () => {
      const result = await completeTraining(training._id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  })

  const uncomplete = useMutation({
    mutationFn: async () => {
      const result = await uncompleteTraining(training._id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  })

  if (training.status !== 'published') return null

  return (
    <View
      className={`rounded-2xl border p-5 ${
        done ? 'border-basil-200 bg-basil-50' : 'border-salt-200 bg-white'
      }`}
    >
      {error && (
        <View className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </View>
      )}

      {done ? (
        <View className="flex-row flex-wrap items-center gap-4">
          <View className="size-12 items-center justify-center rounded-2xl bg-basil-500">
            <CheckCircle2 size={24} color="#ffffff" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-sans-semibold text-base text-basil-800">Training complete</Text>
            <Text className="font-sans text-sm text-basil-700">
              You finished this on {new Date(training.myCompletion!).toLocaleDateString()}.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => uncomplete.mutate()}
            disabled={uncomplete.isPending}
            className="min-h-touch flex-row items-center gap-1.5 rounded-xl px-3 py-2 active:bg-basil-100"
          >
            <RotateCcw size={16} color={colors.basil[700]} />
            <Text className="font-sans-medium text-sm text-basil-700">Undo</Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-4">
          <View className="flex-row items-center gap-4">
            <View className="size-12 items-center justify-center rounded-2xl border border-ember-100 bg-ember-50">
              <GraduationCap size={24} color={colors.ember[600]} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-sans-semibold text-base text-steel-900">Done reading?</Text>
              <Text className="font-sans text-sm leading-5 text-salt-600">
                Mark it complete so your manager knows you are up to speed.
              </Text>
            </View>
          </View>
          <PrimaryButton
            icon={CheckCircle2}
            onPress={() => complete.mutate()}
            busy={complete.isPending}
          >
            {complete.isPending ? 'Saving…' : 'Mark complete'}
          </PrimaryButton>
        </View>
      )}
    </View>
  )
}

export default function TrainingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const session = useSession()
  const { width } = useWindowDimensions()

  const { data: training, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'reader', 'detail', id],
    queryFn: async () => {
      const result = await getTraining(id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: session.token != null && session.scope != null,
  })

  if (!session.token) return <Redirect href="/login" />
  if (!session.scope) return <Redirect href="/scope" />

  const visibleBlocks =
    training?.blocks.filter(
      (block) => block.kind === 'text' || block.kind === 'embed' || block.media != null
    ) ?? []

  return (
    <SafeAreaView className="flex-1 bg-salt-100" edges={['top', 'left', 'right']}>
      <ScrollView contentContainerClassName="px-4 pb-10 pt-2">
        <View className="mx-auto w-full max-w-[720px] gap-5">
          <Pressable
            accessibilityRole="button"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            className="min-h-touch flex-row items-center gap-1.5 self-start"
          >
            <ArrowLeft size={16} color={colors.salt[600]} />
            <Text className="font-sans-semibold text-sm text-salt-600">Reader</Text>
          </Pressable>

          {error ? (
            <ErrorNote>{(error as Error).message}</ErrorNote>
          ) : isLoading || !training ? (
            <View className="gap-4">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-64" />
            </View>
          ) : training.status !== 'published' ? (
            <EmptyState
              icon={GraduationCap}
              title="Not available in the reader"
              hint="This training is not published. It appears here the moment it is."
            />
          ) : (
            <>
              <View className="gap-3">
                <View className="flex-row flex-wrap items-center gap-2.5">
                  <Text className="font-sans-semibold text-xs uppercase tracking-widest text-ember-600">
                    Training module
                  </Text>
                  {training.myCompletion != null && (
                    <View className="flex-row items-center gap-1 rounded-full border border-basil-200 bg-basil-50 px-2.5 py-1">
                      <CheckCircle2 size={12} color={colors.basil[700]} />
                      <Text className="font-sans-semibold text-2xs uppercase tracking-wide text-basil-700">
                        Completed
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="font-sans-bold text-3xl tracking-tight text-steel-900">
                  {training.title}
                </Text>
                {training.description ? (
                  <Text className="font-sans text-base leading-6 text-salt-600">
                    {training.description}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
                  <View className="flex-row items-center gap-1.5">
                    <Layers size={14} color={colors.salt[500]} />
                    <Text className="font-sans text-xs text-salt-500">
                      {visibleBlocks.length} {visibleBlocks.length === 1 ? 'section' : 'sections'}
                    </Text>
                  </View>
                  {training.videoCount > 0 && (
                    <View className="flex-row items-center gap-1.5">
                      <Film size={14} color={colors.salt[500]} />
                      <Text className="font-sans text-xs text-salt-500">
                        {training.videoCount} {training.videoCount === 1 ? 'video' : 'videos'}
                      </Text>
                    </View>
                  )}
                  <View className="flex-row items-center gap-1.5">
                    <Clock size={14} color={colors.salt[500]} />
                    <Text className="font-sans text-xs text-salt-500">
                      Updated {new Date(training.modifiedAt).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              </View>

              {visibleBlocks.length === 0 ? (
                <View className="rounded-2xl border border-salt-200 bg-salt-50 px-4 py-12">
                  <Text className="text-center font-sans text-sm text-salt-500">
                    This training has no content yet.
                  </Text>
                </View>
              ) : (
                <View className={`${cardClass} gap-8 ${width >= 768 ? 'p-8' : 'p-5'}`}>
                  {visibleBlocks.map((block, index) => (
                    <BlockView key={index} block={block} index={index} />
                  ))}
                </View>
              )}

              <CompletionCard training={training} />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
