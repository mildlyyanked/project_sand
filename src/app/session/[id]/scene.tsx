import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { scenePrompt } from '@/core/helpers';
import { manuscriptText } from '@/core/beatTree';
import { useSQLiteContext } from 'expo-sqlite';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { runInForeground } from '@/state/foreground';
import { Banner, Button, Card, Field, Row, Screen, T } from '@/ui/components';
import { shortModel } from '@/ui/format';

export default function Scene() {
  const s = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  useEffect(() => {
    if (id && s.session?.id !== id) void s.open(db, id);
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const apiKey = useSettings((x) => x.apiKey);
  const [wish, setWish] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const session = s.session;
  if (!session) return null;

  async function run() {
    setBusy(true);
    setErr(null);
    setOut('');
    await runInForeground('Planning the next scene', async () => {
    try {
      const recent = manuscriptText(s.path.slice(-3));
      const msgs = scenePrompt({ universe: s.bundle.universe, characters: s.bundle.characters, style: s.bundle.style, summary: session!.summary, recent, wish });
      let text = '';
      for await (const ev of client.stream({ apiKey, model: session!.models.helper, messages: msgs, params: { temperature: 0.9, topP: 0.95, maxTokens: 500, reasoning: false }, zdr: session!.zdr })) {
        if (ev.type === 'text') {
          text += ev.text ?? '';
          setOut(text);
        }
        if (ev.type === 'error') throw new Error(ev.error);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
    });
  }
  async function insertAs(role: 'note' | 'instruction') {
    await s.addBeat(role, out.trim());
    router.back();
    if (role === 'instruction') void s.generate();
  }

  return (
    <Screen scroll>
      {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
      <Field label="What do you want from the next scene?" value={wish} onChangeText={setWish} placeholder="Optional. 'Get them out of the city', 'quiet scene, two people, one secret'…" multiline />
      <Row style={{ marginTop: 12 }}>
        <Button title={out ? 'Another' : 'Propose a scene'} icon="film-outline" onPress={run} loading={busy} />
        <T v="faint">{shortModel(session.models.helper)}</T>
      </Row>
      {out ? (
        <Card style={{ marginTop: 16, gap: 12 }}>
          <T selectable>{out}</T>
          {!busy ? (
            <>
              <Button title="Write it" icon="play" onPress={() => insertAs('instruction')} />
              <Button kind="outline" title="Keep as a note" onPress={() => insertAs('note')} />
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
