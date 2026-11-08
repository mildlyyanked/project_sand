import React, { memo, useMemo } from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { area as polyArea } from '@/core/map/geom';
import { areaFill, areaPath, areaRank, doorSwing, graticule, gridPath, linePath, lineStrokes, marksPath, multiPath, pinShape, rosePath } from '@/core/map/draw';
import { THEMES, scaleBar, type MapTheme } from '@/core/map/style';
import type { MapArea, MapDoc, MapLabel, MapPin, Pt } from '@/core/map/types';
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
export const MapBase = memo(function MapBase({ doc, decor = true }: { doc: MapDoc; decor?: boolean }) {
  const t = THEMES[doc.theme] ?? THEMES.fantasy;
  const font = fontOf(t);
  const layers = useMemo(() => {
    const ground = doc.areas.filter((a) => a.kind === 'land' || a.kind === 'water').sort((a, b) => polyArea(b.points) - polyArea(a.points));
    const rest = doc.areas.filter((a) => a.kind !== 'land' && a.kind !== 'water' && a.kind !== 'block').sort((a, b) => areaRank(a.kind) - areaRank(b.kind));
    const blocks = doc.areas.filter((a) => a.kind === 'block' && !a.name);
    const namedBlocks = doc.areas.filter((a) => a.kind === 'block' && a.name);
    return { ground, terrain: rest.filter((a) => areaRank(a.kind) < 6), built: rest.filter((a) => areaRank(a.kind) >= 6 && areaRank(a.kind) < 9), rooms: rest.filter((a) => areaRank(a.kind) >= 9), blocks: multiPath(blocks), namedBlocks };
  }, [doc.areas]);
  const lines = useMemo(() => {
    const under = doc.lines.filter((l) => l.kind === 'river' || l.kind === 'canal' || l.kind === 'corridor');
    const over = doc.lines.filter((l) => !under.includes(l) && l.kind !== 'door');
    const doors = doc.lines.filter((l) => l.kind === 'door');
    return { under, over, doors };
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
      {lines.under.map((l) => lineStrokes(t, l.kind, doc.kind).map((s, i) => <Path key={`${l.id}-${i}`} d={linePath(l.kind, l.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeOpacity={s.opacity ?? 1} strokeLinecap={s.cap ?? 'round'} strokeLinejoin="round" />))}

      {layers.built.map((a) => <Path key={a.id} d={areaPath(a)} fill={areaFill(t, a.kind)} fillOpacity={a.kind === 'district' ? 0.55 : 0.95} stroke={a.kind === 'district' ? t.blockLine : t.ink} strokeOpacity={a.kind === 'district' ? 0.35 : 0.25} strokeWidth={a.kind === 'district' ? 1.2 : 0.8} strokeDasharray={a.kind === 'district' ? '6 4' : undefined} />)}
      {layers.blocks ? <Path d={layers.blocks} fill={t.block} stroke={t.blockLine} strokeWidth={0.6} strokeOpacity={t.glow ? 0.8 : 0.7} /> : null}
      {layers.namedBlocks.map((a) => <Path key={a.id} d={areaPath(a)} fill={t.block} stroke={t.blockLine} strokeWidth={1.4} />)}

      {/* Roads, walls, borders. */}
      {lines.over.map((l) => lineStrokes(t, l.kind, doc.kind).map((s, i) => <Path key={`${l.id}-${i}`} d={linePath(l.kind, l.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeOpacity={s.opacity ?? 1} strokeLinecap={s.cap ?? 'round'} strokeLinejoin="round" />))}

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

      {decor ? (
        <G>
          {/* Frame */}
          {t.drawn ? (
            <G>
              <Rect x={6} y={6} width={doc.w - 12} height={doc.h - 12} fill="none" stroke={t.ink} strokeWidth={3} />
              <Rect x={13} y={13} width={doc.w - 26} height={doc.h - 26} fill="none" stroke={t.ink} strokeWidth={0.8} />
            </G>
          ) : (
            <Rect x={4} y={4} width={doc.w - 8} height={doc.h - 8} fill="none" stroke={t.glow ? t.coast : t.ink} strokeOpacity={t.glow ? 0.6 : 0.35} strokeWidth={1.5} />
          )}
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
}, (a, b) => a.decor === b.decor && a.doc.areas === b.doc.areas && a.doc.lines === b.doc.lines && a.doc.theme === b.doc.theme && a.doc.title === b.doc.title && a.doc.kind === b.doc.kind && a.doc.scale === b.doc.scale && a.doc.ground === b.doc.ground);

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

const LABEL_SIZE = { s: 13, m: 18, l: 26 } as const;

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
 * Labels and pins: drawn over the base, sized for the screen. `scale` is
 * screen pixels per map unit; text grows a little as you zoom in, never as
 * much as the map, so it stays readable from the whole map down to a street.
 */
export function MapMarks({ doc, typeOf, scale = 1, overlay }: { doc: MapDoc; typeOf?: (entityId: string) => string | undefined; scale?: number; overlay?: Overlay }) {
  const t = THEMES[doc.theme] ?? THEMES.fantasy;
  const font = fontOf(t);
  const k = Math.min(3, Math.max(0.25, Math.pow(Math.max(0.01, scale), -0.75)));
  const sel = overlay?.selected;
  const selArea = sel?.type === 'area' ? doc.areas.find((a) => a.id === sel.id) : undefined;
  const selLine = sel?.type === 'line' ? doc.lines.find((l) => l.id === sel.id) : undefined;
  const handlesOf = selArea?.points ?? selLine?.points ?? null;
  const closed = !!selArea;
  return (
    <G>
      {doc.labels.map((l: MapLabel) => (
        <G key={l.id}>
          {sel?.type === 'label' && sel.id === l.id ? <Rect x={l.x - (l.text.length * LABEL_SIZE[l.size] * 0.3 + 8) * k} y={l.y - LABEL_SIZE[l.size] * k} width={(l.text.length * LABEL_SIZE[l.size] * 0.6 + 16) * k} height={LABEL_SIZE[l.size] * 1.4 * k} fill="none" stroke={t.pin} strokeWidth={1.5 * k} strokeDasharray="4 3" /> : null}
          <Halo x={l.x} y={l.y} text={l.size === 'l' && t.font !== 'sans' ? l.text.toUpperCase() : l.text} size={LABEL_SIZE[l.size] * k} color={l.water ? t.river : t.labelInk} halo={t.halo} font={font} italic={l.water || (t.drawn && l.size !== 's')} spacing={l.size === 'l' ? 4 * k : l.size === 'm' ? 1 * k : 0} angle={l.angle} weight={l.size === 's' ? '400' : '600'} />
        </G>
      ))}
      {selArea ? <Path d={areaPath(selArea)} fill={t.pin} fillOpacity={0.12} stroke={t.pin} strokeWidth={2.2 * k} strokeDasharray={`${8 * k} ${5 * k}`} /> : null}
      {selLine ? <Path d={linePath(selLine.kind, selLine.points)} fill="none" stroke={t.pin} strokeOpacity={0.5} strokeWidth={10 * k} strokeLinecap="round" strokeLinejoin="round" /> : null}
      {doc.pins.map((p) => {
        const s = pinShape(p.entityId ? typeOf?.(p.entityId) : undefined, doc.kind);
        const on = sel?.type === 'pin' && sel.id === p.id;
        const dim = !!overlay?.focus && overlay.focus !== p.entityId && overlay.focus !== p.id;
        return (
          <G key={p.id}>
            <PinMark p={p} t={t} shape={s} k={k} selected={on || (!!overlay?.focus && !dim)} dim={dim} />
            {(() => {
              const size = (s === 'city' ? 16 : 14) * k;
              const flip = p.x + 11 * k + p.name.length * size * 0.56 > doc.w - 8;
              return <Halo x={flip ? p.x - 11 * k : p.x + 11 * k} y={p.y + 5 * k} text={p.name} size={size} color={t.labelInk} halo={t.halo} font={font} weight={s === 'city' ? '700' : '600'} anchor={flip ? 'end' : 'start'} />;
            })()}
          </G>
        );
      })}
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
      <MapBase doc={doc} decor={decor} />
      <MapMarks doc={doc} typeOf={typeOf} scale={Math.max(0.75, width / doc.w)} overlay={{ focus }} />
    </Svg>
  );
}
