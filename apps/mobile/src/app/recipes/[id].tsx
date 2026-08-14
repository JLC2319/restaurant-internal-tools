import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import type { RecipeContentView, RecipeTranslationView } from '@rit/shared';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  Flame,
  Languages,
  Leaf,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getRecipe, recipesScopeKey } from '../../api/recipes';
import { getRecipeTranslation, machineTranslateRecipe } from '../../api/translations';
import { ScreenTransition } from '../../components/motion';
import { EmptyState, ErrorNote, Skeleton, WarningBanner, cardClass } from '../../components/ui';
import { allergenEs, dietaryEs, readerEs, unitEs } from '../../i18n/es';
import { useSession } from '../../lib/useSession';
import colors from '../../theme/colors.js';

/**
 * The recipe as the line reads it: the live version, whole and alone — the
 * same guarantees as the web reader (see apps/web ReaderRecipe.tsx). The
 * Español toggle appears only when an approved, current translation exists;
 * enum labels (units, allergens, dietary) come from the static dictionary,
 * never the LLM. Ingredient and step check-offs are purely local state.
 *
 * SAFETY: allergen chips render only approved tags, and an unverified recipe
 * carries the citron "do not answer allergen questions from this" banner.
 */

type Lang = 'en' | 'es';

interface ReaderStrings {
  ingredients: string;
  method: string;
  allergens: string;
  dietary: string;
  yield: string;
  prep: string;
  cook: string;
  live: string;
  noIngredients: string;
  noSteps: string;
  noVerifiedAllergens: string;
  openSubRecipe: string;
  allergenWarning: string;
}

const EN_STRINGS: ReaderStrings = {
  ingredients: 'Ingredients',
  method: 'Method',
  allergens: 'Allergens',
  dietary: 'Dietary',
  yield: 'Yield',
  prep: 'Prep',
  cook: 'Cook',
  live: 'live',
  noIngredients: 'No ingredients listed.',
  noSteps: 'No steps listed.',
  noVerifiedAllergens: 'No verified allergen tags.',
  openSubRecipe: 'Open',
  allergenWarning:
    'Allergen information on this recipe has not been fully verified. Do not answer guest allergen questions from it — ask a chef.',
};

const ES_STRINGS: ReaderStrings = {
  ingredients: readerEs.ingredients,
  method: readerEs.method,
  allergens: readerEs.allergens,
  dietary: readerEs.dietary,
  yield: readerEs.yield,
  prep: readerEs.prep,
  cook: readerEs.cook,
  live: readerEs.live,
  noIngredients: readerEs.noIngredients,
  noSteps: readerEs.noSteps,
  noVerifiedAllergens: readerEs.noVerifiedAllergens,
  openSubRecipe: readerEs.openSubRecipe,
  allergenWarning: readerEs.allergenWarning,
};

interface DisplayLine {
  name: string;
  note: string | null;
  quantityLabel: string;
  kind: 'item' | 'recipe';
  recipeId: string | null;
}

interface DisplayModel {
  name: string;
  description: string;
  lines: DisplayLine[];
  steps: string[];
  allergenLabels: string[];
  dietaryLabels: string[];
  t: ReaderStrings;
  aiAssisted: boolean;
  /** SAFETY: machine-written Spanish that nobody read — staff are told first. */
  aiUnreviewed: boolean;
}

function buildDisplay(
  name: string,
  content: RecipeContentView,
  translation: RecipeTranslationView | null,
): DisplayModel {
  const es = translation != null;
  const approvedAllergens = content.allergens.filter((tag) => tag.status === 'approved');
  return {
    name: es ? translation.payload.name : name,
    description: es ? translation.payload.description || content.description : content.description,
    lines: content.ingredients.map((line, index) => {
      const translated = es ? translation.payload.ingredients[index] : null;
      return {
        name: translated?.name ?? line.name,
        note: es ? (translated?.note ?? line.note) : line.note,
        quantityLabel: `${line.quantity.amount} ${
          es ? unitEs[line.quantity.unit] : line.quantity.unit
        }`,
        kind: line.kind,
        recipeId: line.recipeId,
      };
    }),
    steps: es ? translation.payload.steps : content.steps,
    allergenLabels: approvedAllergens.map((tag) =>
      es ? allergenEs[tag.allergen] : tag.allergen.replace('_', ' '),
    ),
    dietaryLabels: content.dietary.map((tag) => (es ? dietaryEs[tag] : tag.replace('_', ' '))),
    t: es ? ES_STRINGS : EN_STRINGS,
    aiAssisted: es,
    aiUnreviewed: es && translation.autoApproved,
  };
}

