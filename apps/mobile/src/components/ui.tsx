import type { LucideIcon } from 'lucide-react-native'
import { AlertCircle } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import colors from '../theme/colors.js'

/**
 * The mobile twins of apps/web/src/components/ui.tsx — same design language
 * (soft 2xl radii, hairline borders, restrained tones), expressed in React
 * Native. Web `ring` becomes `border`; hover states become press opacity;
 * font weights are their own families (see tailwind.config.js).
 *
 * Chili stays reserved for allergen tags and danger. Review states read
 * citron, published/approved reads basil — same rules as everywhere else.
 */

/** The one card surface. */
export const cardClass = 'rounded-2xl bg-white border border-salt-200'

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-start gap-2.5 rounded-xl border border-chili-200 bg-chili-50 px-4 py-3"
    >
      <View className="mt-0.5">
        <AlertCircle size={16} color={colors.chili[600]} />
      </View>
      <Text className="flex-1 font-sans text-sm leading-5 text-chili-700">{children}</Text>
    </View>
  )
}

/** Shimmer placeholder (pulse on native). Size it with width/height classes. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <View className={`animate-pulse rounded-lg bg-salt-200 ${className}`} />
}

/**
 * The empty-state pattern: an icon in a soft tile, a headline, one line of
 * guidance, and (optionally) the action that fixes it.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <View className={`items-center gap-3 px-6 py-14 ${cardClass}`}>
      <View className="size-14 items-center justify-center rounded-2xl border border-salt-200 bg-salt-100">
        <Icon size={28} color={colors.salt[500]} />
      </View>
      <Text className="text-center font-sans-semibold text-base text-steel-900">{title}</Text>
      {hint && (
        <Text className="max-w-[320px] text-center font-sans text-sm leading-5 text-salt-600">
          {hint}
        </Text>
      )}
      {action && <View className="mt-2">{action}</View>}
    </View>
  )}

/**
 * One segmented option. The active pill is its own always-mounted layer whose
 * opacity animates, so switching tabs crossfades instead of snapping — and
 * the option's size never changes (the border lives on the layer, not the
 * pressable), so labels don't shift.
 */
function SegmentedOption({
  active,
  onPress,
  label,
  icon: Icon,
}: {
  active: boolean
  onPress: () => void
  label: string
  icon?: LucideIcon
}) {
  const pill = useAnimatedStyle(
    () => ({ opacity: withTiming(active ? 1 : 0, { duration: 160 }) }),
    [active]
  )

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="min-h-touch flex-row items-center gap-1.5 rounded-lg px-3.5 py-1.5"
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.salt[300],
            backgroundColor: '#ffffff',
          },
          pill,
        ]}
      />
      {Icon && <Icon size={14} color={active ? colors.steel[900] : colors.salt[600]} />}
      <Text className={`font-sans-medium text-sm ${active ? 'text-steel-900' : 'text-salt-600'}`}>
        {label}
      </Text>
    </Pressable>
  )
}

/** Segmented control — the recipes/training shelf toggle. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (next: T) => void
  options: { id: T; label: string; icon?: LucideIcon }[]
}) {
  return (
    <View className="flex-row items-center gap-1 self-start rounded-xl border border-salt-200 bg-salt-100 p-1">
      {options.map((option) => (
        <SegmentedOption
          key={option.id}
          active={value === option.id}
          onPress={() => onChange(option.id)}
          label={option.label}
          icon={option.icon}
        />
      ))}
    </View>
  )
}

/** Primary CTA — ember, filled, glove-sized. */
export function PrimaryButton({
  onPress,
  disabled,
  busy,
  icon: Icon,
  children,
}: {
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  icon?: LucideIcon
  children: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      className={`min-h-touch flex-row items-center justify-center gap-2 rounded-xl bg-ember-600 px-4 py-2.5 active:opacity-85 ${
        disabled || busy ? 'opacity-60' : ''
      }`}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : (
        Icon && <Icon size={16} color="#ffffff" />
      )}
      <Text className="font-sans-semibold text-base text-white">{children}</Text>
    </Pressable>
  )
}

/** Quiet bordered button — secondary actions. */
export function SubtleButton({
  onPress,
  disabled,
  busy,
  icon: Icon,
  children,
}: {
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  icon?: LucideIcon
  children: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      className={`min-h-touch flex-row items-center justify-center gap-1.5 rounded-xl border border-salt-300 bg-white px-3.5 py-2 active:bg-salt-50 ${
        disabled || busy ? 'opacity-60' : ''
      }`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.steel[700]} />
      ) : (
        Icon && <Icon size={16} color={colors.steel[700]} />
      )}
      <Text className="font-sans-medium text-sm text-steel-700">{children}</Text>
    </Pressable>
  )
}

/**
 * Small status chip. Tones follow the house rules: basil = verified/approved,
 * citron = unverified/awaiting review, steel = neutral fact.
 */
export function Chip({
  tone,
  icon: Icon,
  label,
}: {
  tone: 'basil' | 'citron' | 'steel' | 'chili'
  icon?: LucideIcon
  label: string
}) {
  const tones = {
    basil: {
      box: 'border-basil-200 bg-basil-50',
      text: 'text-basil-700',
      icon: colors.basil[700],
    },
    citron: {
      box: 'border-citron-200 bg-citron-50',
      text: 'text-citron-700',
      icon: colors.citron[700],
    },
    steel: {
      box: 'border-steel-200 bg-steel-50',
      text: 'text-steel-600',
      icon: colors.steel[600],
    },
    chili: {
      box: 'border-chili-200 bg-chili-50',
      text: 'text-chili-700',
      icon: colors.chili[700],
    },
  }[tone]

  return (
    <View className={`flex-row items-center gap-1 self-start rounded-full border px-2 py-0.5 ${tones.box}`}>
      {Icon && <Icon size={12} color={tones.icon} />}
      <Text className={`font-sans-semibold text-2xs uppercase tracking-wide ${tones.text}`}>
        {label}
      </Text>
    </View>
  )
}

/**
 * Citron notice banner — the "someone should know this before acting" tone:
 * unverified allergens, unreviewed machine translation.
 */
export function WarningBanner({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <View className="flex-row items-start gap-2.5 rounded-xl border border-citron-200 bg-citron-50 px-4 py-3">
      <View className="mt-0.5">
        <Icon size={16} color={colors.citron[700]} />
      </View>
      <Text className="flex-1 font-sans text-sm leading-5 text-citron-700">{children}</Text>
    </View>
  )
}
