import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { GALLERY, GALLERY_SCENE, galleryId, galleryStyle, type GalleryVoice } from '@/core/voiceGallery';
import { STRENGTH } from '@/core/voice';
import { now } from '@/core/ids';
import { getStyle, saveStyle } from '@/db/repo/library';
import { Badge, Button, Card, Chip, Row, Sheet, T } from './index';
import { serif } from '../theme';

/** Add a gallery voice to your voices (or find the one already added). Returns its id. */
export async function addGalleryVoice(db: Parameters<typeof saveStyle>[0], g: GalleryVoice): Promise<string> {
  const id = galleryId(g.key);
  if (!(await getStyle(db, id))) await saveStyle(db, galleryStyle(g, now()));
  return id;
}

/**
 * The voices that come with the app, each shown by the same scene written in
 * it, so they can be told apart at a glance. Tap one to read it whole; add it
 * to make it a voice of your own.
 */
export function VoiceGallery({ added, onOpen }: { added: Set<string>; onOpen: (styleId: string) => void }) {
  const db = useSQLiteContext();
  const [open, setOpen] = useState<GalleryVoice | null>(null);
  return (
    <View style={{ gap: 10 }}>
      <T v="faint">Every sample is the same scene, {GALLERY_SCENE.toLowerCase()} Only the voice changes.</T>
      {GALLERY.map((g) => (
        <Card key={g.key} onPress={() => setOpen(g)} style={{ gap: 6 }}>
          <Row between>
            <T v="h" style={{ flex: 1 }} numberOfLines={1}>{g.name}</T>
            {added.has(galleryId(g.key)) ? <Badge label="added" tone="ok" /> : null}
          </Row>
          <T v="small">Writes like {g.authors.join(' and ')}</T>
          <T v="dim">{g.blurb}</T>
          <T numberOfLines={3} style={{ fontFamily: serif, fontSize: 15, lineHeight: 22, opacity: 0.85 }}>{g.sample}</T>
        </Card>
      ))}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name} full>
        {open ? (
          <>
            <T v="small">Writes like {open.authors.join(' and ')} · {STRENGTH[open.strength].label.toLowerCase()} · {open.tone}</T>
            <T style={{ fontStyle: 'italic' }}>{open.anchor}</T>
            <View style={{ gap: 10 }}>
              {open.sample.split(/\n{2,}/).map((p, i) => <T key={i} style={{ fontFamily: serif, fontSize: 17, lineHeight: 26 }}>{p}</T>)}
            </View>
            <T v="label">How it writes</T>
            <T v="dim">{open.rules}</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {[open.pointOfView, open.tense, open.proseDensity, `dialogue: ${open.dialogueRatio.toLowerCase()}`].map((x) => <Chip key={x} small label={x} />)}
            </ScrollView>
            {added.has(galleryId(open.key))
              ? <Button title="Open it" icon="create-outline" onPress={() => { const id = galleryId(open.key); setOpen(null); onOpen(id); }} />
              : <Button title="Add to my voices" icon="add" onPress={async () => { const id = await addGalleryVoice(db, open); setOpen(null); onOpen(id); }} />}
            <T v="faint">Added, it is a voice of your own: change anything, rebuild it, or hear it on another scene.</T>
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
