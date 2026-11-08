import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { MapScreen } from '@/ui/map/MapScreen';

/** A place's map: to look at, measure, and edit. */
export default function MapRoute() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  return id ? <MapScreen key={id} locationId={id} focus={focus} /> : null;
}
