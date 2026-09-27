import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSettings } from '@/state/settings';
import { IconButton } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/** Home is three tabs: the stories, the library they draw on, and what it all costs. */
export default function TabsLayout() {
  const t = useTheme();
  const apiKey = useSettings((s) => s.apiKey);
  const settingsButton = () => <IconButton name="settings-outline" onPress={() => router.push('/settings')} badge={!apiKey} />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600' },
        headerRight: settingsButton,
        sceneStyle: { backgroundColor: t.bg },
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.border },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.dim,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Stories', headerTitle: 'Sand', tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Ionicons name="library-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="usage" options={{ title: 'Usage', tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
