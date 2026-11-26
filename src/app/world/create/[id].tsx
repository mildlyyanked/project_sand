import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CreationBegin, CreationSession } from '@/ui/components/Creation';

/**
 * Creating a world in stages: its overview, then its core lore one page at
 * a time, then what is in it one entry at a time. `new` starts one; any
 * other id is a session, unfinished or concluded, picked up where it stands.
 */
export default function CreateWorld() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id || id === 'new') return <CreationBegin />;
  return <CreationSession key={id} id={id} />;
}
