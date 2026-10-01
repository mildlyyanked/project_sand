import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Universe } from '@/core/types';
import { forgePrompt, parseForge, type ForgeContext, type ForgeKind, type ForgeResult } from '@/core/helpers';
import { listCharacters, listLore, listSpecies, listUniverses, newCharacter, newLore, newSpecies, newUniverse, saveCharacter, saveLore, saveSpecies, saveUniverse } from '@/db/repo/library';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { runInForeground } from '@/state/foreground';
import { Badge, Banner, Button, Card, Chip, Field, Row, Sheet, Stepper, T } from './index';
import { ModelPicker } from './ModelPicker';
import { shortModel } from '../format';

const LABEL: Record<ForgeKind, { title: string; placeholder: string }> = {
  world: { title: 'Forge a world', placeholder: 'e.g. A drowned city-state run by salvage guilds; tide law; something living in the deep cisterns' },
  species: { title: 'Forge species', placeholder: 'e.g. A sea-born people who moult once a decade; a parasite that confers rank' },
  lore: { title: 'Forge lore', placeholder: 'e.g. How the guild courts work; the night market; what the bells mean' },
  character: { title: 'Forge characters', placeholder: 'e.g. A disgraced tide-judge and the smuggler who owns her debt' },
};

/**
 * One sheet for inventing library entries with the writer model: a wish, how
 * many, which world they belong to, then a preview to prune before saving.
 */
export function ForgeSheet(props: { open: boolean; onClose: () => void; kind: ForgeKind; universeId?: string | null; onSaved: () => void }) {
  // The body mounts fresh on every open, so its state starts clean without resetting in an effect.
  return (
    <Sheet open={props.open} onClose={props.onClose} title={LABEL[props.kind].title} full>
      {props.open ? <ForgeBody {...props} /> : null}
    </Sheet>
  );
}

