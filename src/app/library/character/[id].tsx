import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Character, Universe } from '@/core/types';
import type { Attribute } from '@/core/world/types';
import type { StoredLink } from '@/core/world/links';
import { CHARACTER_FIELDS } from '@/core/world/schema';
import { ATTRIBUTES, ATTRIBUTE_INFO } from '@/core/world/dice';
import { deleteCharacter, getCharacters, listUniverses, saveCharacter } from '@/db/repo/library';
import { linksOf, syncLinks } from '@/db/repo/links';
import { characterDraft } from '@/core/world/drafts';
import { Badge, Button, Chip, Field, IconButton, Row, Screen, Stepper, SwitchRow, T } from '@/ui/components';
import { FieldEditor, RefChips } from '@/ui/components/World';
import { useEntryReforge } from '@/ui/components/Reforge';
import { Avatar, EntryImage } from '@/ui/components/EntryImage';
import { RetconSheet } from '@/ui/components/Retcon';
import { Block, ConnectionsView, EditActions, EditingBar, Lede, SectionsEditor, SectionsView, TiesEditor, useEditable, useLeaveGuard, useStartEditing, workshopRoute } from '@/ui/components/Entry';
import { useWorld } from '@/ui/useWorld';
import { InspirationEditor } from '@/ui/components/Inspiration';

interface Editable { id: string; row: Character; links: StoredLink[] }

const WORKSHOP = [
  { label: 'People in their life', intent: 'people in their life: family, rivals, lovers, creditors, mentors, enemies' },
  { label: 'Belongings', intent: 'things they own or carry' },
  { label: 'Places in their life', intent: 'places in their life: home, haunts, where they come from' },
  { label: 'Groups tied to them', intent: 'groups they serve, betrayed, fled or fight' },
  { label: 'Their past', intent: 'lore from their past' },
];

