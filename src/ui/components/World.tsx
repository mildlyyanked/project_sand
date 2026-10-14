import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { FieldDef } from '@/core/world/schema';
import type { WorldCalendar } from '@/core/world/types';
import { formatDuration, formatTime, fromParts, parseDuration, toParts } from '@/core/world/calendar';
import { Chip, Field, FieldLabel, Row, SwitchRow, T } from './index';
import { radius, useTheme } from '../theme';

export interface RefOption { id: string; name: string; depth?: number }
export type RefOptions = Partial<Record<NonNullable<FieldDef['ref']>, RefOption[]>>;

/** Chips that scroll sideways: None plus every option. */
export function RefChips({ value, options, onChange, none = 'None' }: { value: string | null | undefined; options: RefOption[]; onChange: (id: string | null) => void; none?: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
      <Chip small label={none} selected={!value} onPress={() => onChange(null)} />
      {options.map((o) => <Chip key={o.id} small label={`${o.depth ? '› '.repeat(o.depth) : ''}${o.name}`} selected={value === o.id} onPress={() => onChange(o.id)} />)}
    </ScrollView>
  );
}

/** Comma-separated keywords. Keeps the text as typed (trailing commas and all) while it has focus. */
export function KeysField({ value, onChange, label, hint, onForge }: { value: string[]; onChange: (keys: string[]) => void; label?: string; hint?: string; onForge?: () => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Field
      label={label}
      hint={hint}
      onForge={onForge}
      autoCapitalize="none"
      value={text ?? value.join(', ')}
      onChangeText={(x) => { setText(x); onChange(x.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)); }}
      onBlur={() => setText(null)}
    />
  );
}

/** Edits the fields a schema lists, on a plain data object. Empty fields stay out of the prompt. */
export function FieldEditor({ defs, data, onChange, refs = {}, play = true, onForge }: { defs: FieldDef[]; data: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; refs?: RefOptions; play?: boolean; onForge?: (def: FieldDef) => void }) {
  return (
    <View style={{ gap: 14 }}>
      {defs.filter((d) => play || !d.play).map((d) => {
        const v = data[d.key];
        const forge = onForge ? () => onForge(d) : undefined;
        if (d.type === 'bool') return <SwitchRow key={d.key} label={d.label} hint={d.hint} value={v === true} onChange={(x) => onChange({ [d.key]: x })} />;
        if (d.type === 'select') {
          return (
            <View key={d.key} style={{ gap: 6 }}>
              <FieldLabel label={d.label} onForge={forge} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {(d.options ?? []).map((o) => <Chip key={o} small label={o} selected={v === o} onPress={() => onChange({ [d.key]: v === o ? '' : o })} />)}
              </ScrollView>
            </View>
          );
        }
        if (d.type === 'ref') {
          const opts = d.ref ? refs[d.ref] ?? [] : [];
          return (
            <View key={d.key} style={{ gap: 6 }}>
              <FieldLabel label={d.label} onForge={forge} />
              {opts.length ? <RefChips value={typeof v === 'string' ? v : null} options={opts} onChange={(id) => onChange({ [d.key]: id })} /> : <T v="faint">Nothing to pick yet in this world.</T>}
            </View>
          );
        }
        if (d.type === 'number') {
          return <Field key={d.key} label={d.label} hint={d.hint} onForge={forge} keyboardType="numeric" value={v == null || v === '' ? '' : String(v)} onChangeText={(x) => onChange({ [d.key]: x.trim() === '' ? '' : Number(x.replace(/[^0-9.-]/g, '')) || 0 })} />;
        }
        if (d.type === 'keys') return <KeysField key={d.key} label={d.label} hint={d.hint} onForge={forge} value={Array.isArray(v) ? (v as string[]) : []} onChange={(keys) => onChange({ [d.key]: keys })} />;
        const long = d.type === 'long' || d.type === 'lines';
        return <Field key={d.key} label={d.label} hint={d.hint} onForge={forge} multiline={long} value={typeof v === 'string' ? v : v == null ? '' : String(v)} onChangeText={(x) => onChange({ [d.key]: x })} style={long ? { minHeight: d.type === 'lines' ? 80 : 96 } : undefined} />;
      })}
    </View>
  );
}

const SHIFTS: { label: string; minutes: number }[] = [
  { label: '−1 day', minutes: -1440 }, { label: '−1 h', minutes: -60 }, { label: '+15 min', minutes: 15 }, { label: '+1 h', minutes: 60 },
  { label: '+6 h', minutes: 360 }, { label: '+1 day', minutes: 1440 }, { label: '+1 week', minutes: 10080 },
];

