import React from 'react';
import { router } from 'expo-router';
import { awaiting } from '@/core/jobs';
import { useJobs } from '@/state/jobs';
import { IconButton } from './index';

/** The inbox, from anywhere: a dot when something waits on a decision, a different icon while work is running. */
export function InboxButton({ world }: { world?: string | null }) {
  const waiting = useJobs((s) => s.jobs.filter((j) => j.kind !== 'question' && awaiting(j) && (!world || j.universeId === world)).length);
  const busy = useJobs((s) => s.jobs.some((j) => j.kind !== 'question' && (j.status === 'queued' || j.status === 'running') && (!world || j.universeId === world)));
  return <IconButton name={waiting ? 'mail-unread-outline' : busy ? 'hourglass-outline' : 'mail-outline'} badge={waiting > 0} onPress={() => router.push(world ? { pathname: '/inbox', params: { world } } : '/inbox')} />;
}
