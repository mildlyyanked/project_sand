import React, { useState } from 'react';
import { Image, Modal, Pressable, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSQLiteContext } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import type { Draft, LibKind } from '@/core/world/drafts';
import { composePicture, entryImagePrompt } from '@/core/world/forge';
import { imageOf, type EntryImageData } from '@/core/world/portraits';
import { newId, now } from '@/core/ids';
import { useSettings } from '@/state/settings';
import { complete, paint, paintReady } from '@/state/paint';
import { removeImage, saveImage } from '@/state/images';
import { runInForeground } from '@/state/foreground';
import { Banner, Button, Card, Field, IconButton, Ionicons, Row, Sheet, T } from './index';
import { radius, useTheme } from '../theme';

export { imageOf, type EntryImageData };

const WHAT: Partial<Record<LibKind, { noun: string; verb: string; icon: 'person-outline' | 'image-outline' | 'flag-outline' | 'cube-outline' | 'body-outline' }>> = {
  character: { noun: 'portrait', verb: 'Paint a portrait', icon: 'person-outline' },
  location: { noun: 'view', verb: 'Paint a view', icon: 'image-outline' },
  organization: { noun: 'sigil', verb: 'Paint the sigil', icon: 'flag-outline' },
  item: { noun: 'picture', verb: 'Paint it', icon: 'cube-outline' },
  species: { noun: 'study', verb: 'Paint a study', icon: 'body-outline' },
};

export function worldLine(u: Universe | null | undefined): string {
  if (!u) return '';
  const d = u.data;
  const bits = [u.name, d.genre, d.technology, d.tone].filter((x) => x && x.trim()).join('; ');
  const desc = u.description.trim().slice(0, 400);
  return u.isDefault && !desc ? 'the real world, the present day' : [bits, desc].filter(Boolean).join('. ');
}

