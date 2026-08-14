import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut } from 'react-native-reanimated';

/**
 * The app's motion vocabulary — one place so every surface moves the same
 * way. Durations stay short (120–240ms): transitions should feel like the
 * app keeping up with the user, never the user waiting on the app.
 */

/** Content appearing in place (shelf switches, search results). */
export const appear = FadeIn.duration(220);

/** Small controls popping in/out (clear button, chips). */
export const popIn = FadeIn.duration(140);
export const popOut = FadeOut.duration(120);

/**
 * Screen-level entrance. Native screens already slide via the router's
 * stack animation; the web has no stack animation, so screens fade-and-rise
 * instead. Animating both would double up on native — hence the gate.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') return <View style={{ flex: 1 }}>{children}</View>;
  return (
    <Animated.View style={{ flex: 1 }} entering={FadeInUp.duration(240)}>
      {children}
    </Animated.View>
  );
}

export { Animated };
