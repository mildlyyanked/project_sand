import React, { Suspense, useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { DB_NAME, migrate } from '@/db/schema';
import { seedIfEmpty } from '@/db/seed';
import { useSettings } from '@/state/settings';
import { dark, light, useScheme, useTheme } from '@/ui/theme';
import { KeyboardRoot } from '@/ui/keyboard';

function Boot({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const ready = useSettings((s) => s.ready);
  const load = useSettings((s) => s.load);
  useEffect(() => {
    void load(db);
  }, [db, load]);
  if (!ready) return <Spinner />;
  return <>{children}</>;
}

function Spinner() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

/** Shown instead of a hard crash, with the message so it can be reported. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: dark.bg, padding: 24, justifyContent: 'center', gap: 12 }}>
      <Text style={{ color: dark.text, fontSize: 18, fontWeight: '600' }}>Something broke</Text>
      <ScrollView style={{ maxHeight: 260 }}><Text style={{ color: dark.dim, fontFamily: 'monospace', fontSize: 12 }}>{String(error?.message ?? error)}{'\n'}{String(error?.stack ?? '').slice(0, 1500)}</Text></ScrollView>
      <Pressable onPress={retry} style={{ backgroundColor: dark.accent, padding: 12, borderRadius: 12, alignItems: 'center' }}><Text style={{ color: dark.accentText, fontWeight: '700' }}>Try again</Text></Pressable>
    </View>
  );
}

export default function RootLayout() {
  const scheme = useScheme();
  const t = scheme === 'light' ? light : dark;
  useEffect(() => {
    try {
      void SystemUI.setBackgroundColorAsync(t.bg).catch(() => {});
    } catch {}
  }, [t.bg]);
  // Stable per scheme: a fresh theme object on every render makes the navigators re-apply header styles mid-transition.
  const navTheme = useMemo(() => (scheme === 'light' ? { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: t.bg, card: t.bg, text: t.text, border: t.border, primary: t.accent } } : { ...DarkTheme, colors: { ...DarkTheme.colors, background: t.bg, card: t.bg, text: t.text, border: t.border, primary: t.accent } }), [scheme, t]);
  const screenOptions = useMemo(() => ({
    headerStyle: { backgroundColor: t.bg },
    headerTintColor: t.text,
    headerShadowVisible: false,
    headerTitleStyle: { fontWeight: '600' as const },
    contentStyle: { backgroundColor: t.bg },
    headerBackButtonDisplayMode: 'minimal' as const,
  }), [t]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardRoot>
      <ThemeProvider value={navTheme}>
        <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
        <Suspense fallback={<Spinner />}>
          <SQLiteProvider
            databaseName={DB_NAME}
            useSuspense
            onInit={async (db) => {
              await migrate(db);
              await seedIfEmpty(db);
            }}
          >
            <Boot>
              <Stack screenOptions={screenOptions}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="models" options={{ title: '', presentation: 'modal', headerShown: false }} />
                <Stack.Screen name="new" options={{ title: 'Workshop' }} />
                <Stack.Screen name="templates" options={{ title: 'Prompt templates' }} />
                <Stack.Screen name="lab" options={{ title: 'Prompt lab' }} />
                <Stack.Screen name="session/[id]/index" options={{ title: '' }} />
                <Stack.Screen name="session/[id]/context" options={{ title: 'Context', presentation: 'modal' }} />
                <Stack.Screen name="session/[id]/settings" options={{ title: 'Session' }} />
                <Stack.Screen name="session/[id]/clinic" options={{ title: 'Refusal clinic' }} />
                <Stack.Screen name="library/character/[id]" options={{ title: 'Character' }} />
                <Stack.Screen name="library/style/[id]" options={{ title: 'Voice' }} />
                <Stack.Screen name="library/universe/[id]" options={{ title: 'World' }} />
              </Stack>
            </Boot>
          </SQLiteProvider>
        </Suspense>
      </ThemeProvider>
      </KeyboardRoot>
    </GestureHandlerRootView>
  );
}
