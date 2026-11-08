import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { newId, now } from '@/core/ids';
import { proposalCount } from '@/core/jobs';
import { bbox } from '@/core/map/geom';
import { fitLabel, isAreaKind, scaleOf } from '@/core/map/build';
import { bearing, distanceWords, metresBetween, onFoot } from '@/core/map/geo';
import { AREA_LABEL, KIND_INFO, LINE_LABEL, THEMES, compass, mapKindOf } from '@/core/map/style';
import { addArea, addLabel, addLine, addPin, deleteVertex, duplicate, hitTest, insertVertex, linkPin, moveBy, moveTo, moveVertex, patchLabel, pushHistory, redo, remove, rename, reorder, setAreaKind, setLineKind, snapTo, undo, type Hit, type History } from '@/core/map/edit';
import type { AreaKind, LineKind, MapDoc, MapKind, MapPin, Pt, ThemeKey } from '@/core/map/types';
import type { WorldEntity } from '@/core/world/types';
import { getEntity, newEntity, saveEntity } from '@/db/repo/world';
import { deleteMap, drawMap, getMap, saveMap, sketchMap } from '@/state/atlas';
import { useJobs } from '@/state/jobs';
import { useSettings } from '@/state/settings';
import { Badge, Banner, Button, Chip, Field, IconButton, Ionicons, Row, Segmented, Sheet, SwitchRow, T } from '../components';
import { EditActions, useLeaveGuard } from '../components/Entry';
import { JobStatusLine } from '../components/JobStatus';
import { ProposalSheet } from '../components/Proposals';
import { radius, space, useTheme } from '../theme';
import { useWorld } from '../useWorld';
import { MapPicture } from './MapCanvas';
import { MapView, type MapViewHandle } from './MapView';

type Tool = 'select' | 'pin' | 'area' | 'line' | 'label' | 'erase';
const TOOLS: { key: Tool; icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { key: 'select', icon: 'hand-left-outline', label: 'Select' },
  { key: 'pin', icon: 'location-outline', label: 'Place' },
  { key: 'area', icon: 'shapes-outline', label: 'Area' },
  { key: 'line', icon: 'git-commit-outline', label: 'Line' },
  { key: 'label', icon: 'text-outline', label: 'Label' },
  { key: 'erase', icon: 'trash-outline', label: 'Erase' },
];
const KINDS: MapKind[] = ['globe', 'region', 'city', 'site', 'floor'];

/** A floating round button over the map. */
function Fab({ icon, onPress, active, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; active?: boolean; label?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: label ? 12 : 0, minWidth: 40, height: 40, borderRadius: 20, alignSelf: 'flex-start', justifyContent: 'center', backgroundColor: active ? t.accent : t.surface, borderWidth: 1, borderColor: active ? t.accent : t.border, opacity: pressed ? 0.75 : 0.96, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 })}>
      <Ionicons name={icon} size={19} color={active ? t.accentText : t.text} />
      {label ? <T v="small" style={{ color: active ? t.accentText : t.text, fontWeight: '600' }}>{label}</T> : null}
    </Pressable>
  );
}

/**
 * A place's map: look around it, tap a place to read it or go into its own
 * map, measure the way between two points. In edit mode it is a full
 * editor: move and reshape anything, place pins for the places of the
 * world, draw areas and lines, write labels, undo and redo, change the
 * map's kind, style and scale, and redraw it by model or by hand.
 */
