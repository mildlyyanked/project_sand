import React, { useCallback, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { KIND_INFO, mapKindOf } from '@/core/map/style';
import type { MapDoc } from '@/core/map/types';
import type { WorldEntity } from '@/core/world/types';
import { getMap } from '@/db/repo/atlas';
import { useJobs } from '@/state/jobs';
import { Button, Row, T } from '../components';
import { radius, useTheme } from '../theme';
import { MapPicture } from './MapCanvas';

export const mapRoute = (id: string, focus?: string) => ({ pathname: '/world/map/[id]' as const, params: focus ? { id, focus } : { id } });

/** A map as a picture you can tap to open. */
export function MapThumb({ doc, width, focus, onPress, typeOf }: { doc: MapDoc; width: number; focus?: string | null; onPress: () => void; typeOf?: (id: string) => string | undefined }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.85 : 1, alignSelf: 'flex-start' })}>
      <MapPicture doc={doc} width={width} focus={focus} typeOf={typeOf} />
    </Pressable>
  );
}

/**
 * A place's maps on its page: its own map, and where it sits on the map of
 * the place it is in. A place with no map yet offers to draw one.
 */
export function PlaceMapBlock({ place, parent }: { place: WorldEntity; parent?: WorldEntity | null }) {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const [own, setOwn] = useState<MapDoc | null>(null);
  const [above, setAbove] = useState<MapDoc | null>(null);
  const drawing = useJobs((s) => s.jobs.some((j) => j.kind === 'map' && (j.status === 'queued' || j.status === 'running') && (j.input as { locationId: string }).locationId === place.id));
  const parentId = parent?.id;
  useFocusEffect(useCallback(() => {
    let live = true;
    void (async () => {
      const [a, b] = await Promise.all([getMap(db, place.id), parentId ? getMap(db, parentId) : Promise.resolve(null)]);
      if (live) { setOwn(a); setAbove(b && b.pins.some((p) => p.entityId === place.id) ? b : null); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when a drawing finishes
  }, [db, place.id, parentId, drawing]));
  const w = Math.min(width - 32, 520);
  const kind = mapKindOf(typeof place.data.type === 'string' ? place.data.type : '');
  return (
    <View style={{ gap: 10 }}>
      {own ? <MapThumb doc={own} width={w} onPress={() => router.push(mapRoute(place.id))} /> : (
        <View style={{ gap: 6 }}>
          <T v="faint">{drawing ? 'Its map is being drawn.' : `No map yet. It would be ${KIND_INFO[kind].label.toLowerCase()}, with a pin for every place inside.`}</T>
          <Row><Button small icon="map-outline" title={drawing ? 'See progress' : 'Draw its map'} onPress={() => router.push(mapRoute(place.id))} /></Row>
        </View>
      )}
      {above && parent ? (
        <View style={{ gap: 6 }}>
          <T v="small">On the map of {parent.name}</T>
          <MapThumb doc={above} width={Math.min(w, 300)} focus={place.id} onPress={() => router.push(mapRoute(parent.id, place.id))} />
        </View>
      ) : null}
    </View>
  );
}
