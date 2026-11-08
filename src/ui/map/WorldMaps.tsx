import React, { useCallback, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { KIND_INFO, mapKindOf } from '@/core/map/style';
import type { MapDoc } from '@/core/map/types';
import type { Library } from '@/core/world/drafts';
import type { WorldEntity } from '@/core/world/types';
import { listMaps } from '@/db/repo/atlas';
import { useJobs } from '@/state/jobs';
import { Badge, Button, Card, Row, T } from '../components';
import { space } from '../theme';
import { MapThumb, mapRoute } from './PlaceMap';

const typeOf = (e: WorldEntity) => (typeof e.data.type === 'string' ? e.data.type : '');

/**
 * A world's atlas: the map of each place, outermost first, each opening to
 * the maps of what is inside it. Places with no map yet can be drawn from
 * here.
 */
export function WorldMaps({ lib }: { lib: Library | null }) {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const [maps, setMaps] = useState<MapDoc[]>([]);
  const uid = lib?.universe?.id;
  const stamp = useJobs((s) => s.jobs.filter((j) => j.kind === 'map' && j.universeId === uid).map((j) => j.status).join());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when a drawing finishes
  useFocusEffect(useCallback(() => { if (uid) void listMaps(db, uid).then(setMaps); }, [db, uid, stamp]));
  if (!lib) return null;
  const places = lib.entities.filter((e) => e.kind === 'location');
  const byId = new Map(maps.map((m) => [m.locationId, m]));
  const depth = (e: WorldEntity) => { let d = 0; let at = e; const seen = new Set<string>(); while (at.parentId && !seen.has(at.id)) { seen.add(at.id); const p = places.find((x) => x.id === at.parentId); if (!p) break; at = p; d++; } return d; };
  const mapped = places.filter((p) => byId.has(p.id)).sort((a, b) => depth(a) - depth(b) || a.name.localeCompare(b.name));
  const roots = places.filter((p) => !p.parentId || !places.some((x) => x.id === p.parentId));
  const unmapped = places.filter((p) => !byId.has(p.id) && (roots.includes(p) || places.some((c) => c.parentId === p.id))).sort((a, b) => depth(a) - depth(b));
  const typeOfId = (id: string) => { const e = places.find((x) => x.id === id); return e ? typeOf(e) : undefined; };
  const big = Math.min(width - 32, 560);
  const [first, ...rest] = mapped;

  if (!places.length) return <T v="faint">No places yet. Add some in Entries, or ask the agent; every place can have a map.</T>;
  return (
    <View style={{ gap: space.lg }}>
      {first ? (
        <View style={{ gap: 6 }}>
          <Row between><T v="h">{first.name}</T><Badge label={KIND_INFO[byId.get(first.id)!.kind].label} /></Row>
          <MapThumb doc={byId.get(first.id)!} width={big} typeOf={typeOfId} onPress={() => router.push(mapRoute(first.id))} />
        </View>
      ) : (
        <T v="dim">No maps yet. Start with the outermost place: its map gives every place inside it a spot, and characters can then tell how far and which way.</T>
      )}
      {rest.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {rest.map((p) => (
            <View key={p.id} style={{ gap: 4, width: (big - 12) / 2 }}>
              <MapThumb doc={byId.get(p.id)!} width={(big - 12) / 2} typeOf={typeOfId} onPress={() => router.push(mapRoute(p.id))} />
              <T v="small" numberOfLines={1}>{p.name}</T>
            </View>
          ))}
        </View>
      ) : null}
      {unmapped.length ? (
        <View style={{ gap: 6 }}>
          <T v="label">Not mapped yet</T>
          {unmapped.slice(0, 30).map((p) => {
            const kids = places.filter((c) => c.parentId === p.id).length;
            return (
              <Card key={p.id} onPress={() => router.push(mapRoute(p.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T numberOfLines={1} style={{ fontWeight: '600' }}>{p.name}</T>
                  <T v="small" numberOfLines={1}>{[typeOf(p), KIND_INFO[mapKindOf(typeOf(p))].label, kids ? `${kids} inside` : ''].filter(Boolean).join(' · ')}</T>
                </View>
                <Button small kind="outline" icon="map-outline" title="Draw" onPress={() => router.push(mapRoute(p.id))} />
              </Card>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