/**
 * One row of the stats card: icon and label on the left, value on the right.
 * Stacked rows instead of columns — three tiles across a phone left the
 * labels wrapping letter-by-letter and the values truncated.
 */
function StatRow({
  icon: Icon,
  label,
  value,
  divider,
}: {
  icon: typeof Scale;
  label: string;
  value: string;
  divider: boolean;
}) {
  return (
    <View
      className={`min-h-touch flex-row items-center gap-3 px-4 py-2.5 ${
        divider ? 'border-t border-salt-200' : ''
      }`}
    >
      <View className="size-9 items-center justify-center rounded-lg border border-salt-200 bg-white">
        <Icon size={16} color={colors.ember[600]} />
      </View>
      <Text className="flex-1 font-sans-semibold text-2xs uppercase tracking-widest text-salt-600">
        {label}
      </Text>
      <Text className="font-mono-semibold text-base text-steel-900">{value}</Text>
    </View>
  );
}

/** A round tap target that reads as a checkbox but is sized for gloves. */
function CheckDot({ checked }: { checked: boolean }) {
  return (
    <View
      className={`size-6 items-center justify-center rounded-full border-2 ${
        checked ? 'border-basil-500 bg-basil-500' : 'border-salt-300 bg-white'
      }`}
    >
      {checked && <Check size={14} color="#ffffff" strokeWidth={3} />}
    </View>
  );
}

