import React, { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Session } from '@/core/types';
import { copySession, deleteSession } from '@/db/repo/sessions';
import { Badge, Card, MenuItem, Row, Sheet, T } from './index';
import { relTime, shortModel } from '@/ui/format';

/** One story in a list: title, when, how long, what kind; hold for options. */
export function StoryCard({ s, words, chapter, onHold }: { s: Session; words?: number; chapter?: number; onHold: (s: Session) => void }) {
  return (
    <Card onPress={() => router.push(`/session/${s.id}`)} onLongPress={() => onHold(s)} style={{ gap: 6 }}>
      <Row between>
        <T v="h" numberOfLines={1} style={{ flex: 1 }}>{chapter ? <T v="h" style={{ opacity: 0.55 }}>{`${chapter}  `}</T> : null}{s.title}</T>
        <T v="faint">{relTime(s.updatedAt)}</T>
      </Row>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <T v="faint">{shortModel(s.models.writer)}</T>
        {words != null ? <T v="faint">· {words.toLocaleString()} words</T> : null}
        {s.mode === 'pov' ? <Badge label="played" tone="accent" /> : null}
        {s.explicit ? <Badge label="explicit" tone="warn" /> : null}
        {s.zdr ? <Badge label="ZDR" tone="ok" /> : null}
        {s.variantOf ? <Badge label="variant" tone="info" /> : null}
      </Row>
      {s.variantNote ? <T v="faint" numberOfLines={1}>{s.variantNote}</T> : null}
    </Card>
  );
}

/** The hold menu for a story: open, settings, duplicate, delete. */
export function useStoryMenu(db: SQLiteDatabase, reload: () => void) {
  const [held, setHeld] = useState<Session | null>(null);
  async function duplicate(s: Session) {
    setHeld(null);
    const copy = await copySession(db, s.id, { title: `${s.title} copy`, withBeats: true });
    reload();
    if (copy) router.push(`/session/${copy.id}`);
  }
  function confirmDelete(s: Session) {
    setHeld(null);
    Alert.alert(`Delete “${s.title}”?`, 'Every beat and branch goes with it, and its recap leaves the instance’s memory. There is no undo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSession(db, s.id); reload(); } },
    ]);
  }
  const sheet = (
    <Sheet open={!!held} onClose={() => setHeld(null)} title={held?.title}>
      {held ? (
        <>
          <MenuItem icon="open-outline" label="Open" onPress={() => { setHeld(null); router.push(`/session/${held.id}`); }} />
          <MenuItem icon="options-outline" label="Session settings" onPress={() => { setHeld(null); router.push(`/session/${held.id}/settings`); }} />
          <MenuItem icon="copy-outline" label="Duplicate" onPress={() => duplicate(held)} />
          <MenuItem icon="trash-outline" label="Delete story" danger onPress={() => confirmDelete(held)} />
        </>
      ) : null}
    </Sheet>
  );
  return { hold: setHeld, sheet };
}
