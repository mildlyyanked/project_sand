import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Job } from '@/core/jobs';
import { proposalCount } from '@/core/jobs';
import { useJobs } from '@/state/jobs';
import { Button, Ionicons, Row, T } from './index';
import { relTime } from '../format';
import { useTheme } from '../theme';

/** Where a job stands, in one line, with what can be done about it. */
export function JobStatusLine({ job, live, compact }: { job: Job; live?: number; compact?: boolean }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const jobs = useJobs.getState();
  const n = proposalCount(job);
  const thought = useJobs((s) => s.thinking[job.id]);
  const line = (() => {
    switch (job.status) {
      case 'queued': return 'Waiting its turn…';
      case 'running': return live ? `Writing… ${Math.round(live / 4)} tokens` : thought ? `Thinking… ${Math.round(thought / 4)} tokens` : 'Waiting for the model…';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Stopped';
      default: return n ? `${n} to decide on` : 'Decided';
    }
  })();
  const icon = job.status === 'failed' ? 'alert-circle-outline' : job.status === 'cancelled' ? 'stop-circle-outline' : job.status === 'done' ? (n ? 'mail-unread-outline' : 'checkmark-done-outline') : null;
  return (
    <Row between>
      <Row gap={6} style={{ flex: 1 }}>
        {icon ? <Ionicons name={icon} size={15} color={job.status === 'failed' ? t.danger : n ? t.accent : t.dim} /> : <ActivityIndicator size="small" color={t.accent} />}
        <T v="small" numberOfLines={1} style={{ flexShrink: 1 }}>{line}{compact ? '' : ` · ${job.status === 'running' ? 'started ' : ''}${relTime(job.updatedAt)}`}</T>
      </Row>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {job.status === 'queued' || job.status === 'running' ? <Button small kind="ghost" title="Stop" onPress={() => void jobs.cancel(db, job.id)} /> : null}
        {job.status === 'failed' || job.status === 'cancelled' ? <Button small kind="ghost" icon="refresh-outline" title="Retry" onPress={() => void jobs.retry(db, job.id)} /> : null}
      </View>
    </Row>
  );
}
