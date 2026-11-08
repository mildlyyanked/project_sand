import { useEffect, useMemo, useState } from 'react';
import { fillMap, tileSize, type Fill } from '@/core/map/town';
import type { MapDoc, Pt } from '@/core/map/types';

/**
 * A town's lanes and buildings for what is on screen, grown in tiles of
 * 250 metres. Tiles already grown are kept (the last few hundred), so
 * panning back is instant; new ones are grown a few at a time between
 * frames, nearest the middle of the screen first, so the map never freezes
 * while a city fills in.
 */
const cache = new Map<string, Fill>();
const CAP = 500;
const ids = new WeakMap<object, number>();
let next = 1;
const idOf = (o: object) => { let v = ids.get(o); if (!v) { v = next++; ids.set(o, v); } return v; };
const remember = (k: string, f: Fill) => { cache.delete(k); cache.set(k, f); if (cache.size > CAP) cache.delete(cache.keys().next().value!); };

export function useTownFill(doc: MapDoc, view: { x: number; y: number; w: number; h: number } | null | undefined, detail: { lanes: boolean; buildings: boolean }): Fill | null {
  const on = !!doc.town && !!view && (detail.lanes || detail.buildings);
  const base = `${idOf(doc.lines)}:${idOf(doc.areas)}:${detail.buildings ? 'B' : 'L'}`;
  const tiles = useMemo(() => {
    if (!on || !view) return [] as { key: string; rect: { x: number; y: number; w: number; h: number }; d: number }[];
    const s = tileSize(doc.scale);
    const out: { key: string; rect: { x: number; y: number; w: number; h: number }; d: number }[] = [];
    const cx = view.x + view.w / 2; const cy = view.y + view.h / 2;
    for (let tx = Math.floor(view.x / s); tx <= Math.floor((view.x + view.w) / s); tx++) for (let ty = Math.floor(view.y / s); ty <= Math.floor((view.y + view.h) / s); ty++) {
      const rect = { x: tx * s, y: ty * s, w: s, h: s };
      out.push({ key: `${base}:${tx},${ty}`, rect, d: Math.hypot(rect.x + s / 2 - cx, rect.y + s / 2 - cy) });
    }
    return out.sort((a, b) => a.d - b.d);
  }, [on, view, doc.scale, base]);
  const [ver, setVer] = useState(0);

  useEffect(() => {
    if (!tiles.length) return;
    let stop = false;
    const missing = tiles.filter((t) => !cache.has(t.key));
    if (!missing.length) return;
    let n = 0;
    const work = () => {
      if (stop) return;
      const t0 = Date.now();
      while (n < missing.length && Date.now() - t0 < 30) {
        const t = missing[n++]!;
        if (!cache.has(t.key)) remember(t.key, fillMap(doc, t.rect, { lanes: detail.lanes, buildings: detail.buildings, strict: true }));
      }
      setVer((v) => v + 1);
      if (n < missing.length) setTimeout(work, 0);
    };
    const h = setTimeout(work, 0);
    return () => { stop = true; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tiles carry everything that matters
  }, [tiles]);

  return useMemo(() => {
    if (!tiles.length) return null;
    const lanes: Pt[][] = []; const buildings: Pt[][] = [];
    for (const t of tiles) { const f = cache.get(t.key); if (f) { for (const l of f.lanes) lanes.push(l); for (const b of f.buildings) buildings.push(b); } }
    return { lanes, buildings };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver says a tile arrived
  }, [tiles, ver]);
}
