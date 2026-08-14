import { useMutation, useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { VideoView, useVideoPlayer } from 'expo-video'
import type {
  MediaAssetView,
  RichTextDoc,
  TrainingBlockView,
  TrainingDetail,
  TrainingTranslationView,
} from '@rit/shared'
import { plainTextToDoc } from '@rit/shared'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  Film,
  GraduationCap,
  Languages,
  Layers,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react-native'
import { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { BASE_URL } from '../../api/client'
import { completeTraining, getTraining, trainingsScopeKey, uncompleteTraining } from '../../api/trainings'
import { getTrainingTranslation, machineTranslateTraining } from '../../api/translations'
import { ScreenTransition } from '../../components/motion'
import { RichText } from '../../components/RichText'
import { EmptyState, ErrorNote, PrimaryButton, Skeleton, WarningBanner, cardClass } from '../../components/ui'
import { readerEs } from '../../i18n/es'
import { queryClient } from '../../lib/queryClient'
import { useSession } from '../../lib/useSession'
import colors from '../../theme/colors.js'

/**
 * A training module as the line reads it. Same guarantee as the web reader:
 * anything short of `published` renders as unavailable, even for the chef who
 * wrote it. Marking complete works from here, because the device in the
 * kitchen is exactly where people finish a module.
 *
 * The Español toggle appears only when an approved, current translation
 * exists — same rules as the recipe reader. Translated text blocks render as
 * plain paragraphs (formatting starts fresh in translation); media assets and
 * embeds always render from the source module.
 *
 * Embeds render in a WebView whose src is always the server-derived
 * allow-list construction (`embedSrc`) — the client never builds an embed URL
 * from the raw stored link.
 */

type Lang = 'en' | 'es'

interface DisplayBlock {
  block: TrainingBlockView
  /** Translated text-block content as a rich-text doc; null → the source doc. */
  doc: RichTextDoc | null
  caption: string | null
}

interface DisplayModel {
  title: string
  description: string
  blocks: DisplayBlock[]
  aiAssisted: boolean
  /** SAFETY: machine-written Spanish that nobody read — staff are told first. */
  aiUnreviewed: boolean
}

function buildDisplay(
  training: TrainingDetail,
  translation: TrainingTranslationView | null
): DisplayModel {
  const es = translation != null
  return {
    title: es ? translation.payload.title : training.title,
    description: es
      ? translation.payload.description || training.description
      : training.description,
    blocks: training.blocks.map((block, index) => {
      const translated = es ? translation.payload.blocks[index] : null
      const sourceCaption = block.kind === 'text' ? null : block.caption
      return {
        block,
        doc: translated?.text != null ? plainTextToDoc(translated.text) : null,
        caption: es ? (translated?.caption ?? sourceCaption) : sourceCaption,
      }
    }),
    aiAssisted: es,
    aiUnreviewed: es && translation.autoApproved,
  }
}

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

/**
 * A WebView pointed straight at `embedSrc` loads the player as the top-level
 * document, so it arrives with no referrer and YouTube refuses it: "Video
 * player configuration error" (error 153) — reproducible by opening an embed
 * URL directly in any browser. Framing it inside a bare page whose baseUrl is
 * an ordinary origin gives the player the embedding context it checks for.
 *
 * The referrer is this deployment's own API origin — the provider's own domain
 * is rejected in turn (error 152), and inventing a domain we don't own would
 * send a referrer for a site that isn't us. The framed src is still only ever
 * the server-derived `embedSrc`.
 */
const EMBED_REFERRER = BASE_URL

function embedPage(src: string): string {
  return `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" /></head>
  <body style="margin:0;height:100vh;background:${colors.steel[900]};overflow:hidden">
    <iframe
      src="${src.replace(/"/g, '&quot;')}"
      style="border:0;display:block;width:100%;height:100%"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
    ></iframe>
  </body>
</html>`
}

function EmbedBlock({ src, caption }: { src: string; caption: string | null }) {
  return (
    <View className="gap-3">
      <View className="aspect-video w-full overflow-hidden rounded-2xl bg-steel-900">
        {Platform.OS === 'web' ? (
          // react-native-web renders through react-dom, so a real iframe is
          // available here — react-native-webview has no web implementation.
          // Same attribute posture as the web app's TrainingDetail embed.
          <iframe
            src={src}
            title={caption ?? 'Embedded video'}
            style={{ width: '100%', height: '100%', border: 0 }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <WebView
            source={{ html: embedPage(src), baseUrl: EMBED_REFERRER }}
            originWhitelist={['http://*', 'https://*']}
            style={{ flex: 1, backgroundColor: colors.steel[900] }}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction
          />
        )}
      </View>
      <Caption text={caption} />
    </View>
  )
}

function BlockView({ display, index }: { display: DisplayBlock; index: number }) {
  const { block, doc, caption } = display
  switch (block.kind) {
    case 'text':
      return <RichText doc={doc ?? block.doc} />

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
              accessibilityLabel={caption ?? `Training illustration ${index + 1}`}
            />
          </View>
          <Caption text={caption} />
        </View>
      )

    case 'video':
      if (!block.media) return null
      return <VideoBlock media={block.media} caption={caption} />

    case 'embed':
      return <EmbedBlock src={block.embedSrc} caption={caption} />
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

/**
 * The EN/ES switch, plus what stands in for it when Spanish is not available:
 * a request button for people who can manage the module, a quiet "not yet"
 * chip for everyone else. Same rules as the recipe reader.
 */
function LanguageControl({
  trainingId,
  lang,
  onLang,
}: {
  trainingId: string
  lang: Lang
  onLang: (next: Lang) => void
}) {
  const [requestError, setRequestError] = useState<string | null>(null)

  const { data: state } = useQuery({
    queryKey: ['translations', ...trainingsScopeKey(), 'reader', trainingId, 'es'],
    queryFn: async () => {
      const result = await getTrainingTranslation(trainingId, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })

  const request = useMutation({
    mutationFn: async () => {
      const result = await machineTranslateTraining(trainingId, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['translations'] }),
    onError: (err: Error) => setRequestError(err.message),
  })

  if (!state) return null

  const approved =
    state.translation != null && state.translation.status === 'approved' && !state.translation.stale

  if (approved) {
    return (
      <View className="flex-row items-center gap-1 rounded-xl border border-salt-200 bg-salt-100 p-1">
        {(['en', 'es'] as const).map((option) => {
          const active = lang === option
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onLang(option)}
              className={`min-h-touch flex-row items-center gap-1.5 rounded-lg px-3.5 py-1.5 ${
                active ? 'border border-salt-300 bg-white' : ''
              }`}
            >
              {option === 'es' && (
                <Languages size={14} color={active ? colors.steel[900] : colors.salt[600]} />
              )}
              <Text
                className={`font-sans-semibold text-sm uppercase ${
                  active ? 'text-steel-900' : 'text-salt-600'
                }`}
              >
                {option}
              </Text>
            </Pressable>
          )
        })}
      </View>
    )
  }

  // No approved Spanish yet. Reviewers can kick off a translation from here —
  // it lands pending review on the web training page, never directly on this
  // screen.
  if (state.canManage) {
    const pending =
      state.translation != null && state.translation.status !== 'rejected' && !state.translation.stale
    return (
      <View className="items-end gap-1">
        <Modal transparent visible={request.isPending} animationType="fade">
          <View className="flex-1 items-center justify-center bg-steel-900/60 px-8">
            <View className={`${cardClass} w-full max-w-[320px] items-center gap-3 p-6`}>
              <ActivityIndicator size="large" color={colors.ember[600]} />
              <Text className="font-sans-semibold text-base text-steel-900">
                Translating to Spanish
              </Text>
              <Text className="text-center font-sans text-sm text-salt-600">
                The draft lands pending review — nothing reaches staff until a person approves it.
              </Text>
            </View>
          </View>
        </Modal>
        {pending ? (
          <View className="min-h-touch flex-row items-center gap-1.5 rounded-xl border border-citron-200 bg-citron-50 px-3.5 py-2">
            <Languages size={16} color={colors.citron[700]} />
            <Text className="font-sans-semibold text-sm text-citron-700">
              Spanish pending review
            </Text>
          </View>
        ) : state.enabled ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setRequestError(null)
              request.mutate()
            }}
            disabled={request.isPending}
            className="min-h-touch flex-row items-center gap-1.5 rounded-xl border border-salt-300 bg-white px-3.5 py-2 active:bg-salt-50"
          >
            <Languages size={16} color={colors.steel[700]} />
            <Text className="font-sans-semibold text-sm text-steel-700">Request Spanish</Text>
          </Pressable>
        ) : null}
        {requestError && <Text className="font-sans text-xs text-chili-600">{requestError}</Text>}
      </View>
    )
  }

  return (
    <View className="min-h-touch flex-row items-center gap-1.5 rounded-xl border border-salt-200 bg-salt-100 px-3.5 py-2">
      <Languages size={16} color={colors.salt[500]} />
      <Text className="font-sans-medium text-sm text-salt-500">ES no disponible</Text>
    </View>
  )
}

export default function TrainingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const session = useSession()
  const { width } = useWindowDimensions()
  const [lang, setLang] = useState<Lang>('en')

  const { data: training, error, isLoading } = useQuery({
    queryKey: ['trainings', ...trainingsScopeKey(), 'reader', 'detail', id],
    queryFn: async () => {
      const result = await getTraining(id)
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: session.token != null && session.scope != null,
  })

  const { data: translationState } = useQuery({
    queryKey: ['translations', ...trainingsScopeKey(), 'reader', id, 'es'],
    queryFn: async () => {
      const result = await getTrainingTranslation(id, 'es')
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    enabled: session.token != null && session.scope != null,
  })

  if (!session.token) return <Redirect href="/login" />
  if (!session.scope) return <Redirect href="/scope" />

  // SAFETY: only an approved, current, correctly aligned translation may
  // render — for every role. The server already narrows what staff receive;
  // this repeats the check for reviewers, whose response carries drafts too.
  const translation = translationState?.translation ?? null
  const usableTranslation =
    training != null &&
    translation != null &&
    translation.status === 'approved' &&
    !translation.stale &&
    translation.payload.blocks.length === training.blocks.length
      ? translation
      : null

  const display = training
    ? buildDisplay(training, lang === 'es' && usableTranslation ? usableTranslation : null)
    : null

  const visibleBlocks =
    display?.blocks.filter(
      ({ block }) => block.kind === 'text' || block.kind === 'embed' || block.media != null
    ) ?? []

  return (
    <SafeAreaView className="flex-1 bg-salt-100" edges={['top', 'left', 'right']}>
      <ScreenTransition>
      <ScrollView contentContainerClassName="px-4 pb-10 pt-2">
        <View className="mx-auto w-full max-w-[720px] gap-5">
          <View className="flex-row flex-wrap items-center justify-between gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              className="min-h-touch flex-row items-center gap-1.5 self-start"
            >
              <ArrowLeft size={16} color={colors.salt[600]} />
              <Text className="font-sans-semibold text-sm text-salt-600">Reader</Text>
            </Pressable>
            {training?.status === 'published' && (
              <LanguageControl trainingId={training._id} lang={lang} onLang={setLang} />
            )}
          </View>

          {error ? (
            <ErrorNote>{(error as Error).message}</ErrorNote>
          ) : isLoading || !training ? (
            <View className="gap-4">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-64" />
            </View>
          ) : training.status !== 'published' || !display ? (
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
                  {display.aiAssisted && (
                    <View
                      className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                        display.aiUnreviewed
                          ? 'border-citron-200 bg-citron-50'
                          : 'border-steel-200 bg-steel-50'
                      }`}
                    >
                      <Bot
                        size={12}
                        color={display.aiUnreviewed ? colors.citron[700] : colors.steel[600]}
                      />
                      <Text
                        className={`font-sans-semibold text-2xs ${
                          display.aiUnreviewed ? 'text-citron-700' : 'text-steel-600'
                        }`}
                      >
                        {display.aiUnreviewed ? readerEs.aiUnreviewed : readerEs.aiAssisted}
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="font-sans-bold text-3xl tracking-tight text-steel-900">
                  {display.title}
                </Text>
                {display.description ? (
                  <Text className="font-sans text-base leading-6 text-salt-600">
                    {display.description}
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

              {display.aiUnreviewed && (
                <WarningBanner icon={ShieldAlert}>{readerEs.unreviewedWarning}</WarningBanner>
              )}

              {visibleBlocks.length === 0 ? (
                <View className="rounded-2xl border border-salt-200 bg-salt-50 px-4 py-12">
                  <Text className="text-center font-sans text-sm text-salt-500">
                    This training has no content yet.
                  </Text>
                </View>
              ) : (
                <View className={`${cardClass} gap-8 ${width >= 768 ? 'p-8' : 'p-5'}`}>
                  {visibleBlocks.map((item, index) => (
                    <BlockView key={index} display={item} index={index} />
                  ))}
                </View>
              )}

              <CompletionCard training={training} />
            </>
          )}
        </View>
      </ScrollView>
      </ScreenTransition>
    </SafeAreaView>
  )
}
