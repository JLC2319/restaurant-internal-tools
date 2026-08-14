import { Redirect } from 'expo-router';
import { ChefHat } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { setScope, setToken, takeNotice } from '../api/client';
import { login } from '../api/auth';
import { ScreenTransition } from '../components/motion';
import { ErrorNote, PrimaryButton, cardClass } from '../components/ui';
import { useSession } from '../lib/useSession';
import colors from '../theme/colors.js';

/**
 * Sign in. Navigation is declarative: a token in the session store redirects
 * to the reader (scope set) or the scope picker (scope missing) — so a
 * successful login only has to write the session and the redirects follow.
 * One membership selects its own scope; several send the user to the picker.
 */
export default function LoginScreen() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Why the user landed here uninvited (session expired, account suspended).
  const [notice] = useState<string | null>(() => takeNotice());
  const [busy, setBusy] = useState(false);

  if (session.token && session.scope) return <Redirect href="/" />;
  if (session.token) return <Redirect href="/scope" />;

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await login({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    // Order matters: set the scope first so the token write renders straight
    // into the reader instead of bouncing through the scope picker.
    const { token, memberships } = result.data;
    if (memberships.length === 1) {
      const m = memberships[0];
      setScope({
        orgId: m.org._id,
        propertyId: m.property?._id ?? null,
        locationId: m.location?._id ?? null,
      });
    }
    setToken(token);
  };

  return (
    <SafeAreaView className="flex-1 bg-salt-100">
      <ScreenTransition>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="flex-grow justify-center px-6 py-10"
            keyboardShouldPersistTaps="handled"
          >
            <View className="mx-auto w-full max-w-[420px] gap-6">
              <View className="items-center gap-3">
                <View className="size-16 items-center justify-center rounded-3xl bg-steel-900">
                  <ChefHat size={30} color={colors.salt[50]} />
                </View>
                <View className="items-center gap-1">
                  <Text className="font-sans-bold text-2xl tracking-tight text-steel-900">
                    On the line
                  </Text>
                  <Text className="text-center font-sans text-sm text-salt-600">
                    Live recipes and published training — everything here has been approved.
                  </Text>
                </View>
              </View>

              <View className={`${cardClass} gap-4 p-5`}>
                {notice && <ErrorNote>{notice}</ErrorNote>}
                {error && <ErrorNote>{error}</ErrorNote>}

                <View className="gap-1.5">
                  <Text className="font-sans-medium text-sm text-steel-800">Email</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    placeholder="you@example.com"
                    placeholderTextColor={colors.salt[500]}
                    className="min-h-touch rounded-xl border border-salt-300 bg-white px-3.5 py-2.5 font-sans text-base text-steel-900"
                  />
                </View>

                <View className="gap-1.5">
                  <Text className="font-sans-medium text-sm text-steel-800">Password</Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoComplete="password"
                    textContentType="password"
                    placeholder="••••••••"
                    placeholderTextColor={colors.salt[500]}
                    onSubmitEditing={submit}
                    returnKeyType="go"
                    className="min-h-touch rounded-xl border border-salt-300 bg-white px-3.5 py-2.5 font-sans text-base text-steel-900"
                  />
                </View>

                <PrimaryButton onPress={submit} busy={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </PrimaryButton>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenTransition>
    </SafeAreaView>
  );
}
