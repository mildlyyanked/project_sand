import React, { Suspense, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { DB_NAME, migrate } from '@/db/schema';
import { seedIfEmpty } from '@/db/seed';
import { useSettings } from '@/state/settings';
import { dark, light, useScheme, useTheme } from '@/ui/theme';

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

export default function RootLayout() {
  const scheme = useScheme();
  const t = scheme === 'light' ? light : dark;
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg).catch(() => {});
  }, [t.bg]);
  const navTheme = scheme === 'light' ? { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: t.bg, card: t.bg, text: t.text, border: t.border, primary: t.accent } } : { ...DarkTheme, colors: { ...DarkTheme.colors, background: t.bg, card: t.bg, text: t.text, border: t.border, primary: t.accent } };
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
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
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: t.bg },
                  headerTintColor: t.text,
                  headerShadowVisible: false,
                  headerTitleStyle: { fontWeight: '600' },
                  contentStyle: { backgroundColor: t.bg },
                  headerBackButtonDisplayMode: 'minimal',
                }}
              >
                <Stack.Screen name="index" options={{ title: 'Sand' }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="models" options={{ title: 'Choose model', presentation: 'modal' }} />
                <Stack.Screen name="new" options={{ title: 'New story' }} />
                <Stack.Screen name="session/[id]/index" options={{ title: '' }} />
                <Stack.Screen name="session/[id]/context" options={{ title: 'Context', presentation: 'modal' }} />
                <Stack.Screen name="session/[id]/settings" options={{ title: 'Session' }} />
                <Stack.Screen name="session/[id]/scene" options={{ title: 'Next scene', presentation: 'modal' }} />
                <Stack.Screen name="session/[id]/race" options={{ title: 'Draft race', presentation: 'modal' }} />
                <Stack.Screen name="library/index" options={{ title: 'Library' }} />
                <Stack.Screen name="library/character/[id]" options={{ title: 'Character' }} />
                <Stack.Screen name="library/style/[id]" options={{ title: 'Style' }} />
                <Stack.Screen name="library/preset/[id]" options={{ title: 'Preset' }} />
                <Stack.Screen name="library/universe/[id]" options={{ title: 'World' }} />
              </Stack>
            </Boot>
          </SQLiteProvider>
        </Suspense>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
