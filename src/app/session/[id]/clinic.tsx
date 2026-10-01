import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { CLINIC_TARGET_INFO } from '@/core/helpers';
import { addRevision, saveStyle } from '@/db/repo/library';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { KeyboardShift } from '@/ui/keyboard';
import { Banner, Button, Card, Chip, Field, IconButton, Row, T } from '@/ui/components';
import { ModelPicker } from '@/ui/components/ModelPicker';
import { radius, space, useTheme } from '@/ui/theme';
import { shortModel } from '@/ui/format';

/**
 * Refusal clinic. The conversation lives in the session store: it starts
 * once per refusal, finishes even if this screen is left, and reopening shows
 * what is already there. Nothing is sent to the writer until Retry.
 */
export default function Clinic() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSession();
  const { apiKey, defaults } = useSettings();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [direction, setDirection] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const session = s.session;
  const refusal = s.refusal;
  const clinic = s.clinic;
  const editorModel = defaults.editorModel || session?.models.writer || defaults.models.writer;

  useEffect(() => {
    if (id && s.session?.id !== id) void s.open(db, id);
  }, [db, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (session && refusal && apiKey && !clinic) void s.clinicStart();
  }, [session, refusal, apiKey, clinic]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }, [clinic?.turns.length, clinic?.pending]);

  async function send() {
    const v = text.trim();
    if (!v || clinic?.busy) return;
    setText('');
    await s.clinicSend(v);
  }

  async function apply(turnIdx: number, editIdx: number) {
    const e = clinic?.turns[turnIdx]?.edits[editIdx];
    const style = s.bundle.style;
    if (!e || !session || applying) return;
    setApplying(true);
    try {
      if (e.target === 'system' || e.target === 'postHistory') {
        if (!style) throw new Error('This story has no voice attached; pick one in session settings first.');
        await addRevision(db, 'style', style.id, style, 'Before refusal clinic');
        const next = { ...style, [e.target]: e.text };
        await saveStyle(db, next);
        await addRevision(db, 'style', style.id, next, `Refusal clinic on ${shortModel(refusal?.model ?? '')}: ${e.why}`);
        await s.reload();
      } else if (e.target === 'brief') {
        await addRevision(db, 'brief', session.id, session.brief, 'Before refusal clinic');
        await s.patch({ brief: e.text });
        await addRevision(db, 'brief', session.id, e.text, `Refusal clinic: ${e.why}`);
      } else if (e.target === 'instruction') {
        if (refusal?.instructionBeatId) await s.editBeat(refusal.instructionBeatId, e.text);
        else setDirection(e.text);
      } else if (e.target === 'direction') {
        setDirection(e.text);
      }
      s.clinicMarkApplied(turnIdx, editIdx);
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    } finally {
      setApplying(false);
    }
  }

  async function retry(model?: string) {
    router.back();
    await s.retryRefusal({ direction: direction ?? undefined, model });
  }

  if (!session) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!refusal) return <View style={{ flex: 1, backgroundColor: t.bg, padding: space.lg }}><T v="dim">No refusal to look at. The clinic opens from a refusal on the manuscript.</T></View>;

  return (
    <KeyboardShift style={{ flex: 1, backgroundColor: t.bg }} offset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        {err ? <Banner text={err} onClose={() => setErr(null)} /> : null}
        {clinic?.error ? <Banner text={clinic.error} /> : null}
        <Card style={{ gap: 6 }}>
          <Row between>
            <T v="label">{shortModel(refusal.model)} refused</T>
            <T v="faint">clinic · {shortModel(editorModel)}</T>
          </Row>
          <T v="dim" numberOfLines={6}>{refusal.text || '(empty reply)'}</T>
          {refusal.instruction ? <T v="faint">Instruction: {refusal.instruction}</T> : null}
        </Card>
        {(clinic?.turns ?? []).map((tn, i) => (
          <View key={i} style={{ alignSelf: tn.role === 'user' ? 'flex-end' : 'stretch', maxWidth: tn.role === 'user' ? '85%' : undefined, gap: 8 }}>
            <View style={{ backgroundColor: tn.role === 'user' ? t.accent : t.surface, borderRadius: radius.lg, padding: 12 }}>
              <T style={{ color: tn.role === 'user' ? t.accentText : t.text }} selectable>{tn.text || '…'}</T>
            </View>
            {tn.edits.map((e, j) => (
              <Card key={j} style={{ gap: 6 }}>
                <Row between>
                  <T v="label">{CLINIC_TARGET_INFO[e.target].label}</T>
                  <T v="faint">{CLINIC_TARGET_INFO[e.target].where}</T>
                </Row>
                {e.why ? <T v="dim">{e.why}</T> : null}
                <T v="mono" numberOfLines={10} selectable>{e.text}</T>
                <Button small kind={tn.applied.includes(j) ? 'ghost' : 'outline'} icon={tn.applied.includes(j) ? 'checkmark' : 'download-outline'} title={tn.applied.includes(j) ? 'Applied' : 'Apply'} onPress={() => apply(i, j)} disabled={tn.applied.includes(j) || applying} />
              </Card>
            ))}
          </View>
        ))}
        {clinic?.pending != null ? <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, padding: 12 }}><T>{clinic.pending || `${shortModel(editorModel)} is reading…`}</T></View> : null}
        {clinic?.error && !clinic.busy ? <Button small kind="outline" icon="refresh-outline" title="Ask again" onPress={() => { void s.clinicRetry(); }} /> : null}
        {direction ? <Card><T v="label">Direction for the retry</T><T v="dim">{direction}</T><Button small kind="ghost" title="Drop it" onPress={() => setDirection(null)} /></Card> : null}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, padding: space.md, paddingBottom: Platform.OS === 'ios' ? space.xl : space.md, gap: space.sm }}>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip small label={`Retry${direction ? ' with direction' : ''}`} selected onPress={() => retry()} />
          <Chip small label="Retry on another model" onPress={() => setPickerOpen(true)} />
          <Chip small label="Back to the story" onPress={() => router.back()} />
        </Row>
        <Row style={{ alignItems: 'flex-end' }}>
          <Field value={text} onChangeText={setText} placeholder="Push back, add context, or ask for a different angle…" multiline style={{ flex: 1, maxHeight: 120 }} />
          <IconButton name="arrow-up-circle" size={30} color={text.trim() && !clinic?.busy ? t.accent : t.faint} onPress={send} disabled={!text.trim() || !!clinic?.busy} />
        </Row>
      </View>
      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(m) => { void retry(m); }} current={refusal.model} title="Retry on" />
    </KeyboardShift>
  );
}
