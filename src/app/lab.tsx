import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { Style } from '@/core/types';
import { assembleContext } from '@/core/context/assemble';
import { LAB_TARGET_INFO, labPrompt, parseLabResult, transcriptOf, type LabResult, type LabTarget } from '@/core/helpers';
import { renderStyle } from '@/core/context/cards';
import { applyRepetition, trimDegenerate } from '@/core/repetition';
import { addRevision, newStyle, saveStyle, styleUsage } from '@/db/repo/library';
import { newId } from '@/core/ids';
import { patchSession } from '@/db/repo/sessions';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { client } from '@/state/client';
import { runInForeground } from '@/state/foreground';
import { Banner, Button, Card, Chip, Field, Row, Screen, Section, Sheet, T } from '@/ui/components';
import { ModelPicker } from '@/ui/components/ModelPicker';
import { serif, useTheme } from '@/ui/theme';
import { shortModel } from '@/ui/format';

/**
 * Prompt lab: a strong model revises one piece of the prompt stack toward a
 * goal, you test the revision on the next passage, then accept it with the
 * rationale recorded as a revision. Voice changes can override the shared
 * voice or become a new voice attached to this story.
 */
export default function Lab() {
  const { session: sid, target: initialTarget } = useLocalSearchParams<{ session?: string; target?: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const s = useSession();
  const { apiKey, defaults, setDefaults, templates } = useSettings();
  const [target, setTarget] = useState<LabTarget>(initialTarget && initialTarget in LAB_TARGET_INFO ? (initialTarget as LabTarget) : 'system');
  const [goal, setGoal] = useState('');
  const [sample, setSample] = useState('');
  const [includeLast, setIncludeLast] = useState(true);
  const [busy, setBusy] = useState<'revise' | 'test' | null>(null);
  const [result, setResult] = useState<LabResult | null>(null);
  const [revisedText, setRevisedText] = useState('');
  const [test, setTest] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [used, setUsed] = useState(0);
  const [askHow, setAskHow] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (sid && s.session?.id !== sid) void s.open(db, sid);
  }, [db, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const styleId = s.session?.styleId;
  useEffect(() => {
    void (styleId ? styleUsage(db, styleId) : Promise.resolve(0)).then(setUsed);
  }, [db, styleId]);

  const session = s.session;
  const editorModel = defaults.editorModel || session?.models.writer || defaults.models.writer;
  const lastPassage = useMemo(() => [...s.path].reverse().find((b) => b.role === 'prose')?.text ?? '', [s.path]);
  const style = s.bundle.style;
  const onVoice = LAB_TARGET_INFO[target].where === 'voice';

  const current = (): string => {
    if (target === 'system') return style?.system || templates.craft;
    if (target === 'postHistory') return style?.postHistory ?? '';
    if (target === 'style') return style ? renderStyle(style) : '';
    return session?.brief ?? '';
  };
  const available = (tg: LabTarget) => (LAB_TARGET_INFO[tg].where === 'voice' ? !!style : !!session);

  function overridden(): { style: Style | null; brief: string } {
    let st = style;
    let brief = session?.brief ?? '';
    if (target === 'system' && st) st = { ...st, system: revisedText };
    if (target === 'postHistory' && st) st = { ...st, postHistory: revisedText };
    if (target === 'brief') brief = revisedText;
    if (target === 'style' && st && result && typeof result.revised === 'object') {
      const r = result.revised as Partial<Style>;
      st = { ...st, ...r, register: (['clinical', 'euphemistic', 'blunt'] as const).includes(r.register as never) ? (r.register as Style['register']) : st.register, bannedPhrases: Array.isArray(r.bannedPhrases) ? r.bannedPhrases.map(String) : st.bannedPhrases };
    }
    return { style: st, brief };
  }

  async function revise() {
    if (!session || !apiKey) return;
    setBusy('revise'); setErr(null); setResult(null); setTest('');
    try {
      const full = transcriptOf(assembleContext({ session, path: s.path, ...s.bundle, model: session.models.writer, templates }).messages);
      let text = '';
      await runInForeground('Revising the prompt', async () => {
        for await (const ev of client.stream({ apiKey, model: editorModel, messages: labPrompt({ target, current: current(), goal, sample, lastPassage: includeLast ? lastPassage : '', fullPrompt: full }), params: { temperature: 0.4, topP: 0.9, maxTokens: 2500, reasoning: false }, zdr: session.zdr })) {
          if (ev.type === 'text') text += ev.text ?? '';
          if (ev.type === 'error') throw new Error(ev.error);
        }
      });
      const r = parseLabResult(text);
      if (!r) throw new Error('The editor model did not return a usable revision. Try a stronger model or a clearer goal.');
      setResult(r);
      setRevisedText(typeof r.revised === 'string' ? r.revised : JSON.stringify(r.revised, null, 2));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  async function testIt() {
    if (!session || !apiKey || !result) return;
    setBusy('test'); setErr(null); setTest('');
    try {
      const o = overridden();
      const ctx = assembleContext({ session: { ...session, brief: o.brief }, path: s.path, ...s.bundle, style: o.style, model: session.models.writer, templates });
      let text = '';
      await runInForeground('Testing the revision', async () => {
        for await (const ev of client.stream({ apiKey, model: session.models.writer, messages: ctx.messages, params: applyRepetition(session.params, o.style?.repetition), zdr: session.zdr, providerIgnore: o.style?.providerIgnore, providerOrder: o.style?.providerOrder })) {
          if (ev.type === 'text') { text += ev.text ?? ''; setTest(text); }
          if (ev.type === 'error') throw new Error(ev.error);
        }
      });
      setTest(trimDegenerate(text).text);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  function accept() {
    if (!session || !result) return;
    if (onVoice && used > 1) {
      setNewName(style ? `${style.name} (${session.title})` : session.title);
      setAskHow(true);
      return;
    }
    void commit('override');
  }

  async function commit(how: 'override' | 'new') {
    if (!session || !result) return;
    setAskHow(false);
    const note = [goal.trim() ? `Goal: ${goal.trim()}` : '', result.rationale].filter(Boolean).join('\n');
    const o = overridden();
    if (onVoice && o.style && style) {
      if (how === 'new') {
        const copy: Style = { ...o.style, id: newId(), name: newName.trim() || `${style.name} (${session.title})`, createdAt: Date.now(), updatedAt: Date.now() };
        await saveStyle(db, copy);
        await addRevision(db, 'style', copy.id, copy, `Forked from ${style.name} in the lab.\n${note}`);
        await patchSession(db, session.id, { styleId: copy.id });
      } else {
        await addRevision(db, 'style', style.id, style, 'Before lab change');
        await saveStyle(db, o.style);
        await addRevision(db, 'style', style.id, o.style, note);
      }
    } else if (target === 'brief') {
      await addRevision(db, 'brief', session.id, session.brief, 'Before lab change');
      await patchSession(db, session.id, { brief: o.brief });
      await addRevision(db, 'brief', session.id, o.brief, note);
    }
    await s.reload();
    setResult(null); setTest('');
    s.setNotice(how === 'new' ? 'New voice created and attached to this story.' : 'Revision accepted and recorded in the voice’s history.');
    router.back();
  }

  async function attachVoice() {
    if (!session) return;
    const v = { ...newStyle(), name: `${session.title} voice` };
    await saveStyle(db, v);
    await s.patch({ styleId: v.id });
  }

  if (!session) return <Screen><T v="dim">Open the lab from a story so it has a prompt to work on.</T></Screen>;

  return (
    <Screen scroll>
      {err ? <View style={{ marginBottom: 12 }}><Banner text={err} onClose={() => setErr(null)} /></View> : null}
      <Section title="What to revise">
        <Row style={{ flexWrap: 'wrap' }}>
          {(Object.keys(LAB_TARGET_INFO) as LabTarget[]).map((k) => <Chip key={k} label={LAB_TARGET_INFO[k].label} selected={target === k} onPress={() => { setTarget(k); setResult(null); setTest(''); }} />)}
        </Row>
        {onVoice ? (
          style ? <T v="faint">Lives on the voice “{style.name}”{used > 1 ? `, shared by ${used} stories` : ''}. {target === 'system' && !style.system ? 'This voice has no writer prompt of its own yet, so you are revising the app default; accepting writes the result onto the voice.' : target === 'postHistory' && !style.postHistory ? 'Empty now: nothing is sent after the manuscript. A one-line reminder of what to do next often helps.' : ''}</T>
          : <View style={{ gap: 8 }}><T v="faint">This story has no voice attached, and the writer prompt, post-history and card live on the voice.</T><Button small kind="outline" title="Create a voice for this story" onPress={attachVoice} /></View>
        ) : <T v="faint">Lives on this story. Sent to the writer with every passage.</T>}
        {available(target) ? <Card><T v="mono" numberOfLines={12}>{current() || '(empty)'}</T></Card> : null}
      </Section>
      <Section title="Editor model" right={<Button small kind="ghost" title={shortModel(editorModel)} icon="hardware-chip-outline" onPress={() => setPickerOpen(true)} />}>
        <T v="faint">Use the strongest model you have. It sees the whole request the writer gets, the last passage, your goal and any sample.</T>
      </Section>
      <Section title="Goal">
        <Field value={goal} onChangeText={setGoal} multiline placeholder="e.g. Less ornament, fewer similes, shorter passages that stop at the moment. Closer to the sample." />
        <Field label="Reference sample, optional" value={sample} onChangeText={setSample} multiline placeholder="Paste prose you like, from anywhere." style={{ minHeight: 100, fontFamily: serif }} />
        <Row>
          <Chip small label="Include last passage" selected={includeLast} onPress={() => setIncludeLast(!includeLast)} />
        </Row>
        <Button title="Revise" icon="flask-outline" onPress={revise} loading={busy === 'revise'} disabled={!apiKey || !available(target) || busy === 'test'} />
      </Section>
      {result ? (
        <Section title="Proposal">
          {result.rationale ? <Card><T v="label">Why</T><T v="dim" style={{ marginTop: 6 }}>{result.rationale}</T></Card> : null}
          {result.changes.length ? <Card><T v="label">Changes</T>{result.changes.map((c, i) => <T key={i} v="dim">• {c}</T>)}</Card> : null}
          <Field label="Revised (editable)" multiline value={revisedText} onChangeText={setRevisedText} style={{ minHeight: 180, fontSize: 14 }} />
          <Row style={{ flexWrap: 'wrap' }}>
            <Button kind="outline" icon="play-outline" title="Test on next passage" onPress={testIt} loading={busy === 'test'} disabled={!apiKey} />
            <Button icon="checkmark" title="Accept" onPress={accept} disabled={!!busy} />
          </Row>
          {test ? <Card><T v="label">Test passage · {shortModel(session.models.writer)}</T><T style={{ fontFamily: serif, fontSize: 16, lineHeight: 25, color: t.text, marginTop: 8 }} selectable>{test}</T></Card> : null}
          <T v="faint">Test does not touch the story. Accept saves the revision and records the rationale in the history.</T>
        </Section>
      ) : null}
      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(id) => setDefaults(db, { editorModel: id })} current={editorModel} title="Editor model" />
      <Sheet open={askHow} onClose={() => setAskHow(false)} title="Shared voice">
        <T v="dim">“{style?.name}” is used by {used} stories. Override it and all of them change; save as a new voice and only this story moves to it.</T>
        <Button title={`Override (used by ${used})`} icon="git-merge-outline" onPress={() => commit('override')} />
        <Field label="Or save as a new voice" value={newName} onChangeText={setNewName} />
        <Button kind="outline" title="Save as new and attach here" icon="duplicate-outline" onPress={() => commit('new')} />
      </Sheet>
    </Screen>
  );
}
