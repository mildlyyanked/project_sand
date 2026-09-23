import React, { useEffect, useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Preset, Style, Universe } from '@/core/types';
import { HEAT_LABELS } from '@/core/types';
import { useSession } from '@/state/session';
import { listCharacters, listPresets, listStyles, listUniverses } from '@/db/repo/library';
import { copySession, deleteSession, listBeats } from '@/db/repo/sessions';
import { manuscriptText, pathTo, indexBeats } from '@/core/beatTree';
import { Banner, Button, Card, Chip, Field, ListItem, MenuItem, Row, Screen, Section, Sheet, Stepper, SwitchRow, T } from '@/ui/components';
import { shortModel } from '@/ui/format';
import { space } from '@/ui/theme';

export default function SessionSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const s = useSession();
  const session = s.session;
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [ask, setAsk] = useState<'variant' | 'template' | 'duplicate' | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (session?.id !== id) void s.open(db, id!);
    void Promise.all([listUniverses(db), listStyles(db), listPresets(db), listCharacters(db)]).then(([u, st, p, c]) => {
      setUniverses(u);
      setStyles(st);
      setPresets(p);
      setChars(c);
    });
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!session) return null;

  const attached = chars.filter((c) => session.characterIds.includes(c.id));
  const nonAdult = attached.filter((c) => !c.adult);

  async function toggleChar(c: Character) {
    const has = session!.characterIds.includes(c.id);
    if (!has && session!.explicit && !c.adult) return setErr(`${c.name} is not flagged adult. Explicit sessions only take adult characters.`);
    await s.patch({ characterIds: has ? session!.characterIds.filter((x) => x !== c.id) : [...session!.characterIds, c.id] });
  }
  async function setExplicit(v: boolean) {
    if (v && nonAdult.length) return setErr(`Explicit needs every attached character flagged adult. Not flagged: ${nonAdult.map((c) => c.name).join(', ')}.`);
    await s.patch({ explicit: v });
  }
  async function doCopy() {
    const kind = ask!;
    setAsk(null);
    const copy = await copySession(db, session!.id, kind === 'variant' ? { title: `${session!.title} (variant)`, withBeats: true, variantNote: note } : kind === 'template' ? { title: `${session!.title} template`, withBeats: false, isTemplate: true } : { title: `${session!.title} copy`, withBeats: true });
    setNote('');
    if (copy && kind !== 'template') router.replace(`/session/${copy.id}`);
    else s.setNotice(kind === 'template' ? 'Template saved. Find it under + on the home screen.' : null);
  }
  async function exportMd() {
    const beats = await listBeats(db, session!.id);
    const text = manuscriptText(pathTo(indexBeats(beats), session!.currentBeatId));
    await Share.share({ message: `# ${session!.title}\n\n${text}`, title: session!.title });
  }
  async function exportJson() {
    const beats = await listBeats(db, session!.id);
    await Share.share({ message: JSON.stringify({ session: session, beats, exportedAt: Date.now() }, null, 2), title: `${session!.title}.json` });
  }
  function del() {
    Alert.alert('Delete story?', 'This removes every beat and branch. There is no undo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSession(db, session!.id); router.dismissAll(); router.replace('/'); } },
    ]);
  }

  return (
    <Screen scroll>
      {err ? <View style={{ marginBottom: space.lg }}><Banner text={err} onClose={() => setErr(null)} /></View> : null}
      <Section title="Story">
        <Field value={title ?? session.title} onChangeText={setTitle} onBlur={() => { if (title != null && title.trim() && title !== session.title) void s.patch({ title: title.trim() }); setTitle(null); }} placeholder="Title" />
        {session.variantOf ? <Field label="What is different in this variant" value={session.variantNote} onChangeText={(v) => s.patch({ variantNote: v })} multiline /> : null}
        <Field label="Brief" hint="Premise, ideas, people, limits. Sent to the writer with every passage. Edit freely." value={session.brief} onChangeText={(v) => s.patch({ brief: v })} multiline style={{ minHeight: 140 }} placeholder="What this story is, stated outright." />
        <SwitchRow label="Plan before writing" hint="The helper drafts a short plan for each passage first; the writer follows it. One small extra call per passage, and the plan shows in the inspector." value={session.planFirst} onChange={(v) => s.patch({ planFirst: v })} />
      </Section>

      <Section title="Models">
        <Card style={{ padding: 0, paddingHorizontal: space.md }}>
          {(['writer', 'summarizer', 'helper'] as const).map((slot) => (
            <ListItem key={slot} title={slot[0]!.toUpperCase() + slot.slice(1)} subtitle={session.models[slot] || 'not set'} right={<T v="faint">{shortModel(session.models[slot])}</T>} onPress={() => router.push(`/models?target=session:${session.id}:${slot}&current=${encodeURIComponent(session.models[slot])}`)} />
          ))}
        </Card>
        <Row between><T>Temperature</T><Stepper value={session.params.temperature} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => s.patch({ params: { ...session.params, temperature: v } })} /></Row>
        <Row between><T>Max tokens</T><Stepper value={session.params.maxTokens} min={200} max={8000} step={100} onChange={(v) => s.patch({ params: { ...session.params, maxTokens: v } })} /></Row>
        <SwitchRow label="Request reasoning" hint="Shows the model's train of thought in the inspector when the model supports it" value={session.params.reasoning} onChange={(v) => s.patch({ params: { ...session.params, reasoning: v } })} />
        <SwitchRow label="Zero data retention" hint="Only ZDR providers for this session" value={session.zdr} onChange={(v) => s.patch({ zdr: v })} />
      </Section>

      <Section title="Content">
        <SwitchRow label="Explicit" hint="Enables the heat dial and its instruction to the writer" value={session.explicit} onChange={setExplicit} />
        {session.explicit ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {HEAT_LABELS.map((l, i) => <Chip key={l} label={l} selected={session.heat === i} onPress={() => s.patch({ heat: i })} />)}
          </Row>
        ) : null}
      </Section>

      <Section title="Preset">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="None" selected={!session.presetId} onPress={() => s.patch({ presetId: null })} />
          {presets.map((p) => <Chip key={p.id} label={p.name} selected={session.presetId === p.id} onPress={() => s.patch({ presetId: p.id })} />)}
        </Row>
        {session.presetId ? <Button small kind="ghost" title="Edit preset" onPress={() => router.push(`/library/preset/${session.presetId}`)} /> : null}
      </Section>

      <Section title="Style">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="None" selected={!session.styleId} onPress={() => s.patch({ styleId: null })} />
          {styles.map((p) => <Chip key={p.id} label={p.name} selected={session.styleId === p.id} onPress={() => s.patch({ styleId: p.id })} />)}
        </Row>
        {session.styleId ? <Button small kind="ghost" title="Edit style" onPress={() => router.push(`/library/style/${session.styleId}`)} /> : null}
      </Section>

      <Section title="World">
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="None" selected={!session.universeId} onPress={() => s.patch({ universeId: null })} />
          {universes.map((u) => <Chip key={u.id} label={u.name} selected={session.universeId === u.id} onPress={() => s.patch({ universeId: u.id })} />)}
        </Row>
        {session.universeId ? <Button small kind="ghost" title="Open world" onPress={() => router.push(`/library/universe/${session.universeId}`)} /> : null}
      </Section>

      <Section title="Characters">
        {chars.length === 0 ? <T v="faint">No characters yet. Create them in the Library.</T> : null}
        <Row style={{ flexWrap: 'wrap' }}>
          {chars.map((c) => <Chip key={c.id} label={c.adult ? c.name : `${c.name} ·`} selected={session.characterIds.includes(c.id)} onPress={() => toggleChar(c)} />)}
        </Row>
      </Section>

      <Section title="Context budget">
        <Row between><T>Recent beats (tokens)</T><Stepper value={session.strategy.recentBudget} min={1000} max={60000} step={500} onChange={(v) => s.patch({ strategy: { ...session.strategy, recentBudget: v } })} /></Row>
        <Row between><T>Summary (tokens)</T><Stepper value={session.strategy.summaryBudget} min={300} max={6000} step={100} onChange={(v) => s.patch({ strategy: { ...session.strategy, summaryBudget: v } })} /></Row>
        <Row between><T>Lore (tokens)</T><Stepper value={session.strategy.loreBudget} min={0} max={6000} step={100} onChange={(v) => s.patch({ strategy: { ...session.strategy, loreBudget: v } })} /></Row>
        <Row between><T>Lore scan (beats)</T><Stepper value={session.strategy.loreScanBeats} min={1} max={30} onChange={(v) => s.patch({ strategy: { ...session.strategy, loreScanBeats: v } })} /></Row>
      </Section>

      <Section title="Copies">
        <MenuItem icon="copy-outline" label="Duplicate" hint="Full copy with every branch" onPress={() => setAsk('duplicate')} />
        <MenuItem icon="git-branch-outline" label="Create variant" hint="Full copy with a note on what is different" onPress={() => setAsk('variant')} />
        <MenuItem icon="albums-outline" label="Save as template" hint="Settings, cards and models without the text" onPress={() => setAsk('template')} />
        <MenuItem icon="share-outline" label="Export manuscript" hint="Markdown of the current path" onPress={exportMd} />
        <MenuItem icon="code-download-outline" label="Export everything" hint="JSON with all branches" onPress={exportJson} />
        <MenuItem icon="trash-outline" label="Delete story" danger onPress={del} />
      </Section>

      <Sheet open={!!ask} onClose={() => setAsk(null)} title={ask === 'variant' ? 'New variant' : ask === 'template' ? 'Save as template' : 'Duplicate'}>
        {ask === 'variant' ? <Field label="What is different" value={note} onChangeText={setNote} placeholder="e.g. Mara refuses the deal in chapter 2" multiline autoFocus /> : <T v="dim">{ask === 'template' ? 'A template keeps the world, cards, preset, style and models. The text stays here.' : 'Creates a complete copy, branches included, and opens it.'}</T>}
        <Button title={ask === 'variant' ? 'Create variant' : ask === 'template' ? 'Save template' : 'Duplicate'} onPress={doCopy} disabled={ask === 'variant' && !note.trim()} />
      </Sheet>
    </Screen>
  );
}
