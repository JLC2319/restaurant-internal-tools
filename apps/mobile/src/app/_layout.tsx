import '../global.css'

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono'
import { QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { hydrateSession } from '../api/client'
import { queryClient } from '../lib/queryClient'

/**
 * App shell. Nothing renders until the persisted session is back in memory —
 * routing decisions (login vs reader vs scope picker) read the session
 * synchronously, so hydration must win the race with the first screen.
 */

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  })
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    void hydrateSession().then(() => setSessionReady(true))
  }, [])

  const ready = fontsLoaded && sessionReady

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync()
  }, [ready])

  if (!ready) return null

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#f6f7f9' },
        }}
      />
    </QueryClientProvider>
  )
}