function useCheckSet(): [Set<number>, (index: number) => void] {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (index: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return [checked, toggle];
}

function Ingredients({ display }: { display: DisplayModel }) {
  const [checked, toggle] = useCheckSet();

  return (
    <View className="gap-3">
      <Text className="font-sans-semibold text-lg text-steel-900">{display.t.ingredients}</Text>
      {display.lines.length === 0 ? (
        <Text className="font-sans text-salt-500">{display.t.noIngredients}</Text>
      ) : (
        <View className="overflow-hidden rounded-xl border border-salt-200">
          {display.lines.map((line, index) => {
            const done = checked.has(index);
            return (
              <View
                key={index}
                className={`flex-row items-center bg-white ${index > 0 ? 'border-t border-salt-100' : ''}`}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  onPress={() => toggle(index)}
                  className={`min-h-touch flex-1 flex-row items-center gap-3 px-3.5 py-3 ${
                    done ? 'opacity-45' : ''
                  }`}
                >
                  <CheckDot checked={done} />
                  <View className="w-24 rounded-md bg-salt-100 px-1.5 py-1">
                    <Text
                      numberOfLines={1}
                      className="text-center font-mono-semibold text-xs text-steel-800"
                    >
                      {line.quantityLabel}
                    </Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text
                      className={`font-sans text-base text-steel-900 ${done ? 'line-through' : ''}`}
                    >
                      {line.name}
                    </Text>
                    {line.note && (
                      <Text className="font-sans text-sm italic text-salt-500">{line.note}</Text>
                    )}
                  </View>
                </Pressable>
                {line.kind === 'recipe' && line.recipeId && (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`${display.t.openSubRecipe}: ${line.name}`}
                    onPress={() =>
                      router.push({ pathname: '/recipes/[id]', params: { id: line.recipeId! } })
                    }
                    className="mr-2 min-h-touch flex-row items-center gap-1 rounded-lg px-2.5 active:bg-ember-50"
                  >
                    <Text className="font-sans-semibold text-sm text-ember-600">
                      {display.t.openSubRecipe}
                    </Text>
                    <ArrowUpRight size={14} color={colors.ember[600]} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Method({ display }: { display: DisplayModel }) {
  const [checked, toggle] = useCheckSet();

  return (
    <View className="gap-3">
      <Text className="font-sans-semibold text-lg text-steel-900">{display.t.method}</Text>
      {display.steps.length === 0 ? (
        <Text className="font-sans text-salt-500">{display.t.noSteps}</Text>
      ) : (
        <View className="gap-2">
          {display.steps.map((step, index) => {
            const done = checked.has(index);
            return (
              <Pressable
                key={index}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                onPress={() => toggle(index)}
                className={`flex-row gap-3.5 rounded-xl p-3 active:bg-salt-50 ${done ? 'opacity-45' : ''}`}
              >
                <View
                  className={`size-9 items-center justify-center rounded-full ${
                    done ? 'bg-basil-500' : 'bg-steel-900'
                  }`}
                >
                  {done ? (
                    <Check size={16} color="#ffffff" strokeWidth={3} />
                  ) : (
                    <Text className="font-mono-semibold text-sm text-salt-50">{index + 1}</Text>
                  )}
                </View>
                <Text
                  className={`flex-1 pt-1.5 font-sans text-base leading-6 text-steel-800 ${
                    done ? 'line-through' : ''
                  }`}
                >
                  {step}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function TagChip({ tone, label }: { tone: 'chili' | 'basil'; label: string }) {
  const chili = tone === 'chili';
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
        chili ? 'border-chili-200 bg-chili-50' : 'border-basil-200 bg-basil-50'
      }`}
    >
      {chili ? (
        <ShieldCheck size={14} color={colors.chili[700]} />
      ) : (
        <Leaf size={14} color={colors.basil[700]} />
      )}
      <Text className={`font-sans-semibold text-sm ${chili ? 'text-chili-700' : 'text-basil-700'}`}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The EN/ES switch, plus what stands in for it when Spanish is not available:
 * a request button for people who can manage the recipe, a quiet "not yet"
 * chip for everyone else. Same rules as the web reader.
 */
function LanguageControl({
  recipeId,
  lang,
  onLang,
}: {
  recipeId: string;
  lang: Lang;
  onLang: (next: Lang) => void;
}) {
  const queryClient = useQueryClient();
  const [requestError, setRequestError] = useState<string | null>(null);

  const { data: state } = useQuery({
    queryKey: ['translations', ...recipesScopeKey(), 'reader', recipeId, 'es'],
    queryFn: async () => {
      const result = await getRecipeTranslation(recipeId, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
  });

  const request = useMutation({
    mutationFn: async () => {
      const result = await machineTranslateRecipe(recipeId, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['translations'] }),
    onError: (err: Error) => setRequestError(err.message),
  });

  if (!state) return null;

  const approved =
    state.translation != null &&
    state.translation.status === 'approved' &&
    !state.translation.stale;

  if (approved) {
    return (
      <View className="flex-row items-center gap-1 rounded-xl border border-salt-200 bg-salt-100 p-1">
        {(['en', 'es'] as const).map((option) => {
          const active = lang === option;
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
          );
        })}
      </View>
    );
  }

  // No approved Spanish yet. Reviewers can kick off a translation from here —
  // it lands pending review on the web recipe page, never directly on this
  // screen.
  if (state.canManage) {
    const pending =
      state.translation != null &&
      state.translation.status !== 'rejected' &&
      !state.translation.stale;
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
              setRequestError(null);
              request.mutate();
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
    );
  }

  return (
    <View className="min-h-touch flex-row items-center gap-1.5 rounded-xl border border-salt-200 bg-salt-100 px-3.5 py-2">
      <Languages size={16} color={colors.salt[500]} />
      <Text className="font-sans-medium text-sm text-salt-500">ES no disponible</Text>
    </View>
  );
}

function BackButton({ label }: { label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      className="min-h-touch flex-row items-center gap-1.5 self-start"
    >
      <ArrowLeft size={16} color={colors.salt[600]} />
      <Text className="font-sans-semibold text-sm text-salt-600">{label}</Text>
    </Pressable>
  );
}

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [lang, setLang] = useState<Lang>('en');

  const {
    data: recipe,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['recipes', ...recipesScopeKey(), 'reader', 'detail', id],
    queryFn: async () => {
      const result = await getRecipe(id);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    enabled: session.token != null && session.scope != null,
  });

  const { data: translationState } = useQuery({
    queryKey: ['translations', ...recipesScopeKey(), 'reader', id, 'es'],
    queryFn: async () => {
      const result = await getRecipeTranslation(id, 'es');
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    enabled: session.token != null && session.scope != null,
  });

  if (!session.token) return <Redirect href="/login" />;
  if (!session.scope) return <Redirect href="/scope" />;

  const content = recipe?.activeContent ?? null;

  // SAFETY: only an approved, current, correctly aligned translation may
  // render — for every role. The server already narrows what staff receive;
  // this repeats the check for reviewers, whose response carries drafts too.
  const translation = translationState?.translation ?? null;
  const usableTranslation =
    content != null &&
    translation != null &&
    translation.status === 'approved' &&
    !translation.stale &&
    translation.payload.ingredients.length === content.ingredients.length &&
    translation.payload.steps.length === content.steps.length
      ? translation
      : null;

  const display =
    recipe && content
      ? buildDisplay(
          recipe.name,
          content,
          lang === 'es' && usableTranslation ? usableTranslation : null,
        )
      : null;

  return (
    <SafeAreaView className="flex-1 bg-salt-100" edges={['top', 'left', 'right']}>
      <ScreenTransition>
        <ScrollView contentContainerClassName="px-4 pb-10 pt-2">
          <View className="mx-auto w-full max-w-[720px] gap-5">
            {error ? (
              <>
                <BackButton label="Reader" />
                <ErrorNote>{(error as Error).message}</ErrorNote>
              </>
            ) : isLoading || !recipe ? (
              <View className="gap-4">
                <Skeleton className="h-10 w-3/4" />
                <Skeleton className="h-20" />
                <Skeleton className="h-72" />
              </View>
            ) : recipe.status !== 'active' || !content || !display ? (
              // Chefs can reach an unpublished lineage by URL; staff get a 404
              // upstream. Either way the reader has nothing it may show.
              <>
                <BackButton label="Reader" />
                <EmptyState
                  icon={BookOpen}
                  title="Not available in the reader"
                  hint="This recipe has no live version. Once a chef sets one live, it appears here."
                />
              </>
            ) : (
              <>
                <View className="flex-row flex-wrap items-center justify-between gap-3">
                  <BackButton label="Reader" />
                  <LanguageControl recipeId={recipe._id} lang={lang} onLang={setLang} />
                </View>

                <View className="gap-3">
                  <View className="flex-row flex-wrap items-center gap-3">
                    <Text className="font-sans-bold text-3xl tracking-tight text-steel-900">
                      {display.name}
                    </Text>
                    <View className="rounded-full bg-steel-900 px-2.5 py-1">
                      <Text className="font-mono-semibold text-2xs text-salt-50">
                        v{recipe.activeVersion} {display.t.live}
                      </Text>
                    </View>
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
                  {display.description ? (
                    <Text className="font-sans text-base leading-6 text-salt-600">
                      {display.description}
                    </Text>
                  ) : null}
                </View>

                {display.aiUnreviewed && (
                  <WarningBanner icon={ShieldAlert}>{readerEs.unreviewedWarning}</WarningBanner>
                )}

                {!recipe.allergensVerified && (
                  <WarningBanner icon={ShieldAlert}>{display.t.allergenWarning}</WarningBanner>
                )}

                <View className={`${cardClass} gap-7 p-4 tablet:p-6`}>
                  <View className="overflow-hidden rounded-xl border border-salt-200 bg-salt-50">
                    <StatRow
                      icon={Scale}
                      label={display.t.yield}
                      value={`${content.yield.amount} ${
                        display.aiAssisted ? unitEs[content.yield.unit] : content.yield.unit
                      }`}
                      divider={false}
                    />
                    {content.times?.prepMinutes != null && (
                      <StatRow
                        icon={Timer}
                        label={display.t.prep}
                        value={`${content.times.prepMinutes} min`}
                        divider
                      />
                    )}
                    {content.times?.cookMinutes != null && (
                      <StatRow
                        icon={Flame}
                        label={display.t.cook}
                        value={`${content.times.cookMinutes} min`}
                        divider
                      />
                    )}
                  </View>

                  <Ingredients display={display} />
                  <Method display={display} />

                  <View className="gap-5">
                    <View className="gap-2">
                      <Text className="font-sans-semibold text-xs uppercase tracking-wide text-salt-600">
                        {display.t.allergens}
                      </Text>
                      {display.allergenLabels.length === 0 ? (
                        <Text className="font-sans text-sm text-salt-500">
                          {display.t.noVerifiedAllergens}
                        </Text>
                      ) : (
                        <View className="flex-row flex-wrap gap-2">
                          {display.allergenLabels.map((label) => (
                            <TagChip key={label} tone="chili" label={label} />
                          ))}
                        </View>
                      )}
                    </View>
                    {display.dietaryLabels.length > 0 && (
                      <View className="gap-2">
                        <Text className="font-sans-semibold text-xs uppercase tracking-wide text-salt-600">
                          {display.t.dietary}
                        </Text>
                        <View className="flex-row flex-wrap gap-2">
                          {display.dietaryLabels.map((label) => (
                            <TagChip key={label} tone="basil" label={label} />
                          ))}
                        </View>
                      </View>
                    )}
                  </View>

                  {content.photos.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-3">
                        {content.photos.map((photo) => (
                          <View
                            key={photo._id}
                            className="h-40 w-56 overflow-hidden rounded-xl border border-salt-200 bg-salt-100"
                          >
                            <Image
                              source={{ uri: photo.url }}
                              style={{ width: '100%', height: '100%' }}
                              contentFit="cover"
                              accessibilityLabel={display.name}
                            />
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </ScreenTransition>
    </SafeAreaView>
  );
}
