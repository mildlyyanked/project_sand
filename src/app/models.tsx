import React, { useEffect } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSettings } from '@/state/settings';
import { useSession } from '@/state/session';
import { getSession, patchSession } from '@/db/repo/sessions';
import { ModelPicker } from '@/ui/components/ModelPicker';

type Slot = 'writer' | 'summarizer' | 'helper';

/** Route wrapper around the shared picker so list rows can deep-link to it. */
export default function Models() {
  const { target, current } = useLocalSearchParams<{ target: string; current?: string }>();
  const db = useSQLiteContext();
  const settings = useSettings();
  const sessionStore = useSession();
  useEffect(() => {
    void settings.ensureModels(db);
  }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(id: string) {
    const [kind, sid, slot] = (target ?? '').split(':');
    if (kind === 'default') await settings.setDefaults(db, { models: { ...settings.defaults.models, [sid as Slot]: id } });
    else if (kind === 'session' && sid && slot) {
      if (sessionStore.session?.id === sid) await sessionStore.patch({ models: { ...sessionStore.session.models, [slot as Slot]: id } });
      else {
        const s = await getSession(db, sid);
        if (s) await patchSession(db, sid, { models: { ...s.models, [slot]: id } });
      }
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ModelPicker open onClose={() => router.back()} onSelect={(id) => void choose(id)} current={current ?? null} />
    </>
  );
}
