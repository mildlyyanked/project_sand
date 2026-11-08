import React, { memo, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { area as polyArea } from '@/core/map/geom';
import { areaFill, areaPath, areaRank, doorSwing, graticule, gridPath, linePath, lineStrokes, marksPath, multiPath, pinShape, rosePath } from '@/core/map/draw';
import { THEMES, scaleBar, type MapTheme } from '@/core/map/style';
import { placeLabels } from '@/core/map/labels';
import { metresPer, roadHalf, townDetail } from '@/core/map/town';
import { useTownFill } from './useTownFill';
import type { MapArea, MapDoc, MapPin, Pt } from '@/core/map/types';
import { mono, serif } from '../theme';

const sans = Platform.select({ ios: 'Helvetica Neue', android: 'sans-serif', default: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' });
export const fontOf = (t: MapTheme) => (t.font === 'serif' ? serif : t.font === 'mono' ? mono : sans);

/** A label with a halo, so it reads over anything. */
function Halo({ x, y, text, size, color, halo, font, italic, weight, spacing, angle, anchor = 'middle' }: { x: number; y: number; text: string; size: number; color: string; halo: string; font: string; italic?: boolean; weight?: '400' | '600' | '700'; spacing?: number; angle?: number; anchor?: 'start' | 'middle' | 'end' }) {
  const common = { x, y, fontSize: size, fontFamily: font, fontStyle: italic ? ('italic' as const) : ('normal' as const), fontWeight: weight ?? '400', textAnchor: anchor, letterSpacing: spacing, transform: angle ? `rotate(${angle} ${x} ${y})` : undefined } as const;
  return (
    <G>
      <SvgText {...common} fill={halo} stroke={halo} strokeWidth={size * 0.28} strokeLinejoin="round" opacity={0.9}>{text}</SvgText>
      <SvgText {...common} fill={color}>{text}</SvgText>
    </G>
  );
}

/** Ground, terrain, buildings, lines and the map's furniture: everything that does not change while you look. */
export const MapBase = memo(function MapBase({ doc, decor = true, zoom = 1, px, view }: { doc: MapDoc; decor?: boolean; /** How far in from the whole map: lines thicken more slowly than the map grows. */ zoom?: number; /** Screen pixels per map unit. */ px?: number; /** The part of the map being drawn. */ view?: { x: number; y: number; w: number; h: number } | null }) {
  const lw = 1 / Math.sqrt(Math.max(1, zoom));
  // A town at its real size: roads as wide as they are (never thinner than a hairline), lanes and buildings grown for what is on screen.
  const town = doc.town ? { m: metresPer(doc.scale), ppu: px ?? 1 } : null;
  const detail = town ? townDetail(town.ppu / town.m, doc.town?.grid) : { lanes: false, buildings: false };
  const fill = useTownFill(doc, view, detail);
  const roadW = (k: 'avenue' | 'street' | 'lane') => (town ? Math.max((roadHalf(k, !!doc.town?.grid) * 2) / town.m, ({ avenue: 2.2, street: 0.9, lane: 0.6 })[k] / town.ppu) : 0);
  const caseW = (k: 'avenue' | 'street' | 'lane') => roadW(k) + (town ? Math.max(2.4 / town.m, 1.1 / town.ppu) : 0);
  const t = THEMES[doc.theme] ?? THEMES.fantasy;
  const font = fontOf(t);
  // Old maps draw streets as pale paper edged in ink; the others in their road colours.
  const roadTop = t.drawn ? t.paper : t.road;
  const roadEdge = t.drawn ? t.ink : t.roadCase;
  const layers = useMemo(() => {
    const ground = doc.areas.filter((a) => a.kind === 'land' || a.kind === 'water').sort((a, b) => polyArea(b.points) - polyArea(a.points));
    const rest = doc.areas.filter((a) => a.kind !== 'land' && a.kind !== 'water' && a.kind !== 'block').sort((a, b) => areaRank(a.kind) - areaRank(b.kind));
    const blocks = doc.areas.filter((a) => a.kind === 'block' && !a.name);
    const namedBlocks = doc.areas.filter((a) => a.kind === 'block' && a.name);
    return { ground, terrain: rest.filter((a) => areaRank(a.kind) < 6), built: rest.filter((a) => areaRank(a.kind) >= 6 && areaRank(a.kind) < 9), rooms: rest.filter((a) => areaRank(a.kind) >= 9), blocks: multiPath(blocks), namedBlocks };
  }, [doc.areas]);
  const lines = useMemo(() => {
    const under = doc.lines.filter((l) => l.kind === 'river' || l.kind === 'canal' || l.kind === 'corridor');
    const ROADS = ['lane', 'street', 'avenue'] as const;
    const over = doc.lines.filter((l) => !under.includes(l) && l.kind !== 'door' && !(ROADS as readonly string[]).includes(l.kind));
    const doors = doc.lines.filter((l) => l.kind === 'door');
    // A town's streets, one path per kind: casings under every street first, then the roadways, so junctions join cleanly.
    const roads = ROADS.map((k) => ({ kind: k, d: doc.lines.filter((l) => l.kind === k).map((l) => linePath(k, l.points)).join('') })).filter((x) => x.d);
    return { under, over, doors, roads };
  }, [doc.lines]);
  const bg = doc.kind === 'floor' ? t.paper : doc.ground === 'water' ? t.water : t.land;
  const grat = doc.kind === 'globe' ? graticule(doc) : null;
  const bar = scaleBar(doc.scale, doc.w * 0.16);
  const rose = rosePath(doc.w - 62, 70, 40);
  const strokeArea = (a: MapArea) => (t.drawn ? { stroke: t.ink, strokeWidth: 0.8, strokeOpacity: 0.45 } : t.glow ? { stroke: t.coast, strokeWidth: 0.8, strokeOpacity: 0.35 } : {});

  return (
    <G>
      <Rect x={-50} y={-50} width={doc.w + 100} height={doc.h + 100} fill={bg} />
      {t.glow || doc.kind === 'floor' ? <Path d={gridPath(doc.w, doc.h, doc.kind === 'floor' ? 20 : 50)} stroke={t.grid} strokeWidth={doc.kind === 'floor' ? 0.5 : 0.8} opacity={doc.kind === 'floor' ? 0.5 : 0.7} /> : null}

      {/* Land and water, largest first: seas, then islands on them, then lakes on those. */}
      {layers.ground.map((a) => {
        const d = areaPath(a);
        if (a.kind === 'land') {
          return (
            <G key={a.id}>
              <Path d={d} fill="none" stroke={t.waterLine} strokeWidth={t.glow ? 6 : 14} strokeOpacity={t.glow ? 0.25 : 0.45} strokeLinejoin="round" />
              <Path d={d} fill={t.land} stroke={t.coast} strokeWidth={t.glow ? 1.4 : 1.6} strokeLinejoin="round" />
            </G>
          );
        }
        return (
          <G key={a.id}>
            <Defs><ClipPath id={`clip-${a.id}`}><Path d={d} /></ClipPath></Defs>
            <Path d={d} fill={t.water} />
            <Path d={d} fill="none" stroke={t.waterLine} strokeWidth={t.glow ? 8 : 16} strokeOpacity={t.glow ? 0.3 : 0.5} clipPath={`url(#clip-${a.id})`} />
            <Path d={d} fill="none" stroke={t.coast} strokeWidth={t.glow ? 1.4 : 1.6} strokeLinejoin="round" />
          </G>
        );
      })}
      {grat ? (
        <G>
          <Path d={grat.d} stroke={t.grid} strokeWidth={0.8} opacity={0.55} fill="none" />
          <Path d={grat.equator} stroke={t.border} strokeWidth={1} opacity={0.5} strokeDasharray="8 5" fill="none" />
        </G>
      ) : null}

      {/* Terrain with its marks. */}
      {layers.terrain.map((a) => (
        <G key={a.id}>
          <Path d={areaPath(a)} fill={areaFill(t, a.kind)} fillOpacity={a.kind === 'ice' ? 0.95 : 0.85} {...strokeArea(a)} />
          {a.marks?.length ? (
            a.kind === 'forest'
              ? <Path d={marksPath(a.kind, a.marks, t.drawn)} fill={t.drawn ? t.forest : t.ink} fillOpacity={t.drawn ? 1 : 0.18} stroke={t.ink} strokeWidth={t.drawn ? 0.9 : 0} strokeOpacity={0.6} />
              : <Path d={marksPath(a.kind, a.marks, t.drawn)} fill={a.kind === 'mountains' ? areaFill(t, a.kind) : 'none'} stroke={t.ink} strokeWidth={a.kind === 'mountains' ? 1.3 : 1} strokeOpacity={t.glow ? 0.7 : 0.6} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
        </G>
      ))}

      {/* Rivers and corridors run under what is built. */}
      {lines.under.map((l) => lineStrokes(t, l.kind, doc.kind).map((s, i) => <Path key={`${l.id}-${i}`} d={linePath(l.kind, l.points)} fill="none" stroke={s.color} strokeWidth={s.width * lw} strokeDasharray={s.dash?.split(' ').map((v) => Number(v) * lw).join(' ')} strokeOpacity={s.opacity ?? 1} strokeLinecap={s.cap ?? 'round'} strokeLinejoin="round" />))}

      {layers.built.map((a) => <Path key={a.id} d={areaPath(a)} fill={areaFill(t, a.kind)} fillOpacity={a.kind === 'district' ? 0.55 : 0.95} stroke={a.kind === 'district' ? t.blockLine : t.ink} strokeOpacity={a.kind === 'district' ? 0.35 : 0.25} strokeWidth={a.kind === 'district' ? 1.2 : 0.8} strokeDasharray={a.kind === 'district' ? '6 4' : undefined} />)}
      {layers.blocks ? <Path d={layers.blocks} fill={t.block} stroke={t.blockLine} strokeWidth={0.6} strokeOpacity={t.glow ? 0.8 : 0.7} /> : null}
      {/* Too far out to see buildings: the town reads as built-up ground. */}
      {town && !detail.buildings ? <Path d={multiPath(layers.built.filter((a) => a.kind === 'district'))} fill={t.block} fillOpacity={t.glow ? 0.55 : 0.5} /> : null}
      {fill?.buildings.length ? <Path d={multiPath(fill.buildings.map((q) => ({ points: q })))} fill={t.block} stroke={t.blockLine} strokeWidth={0.7 / (town?.ppu ?? 1)} strokeOpacity={t.glow ? 0.9 : 0.6} /> : null}
      {layers.namedBlocks.map((a) => <Path key={a.id} d={areaPath(a)} fill={t.block} stroke={t.blockLine} strokeWidth={1.4} />)}

      {/* Roads, walls, borders. */}
      {town ? (() => {
        const ls = fill?.lanes.length ? [{ kind: 'lane' as const, d: fill.lanes.map((p) => linePath('lane', p)).join('') }] : [];
        const all = [...ls, ...lines.roads.filter((x) => x.kind !== 'lane')] as { kind: 'avenue' | 'street' | 'lane'; d: string }[];
        return (
          <G>
            {t.glow ? all.filter((x) => x.kind === 'avenue').map((x) => <Path key={`${x.kind}-g`} d={x.d} fill="none" stroke={t.road} strokeWidth={caseW(x.kind) * 3} strokeOpacity={0.14} strokeLinecap="round" strokeLinejoin="round" />) : null}
            {all.map((x) => <Path key={`${x.kind}-c`} d={x.d} fill="none" stroke={roadEdge} strokeWidth={caseW(x.kind)} strokeOpacity={t.drawn ? (detail.buildings ? 0.55 : 0.35) : detail.buildings ? 1 : 0.6} strokeLinecap="round" strokeLinejoin="round" />)}
            {all.map((x) => <Path key={`${x.kind}-t`} d={x.d} fill="none" stroke={roadTop} strokeWidth={roadW(x.kind)} strokeOpacity={x.kind === 'street' && !detail.buildings ? (t.glow ? 0.38 : 0.6) : 1} strokeLinecap="round" strokeLinejoin="round" />)}
          </G>
        );
      })() : (
        <G>
          {lines.roads.map((x) => lineStrokes(t, x.kind, doc.kind).slice(0, -1).map((st, i) => <Path key={`${x.kind}-u${i}`} d={x.d} fill="none" stroke={st.color} strokeWidth={st.width * lw} strokeOpacity={st.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" />))}
          {lines.roads.map((x) => { const st = lineStrokes(t, x.kind, doc.kind).slice(-1)[0]!; return <Path key={`${x.kind}-top`} d={x.d} fill="none" stroke={st.color} strokeWidth={st.width * lw} strokeOpacity={st.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" />; })}
        </G>
      )}
      {lines.over.map((l) => lineStrokes(t, l.kind, doc.kind).map((s, i) => <Path key={`${l.id}-${i}`} d={linePath(l.kind, l.points)} fill="none" stroke={s.color} strokeWidth={s.width * lw} strokeDasharray={s.dash?.split(' ').map((v) => Number(v) * lw).join(' ')} strokeOpacity={s.opacity ?? 1} strokeLinecap={s.cap ?? 'round'} strokeLinejoin="round" />))}

      {/* Rooms: walls are their outlines; doors cut them. */}
      {layers.rooms.length ? (
        <G>
          {layers.rooms.map((a) => <Path key={`${a.id}-w`} d={areaPath(a)} fill="none" stroke={t.wall} strokeWidth={8} strokeLinejoin="miter" />)}
          {layers.rooms.map((a) => <Path key={a.id} d={areaPath(a)} fill={areaFill(t, a.kind)} stroke={t.wall} strokeWidth={2} />)}
          {t.glow ? layers.rooms.map((a) => <Path key={`${a.id}-g`} d={areaPath(a)} fill="none" stroke={t.wall} strokeWidth={10} strokeOpacity={0.15} />) : null}
        </G>
      ) : null}
      {lines.doors.map((l) => (
        <G key={l.id}>
          <Path d={linePath('door', l.points)} stroke={doc.kind === 'floor' ? t.room : t.paper} strokeWidth={11} strokeLinecap="butt" />
          <Path d={doorSwing(l.points)} stroke={t.ink} strokeWidth={1} fill="none" strokeOpacity={0.6} />
        </G>
      ))}

      {/* Frame: the edge of the map, at every zoom. */}
      {t.drawn ? (
        <G>
          <Rect x={6} y={6} width={doc.w - 12} height={doc.h - 12} fill="none" stroke={t.ink} strokeWidth={3} />
          <Rect x={13} y={13} width={doc.w - 26} height={doc.h - 26} fill="none" stroke={t.ink} strokeWidth={0.8} />
        </G>
      ) : (
        <Rect x={4} y={4} width={doc.w - 8} height={doc.h - 8} fill="none" stroke={t.glow ? t.coast : t.ink} strokeOpacity={t.glow ? 0.6 : 0.35} strokeWidth={1.5} />
      )}
      {decor ? (
        <G>
          {/* Compass */}
          {t.drawn ? (
            <G opacity={0.85}>
              <Circle cx={doc.w - 62} cy={70} r={30} fill="none" stroke={t.ink} strokeWidth={0.8} />
              <Path d={rose.dark} fill={t.ink} />
              <Path d={rose.light} fill={t.paper} stroke={t.ink} strokeWidth={0.6} />
              <Halo x={doc.w - 62} y={22} text="N" size={14} color={t.ink} halo={t.halo} font={font} weight="700" />
            </G>
          ) : (
            <G>
              <Path d={`M${doc.w - 40} 30L${doc.w - 48} 52L${doc.w - 40} 47L${doc.w - 32} 52Z`} fill={t.glow ? t.coast : t.ink} />
              <Halo x={doc.w - 40} y={68} text="N" size={12} color={t.glow ? t.coast : t.ink} halo={t.halo} font={font} weight="700" />
            </G>
          )}
          {/* Scale */}
          <G>
            <Rect x={doc.w - 40 - bar.units - 8} y={doc.h - 50} width={bar.units + 16} height={30} fill={t.halo} opacity={0.6} rx={3} />
            <Line x1={doc.w - 40 - bar.units} y1={doc.h - 30} x2={doc.w - 40} y2={doc.h - 30} stroke={t.glow ? t.coast : t.ink} strokeWidth={2} />
            <Line x1={doc.w - 40 - bar.units} y1={doc.h - 35} x2={doc.w - 40 - bar.units} y2={doc.h - 25} stroke={t.glow ? t.coast : t.ink} strokeWidth={2} />
            <Line x1={doc.w - 40} y1={doc.h - 35} x2={doc.w - 40} y2={doc.h - 25} stroke={t.glow ? t.coast : t.ink} strokeWidth={2} />
            <Line x1={doc.w - 40 - bar.units / 2} y1={doc.h - 33} x2={doc.w - 40 - bar.units / 2} y2={doc.h - 27} stroke={t.glow ? t.coast : t.ink} strokeWidth={1.2} />
            <SvgText x={doc.w - 40 - bar.units / 2} y={doc.h - 38} fontSize={12} fontFamily={font} fill={t.glow ? t.coast : t.ink} textAnchor="middle">{bar.label}</SvgText>
          </G>
          {/* Title */}
          {doc.title ? <Cartouche doc={doc} t={t} font={font} /> : null}
        </G>
      ) : null}
    </G>
  );
}, (a, b) => a.decor === b.decor && a.zoom === b.zoom && a.px === b.px && a.view === b.view && a.doc.town === b.doc.town && a.doc.areas === b.doc.areas && a.doc.lines === b.doc.lines && a.doc.theme === b.doc.theme && a.doc.title === b.doc.title && a.doc.kind === b.doc.kind && a.doc.scale === b.doc.scale && a.doc.ground === b.doc.ground);

function Cartouche({ doc, t, font }: { doc: MapDoc; t: MapTheme; font: string }) {
  const size = doc.title.length > 24 ? 18 : 22;
  const w = Math.min(doc.w * 0.6, doc.title.length * size * 0.62 + 44);
  const x = 26; const y = doc.h - 70;
  if (t.drawn) {
    return (
      <G>
        <Rect x={x} y={y} width={w} height={44} fill={t.paper} stroke={t.ink} strokeWidth={1.6} rx={2} />
        <Rect x={x + 4} y={y + 4} width={w - 8} height={36} fill="none" stroke={t.ink} strokeWidth={0.6} />
        <SvgText x={x + w / 2} y={y + 29} fontSize={size} fontFamily={font} fill={t.ink} textAnchor="middle" letterSpacing={1.5} fontWeight="600">{doc.title}</SvgText>
      </G>
    );
  }
  return (
    <G>
      <Rect x={x} y={y} width={w} height={40} fill={t.paper} fillOpacity={t.glow ? 0.85 : 0.9} stroke={t.glow ? t.coast : t.ink} strokeOpacity={t.glow ? 0.9 : 0.25} strokeWidth={1.2} rx={t.glow ? 0 : 6} />
      {t.glow ? <Rect x={x} y={y} width={4} height={40} fill={t.pin} /> : null}
      <SvgText x={x + w / 2} y={y + 26} fontSize={size - 2} fontFamily={font} fill={t.labelInk} textAnchor="middle" letterSpacing={t.font === 'mono' ? 1 : 0.3} fontWeight="600">{t.font === 'mono' ? doc.title.toUpperCase() : doc.title}</SvgText>
    </G>
  );
}

/** One pin, shaped by what kind of place it is. */
function PinMark({ p, t, shape, k, selected, dim }: { p: MapPin; t: MapTheme; shape: ReturnType<typeof pinShape>; k: number; selected?: boolean; dim?: boolean }) {
  const r = 6.5 * k;
  const ring = selected ? r + 6 * k : 0;
  return (
    <G opacity={dim ? 0.45 : 1}>
      {selected ? <Circle cx={p.x} cy={p.y} r={ring} fill={t.pin} fillOpacity={0.2} stroke={t.pin} strokeWidth={1.5 * k} /> : null}
      {t.glow ? <Circle cx={p.x} cy={p.y} r={r * 2.2} fill={t.pin} opacity={0.18} /> : null}
      {shape === 'city' ? (
        <G>
          <Circle cx={p.x} cy={p.y} r={r * 1.15} fill={t.pinRing} stroke={t.pin} strokeWidth={2.4 * k} />
          <Circle cx={p.x} cy={p.y} r={r * 0.5} fill={t.pin} />
        </G>
      ) : shape === 'town' ? (
        <Circle cx={p.x} cy={p.y} r={r * 0.9} fill={t.pin} stroke={t.pinRing} strokeWidth={2 * k} />
      ) : shape === 'site' ? (
        <Rect x={p.x - r * 0.8} y={p.y - r * 0.8} width={r * 1.6} height={r * 1.6} fill={t.pin} stroke={t.pinRing} strokeWidth={2 * k} transform={`rotate(45 ${p.x} ${p.y})`} />
      ) : shape === 'room' ? (
        <Circle cx={p.x} cy={p.y} r={r * 0.6} fill={t.pin} stroke={t.pinRing} strokeWidth={1.6 * k} />
      ) : (
        <Path d={`M${p.x} ${p.y}l${-r * 0.8} ${-r * 1.6}a${r * 0.9} ${r * 0.9} 0 1 1 ${r * 1.6} 0Z`} fill={t.pin} stroke={t.pinRing} strokeWidth={1.6 * k} />
      )}
    </G>
  );
}

export interface Overlay {
  /** Selected thing: its outline shows, with handles in edit mode. */
  selected?: { type: 'pin' | 'area' | 'line' | 'label'; id: string } | null;
  /** Vertex handles and midpoints for the selected shape. */
  handles?: boolean;
  activeVertex?: number | null;
  /** A shape being drawn. */
  draft?: { points: Pt[]; closed: boolean } | null;
  /** A measure from one point to another, with its words. */
  measure?: { a: Pt; b: Pt | null; text: string } | null;
  /** Pins of other places shown dimmed while one is focused. */
  focus?: string | null;
}

/**
 * Labels and pins over the base. `scale` is screen pixels per map unit:
 * markers and text keep their size on screen at every zoom, and names that
 * would collide give way to the more important ones (see core/map/labels).
 */
export function MapMarks({ doc, typeOf, scale = 1, overlay, view }: { doc: MapDoc; typeOf?: (entityId: string) => string | undefined; scale?: number; overlay?: Overlay; view?: { x: number; y: number; w: number; h: number } | null }) {
  const t = THEMES[doc.theme] ?? THEMES.fantasy;
  const font = fontOf(t);
  const k = 1 / Math.max(0.01, scale);
  const sel = overlay?.selected;
  const selArea = sel?.type === 'area' ? doc.areas.find((a) => a.id === sel.id) : undefined;
  const selLine = sel?.type === 'line' ? doc.lines.find((l) => l.id === sel.id) : undefined;
  const handlesOf = selArea?.points ?? selLine?.points ?? null;
  const closed = !!selArea;
  const shapeOf = useCallback((p: MapPin) => pinShape(p.entityId ? typeOf?.(p.entityId) : undefined, doc.kind), [typeOf, doc.kind]);
  const placed = useMemo(() => placeLabels(doc, { scale, glyph: t.font === 'mono' ? 0.62 : t.font === 'serif' ? 0.52 : 0.56, grand: t.font !== 'sans', shapeOf, selected: sel ?? null, view }), [doc, scale, t.font, shapeOf, sel, view]);
  return (
    <G>
      {selArea ? <Path d={areaPath(selArea)} fill={t.pin} fillOpacity={0.12} stroke={t.pin} strokeWidth={2.2 * k} strokeDasharray={`${8 * k} ${5 * k}`} /> : null}
      {selLine ? <Path d={linePath(selLine.kind, selLine.points)} fill="none" stroke={t.pin} strokeOpacity={0.5} strokeWidth={10 * k} strokeLinecap="round" strokeLinejoin="round" /> : null}
      {placed.filter((l) => l.role !== 'pin').map((l) => (
        <G key={l.key}>
          {sel?.type === 'label' && sel.id === l.id ? <Rect x={l.x - (l.text.length * l.size * 0.3 + 6 * k)} y={l.y - l.size} width={l.text.length * l.size * 0.6 + 12 * k} height={l.size * 1.4} fill="none" stroke={t.pin} strokeWidth={1.5 * k} strokeDasharray={`${4 * k} ${3 * k}`} /> : null}
          <Halo x={l.x} y={l.y} text={l.text} size={l.size} color={l.water ? t.river : t.labelInk} halo={t.halo} font={font} italic={l.water || (t.drawn && l.role !== 'line' && l.bold)} spacing={l.spacing || undefined} angle={l.angle || undefined} weight={l.bold ? '600' : '400'} anchor={l.anchor} />
        </G>
      ))}
      {doc.pins.map((p) => {
        const on = sel?.type === 'pin' && sel.id === p.id;
        const dim = !!overlay?.focus && overlay.focus !== p.entityId && overlay.focus !== p.id;
        return <PinMark key={p.id} p={p} t={t} shape={shapeOf(p)} k={k} selected={on || (!!overlay?.focus && !dim)} dim={dim} />;
      })}
      {placed.filter((l) => l.role === 'pin').map((l) => <Halo key={l.key} x={l.x} y={l.y} text={l.text} size={l.size} color={t.labelInk} halo={t.halo} font={font} weight={l.bold ? '700' : '600'} anchor={l.anchor} />)}
      {handlesOf && overlay?.handles ? (
        <G>
          {handlesOf.map((p, i) => {
            const q = handlesOf[(i + 1) % handlesOf.length]!;
            if (!closed && i === handlesOf.length - 1) return null;
            return <Circle key={`m${i}`} cx={(p[0] + q[0]) / 2} cy={(p[1] + q[1]) / 2} r={4.5 * k} fill={t.halo} stroke={t.pin} strokeWidth={1.4 * k} opacity={0.85} />;
          })}
          {handlesOf.map((p, i) => <Circle key={`v${i}`} cx={p[0]} cy={p[1]} r={(overlay.activeVertex === i ? 9 : 6.5) * k} fill={overlay.activeVertex === i ? t.pin : t.halo} stroke={t.pin} strokeWidth={2 * k} />)}
        </G>
      ) : null}
      {overlay?.draft && overlay.draft.points.length ? (
        <G>
          <Path d={(overlay.draft.closed && overlay.draft.points.length > 2 ? 'M' : 'M') + overlay.draft.points.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L') + (overlay.draft.closed && overlay.draft.points.length > 2 ? 'Z' : '')} fill={overlay.draft.closed ? t.pin : 'none'} fillOpacity={0.15} stroke={t.pin} strokeWidth={2.4 * k} strokeDasharray={`${6 * k} ${4 * k}`} strokeLinejoin="round" />
          {overlay.draft.points.map((p, i) => <Circle key={i} cx={p[0]} cy={p[1]} r={(i === 0 ? 7 : 5) * k} fill={i === 0 ? t.pin : t.halo} stroke={t.pin} strokeWidth={1.8 * k} />)}
        </G>
      ) : null}
      {overlay?.measure ? (
        <G>
          <Circle cx={overlay.measure.a[0]} cy={overlay.measure.a[1]} r={6 * k} fill={t.pin} stroke={t.halo} strokeWidth={2 * k} />
          {overlay.measure.b ? (
            <G>
              <Line x1={overlay.measure.a[0]} y1={overlay.measure.a[1]} x2={overlay.measure.b[0]} y2={overlay.measure.b[1]} stroke={t.pin} strokeWidth={2.5 * k} strokeDasharray={`${8 * k} ${5 * k}`} />
              <Circle cx={overlay.measure.b[0]} cy={overlay.measure.b[1]} r={6 * k} fill={t.pin} stroke={t.halo} strokeWidth={2 * k} />
              <Halo x={(overlay.measure.a[0] + overlay.measure.b[0]) / 2} y={(overlay.measure.a[1] + overlay.measure.b[1]) / 2 - 10 * k} text={overlay.measure.text} size={16 * k} color={t.pin} halo={t.halo} font={font} weight="700" />
            </G>
          ) : null}
        </G>
      ) : null}
    </G>
  );
}

/** A whole map at a fixed size: thumbnails, proposals, previews. */
export function MapPicture({ doc, width, typeOf, decor = true, focus }: { doc: MapDoc; width: number; typeOf?: (id: string) => string | undefined; decor?: boolean; focus?: string | null }) {
  const height = (width * doc.h) / doc.w;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${doc.w} ${doc.h}`}>
      <MapBase doc={doc} decor={decor} px={width / doc.w} />
      <MapMarks doc={doc} typeOf={typeOf} scale={width / doc.w} overlay={{ focus }} />
    </Svg>
  );
}
