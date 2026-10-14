import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { FieldDef } from '@/core/world/schema';
import type { WorldCalendar } from '@/core/world/types';
import { formatTime, fromParts, toParts } from '@/core/world/calendar';
import { Chip, Field, Row, Stepper, T } from './index';
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

/** Edits the fields a schema lists, on a plain data object. Empty fields stay out of the prompt. */
export function FieldEditor({ defs, data, onChange, refs = {}, play = true }: { defs: FieldDef[]; data: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; refs?: RefOptions; play?: boolean }) {
  return (
    <View style={{ gap: 14 }}>
      {defs.filter((d) => play || !d.play).map((d) => {
        const v = data[d.key];
        if (d.type === 'select') {
          return (
            <View key={d.key} style={{ gap: 6 }}>
              <T v="label">{d.label}</T>
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
              <T v="label">{d.label}</T>
              {opts.length ? <RefChips value={typeof v === 'string' ? v : null} options={opts} onChange={(id) => onChange({ [d.key]: id })} /> : <T v="faint">Nothing to pick yet in this world.</T>}
            </View>
          );
        }
        if (d.type === 'number') {
          return <Field key={d.key} label={d.label} hint={d.hint} keyboardType="numeric" value={v == null || v === '' ? '' : String(v)} onChangeText={(x) => onChange({ [d.key]: x.trim() === '' ? '' : Number(x.replace(/[^0-9.-]/g, '')) || 0 })} />;
        }
        const long = d.type === 'long' || d.type === 'lines';
        return <Field key={d.key} label={d.label} hint={d.hint} multiline={long} value={typeof v === 'string' ? v : v == null ? '' : String(v)} onChangeText={(x) => onChange({ [d.key]: x })} style={long ? { minHeight: d.type === 'lines' ? 80 : 96 } : undefined} />;
      })}
    </View>
  );
}

/** Edit an in-world time in the world's own reckoning. */
export function TimeEditor({ calendar, value, onChange, label = 'When' }: { calendar?: WorldCalendar; value: number; onChange: (minutes: number) => void; label?: string }) {
  const parts = toParts(calendar, value);
  const [date, setDate] = useState<string | null>(null);
  const greg = (calendar?.kind ?? 'gregorian') === 'gregorian';
  const hpd = Math.max(1, calendar?.hoursPerDay || 24);
  return (
    <View style={{ gap: 8 }}>
      <T v="label">{label}</T>
      <Row style={{ flexWrap: 'wrap' }}>
        {greg ? (
          <Field value={date ?? parts.date} onChangeText={setDate} onBlur={() => { if (date != null) onChange(fromParts(calendar, { ...parts, date })); setDate(null); }} placeholder="YYYY-MM-DD" style={{ minWidth: 130 }} keyboardType="numbers-and-punctuation" />
        ) : (
          <Row><T v="dim">Day</T><Stepper value={parts.day} min={1} max={100000} onChange={(d) => onChange(fromParts(calendar, { ...parts, day: d }))} /></Row>
        )}
        <Row><T v="dim">Hour</T><Stepper value={parts.hour} min={0} max={hpd - 1} onChange={(h) => onChange(fromParts(calendar, { ...parts, hour: h }))} /></Row>
        <Row><T v="dim">Min</T><Stepper value={parts.minute} min={0} max={55} step={5} onChange={(m) => onChange(fromParts(calendar, { ...parts, minute: m }))} /></Row>
      </Row>
      <T v="faint">{formatTime(calendar, value)}</T>
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
