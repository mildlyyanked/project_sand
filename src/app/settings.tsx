import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { Banner, Button, Card, Field, ListItem, Row, Section, Screen, Segmented, Stepper, SwitchRow, T } from '@/ui/components';
import { relTime, shortModel } from '@/ui/format';
import { space } from '@/ui/theme';

export default function Settings() {
  const db = useSQLiteContext();
  const s = useSettings();
  const [key, setKey] = useState(s.apiKey);
  const [busy, setBusy] = useState<'test' | 'models' | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'danger' | 'info' } | null>(null);

  async function saveAndTest() {
    setBusy('test');
    setMsg(null);
    try {
      await s.setApiKey(db, key);
      if (!key.trim()) {
        setMsg({ text: 'Key removed.', tone: 'info' });
        return;
      }
      const info = await client.keyInfo(key.trim());
      if (!info) setMsg({ text: 'Key saved, but OpenRouter did not accept it.', tone: 'danger' });
      else setMsg({ text: `Key works${info.label ? ` (${info.label})` : ''}. Used $${info.usage.toFixed(2)}${info.limit != null ? ` of $${info.limit}` : ''}.`, tone: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }
  async function refreshModels() {
    if (!s.apiKey) return setMsg({ text: 'Save a key first.', tone: 'danger' });
    setBusy('models');
    try {
      const [models, zdr] = await Promise.all([client.listModels(s.apiKey), client.listZdrModelIds(s.apiKey)]);
      await s.setModels(db, models, [...zdr]);
      setMsg({ text: `${models.length} models cached, ${zdr.size} with zero data retention.`, tone: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen scroll>
      {msg ? <View style={{ marginBottom: space.lg }}><Banner text={msg.text} tone={msg.tone} onClose={() => setMsg(null)} /></View> : null}
      <Section title="OpenRouter">
        <Field label="API key" value={key} onChangeText={setKey} placeholder="sk-or-…" secureTextEntry autoCapitalize="none" autoCorrect={false} hint="Stored in the device secure store. Only ever sent to openrouter.ai." />
        <Row>
          <Button title="Save & test" onPress={saveAndTest} loading={busy === 'test'} />
          <Button title="Get a key" kind="ghost" onPress={() => Linking.openURL('https://openrouter.ai/keys')} />
        </Row>
      </Section>
      <Section title="Models" right={<Button small kind="outline" title="Refresh list" onPress={refreshModels} loading={busy === 'models'} />}>
        <T v="faint">{s.models.length ? `${s.models.length} models · refreshed ${s.modelsFetchedAt ? relTime(s.modelsFetchedAt) : ''}` : 'No model list yet. Refresh to enable the picker.'}</T>
        <Card style={{ padding: 0, paddingHorizontal: space.md }}>
          {(['writer', 'summarizer', 'helper'] as const).map((slot) => (
            <ListItem key={slot} title={slot[0]!.toUpperCase() + slot.slice(1)} subtitle={s.defaults.models[slot] || 'not set'} right={<T v="faint">{shortModel(s.defaults.models[slot])}</T>} onPress={() => router.push(`/models?target=default:${slot}`)} />
          ))}
        </Card>
        <T v="faint">Defaults for new sessions. The writer writes prose, the summarizer maintains the story summary, the helper powers scene ideas, premises and reweaving.</T>
      </Section>
      <Section title="Privacy">
        <SwitchRow label="Zero data retention by default" hint="New sessions only route to providers that keep nothing. Fewer models qualify." value={s.defaults.zdr} onChange={(v) => s.setDefaults(db, { zdr: v })} />
        <Card style={{ gap: 6 }}>
          <T v="dim">Every request tells OpenRouter to exclude providers that log or train on prompts. Nothing is stored anywhere except this device.</T>
          <T v="dim">Also turn off training and logging in your OpenRouter account settings; that switch is on their side.</T>
          <Button small kind="ghost" title="Open OpenRouter privacy settings" onPress={() => Linking.openURL('https://openrouter.ai/settings/privacy')} />
        </Card>
      </Section>
      <Section title="Appearance">
        <Segmented value={s.defaults.theme} onChange={(v) => s.setDefaults(db, { theme: v })} options={[{ key: 'dark', label: 'Dark' }, { key: 'light', label: 'Light' }, { key: 'system', label: 'System' }]} />
        <Row between>
          <T>Manuscript font size</T>
          <Stepper value={s.defaults.fontSize} min={13} max={24} onChange={(v) => s.setDefaults(db, { fontSize: v })} />
        </Row>
      </Section>
    </Screen>
  );
}
