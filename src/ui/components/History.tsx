import React, { useEffect, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { listRevisions, type Revision, type RevisionKind } from '@/db/repo/library';
import { Button, Card, Row, Sheet, T } from './index';
import { relTime } from '../format';

/** Revision history for a preset, style or brief, with restore. */
export function HistorySheet({ open, onClose, kind, targetId, onRestore }: { open: boolean; onClose: () => void; kind: RevisionKind; targetId: string; onRestore: (payload: string) => void }) {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<Revision[]>([]);
  useEffect(() => {
    if (open) void listRevisions(db, kind, targetId).then(setRows);
  }, [open, db, kind, targetId]);
  return (
    <Sheet open={open} onClose={onClose} title="History" full>
      {rows.length === 0 ? <T v="dim">No revisions yet. The prompt lab records one each time you accept a change.</T> : null}
      {rows.map((r) => (
        <Card key={r.id} style={{ gap: 6 }}>
          <Row between>
            <T v="label">{relTime(r.createdAt)}</T>
            <Button small kind="ghost" title="Restore" onPress={() => { onRestore(r.payload); onClose(); }} />
          </Row>
          {r.note ? <T v="dim">{r.note}</T> : null}
          <T v="mono" numberOfLines={8}>{r.payload}</T>
        </Card>
      ))}
    </Sheet>
  );
}
