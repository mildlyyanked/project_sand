import React, { useState } from 'react';
import { Image, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Universe } from '@/core/types';
import type { Draft, LibKind } from '@/core/world/drafts';
import { entryImagePrompt } from '@/core/world/forge';
import { imageOf, type EntryImageData } from '@/core/world/portraits';
import { newId, now } from '@/core/ids';
import { useSettings } from '@/state/settings';
import { complete, paint, paintReady } from '@/state/paint';
import { removeImage, saveImage } from '@/state/images';
import { runInForeground } from '@/state/foreground';
import { Banner, Button, Card, Field, Row, Sheet, T } from './index';
import { radius, useTheme } from '../theme';

export { imageOf, type EntryImageData };

const WHAT: Partial<Record<LibKind, { noun: string; verb: string; aspect: number }>> = {
  character: { noun: 'portrait', verb: 'Paint a portrait', aspect: 1 },
  location: { noun: 'view', verb: 'Paint a view', aspect: 16 / 10 },
  organization: { noun: 'sigil', verb: 'Paint the sigil', aspect: 1 },
  item: { noun: 'picture', verb: 'Paint it', aspect: 1 },
  species: { noun: 'study', verb: 'Paint a study', aspect: 1 },
};

export function worldLine(u: Universe | null | undefined): string {
  if (!u) return '';
  const d = u.data;
  const bits = [u.name, d.genre, d.technology, d.tone].filter((x) => x && x.trim()).join('; ');
  const desc = u.description.trim().slice(0, 400);
  return u.isDefault && !desc ? 'the real world, the present day' : [bits, desc].filter(Boolean).join('. ');
}

/** Round thumbnail for lists, the cast, the play strip. */
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
 * The picture section of an entry editor. The helper model writes an image
 * prompt from the entry (never from a lookalike's name), then the painter from
 * Settings paints it; with prompt-only or review on, the prompt is shown first.
 */
export function EntryImage({ kind, name, data, draft, world, onChange }: { kind: LibKind; name: string; data: Record<string, unknown>; draft: () => Draft; world: Universe | null | undefined; onChange: (image: EntryImageData | null) => void }) {
  const t = useTheme();
  const { defaults } = useSettings();
  const what = WHAT[kind] ?? WHAT.item!;
  const img = imageOf(data);
  const [busy, setBusy] = useState<'prompt' | 'paint' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  async function describe(): Promise<string> {
    const { text } = await complete({ model: defaults.models.helper, messages: entryImagePrompt({ draft: draft(), world: worldLine(world) }), maxTokens: 300, temperature: 0.7 });
    const p = text.trim();
    if (!p) throw new Error('The helper wrote no picture prompt. Try again.');
    return p;
  }

  async function paintWith(p: string) {
    setBusy('paint'); setErr(null);
    try {
      const out = await runInForeground(`Painting ${name}`, () => paint(p, { zdr: defaults.zdr }));
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
  return (
    <View style={{ gap: 8 }}>
      <T v="label">{what.noun.charAt(0).toUpperCase() + what.noun.slice(1)}</T>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      {img ? (
        <Image source={{ uri: img.uri }} resizeMode="cover" style={{ width: '100%', maxWidth: kind === 'location' ? undefined : 320, alignSelf: 'center', aspectRatio: what.aspect, borderRadius: radius.lg, backgroundColor: t.surface2 }} />
      ) : null}
      <Row style={{ flexWrap: 'wrap' }}>
        <Button small kind={img ? 'outline' : 'primary'} icon="color-palette-outline" title={img ? 'Paint again' : what.verb} onPress={start} loading={!!busy} />
        {img ? <Button small kind="ghost" icon="document-text-outline" title="Prompt" onPress={() => setPrompt(img.prompt)} /> : null}
        {img ? <Button small kind="ghost" icon="trash-outline" title="Remove" onPress={async () => { await removeImage(img.uri); onChange(null); }} /> : null}
      </Row>
      {!img ? <T v="faint">{kind === 'character' ? 'Written from the appearance, then painted by the image model in Settings. Portraits show beside the character in stories and help keep their look the same in illustrations.' : `Written from the entry, then painted by the image model in Settings.${ready.ok ? '' : ' Prompt only for now: copy it into any generator.'}`}</T> : null}
      <Sheet open={prompt != null} onClose={() => setPrompt(null)} title={`${what.noun.charAt(0).toUpperCase() + what.noun.slice(1)} prompt`}>
        <Field value={prompt ?? ''} onChangeText={setPrompt} multiline style={{ minHeight: 140 }} />
        <Row style={{ flexWrap: 'wrap' }}>
          {ready.ok ? <Button title="Paint" icon="color-palette-outline" onPress={() => prompt && paintWith(prompt)} loading={busy === 'paint'} style={{ flex: 1 }} /> : null}
          <Button kind="outline" icon="copy-outline" title="Copy" onPress={() => prompt && Clipboard.setStringAsync(prompt)} />
          <Button kind="outline" icon="share-outline" title="Share" onPress={() => prompt && Share.share({ message: prompt })} />
        </Row>
        {!ready.ok ? <T v="faint">{ready.why}</T> : null}
        <Card><T v="faint">The prompt describes by appearance only. A character’s “looks like” never goes into it.</T></Card>
      </Sheet>
    </View>
  );
}
