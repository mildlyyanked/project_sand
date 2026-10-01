import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSettings } from '@/state/settings';
import { listStyles } from '@/db/repo/library';
import type { Style } from '@/core/types';
import { describeBackend, type ImageBackendKind } from '@/core/images';
import { client } from '@/state/client';
import { Banner, Button, Card, Chip, Field, ListItem, Row, Section, Screen, Segmented, Stepper, SwitchRow, T } from '@/ui/components';
import { relTime, shortModel } from '@/ui/format';
import { space } from '@/ui/theme';
import { appVersion } from '@/ui/version';

export default function Settings() {
  const db = useSQLiteContext();
  const s = useSettings();
  const [key, setKey] = useState(s.apiKey);
  const [busy, setBusy] = useState<'test' | 'models' | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'danger' | 'info' } | null>(null);
  const [voices, setVoices] = useState<Style[]>([]);
  const [imgKey, setImgKey] = useState<string | null>(null);
  const ib = s.defaults.imageBackend;
  const setIb = (patch: Partial<typeof ib>) => s.setDefaults(db, { imageBackend: { ...ib, ...patch } });
  useEffect(() => {
    void listStyles(db).then(setVoices);
  }, [db]);

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
      else {
        setMsg({ text: `Key works${info.label ? ` (${info.label})` : ''}. Used $${info.usage.toFixed(2)}${info.limit != null ? ` of $${info.limit}` : ''}.`, tone: 'ok' });
        void s.ensureModels(db);
      }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }
  async function refreshModels() {
    if (!s.apiKey) return setMsg({ text: 'Save a key first.', tone: 'danger' });
    setBusy('models');
    await s.ensureModels(db, { force: true });
    const { models, zdrIds, modelsError } = useSettings.getState();
    setMsg(modelsError ? { text: modelsError, tone: 'danger' } : { text: `${models.length} models cached, ${zdrIds.length} with zero data retention.`, tone: 'ok' });
    setBusy(null);
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
        <T v="faint">{s.models.length ? `${s.models.length} models · refreshed ${s.modelsFetchedAt ? relTime(s.modelsFetchedAt) : ''}. The list refreshes itself every few hours.` : 'The model list loads once a key is saved.'}</T>
        <Card style={{ padding: 0, paddingHorizontal: space.md }}>
          {(['writer', 'summarizer', 'helper'] as const).map((slot) => (
            <ListItem key={slot} title={slot[0]!.toUpperCase() + slot.slice(1)} subtitle={s.defaults.models[slot] || 'not set'} right={<T v="faint">{shortModel(s.defaults.models[slot])}</T>} onPress={() => router.push(`/models?target=default:${slot}`)} />
          ))}
        </Card>
        <T v="faint">Defaults for new sessions. The writer writes prose, the summarizer maintains the story summary, the helper powers scene ideas, premises and reweaving.</T>
      </Section>
      <Section title="Illustrations">
        <T v="faint">The helper turns a passage into an image prompt; this is what paints it. OpenRouter’s image models carry their providers’ filters. An open-weights model on a host or PC of your own does not.</T>
        <Segmented value={ib.kind} onChange={(v: ImageBackendKind) => setIb({ kind: v })} options={[{ key: 'openrouter', label: 'OpenRouter' }, { key: 'openai', label: 'Images API' }, { key: 'a1111', label: 'SD web UI' }, { key: 'prompt', label: 'Prompt only' }]} />
        {ib.kind === 'openrouter' ? (
          <Card style={{ padding: 0, paddingHorizontal: space.md }}>
            <ListItem title="Image model" subtitle={s.defaults.imageModel || 'not set'} right={<T v="faint">{shortModel(s.defaults.imageModel)}</T>} onPress={() => router.push(`/models?target=default:imageModel&current=${encodeURIComponent(s.defaults.imageModel)}`)} />
          </Card>
        ) : ib.kind === 'prompt' ? (
          <T v="faint">Illustrate writes the image prompt and stops. Copy it into Perchance or any generator’s page, then save the picture yourself. The prompt is also available in every passage’s menu as Picture prompt, whatever is picked here.</T>
        ) : ib.kind === 'openai' ? (
          <>
            <T v="faint">Any host that speaks the OpenAI images shape (POST /images/generations): Venice, Together, fal, a RunPod template, a local server. Paste the base URL up to and including /v1.</T>
            <Field label="Base URL" value={ib.baseUrl} onChangeText={(v) => setIb({ baseUrl: v })} placeholder="https://api.venice.ai/api/v1" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Field label="Model" value={ib.model} onChangeText={(v) => setIb({ model: v })} placeholder="e.g. lustify-sdxl, flux-dev, or empty for the host default" autoCapitalize="none" autoCorrect={false} />
            <Field label="API key" value={imgKey ?? s.imageKey} onChangeText={setImgKey} onBlur={() => { if (imgKey != null) void s.setImageKey(imgKey); setImgKey(null); }} placeholder="Sent as a Bearer token; kept in the secure store" secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <Field label="Negative prompt, optional" value={ib.negativePrompt} onChangeText={(v) => setIb({ negativePrompt: v })} placeholder="Sent when the host supports it" />
          </>
        ) : (
          <>
            <T v="faint">AUTOMATIC1111, Forge or SD.Next running on a PC with --api --listen, on the same network or through a tunnel. Loads whichever checkpoint the UI has, so any open model works.</T>
            <Field label="Server address" value={ib.baseUrl} onChangeText={(v) => setIb({ baseUrl: v })} placeholder="http://192.168.1.20:7860" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Field label="Checkpoint, optional" value={ib.model} onChangeText={(v) => setIb({ model: v })} placeholder="Exact checkpoint name, or empty for the loaded one" autoCapitalize="none" autoCorrect={false} />
            <Field label="Negative prompt" value={ib.negativePrompt} onChangeText={(v) => setIb({ negativePrompt: v })} placeholder="e.g. text, watermark, extra fingers" />
            <Row between><T>Steps</T><Stepper value={ib.steps} min={0} max={60} step={5} format={(v) => (v ? String(v) : 'default')} onChange={(v) => setIb({ steps: v })} /></Row>
            <Field label="API key, if the server asks for one" value={imgKey ?? s.imageKey} onChangeText={setImgKey} onBlur={() => { if (imgKey != null) void s.setImageKey(imgKey); setImgKey(null); }} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          </>
        )}
        {ib.kind !== 'prompt' ? <SwitchRow label="Show the prompt before painting" hint="Illustrate stops at the helper's description so you can read it, change it, then paint. Useful when a painter keeps refusing: cut what it objects to and try again, without touching the story." value={s.defaults.reviewImagePrompt} onChange={(v) => s.setDefaults(db, { reviewImagePrompt: v })} /> : null}
        {ib.kind !== 'openrouter' ? <Row between><T>Image size</T><Stepper value={ib.size} min={512} max={1536} step={128} onChange={(v) => setIb({ size: v })} /></Row> : null}
        <T v="faint">Painting with: {describeBackend(ib)}</T>
      </Section>
      <Section title="Default voice">
        <Row style={{ flexWrap: 'wrap' }}>
          {voices.map((v) => <Chip key={v.id} label={v.name} selected={s.defaults.styleId === v.id} onPress={() => s.setDefaults(db, { styleId: v.id })} />)}
        </Row>
        <T v="faint">New stories start with this voice: its writer prompt, persistence chain and card. The workshop may replace it with a voice it writes for the story.</T>
      </Section>
      <Section title="Privacy">
        <SwitchRow label="Zero data retention by default" hint="New sessions only route to providers that keep nothing. Fewer models qualify." value={s.defaults.zdr} onChange={(v) => s.setDefaults(db, { zdr: v })} />
        <Card style={{ gap: 6 }}>
          <T v="dim">Every request tells OpenRouter to exclude providers that log or train on prompts. Nothing is stored anywhere except this device.</T>
          <T v="dim">Also turn off training and logging in your OpenRouter account settings; that switch is on their side.</T>
          <Button small kind="ghost" title="Open OpenRouter privacy settings" onPress={() => Linking.openURL('https://openrouter.ai/settings/privacy')} />
        </Card>
      </Section>
      <Section title="Prompts">
        <Card style={{ padding: 0, paddingHorizontal: space.md }}>
          <ListItem title="Prompt templates" subtitle="Every fixed piece of prompt text the app sends, editable" onPress={() => router.push('/templates')} />
          <ListItem title="Editor model for the prompt lab" subtitle={s.defaults.editorModel || 'Same as the writer'} onPress={() => router.push('/models?target=default:editorModel')} />
        </Card>
        <T v="faint">Open the lab from a story’s menu to have a strong model revise its voice or brief against a goal, test the result, and accept it with the rationale on record.</T>
      </Section>
      <Section title="Appearance">
        <Segmented value={s.defaults.theme} onChange={(v) => s.setDefaults(db, { theme: v })} options={[{ key: 'dark', label: 'Dark' }, { key: 'light', label: 'Light' }, { key: 'system', label: 'System' }]} />
        <Row between>
          <T>Manuscript font size</T>
          <Stepper value={s.defaults.fontSize} min={13} max={24} onChange={(v) => s.setDefaults(db, { fontSize: v })} />
        </Row>
      </Section>
      <T v="faint" style={{ textAlign: 'center', marginTop: space.lg }}>{appVersion()}</T>
    </Screen>
  );
}