/** A character: read as a page, edited with save and discard. */
export default function CharacterPage() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const db = useSQLiteContext();
  const ed = useEditable<Editable>(
    async () => { const row = (await getCharacters(db, [id!]))[0]; return row ? { id: row.id, row, links: await linksOf(db, row.id) } : null; },
    async (v) => { await saveCharacter(db, v.row); await syncLinks(db, v.id, v.links); },
    [id],
  );
  const c = ed.value?.row ?? null;
  const w = useWorld(c?.universeId);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [retconOpen, setRetconOpen] = useState(false);
  const rowOf = useCallback(() => (ed.value ? { kind: 'character' as const, row: ed.value.row } : null), [ed.value]);
  const takeSelf = useCallback((row: unknown) => ed.setBuffer((b) => (b ? { ...b, row: row as Character } : b)), [ed]);
  const rf = useEntryReforge({ db, universeId: c?.universeId, row: rowOf, onSelf: takeSelf });
  useEffect(() => { void listUniverses(db).then(setUniverses); }, [db]);
  useLeaveGuard(ed.dirty, ed.commit);
  useStartEditing(edit, !!ed.saved, ed.begin);
  if (!c || !ed.value) return null;

  const set = (p: Partial<Character>) => ed.change({ row: { ...c, ...p } });
  const setData = (p: Record<string, unknown>) => set({ data: { ...c.data, ...p } });
  const species = w.lib?.species ?? [];
  const mySpecies = species.find((s) => s.id === c.speciesId);
  const memberships = c.data.memberships ?? [];
  const attrs = c.data.attributes ?? {};
  const spent = ATTRIBUTES.reduce((n, a) => n + (attrs[a] ?? 2), 0);
  const lib = w.lib ?? { universe: null, entities: [], characters: [c], species: [], lore: [] };
  const world = universes.find((u) => u.id === c.universeId);
  const kicker = ['Character', c.data.occupation].filter(Boolean).join(' · ');
  const picture = <EntryImage kind="character" name={c.name} data={c.data as Record<string, unknown>} world={world} draft={() => characterDraft(c, lib)} onChange={(image) => void ed.persist({ row: { ...c, data: { ...c.data, image } as Character['data'] } })} quiet={!ed.editing} />;
  const workshop = (intent?: string) => c.universeId && router.push(workshopRoute(c.universeId, { kind: 'character', id: c.id }, intent) as never);

  return (
    <Screen scroll>
      <Stack.Screen options={{ headerTitle: () => <Row gap={8}><Avatar data={c.data as Record<string, unknown>} name={c.name} size={26} /><T v="h" numberOfLines={1} style={{ maxWidth: ed.editing ? 140 : 230 }}>{c.name}</T></Row>, headerRight: () => <EditActions editing={ed.editing} dirty={ed.dirty} saving={ed.saving} onEdit={ed.begin} onSave={() => void ed.commit()} onDiscard={ed.discard} /> }} />
      {ed.editing ? (
        <>
          <EditingBar dirty={ed.dirty} />
          {picture}
          <View style={{ gap: 14 }}>
            <Field label="Name" value={c.name} onChangeText={(v) => set({ name: v })} onForge={() => void rf.open('name')} />
            <Field label="Summary" hint="One or two lines the writer always sees." value={c.summary} onChangeText={(v) => set({ summary: v })} multiline onForge={() => void rf.open('summary')} />
          </View>
          <Block title="World">
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label="Any world" selected={!c.universeId} onPress={() => set({ universeId: null, speciesId: null, data: { ...c.data, homeLocationId: null, memberships: [] } })} />
              {universes.map((u) => <Chip key={u.id} label={u.name} selected={c.universeId === u.id} onPress={() => set({ universeId: u.id, speciesId: null, data: { ...c.data, homeLocationId: null, memberships: [] } })} />)}
            </Row>
            {c.universeId ? (
              species.length ? (
                <Row style={{ flexWrap: 'wrap' }}>
                  <Chip label="No people" selected={!c.speciesId} onPress={() => set({ speciesId: null })} />
                  {species.map((s) => <Chip key={s.id} label={s.name} selected={c.speciesId === s.id} onPress={() => set({ speciesId: s.id })} />)}
                </Row>
              ) : <T v="faint">This world has no peoples yet. Add them on the world page.</T>
            ) : <T v="faint">A character in no world can be cast in any story. One in a world stays consistent across every story set there.</T>}
            <Field label="Life stage" hint={mySpecies?.adulthood ? `${mySpecies.name}: ${mySpecies.adulthood}` : 'Free text, in the world\'s own terms.'} value={c.lifeStage} onChangeText={(v) => set({ lifeStage: v })} onForge={() => void rf.open('lifeStage')} />
            <SwitchRow label="Adult" hint="By their people's definition. Explicit sessions only take characters with this on." value={c.adult} onChange={(v) => set({ adult: v })} />
          </Block>
          <View style={{ height: 18 }} />
          <Block title="Inspiration">
            <InspirationEditor c={c} lib={w.lib} onChange={set} />
          </Block>
          <View style={{ height: 18 }} />
          <SectionsEditor defs={CHARACTER_FIELDS.filter((d) => !d.play && d.key !== 'inspiredBy')} data={c.data as Record<string, unknown>} refs={w.refs} onChange={setData} onForge={(d) => void rf.open(d.key === 'homeLocationId' ? 'home' : d.key)} />
          <Block title="Voice">
            <Field label="Voice" hint="How they talk and think." value={c.voice} onChangeText={(v) => set({ voice: v })} multiline onForge={() => void rf.open('voice')} />
          </Block>
          {c.universeId ? (
            <>
              <Block title="Belongs to" right={<Button small kind="outline" icon="add" title="Faction" onPress={() => setData({ memberships: [...memberships, { orgId: '', role: '' }] })} />}>
                {memberships.length ? memberships.map((m, i) => (
                  <View key={i} style={{ gap: 6 }}>
                    <Row between><T v="label">Membership {i + 1}</T><IconButton name="trash-outline" size={18} onPress={() => setData({ memberships: memberships.filter((_, j) => j !== i) })} /></Row>
                    <RefChips value={m.orgId || null} options={w.refs.organization ?? []} onChange={(orgId) => setData({ memberships: memberships.map((x, j) => (j === i ? { ...x, orgId: orgId ?? '' } : x)) })} none="Pick a faction" />
                    <Field value={m.role} onChangeText={(role) => setData({ memberships: memberships.map((x, j) => (j === i ? { ...x, role } : x)) })} placeholder="Role or rank" />
                  </View>
                )) : <T v="faint">Factions they serve, lead or have fled.</T>}
              </Block>
              <Block title="Ties">
                <TiesEditor id={c.id} kind="character" universeId={c.universeId} links={ed.value.links} onChange={(links) => ed.change({ links })} index={w.index} graph={w.graph} />
                <Field label="Other ties" hint="People in their life who are not in the library, or more on the ties above." value={c.relationships} onChangeText={(v) => set({ relationships: v })} multiline onForge={() => void rf.open('relationships')} />
              </Block>
            </>
          ) : (
            <Block title="Ties">
              <Field label="Relationships" value={c.relationships} onChangeText={(v) => set({ relationships: v })} multiline onForge={() => void rf.open('relationships')} />
            </Block>
          )}
          <Block title="Boundaries">
            <Field label="Limits" hint="What this character will not do or have done to them." value={c.limits} onChangeText={(v) => set({ limits: v })} multiline onForge={() => void rf.open('limits')} />
            <Field label="Preferences" hint="What they lean into." value={c.preferences} onChangeText={(v) => set({ preferences: v })} multiline onForge={() => void rf.open('preferences')} />
          </Block>
          <Block title="In play">
            <T v="faint">Used when someone plays this character in POV mode. 2 is ordinary, 5 exceptional; each point above 2 adds +2 to tests. Total now {spent}.</T>
            {ATTRIBUTES.map((a: Attribute) => (
              <Row key={a} between>
                <View style={{ flex: 1 }}><T>{ATTRIBUTE_INFO[a].label}</T><T v="faint">{ATTRIBUTE_INFO[a].hint}</T></View>
                <Stepper value={attrs[a] ?? 2} min={1} max={5} onChange={(v) => setData({ attributes: { ...attrs, [a]: v } })} />
              </Row>
            ))}
            <FieldEditor defs={CHARACTER_FIELDS.filter((d) => d.play)} data={c.data as Record<string, unknown>} onChange={setData} onForge={(d) => void rf.open(d.key)} />
          </Block>
          <Block title="Danger zone">
            <Button kind="danger" title="Delete character" onPress={() => Alert.alert(`Delete ${c.name}?`, 'Their ties go with them.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCharacter(db, c.id); ed.discard(); setTimeout(() => router.back(), 0); } }])} />
          </Block>
        </>
      ) : (
        <>
          <Lede kicker={kicker} title={c.name} lede={c.summary} picture={picture} badges={[
            mySpecies ? <Badge key="s" label={mySpecies.name} tone="info" /> : null,
            c.lifeStage ? <Badge key="l" label={c.lifeStage} /> : null,
            !c.adult ? <Badge key="a" label="not adult" tone="warn" /> : null,
            world ? <T key="w" v="faint">{world.name}</T> : null,
            c.data.inspiredBy?.trim() ? <T key="i" v="faint">Inspired by {c.data.inspiredBy.trim()}</T> : null,
          ]} />
          <SectionsView defs={CHARACTER_FIELDS.filter((d) => d.key !== 'inspiredBy')} data={c.data as Record<string, unknown>} extra={{
            look: c.voice ? [{ label: 'Voice', text: c.voice }] : [],
            life: c.relationships ? [{ label: c.universeId ? 'Other ties' : 'Relationships', text: c.relationships }] : [],
            edge: [...(c.limits ? [{ label: 'Limits', text: c.limits }] : []), ...(c.preferences ? [{ label: 'Leans into', text: c.preferences }] : [])],
            play: Object.keys(attrs).length ? [{ label: 'Attributes', text: ATTRIBUTES.map((a) => `${ATTRIBUTE_INFO[a].label} ${attrs[a] ?? 2}`).join(' · ') }] : [],
          }} />
          {c.universeId ? (
            <>
              <Block title="Connections">
                <ConnectionsView id={c.id} graph={w.graph} byId={w.byId} empty="No home, faction or ties yet." />
              </Block>
              <Block title="Grow them">
                <T v="faint">The world’s agent picks up from here, with {c.name} and everyone tied to them in mind.</T>
                <Row style={{ flexWrap: 'wrap' }}>
                  {WORKSHOP.map((x) => <Button key={x.label} small kind="outline" title={x.label} onPress={() => workshop(x.intent)} />)}
                  <Button small kind="outline" icon="chatbubbles-outline" title="Talk it through" onPress={() => workshop()} />
                </Row>
              </Block>
            </>
          ) : null}
          <Block title="Change what is true">
            <T v="faint">Retcon changes what is true about them and carries it, or a new name, through every entry that mentions them.</T>
            <Button small kind="outline" icon="git-compare-outline" title="Retcon" onPress={() => setRetconOpen(true)} />
          </Block>
        </>
      )}
      {rf.sheet}
      <RetconSheet open={retconOpen} onClose={() => { setRetconOpen(false); void ed.reload(); void w.reload(); }} universeId={c.universeId} row={rowOf} onSelf={(row) => void ed.persist({ row: row as Character })} />
      <View style={{ height: 40 }} />
    </Screen>
  );
}