/** Round thumbnail for lists, the cast, the play strip. Factions' sigils and characters' portraits alike. */
export function Avatar({ data, size = 36, name }: { data: Record<string, unknown> | undefined | null; size?: number; name?: string }) {
  const t = useTheme();
  const img = imageOf(data);
  if (img) return <Image source={{ uri: img.uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.surface2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <T v="small" style={{ fontSize: size * 0.4 }}>{(name ?? '?').trim().charAt(0).toUpperCase()}</T>
    </View>
  );
}

/**
 * The picture at the head of an entry: a portrait, a view of a place, a sigil,
 * an object. The helper describes the subject from the entry (never from a
 * lookalike's name); the world's art direction and a fixed framing per kind
 * are put in front, so a world's pictures match; then the painter from
 * Settings paints it. With prompt-only or review on, the prompt is shown first.
 */
export function EntryImage({ kind, name, data, draft, world, onChange }: { kind: LibKind; name: string; data: Record<string, unknown>; draft: () => Draft; world: Universe | null | undefined; onChange: (image: EntryImageData | null) => void }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { defaults } = useSettings();
  const what = WHAT[kind] ?? WHAT.item!;
  const img = imageOf(data);
  const [busy, setBusy] = useState<'prompt' | 'paint' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const style = { art: world?.data.artStyle?.trim() || defaults.artStyle.trim(), sigil: world?.data.sigilStyle?.trim() || defaults.sigilStyle.trim() };

  async function describe(): Promise<string> {
    const { text } = await complete({ model: defaults.models.helper, messages: entryImagePrompt({ draft: draft(), world: worldLine(world) }), maxTokens: 300, temperature: 0.7, spend: { db, note: `${what.noun} prompt` } });
    const subject = text.trim();
    if (!subject) throw new Error('The helper wrote no picture description. Try again.');
    return composePicture(kind, subject, style);
  }

  async function paintWith(p: string) {
    setBusy('paint'); setErr(null);
    try {
      const out = await runInForeground(`Painting ${name}`, () => paint(p, { zdr: defaults.zdr, spend: { db, note: `${what.noun}: ${name}` } }));
      const uri = await saveImage(newId(), out.dataUrl);
      if (img) await removeImage(img.uri);
      onChange({ uri, prompt: p, model: out.model, at: now() });
      setPrompt(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPrompt(p);
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy('prompt'); setErr(null);
    try {
      const p = await runInForeground('Describing the picture', describe);
      const ready = paintReady();
      setBusy(null);
      if (!ready.ok || defaults.reviewImagePrompt) {
        setPrompt(p);
        if (!ready.ok && !ready.promptOnly) setErr(ready.why);
        return;
      }
      await paintWith(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const ready = paintReady();
  const round = kind === 'character' || kind === 'organization';
  const wide = kind === 'location';
  const box = wide ? { width: '100%' as const, aspectRatio: 16 / 10, borderRadius: radius.lg } : { width: round ? 168 : 200, height: round ? 168 : 200, borderRadius: round ? 84 : radius.lg };

  return (
    <View style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
      {err ? <View style={{ alignSelf: 'stretch' }}><Banner text={err} onClose={() => setErr(null)} /></View> : null}
      <View style={[{ alignSelf: wide ? 'stretch' : 'center' }]}>
        {img ? (
          <Pressable onPress={() => setFull(true)}>
            <Image source={{ uri: img.uri }} resizeMode="cover" style={[box, { backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border }]} />
          </Pressable>
        ) : (
          <Pressable onPress={start} disabled={!!busy} style={({ pressed }) => [box, { backgroundColor: t.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: t.border, alignItems: 'center', justifyContent: 'center', gap: 6, opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name={what.icon} size={34} color={t.faint} />
            <T v="small" style={{ color: t.accent }}>{busy ? (busy === 'prompt' ? 'Describing…' : 'Painting…') : what.verb}</T>
          </Pressable>
        )}
      </View>
      {img ? (
        <Row gap={2}>
          <Button small kind="ghost" icon="color-palette-outline" title={busy ? (busy === 'prompt' ? 'Describing…' : 'Painting…') : 'Paint again'} onPress={start} loading={!!busy} />
          <IconButton name="document-text-outline" size={18} onPress={() => setPrompt(img.prompt)} />
          <IconButton name="trash-outline" size={18} onPress={async () => { await removeImage(img.uri); onChange(null); }} />
        </Row>
      ) : (
        <T v="faint" style={{ textAlign: 'center' }}>{kind === 'character' ? 'Tap to paint a portrait from the appearance. It shows beside them in lists, pickers and passages, and keeps their look in illustrations.' : kind === 'organization' ? 'Tap to paint the sigil. It shows wherever the faction is picked or listed.' : `Tap to paint it from the entry.${ready.ok ? '' : ' Prompt only for now: copy it into any generator.'}`}</T>
      )}
      <Modal visible={full && !!img} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <Pressable onPress={() => setFull(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          {img ? <Image source={{ uri: img.uri }} resizeMode="contain" style={{ width: '100%', height: '80%' }} /> : null}
          <T v="faint" style={{ marginTop: 10 }}>{name} · {img?.model}</T>
        </Pressable>
      </Modal>
      <Sheet open={prompt != null} onClose={() => setPrompt(null)} title={`${what.noun.charAt(0).toUpperCase() + what.noun.slice(1)} prompt`}>
        <Field value={prompt ?? ''} onChangeText={setPrompt} multiline style={{ minHeight: 160 }} />
        <Row style={{ flexWrap: 'wrap' }}>
          {ready.ok ? <Button title="Paint" icon="color-palette-outline" onPress={() => prompt && paintWith(prompt)} loading={busy === 'paint'} style={{ flex: 1 }} /> : null}
          <Button kind="outline" icon="copy-outline" title="Copy" onPress={() => prompt && Clipboard.setStringAsync(prompt)} />
          <Button kind="outline" icon="share-outline" title="Share" onPress={() => prompt && Share.share({ message: prompt })} />
        </Row>
        {!ready.ok ? <T v="faint">{ready.why}</T> : null}
        <Card><T v="faint">The art direction ({kind === 'organization' ? 'sigil style' : 'from the world page, or Settings'}) and the framing come first, then the helper’s description by appearance only. A character’s “looks like” never goes into it.</T></Card>
      </Sheet>
    </View>
  );
}