export function MapScreen({ locationId, focus }: { locationId: string; focus?: string }) {
  const db = useSQLiteContext();
  const t = useTheme();
  const apiKey = useSettings((s) => s.apiKey);
  const [place, setPlace] = useState<WorldEntity | null>(null);
  const [saved, setSaved] = useState<MapDoc | null>(null);
  const [doc, setDoc] = useState<MapDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hist, setHist] = useState<History>({ past: [], future: [] });
  const [sel, setSel] = useState<Hit | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [drawKind, setDrawKind] = useState<string>('forest');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt | null } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [live, setLive] = useState<MapDoc | null>(null);
  const [settings, setSettings] = useState(false);
  const [pinAt, setPinAt] = useState<Pt | null>(null);
  const [labelAt, setLabelAt] = useState<Pt | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState(false);
  const [pickKind, setPickKind] = useState<MapKind | null>(null);
  // Sheets start fresh each time they open.
  const [sheetKey, setSheetKey] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const view = useRef<MapViewHandle>(null);
  const drag = useRef<{ base: MapDoc; mode: 'vertex' | 'move' | 'point'; index?: number; from?: Pt } | null>(null);
  const w = useWorld(place?.universeId);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([getEntity(db, locationId), getMap(db, locationId)]);
    setPlace(p); setSaved(m); setDoc(m); setLoaded(true);
    return m;
  }, [db, locationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Jobs for this place: a first map lands on its own; a redraw waits to be looked at.
  const allJobs = useJobs((s) => s.jobs);
  const jobs = useMemo(() => allJobs.filter((j) => j.kind === 'map' && (j.input as { locationId: string }).locationId === locationId), [allJobs, locationId]);
  const running = jobs.find((j) => j.status === 'queued' || j.status === 'running');
  const failed = jobs.find((j) => j.status === 'failed' && !saved);
  const waiting = jobs.find((j) => proposalCount(j) > 0);
  const live$ = useJobs((s) => (running ? s.live[running.id] : undefined));
  // A drawing that finishes while the map is open shows up at once (unless you are mid-edit).
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => useJobs.subscribe((s, prev) => {
    const done = (js: typeof s.jobs) => js.filter((j) => j.kind === 'map' && j.status === 'done' && (j.input as { locationId: string }).locationId === locationId).map((j) => j.id).join();
    if (done(s.jobs) !== done(prev.jobs) && !editingRef.current) void load();
  }), [locationId, load]);

  const typeOf = useCallback((id: string) => { const e = w.lib?.entities.find((x) => x.id === id); return typeof e?.data.type === 'string' ? e.data.type : undefined; }, [w.lib]);
  const all = w.lib?.entities.filter((e) => e.kind === 'location') ?? [];
  const parent = place?.parentId ? all.find((e) => e.id === place.parentId) : undefined;
  const children = all.filter((e) => e.parentId === locationId);
  const dirty = editing && !!doc && doc !== saved;

  // Open on a place when asked (from the map above, or an entry).
  const focused = useRef(false);
  useEffect(() => {
    if (!focus || !doc || focused.current) return;
    const p = doc.pins.find((x) => x.entityId === focus || x.id === focus);
    if (p) { focused.current = true; setTimeout(() => { view.current?.focus([p.x, p.y], 2.5); setSel({ type: 'pin', id: p.id }); }, 350); }
  }, [focus, doc]);

  const commit = useCallback((next: MapDoc) => { if (!doc) return; setHist((h) => pushHistory(h, doc)); setDoc({ ...next, updatedAt: now() }); }, [doc]);

  async function save() {
    if (!doc) return;
    await saveMap(db, { ...doc, updatedAt: now() });
    setSaved(doc);
  }
  useLeaveGuard(dirty, save);

  function begin() { setEditing(true); setTool('select'); setMeasuring(false); setMeasure(null); setHist({ past: [], future: [] }); }
  function end() { setEditing(false); setSel(null); setDraft([]); setTool('select'); }
  function discard() { setDoc(saved); end(); }

  // ---- Gestures -------------------------------------------------------------
  const snap = (p: Pt): Pt => (doc?.kind === 'floor' ? snapTo(p, 10) : p);

  function onDragStart(p: Pt, tol: number): boolean {
    if (!doc || !editing || (tool !== 'select' && tool !== 'pin' && tool !== 'label')) return false;
    const h = hitTest(doc, p, tol, sel, { areas: true, scale: 22 / tol });
    if (!h) return false;
    if (h.vertex !== undefined) { drag.current = { base: doc, mode: 'vertex', index: h.vertex }; setSel(h); return true; }
    if (h.mid !== undefined) { const r = insertVertex(doc, h, h.mid); drag.current = { base: r.doc, mode: 'vertex', index: r.index }; setSel({ type: h.type, id: h.id, vertex: r.index }); setLive(r.doc); return true; }
    if (h.type === 'pin' || h.type === 'label') {
      const at = h.type === 'pin' ? doc.pins.find((x) => x.id === h.id)! : doc.labels.find((x) => x.id === h.id)!;
      drag.current = { base: doc, mode: 'point', from: [at.x - p[0], at.y - p[1]] }; setSel(h); return true;
    }
    if (sel && sel.id === h.id) { drag.current = { base: doc, mode: 'move' }; return true; }
    return false;
  }
  function onDrag(p: Pt, start: Pt) {
    const d = drag.current;
    if (!d || !sel) return;
    if (d.mode === 'vertex' && d.index !== undefined) setLive(moveVertex(d.base, sel, d.index, snap(p)));
    else if (d.mode === 'point' && d.from) setLive(moveTo(d.base, sel, [p[0] + d.from[0], p[1] + d.from[1]]));
    else if (d.mode === 'move') { const [dx, dy] = doc?.kind === 'floor' ? snap([p[0] - start[0], p[1] - start[1]]) : [p[0] - start[0], p[1] - start[1]]; setLive(moveBy(d.base, sel, dx, dy)); }
  }
  function onDragEnd() {
    const d = drag.current;
    drag.current = null;
    if (live && d && doc) { const before = doc; setHist((h) => pushHistory(h, before)); setDoc({ ...live, updatedAt: now() }); }
    setLive(null);
  }

  function onTap(p: Pt, tol: number) {
    if (!doc) return;
    if (measuring) { setMeasure((m) => (!m || m.b ? { a: p, b: null } : { ...m, b: p })); return; }
    if (!editing) {
      const h = hitTest(doc, p, tol, null, { scale: 22 / tol });
      // Looking, only what has a name is worth a card: a pin, a named area or line, a label.
      const named = h && (h.type === 'pin' || h.type === 'label' || (h.type === 'area' && doc.areas.find((a) => a.id === h.id)?.name) || (h.type === 'line' && doc.lines.find((l) => l.id === h.id)?.name));
      setSel(h && named ? { type: h.type, id: h.id } : null);
      return;
    }
    switch (tool) {
      case 'select': {
        const h = hitTest(doc, p, tol, sel, { scale: 22 / tol });
        if (h && sel && h.id === sel.id && h.mid !== undefined) { const r = insertVertex(doc, h, h.mid); commit(r.doc); setSel({ ...sel, vertex: r.index, mid: undefined }); return; }
        setSel(h ? { type: h.type, id: h.id, vertex: h.vertex } : null);
        return;
      }
      case 'erase': {
        const h = hitTest(doc, p, tol, null, { scale: 22 / tol });
        if (h) { commit(remove(doc, h)); setSel(null); }
        return;
      }
      case 'pin': setSheetKey((k) => k + 1); setPinAt(p); return;
      case 'label': setSheetKey((k) => k + 1); setLabelAt(p); return;
      case 'area':
      case 'line': {
        const q = snap(p);
        if (tool === 'area' && draft.length >= 3 && Math.hypot(q[0] - draft[0]![0], q[1] - draft[0]![1]) < tol * 1.2) { finishDraft(); return; }
        setDraft((d) => [...d, q]);
      }
    }
  }

  function finishDraft() {
    if (!doc) return;
    if (tool === 'area' && draft.length >= 3 && isAreaKind(drawKind)) {
      const id = newId();
      commit(addArea(doc, { id, kind: drawKind, points: draft }));
      setSel({ type: 'area', id });
    } else if (tool === 'line' && draft.length >= 2 && !isAreaKind(drawKind)) {
      const id = newId();
      commit(addLine(doc, { id, kind: drawKind as LineKind, points: draft }));
      setSel({ type: 'line', id });
    }
    setDraft([]);
    setTool('select');
  }

  function pickTool(k: Tool) {
    setDraft([]);
    setTool(k);
    if (doc && k === 'area') setDrawKind(KIND_INFO[doc.kind].areas[1] ?? KIND_INFO[doc.kind].areas[0]!);
    if (doc && k === 'line') setDrawKind(KIND_INFO[doc.kind].lines[0]!);
  }

  function doUndo() { if (!doc) return; const r = undo(hist, doc); if (r) { setHist(r.h); setDoc(r.doc); setSel(null); } }
  function doRedo() { if (!doc) return; const r = redo(hist, doc); if (r) { setHist(r.h); setDoc(r.doc); setSel(null); } }

  // ---- Drawing --------------------------------------------------------------
  async function ask(o: { kind?: MapKind; theme?: ThemeKey; wish?: string; keepPins?: MapPin[] } = {}) {
    setErr(null);
    if (!apiKey) { setErr('Add an OpenRouter key in Settings to draw with a model, or use a quick sketch.'); return; }
    await drawMap(db, locationId, o);
  }
  async function sketch(o: { kind?: MapKind; theme?: ThemeKey; keepPins?: MapPin[] } = {}) {
    setBusy(true);
    try {
      const m = await sketchMap(db, locationId, o);
      if (!m) return;
      // Editing, it is one more change (Undo brings the old map back); looking, it replaces the map.
      if (!saved || !editing) { await saveMap(db, m); setSaved(m); setDoc(m); return; }
      commit(m);
    } finally { setBusy(false); }
  }
  function removeMap() {
    Alert.alert('Delete this map?', 'Its pins, areas, lines and labels go with it. The places themselves stay. You can draw a new one straight after.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteMap(db, locationId); setSettings(false); setActions(false); setEditing(false); setSel(null); setSaved(null); setDoc(null); setHist({ past: [], future: [] }); } },
    ]);
  }
  const redrawn = async (wish: string, keep: boolean, free: boolean) => {
    setSettings(false); setActions(false);
    if (!doc) return;
    await ask({ kind: free ? undefined : doc.kind, theme: doc.theme, wish, keepPins: keep ? doc.pins : undefined });
    Alert.alert('Redrawing', 'The model is drawing a new map. It will wait beside this one for you to compare; nothing changes until you choose it.');
  };

  if (!loaded) return null;
  const title = doc?.title || place?.name || 'Map';
  const kindNow: MapKind = doc?.kind ?? mapKindOf(typeof place?.data.type === 'string' ? place.data.type : '');

  // ---- No map yet -----------------------------------------------------------
  if (!doc) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Stack.Screen options={{ title }} />
        <T v="title">{place?.name ?? 'This place'}</T>
        <T v="dim">No map yet. It will be drawn as {KIND_INFO[kindNow].label.toLowerCase()} ({KIND_INFO[kindNow].span}), in the world’s own style, with {children.length ? `a pin for each of the ${children.length} places inside it` : 'places invented to fit it'}. Everything on it can be changed by hand afterwards.</T>
        {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
        {failed ? <Banner text={failed.error ?? 'The drawing failed.'} /> : null}
        {running ? (
          <View style={{ gap: 6 }}>
            <JobStatusLine job={running} live={live$} />
            <T v="faint">The model is sketching the plan; the map is drawn from it. This keeps going if you leave.</T>
          </View>
        ) : (
          <>
            <T v="label">Kind of map</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Chip label="Let the model judge" selected={!pickKind} onPress={() => setPickKind(null)} />
              {KINDS.map((k) => <Chip key={k} label={KIND_INFO[k].label} selected={pickKind === k} onPress={() => setPickKind(k)} />)}
            </View>
            <T v="faint">{pickKind ? `Drawn as ${KIND_INFO[pickKind].label.toLowerCase()}.` : 'The model reads the entry and picks the kind and the size; a quick sketch goes by its type.'}</T>
            <Button title="Draw with the model" icon="sparkles-outline" onPress={() => void ask({ kind: pickKind ?? undefined })} />
            <Button kind="outline" title="Quick sketch, no model" icon="color-wand-outline" loading={busy} onPress={() => void sketch({ kind: pickKind ?? kindNow })} />
          </>
        )}
      </ScrollView>
    );
  }

  const shown = live ?? doc;
  const info = KIND_INFO[doc.kind];
  const theme = THEMES[doc.theme];
  const selPin = sel?.type === 'pin' ? shown.pins.find((p) => p.id === sel.id) : undefined;
  const selArea = sel?.type === 'area' ? shown.areas.find((a) => a.id === sel.id) : undefined;
  const selLine = sel?.type === 'line' ? shown.lines.find((l) => l.id === sel.id) : undefined;
  const selLabel = sel?.type === 'label' ? shown.labels.find((l) => l.id === sel.id) : undefined;
  const pinEntity = selPin?.entityId ? all.find((e) => e.id === selPin.entityId) : undefined;
  const measured = measure?.b ? metresBetween(doc, { x: measure.a[0], y: measure.a[1] }, { x: measure.b[0], y: measure.b[1] }) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen options={{ title, headerRight: () => <EditActions editing={editing} dirty={dirty} onEdit={begin} onSave={async () => { await save(); end(); }} onDiscard={discard} /> }} />
      <MapView
        ref={view}
        base={drag.current?.base ?? doc}
        doc={shown}
        typeOf={typeOf}
        overlay={{ selected: sel, handles: editing && tool === 'select', activeVertex: sel?.vertex ?? null, draft: draft.length ? { points: draft, closed: tool === 'area' } : null, measure: measure ? { ...measure, text: measured !== null ? distanceWords(measured) : '' } : null, focus: !editing && sel?.type === 'pin' ? sel.id : null }}
        onTap={onTap}
        onDragStart={onDragStart}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        barTop={10 + 50 * ((parent ? 1 : 0) + (!editing ? 1 : 0))}
      />

      {/* Top: the way up, and zoom */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ gap: 8 }}>
          {parent ? <Fab icon="arrow-up" label={parent.name} onPress={() => router.push({ pathname: '/world/map/[id]', params: { id: parent.id, focus: locationId } })} /> : null}
          {!editing ? <Fab icon="resize-outline" label="Measure" active={measuring} onPress={() => { setMeasuring((m) => !m); setMeasure(null); setSel(null); }} /> : null}
        </View>
        <View style={{ gap: 8 }}>
          <Fab icon="add" onPress={() => view.current?.zoomBy(1.6)} />
          <Fab icon="remove" onPress={() => view.current?.zoomBy(1 / 1.6)} />
          <Fab icon="scan-outline" onPress={() => view.current?.fit()} />
          {editing ? <Fab icon="options-outline" onPress={() => { setSheetKey((k) => k + 1); setSettings(true); }} /> : <Fab icon="ellipsis-horizontal" onPress={() => { setSheetKey((k) => k + 1); setActions(true); }} />}
        </View>
      </View>

      {/* Bottom panels */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, gap: 8 }}>
        {waiting && !editing ? (
          <Pressable onPress={() => setProposal(waiting.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: t.surface, borderWidth: 1, borderColor: t.accent }}>
            <Ionicons name="map-outline" size={18} color={t.accent} />
            <T style={{ flex: 1 }}>A redrawn map is ready to compare.</T>
            <T v="small" style={{ color: t.accent }}>Look</T>
          </Pressable>
        ) : null}
        {running && saved ? <View style={{ padding: 10, borderRadius: radius.md, backgroundColor: t.surface }}><JobStatusLine job={running} live={live$} /></View> : null}
        {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}

        {measuring && !editing ? (
          <Panel>
            {measure?.b && measured !== null ? (
              <>
                <T v="h">{distanceWords(measured)} {compass({ x: measure.a[0], y: measure.a[1] }, { x: measure.b[0], y: measure.b[1] })}</T>
                <T v="dim">{onFoot(measured) ? `${onFoot(measured)}.` : 'Too far to walk in any sensible time.'} Straight across{doc.kind === 'globe' ? ' the globe' : ''}; roads and rivers make it longer.</T>
              </>
            ) : <T v="dim">{measure ? 'Tap where it ends.' : 'Tap where the way starts.'}</T>}
          </Panel>
        ) : null}

        {!editing && !measuring && selPin ? (
          <Panel onClose={() => setSel(null)}>
            <T v="h">{selPin.name}</T>
            {pinEntity ? <T v="dim" numberOfLines={3}>{[typeof pinEntity.data.type === 'string' ? pinEntity.data.type : '', pinEntity.summary].filter(Boolean).join(' · ')}</T> : <T v="faint">A mark on the map, not an entry.</T>}
            <Nearest doc={doc} pin={selPin} />
            {pinEntity ? (
              <Row>
                <Button small kind="outline" icon="document-text-outline" title="Open entry" onPress={() => router.push(`/library/entity/${pinEntity.id}`)} />
                <Button small icon="map-outline" title="Its map" onPress={() => router.push({ pathname: '/world/map/[id]', params: { id: pinEntity.id } })} />
              </Row>
            ) : null}
          </Panel>
        ) : null}
        {!editing && !measuring && (selArea || selLine || selLabel) ? (
          <Panel onClose={() => setSel(null)}>
            <T v="h">{selArea?.name ?? selLine?.name ?? selLabel?.text ?? (selArea ? AREA_LABEL[selArea.kind] : selLine ? LINE_LABEL[selLine.kind] : '')}</T>
            <T v="faint">{selArea ? AREA_LABEL[selArea.kind] : selLine ? LINE_LABEL[selLine.kind] : 'Label'}{selArea ? ` · about ${areaWords(doc, selArea.points)}` : ''}</T>
          </Panel>
        ) : null}

        {editing ? (
          <>
            {tool === 'area' || tool === 'line' ? (
              <Panel>
                <T v="small">{draft.length ? (tool === 'area' ? `${draft.length} points. Tap the first point or Done to close it.` : `${draft.length} points. Done when the line is drawn.`) : `Tap the map to draw ${tool === 'area' ? 'an area' : 'a line'}, point by point.`}</T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {(tool === 'area' ? info.areas : info.lines).map((k) => <Chip key={k} small label={tool === 'area' ? AREA_LABEL[k as AreaKind] : LINE_LABEL[k as LineKind]} selected={drawKind === k} onPress={() => setDrawKind(k)} />)}
                </ScrollView>
                <Row>
                  <Button small kind="ghost" title="Cancel" onPress={() => { setDraft([]); setTool('select'); }} />
                  {draft.length ? <Button small kind="outline" icon="arrow-undo-outline" title="Last point" onPress={() => setDraft((d) => d.slice(0, -1))} /> : null}
                  <View style={{ flex: 1 }} />
                  <Button small icon="checkmark" title="Done" disabled={draft.length < (tool === 'area' ? 3 : 2)} onPress={finishDraft} />
                </Row>
              </Panel>
            ) : null}
            {tool === 'select' && sel && (selPin || selArea || selLine || selLabel) ? (
              <Panel onClose={() => setSel(null)}>
                <Row>
                  <Badge label={selPin ? 'place' : selArea ? AREA_LABEL[selArea.kind].toLowerCase() : selLine ? LINE_LABEL[selLine.kind].toLowerCase() : 'label'} tone="accent" />
                  <TextInput
                    key={sel.id}
                    defaultValue={selPin?.name ?? selArea?.name ?? selLine?.name ?? selLabel?.text ?? ''}
                    placeholder={selPin ? 'Name' : 'Name (optional)'}
                    placeholderTextColor={t.faint}
                    onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v !== (selPin?.name ?? selArea?.name ?? selLine?.name ?? selLabel?.text ?? '')) commit(rename(doc, sel, v)); }}
                    onSubmitEditing={(e) => { const v = e.nativeEvent.text.trim(); commit(rename(doc, sel, v)); }}
                    style={{ flex: 1, color: t.text, fontSize: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.border }}
                  />
                </Row>
                {selArea ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{info.areas.map((k) => <Chip key={k} small label={AREA_LABEL[k]} selected={selArea.kind === k} onPress={() => commit(setAreaKind(doc, selArea.id, k))} />)}</ScrollView> : null}
                {selLine ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{info.lines.map((k) => <Chip key={k} small label={LINE_LABEL[k]} selected={selLine.kind === k} onPress={() => commit(setLineKind(doc, selLine.id, k))} />)}</ScrollView> : null}
                {selLabel ? (
                  <Row gap={6}>
                    {(['s', 'm', 'l'] as const).map((z) => <Chip key={z} small label={z === 's' ? 'Small' : z === 'm' ? 'Medium' : 'Large'} selected={selLabel.size === z} onPress={() => commit(patchLabel(doc, selLabel.id, { size: z }))} />)}
                    <Chip small label="Water" selected={!!selLabel.water} onPress={() => commit(patchLabel(doc, selLabel.id, { water: !selLabel.water || undefined }))} />
                    <IconButton name="refresh-outline" size={18} onPress={() => commit(patchLabel(doc, selLabel.id, { angle: (((selLabel.angle ?? 0) + 15 + 90) % 180) - 90 }))} />
                  </Row>
                ) : null}
                {selPin ? (
                  <Row gap={6}>
                    <Ionicons name="link-outline" size={16} color={t.dim} />
                    <T v="small" style={{ flex: 1 }} numberOfLines={1}>{pinEntity ? `Stands for ${pinEntity.name}` : 'Not linked to an entry'}</T>
                    <Button small kind="outline" title={pinEntity ? 'Change' : 'Link'} onPress={() => setLinking(selPin.id)} />
                  </Row>
                ) : null}
                <Row gap={4}>
                  {sel.vertex !== undefined && (selArea || selLine) ? <Button small kind="outline" icon="remove-circle-outline" title="Point" onPress={() => { commit(deleteVertex(doc, sel, sel.vertex!)); setSel({ type: sel.type, id: sel.id }); }} /> : null}
                  {selArea || selLine ? <IconButton name="arrow-up-circle-outline" size={20} onPress={() => commit(reorder(doc, sel, 1))} /> : null}
                  {selArea || selLine ? <IconButton name="arrow-down-circle-outline" size={20} onPress={() => commit(reorder(doc, sel, -1))} /> : null}
                  {!selPin ? <IconButton name="copy-outline" size={20} onPress={() => { const r = duplicate(doc, sel, newId()); commit(r.doc); setSel(r.sel); }} /> : null}
                  <View style={{ flex: 1 }} />
                  <Button small kind="danger" icon="trash-outline" title="Delete" onPress={() => { commit(remove(doc, sel)); setSel(null); }} />
                </Row>
                {(selArea || selLine) && sel.vertex === undefined ? <T v="faint">Drag a point to reshape; drag a small dot between points to add one; drag inside to move it all.</T> : null}
              </Panel>
            ) : null}
            {/* Toolbar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: radius.lg, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2 }} style={{ flex: 1 }}>
                {TOOLS.map((x) => (
                  <Pressable key={x.key} onPress={() => pickTool(x.key)} style={{ alignItems: 'center', paddingVertical: 4, paddingHorizontal: 9, borderRadius: radius.md, backgroundColor: tool === x.key ? t.accent : 'transparent' }}>
                    <Ionicons name={x.icon} size={20} color={tool === x.key ? t.accentText : t.text} />
                    <T v="small" style={{ fontSize: 11, color: tool === x.key ? t.accentText : t.dim }}>{x.label}</T>
                  </Pressable>
                ))}
              </ScrollView>
              <IconButton name="arrow-undo" size={20} disabled={!hist.past.length} onPress={doUndo} />
              <IconButton name="arrow-redo" size={20} disabled={!hist.future.length} onPress={doRedo} />
            </View>
          </>
        ) : null}
      </View>

      <PinSheet
        key={`pin${sheetKey}`}
        at={pinAt}
        doc={doc}
        options={children.filter((c) => !doc.pins.some((p) => p.entityId === c.id))}
        others={all.filter((e) => e.id !== locationId && e.parentId !== locationId && !doc.pins.some((p) => p.entityId === e.id))}
        onClose={() => setPinAt(null)}
        onPick={async (o) => {
          if (!pinAt) return;
          let entityId = o.entityId;
          let name = o.name;
          if (o.create && place) { const e = newEntity(place.universeId, 'location', o.name, locationId); e.data = { type: o.type ?? '' }; await saveEntity(db, e); entityId = e.id; name = e.name; await w.reload(); }
          const id = newId();
          commit(addPin(doc, { id, entityId, name, x: pinAt[0], y: pinAt[1] }));
          setSel({ type: 'pin', id });
          setPinAt(null);
          setTool('select');
        }}
        placeName={place?.name ?? ''}
        kind={doc.kind}
      />
      <LabelSheet key={`label${sheetKey}`} at={labelAt} onClose={() => setLabelAt(null)} onAdd={(text, size, water) => { if (!labelAt) return; const id = newId(); commit(addLabel(doc, fitLabel({ id, text, x: labelAt[0], y: labelAt[1], size, water: water || undefined }))); setSel({ type: 'label', id }); setLabelAt(null); setTool('select'); }} />
      <LinkSheet
        open={!!linking}
        places={[...children, ...all.filter((e) => e.id !== locationId && !children.includes(e))]}
        onClose={() => setLinking(null)}
        onPick={(e) => { if (linking) commit(linkPin(doc, linking, e?.id ?? null, e?.name)); setLinking(null); }}
      />
      <SettingsSheet
        key={`settings${sheetKey}`}
        open={settings}
        doc={doc}
        onClose={() => setSettings(false)}
        onChange={(p) => commit({ ...doc, ...p })}
        onRedraw={(wish, keep, free) => void redrawn(wish, keep, free)}
        onSketch={async (keep) => { setSettings(false); await sketch({ kind: doc.kind, theme: doc.theme, keepPins: keep ? doc.pins : undefined }); }}
        onDelete={removeMap}
      />
      <Sheet key={`actions${sheetKey}`} open={actions} onClose={() => setActions(false)} title="This map">
        <RedrawControls doc={doc} onRedraw={(wish, keep, free) => void redrawn(wish, keep, free)} onSketch={(keep) => { setActions(false); void sketch({ kind: doc.kind, theme: doc.theme, keepPins: keep ? doc.pins : undefined }); }} onDelete={removeMap} />
        <T v="faint">To move things, reshape them or change the style and scale, use the pencil.</T>
      </Sheet>
      <ProposalSheet jobId={proposal} onClose={() => setProposal(null)} onAccepted={() => void load()} />
    </View>
  );
}

function Panel({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: radius.lg, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
      {onClose ? <IconButton name="close" size={18} onPress={onClose} style={{ position: 'absolute', top: 2, right: 2, zIndex: 2 }} /> : null}
      {children}
    </View>
  );
}

/** The nearest other places from a pin, in words. */
function Nearest({ doc, pin }: { doc: MapDoc; pin: MapPin }) {
  const near = useMemo(() => doc.pins.filter((p) => p.id !== pin.id).map((p) => ({ p, m: metresBetween(doc, pin, p) })).sort((a, b) => a.m - b.m).slice(0, 3), [doc, pin]);
  if (!near.length) return null;
  return <View style={{ gap: 2 }}>{near.map(({ p }) => <T key={p.id} v="small">{p.name}: {bearing(doc, pin, p)}</T>)}</View>;
}

function areaWords(doc: MapDoc, pts: Pt[]): string {
  const b = bbox(pts);
  const m = metresBetween(doc, { x: b.x, y: b.y + b.h / 2 }, { x: b.x + b.w, y: b.y + b.h / 2 });
  const n = metresBetween(doc, { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w / 2, y: b.y + b.h });
  return `${distanceWords(m)} by ${distanceWords(n)}`;
}

function PinSheet({ at, doc, options, others, onClose, onPick, placeName, kind }: { at: Pt | null; doc: MapDoc; options: WorldEntity[]; others: WorldEntity[]; onClose: () => void; onPick: (o: { entityId: string | null; name: string; create?: boolean; type?: string }) => void; placeName: string; kind: MapKind }) {
  const [name, setName] = useState('');
  const [more, setMore] = useState(false);
  const childType = kind === 'globe' ? 'nation' : kind === 'region' ? 'town' : kind === 'city' ? 'landmark' : kind === 'site' ? 'building' : 'room';
  return (
    <Sheet open={!!at} onClose={onClose} title="Place a pin">
      {options.length ? (
        <>
          <T v="label">Places in {placeName} not on the map yet</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{options.map((e) => <Chip key={e.id} label={e.name} onPress={() => onPick({ entityId: e.id, name: e.name })} />)}</View>
        </>
      ) : <T v="faint">Every place recorded inside {placeName} is already on the map.</T>}
      <Field label="Or a new one" placeholder="Its name" value={name} onChangeText={setName} />
      <Row>
        <Button style={{ flex: 1 }} icon="add" title={`New ${childType} in ${placeName}`} disabled={!name.trim()} onPress={() => onPick({ entityId: null, name: name.trim(), create: true, type: childType })} />
        <Button kind="outline" title="Just a mark" disabled={!name.trim()} onPress={() => onPick({ entityId: null, name: name.trim() })} />
      </Row>
      <T v="faint">A new {childType} becomes an entry in the world, inside {placeName}. A mark is only on this map.</T>
      {others.length ? (
        more ? (
          <>
            <T v="label">Elsewhere in the world</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{others.slice(0, 60).map((e) => <Chip key={e.id} small label={e.name} onPress={() => onPick({ entityId: e.id, name: e.name })} />)}</View>
          </>
        ) : <Button kind="ghost" title="A place from elsewhere in the world" onPress={() => setMore(true)} />
      ) : null}
    </Sheet>
  );
}

function LabelSheet({ at, onClose, onAdd }: { at: Pt | null; onClose: () => void; onAdd: (text: string, size: 's' | 'm' | 'l', water: boolean) => void }) {
  const [text, setText] = useState('');
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m');
  const [water, setWater] = useState(false);
  return (
    <Sheet open={!!at} onClose={onClose} title="Write a label">
      <Field placeholder="The Grey Sea, Old Quarter, Here be wolves…" value={text} onChangeText={setText} autoFocus />
      <Segmented options={[{ key: 's', label: 'Small' }, { key: 'm', label: 'Medium' }, { key: 'l', label: 'Large' }]} value={size} onChange={setSize} />
      <SwitchRow label="Name of water" hint="Set in italic, in the water's colour." value={water} onChange={setWater} />
      <Button title="Add label" icon="checkmark" disabled={!text.trim()} onPress={() => onAdd(text.trim(), size, water)} />
    </Sheet>
  );
}

function LinkSheet({ open, places, onClose, onPick }: { open: boolean; places: WorldEntity[]; onClose: () => void; onPick: (e: WorldEntity | null) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="What place is this pin?">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{places.slice(0, 80).map((e) => <Chip key={e.id} label={e.name} onPress={() => onPick(e)} />)}</View>
      <Button kind="outline" title="Not an entry, just a mark" onPress={() => onPick(null)} />
    </Sheet>
  );
}

function SettingsSheet({ open, doc, onClose, onChange, onRedraw, onSketch, onDelete }: { open: boolean; doc: MapDoc; onClose: () => void; onChange: (p: Partial<MapDoc>) => void; onRedraw: (wish: string, keep: boolean, free: boolean) => void; onSketch: (keep: boolean) => void; onDelete: () => void }) {
  const t = useTheme();
  const across = doc.scale.per * doc.w;
  const [acrossText, setAcrossText] = useState(String(Math.round(across * 100) / 100));
  return (
    <Sheet open={open} onClose={onClose} title="Map settings" full>
      <Field label="Title" value={doc.title} onChangeText={(v) => onChange({ title: v })} />
      <T v="label">Kind of map</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {KINDS.map((k) => <Chip key={k} label={KIND_INFO[k].label} selected={doc.kind === k} onPress={() => onChange({ kind: k, scale: scaleOf(k, null) })} />)}
      </View>
      <T v="faint">Changing the kind changes the scale and what can be drawn. Redraw for a fresh map of the new kind.</T>
      <T v="label">Style</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(Object.keys(THEMES) as ThemeKey[]).map((k) => {
          const th = THEMES[k];
          const on = doc.theme === k;
          return (
            <Pressable key={k} onPress={() => onChange({ theme: k })} style={{ width: 96, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: on ? t.accent : t.border }}>
              <View style={{ height: 38, backgroundColor: th.bg, flexDirection: 'row' }}>
                <View style={{ flex: 2, backgroundColor: th.land }} />
                <View style={{ flex: 1, backgroundColor: th.water }} />
                <View style={{ position: 'absolute', left: 10, top: 14, width: 10, height: 10, borderRadius: 5, backgroundColor: th.pin }} />
                <View style={{ position: 'absolute', left: 0, right: 0, top: 26, height: 3, backgroundColor: th.road }} />
              </View>
              <T v="small" style={{ padding: 5, fontSize: 11 }} numberOfLines={1}>{th.label}</T>
            </Pressable>
          );
        })}
      </View>
      <T v="label">How far it reaches, west to east</T>
      <Row>
        <TextInput value={acrossText} onChangeText={setAcrossText} keyboardType="decimal-pad" onEndEditing={() => { const v = Number(acrossText.replace(',', '.')); if (Number.isFinite(v) && v > 0) onChange({ scale: { ...doc.scale, per: v / doc.w } }); }} style={{ flex: 1, color: t.text, fontSize: 16, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: t.border }} />
        <Segmented options={[{ key: 'm', label: 'm' }, { key: 'km', label: 'km' }]} value={doc.scale.unit} onChange={(u) => onChange({ scale: { unit: u, per: doc.scale.per } })} />
      </Row>
      <T v="faint">Distances the story uses are measured with this. {doc.kind === 'globe' ? 'On a globe it is the length of the equator.' : ''}</T>
      <T v="label">Ground</T>
      <Segmented options={[{ key: 'land', label: 'Land, seas cut in' }, { key: 'water', label: 'Sea, land raised' }]} value={doc.ground} onChange={(g) => onChange({ ground: g })} />

      <View style={{ height: 8 }} />
      <RedrawControls doc={doc} onRedraw={onRedraw} onSketch={onSketch} onDelete={onDelete} editing />
      {doc.pins.length ? <T v="faint">{doc.pins.length} pins · {doc.areas.length} areas · {doc.lines.length} lines · {doc.labels.length} labels</T> : null}
      <View style={{ alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden' }}><MapPicture doc={doc} width={240} decor={false} /></View>
    </Sheet>
  );
}

/** Draw the map again (by model or by hand), or delete it. */
function RedrawControls({ doc, onRedraw, onSketch, onDelete, editing }: { doc: MapDoc; onRedraw: (wish: string, keep: boolean, free: boolean) => void; onSketch: (keep: boolean) => void; onDelete: () => void; editing?: boolean }) {
  const [wish, setWish] = useState('');
  const [keep, setKeep] = useState(true);
  const [free, setFree] = useState(!editing);
  return (
    <View style={{ gap: 10 }}>
      <T v="label">Redraw</T>
      <Field label="What should change" placeholder="Make it far bigger; move the city to the coast; a pass through the mountains…" value={wish} onChangeText={setWish} multiline />
      <SwitchRow label="Let the model judge kind and size" hint={`Off: it stays ${KIND_INFO[doc.kind].label.toLowerCase()}.`} value={free} onChange={setFree} />
      <SwitchRow label="Keep my pins where they are" value={keep} onChange={setKeep} />
      <Button title="Redraw with the model" icon="sparkles-outline" onPress={() => onRedraw(wish.trim(), keep, free)} />
      <Button kind="outline" title="Quick sketch, no model" icon="color-wand-outline" onPress={() => onSketch(keep)} />
      <T v="faint">{editing ? 'A quick sketch replaces the map now (Undo brings it back).' : 'A quick sketch replaces the map now.'} A model redraw waits beside this map for you to compare.</T>
      <Button kind="danger" icon="trash-outline" title="Delete this map" onPress={onDelete} />
    </View>
  );
}