/** A number typed in place; committed on blur or done. */
function NumberBox({ value, onCommit, width = 72, placeholder }: { value: number | string; onCommit: (text: string) => void; width?: number; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Field
      value={text ?? String(value)}
      onChangeText={setText}
      onFocus={() => setText(String(value))}
      onBlur={() => { if (text != null) onCommit(text); setText(null); }}
      onSubmitEditing={() => { if (text != null) onCommit(text); setText(null); }}
      keyboardType="numbers-and-punctuation"
      placeholder={placeholder}
      selectTextOnFocus
      style={{ width, textAlign: 'center' }}
    />
  );
}

/**
 * Edit an in-world time in the world's own reckoning: the date and the time
 * typed directly, quick shifts, and a skip by any duration ("3 days 4 hours").
 */
export function TimeEditor({ calendar, value, onChange, label = 'When' }: { calendar?: WorldCalendar; value: number; onChange: (minutes: number) => void; label?: string }) {
  const parts = toParts(calendar, value);
  const greg = (calendar?.kind ?? 'gregorian') === 'gregorian';
  const hpd = Math.max(1, calendar?.hoursPerDay || 24);
  const dpy = !greg && calendar?.daysPerYear ? calendar.daysPerYear : 0;
  const startYear = calendar?.startYear ?? 1;
  const [skip, setSkip] = useState('');
  const set = (p: Partial<typeof parts>) => onChange(fromParts(calendar, { ...parts, ...p }));
  const setTime = (text: string) => {
    const m = /^\s*(\d{1,2})(?:[:.h ]\s*(\d{1,2}))?\s*$/i.exec(text);
    if (!m) return;
    set({ hour: Math.min(hpd - 1, Number(m[1])), minute: Math.min(59, Number(m[2] ?? 0)) });
  };
  const year = dpy ? startYear + Math.floor((parts.day - 1) / dpy) : 0;
  const dayOfYear = dpy ? ((parts.day - 1) % dpy) + 1 : parts.day;
  const skipMinutes = parseDuration(skip);
  const shift = (m: number) => onChange(Math.max(0, value + m));
  return (
    <View style={{ gap: 8 }}>
      <T v="label">{label}</T>
      <Row style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {greg ? (
          <View style={{ gap: 4 }}><T v="small">Date</T><NumberBox value={parts.date} width={130} placeholder="YYYY-MM-DD" onCommit={(date) => set({ date: date.trim() })} /></View>
        ) : dpy ? (
          <>
            <View style={{ gap: 4 }}><T v="small">Year</T><NumberBox value={year} onCommit={(x) => { const y = Math.round(Number(x)); if (Number.isFinite(y)) set({ day: Math.max(1, (y - startYear) * dpy + dayOfYear) }); }} /></View>
            <View style={{ gap: 4 }}><T v="small">Day of year</T><NumberBox value={dayOfYear} onCommit={(x) => { const d = Math.round(Number(x)); if (Number.isFinite(d)) set({ day: Math.max(1, (year - startYear) * dpy + Math.min(dpy, Math.max(1, d))) }); }} /></View>
          </>
        ) : (
          <View style={{ gap: 4 }}><T v="small">Day</T><NumberBox value={parts.day} onCommit={(x) => { const d = Math.round(Number(x)); if (Number.isFinite(d)) set({ day: Math.max(1, d) }); }} /></View>
        )}
        <View style={{ gap: 4 }}><T v="small">Time</T><NumberBox value={`${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`} width={84} placeholder="HH:MM" onCommit={setTime} /></View>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {SHIFTS.map((x) => <Chip key={x.label} small label={x.label} onPress={() => shift(x.minutes)} />)}
      </ScrollView>
      <Row>
        <View style={{ flex: 1 }}><Field value={skip} onChangeText={setSkip} placeholder="Skip by, e.g. 3 days 4 hours" /></View>
        <Chip small label="Back" onPress={() => skipMinutes > 0 && shift(-skipMinutes)} />
        <Chip small label="Ahead" onPress={() => skipMinutes > 0 && shift(skipMinutes)} />
      </Row>
      <T v="faint">{formatTime(calendar, value)}{skip.trim() ? (skipMinutes > 0 ? ` · skip ${formatDuration(skipMinutes)}` : ' · say it like “2 hours” or “3 days”') : ''}</T>
    </View>
  );
}

/** A thin labelled bar for a 0–100 resource. */
export function Bar({ label, value, color }: { label: string; value: number; color?: string }) {
  const t = useTheme();
  const c = color ?? (value < 25 ? t.danger : value < 50 ? t.warn : t.ok);
  return (
    <View style={{ flex: 1, gap: 2, minWidth: 44 }}>
      <T v="small" numberOfLines={1}>{label}</T>
      <View style={{ height: 5, borderRadius: radius.pill, backgroundColor: t.surface2, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', backgroundColor: c }} />
      </View>
    </View>
  );
}