function ForgeBody({ onClose, kind, universeId, onSaved }: { onClose: () => void; kind: ForgeKind; universeId?: string | null; onSaved: () => void }) {
  const db = useSQLiteContext();
  const { apiKey, defaults } = useSettings();
  const [wish, setWish] = useState('');
  const [count, setCount] = useState(kind === 'character' ? 2 : 3);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [uId, setUId] = useState<string | null>(universeId ?? null);
  const [model, setModel] = useState(defaults.models.writer);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ForgeResult | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    void listUniverses(db).then(setUniverses);
  }, [db]);

  const needsWorld = kind === 'species' || kind === 'lore';

  async function generate() {
    if (!apiKey) return setErr('Add your OpenRouter key in Settings first.');
    if (needsWorld && !uId) return setErr('Pick the world these belong to.');
    setBusy(true); setErr(null); setResult(null); setSkip(new Set()); setProgress(0);
    try {
      const universe = uId ? universes.find((u) => u.id === uId) ?? null : null;
      const [species, lore, chars] = uId ? await Promise.all([listSpecies(db, uId), listLore(db, uId), listCharacters(db)]) : [[], [], await listCharacters(db)];
      const ctx: ForgeContext = { universe, species: species.map((s) => ({ name: s.name, adulthood: s.adulthood })), lore: lore.map((l) => ({ title: l.title, keys: l.keys })), characters: chars.filter((c) => !uId || c.universeId === uId).map((c) => ({ name: c.name, summary: c.summary })) };
      let text = '';
      await runInForeground('Forging library entries', async () => {
        for await (const ev of client.stream({ apiKey, model, messages: forgePrompt(kind, { wish, count, ctx }), params: { temperature: 0.9, topP: 0.95, maxTokens: kind === 'world' ? 2200 : 500 + 450 * count, reasoning: false }, zdr: defaults.zdr })) {
          if (ev.type === 'text') { text += ev.text ?? ''; setProgress(text.length); }
          if (ev.type === 'error') throw new Error(ev.error);
        }
      });
      const r = parseForge(kind, text);
      if (!r) throw new Error('The model did not return usable entries. Try again, a clearer wish, or another model.');
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    const keep = <T,>(xs: T[]) => xs.filter((_, i) => !skip.has(i));
    if (result.kind === 'world') {
      const u = { ...newUniverse(result.world.name), description: result.world.description };
      await saveUniverse(db, u);
      for (const s of keep(result.world.species)) await saveSpecies(db, { ...newSpecies(u.id), ...s });
      for (const l of result.world.lore) await saveLore(db, { ...newLore(u.id), ...l, priority: l.alwaysOn ? 1 : 0 });
    } else if (result.kind === 'species' && uId) {
      for (const s of keep(result.species)) await saveSpecies(db, { ...newSpecies(uId), ...s });
    } else if (result.kind === 'lore' && uId) {
      for (const l of keep(result.lore)) await saveLore(db, { ...newLore(uId), ...l, priority: l.alwaysOn ? 1 : 0 });
    } else if (result.kind === 'character') {
      const species = uId ? await listSpecies(db, uId) : [];
      for (const c of keep(result.characters)) {
        const sp = c.species ? species.find((s) => s.name.toLowerCase() === c.species.toLowerCase()) : undefined;
        await saveCharacter(db, { ...newCharacter(), name: c.name, universeId: uId, speciesId: sp?.id ?? null, lifeStage: c.lifeStage, adult: c.adult, summary: c.summary, voice: c.voice, tells: c.tells, relationships: c.relationships, limits: c.limits, preferences: c.preferences });
      }
    }
    setResult(null);
    onSaved();
    onClose();
  }

  const toggle = (i: number) => setSkip((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const items: { title: string; subtitle: string; badge?: string }[] = !result ? [] : result.kind === 'world' ? result.world.species.map((s) => ({ title: s.name, subtitle: s.adulthood, badge: 'species' })) : result.kind === 'species' ? result.species.map((s) => ({ title: s.name, subtitle: s.notes || s.adulthood })) : result.kind === 'lore' ? result.lore.map((l) => ({ title: l.title, subtitle: l.text, badge: l.alwaysOn ? 'always on' : l.keys.join(', ') })) : result.characters.map((c) => ({ title: c.name, subtitle: [c.lifeStage, c.summary].filter(Boolean).join(' · '), badge: c.adult ? undefined : 'not adult' }));

  return (
    <>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      {!result ? (
        <>
          <Field value={wish} onChangeText={setWish} placeholder={LABEL[kind].placeholder} multiline style={{ minHeight: 80 }} autoFocus />
          {kind !== 'world' ? (
            <View style={{ gap: 6 }}>
              <T v="label">{needsWorld ? 'World' : 'World, optional'}</T>
              <Row style={{ flexWrap: 'wrap' }}>
                {!needsWorld ? <Chip label="None" selected={!uId} onPress={() => setUId(null)} /> : null}
                {universes.map((u) => <Chip key={u.id} label={u.name} selected={uId === u.id} onPress={() => setUId(u.id)} />)}
              </Row>
              {!universes.length ? <T v="faint">No worlds yet. Forge one from the Worlds tab first.</T> : null}
            </View>
          ) : null}
          {kind !== 'world' ? <Row between><T>How many</T><Stepper value={count} min={1} max={6} onChange={setCount} /></Row> : null}
          <Row between>
            <T v="faint">Written by {shortModel(model)}</T>
            <Button small kind="ghost" icon="hardware-chip-outline" title="Change" onPress={() => setPickerOpen(true)} />
          </Row>
          <Button title={busy ? `Writing… ${progress > 0 ? `${Math.round(progress / 4)} tokens` : ''}` : 'Generate'} icon="sparkles-outline" onPress={generate} loading={busy} disabled={!apiKey} />
          <T v="faint">{kind === 'world' ? 'A world comes with a description and, where it calls for them, a few species and lore entries. Everything is editable after saving.' : 'What is already in the world is shown to the model so new entries fit it and avoid repeats. Untick anything you do not want before saving.'}</T>
        </>
      ) : (
        <>
          {result.kind === 'world' ? (
            <Card style={{ gap: 6 }}>
              <T v="h">{result.world.name}</T>
              <T v="dim">{result.world.description}</T>
              {result.world.lore.length ? <T v="faint">{result.world.lore.length} lore entr{result.world.lore.length === 1 ? 'y' : 'ies'}: {result.world.lore.map((l) => l.title).join('; ')}</T> : null}
            </Card>
          ) : null}
          {items.map((it, i) => (
            <Card key={i} onPress={() => toggle(i)} style={{ gap: 4, opacity: skip.has(i) ? 0.4 : 1 }}>
              <Row between>
                <T v="h" style={{ flex: 1 }}>{skip.has(i) ? '○ ' : '● '}{it.title}</T>
                {it.badge ? <Badge label={it.badge} tone={it.badge === 'not adult' ? 'warn' : 'dim'} /> : null}
              </Row>
              <T v="dim" numberOfLines={6}>{it.subtitle}</T>
            </Card>
          ))}
          <Row>
            <Button title="Save to library" icon="checkmark" onPress={save} style={{ flex: 1 }} />
            <Button kind="outline" icon="refresh-outline" title="Again" onPress={generate} loading={busy} />
          </Row>
          <Button kind="ghost" title="Back to the wish" onPress={() => setResult(null)} />
        </>
      )}
      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setModel} current={model} title="Forge with" />
    </>
  );
}
