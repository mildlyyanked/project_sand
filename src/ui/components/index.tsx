import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, serif, space, useTheme, mono } from '../theme';
import { KeyboardScroll } from '../keyboard';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, style, edges, scroll, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom' | 'left' | 'right')[]; scroll?: boolean; padded?: boolean }) {
  const t = useTheme();
  const inner = scroll ? (
    <KeyboardScroll contentContainerStyle={[padded && { padding: space.lg, paddingBottom: space.xxl * 2 }, style]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      {children}
    </KeyboardScroll>
  ) : (
    <View style={[{ flex: 1 }, padded && { padding: space.lg }, style]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges ?? ['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.bg }}>
      {inner}
    </SafeAreaView>
  );
}

export function T({ v = 'body', style, children, ...rest }: { v?: 'title' | 'h' | 'body' | 'dim' | 'faint' | 'small' | 'serif' | 'mono' | 'label' } & React.ComponentProps<typeof Text>) {
  const t = useTheme();
  const styles: Record<string, TextStyle> = {
    title: { fontSize: 26, fontWeight: '700', color: t.text, letterSpacing: -0.3 },
    h: { fontSize: 17, fontWeight: '600', color: t.text },
    body: { fontSize: 15, color: t.text, lineHeight: 21 },
    dim: { fontSize: 14, color: t.dim, lineHeight: 20 },
    faint: { fontSize: 13, color: t.faint, lineHeight: 18 },
    small: { fontSize: 12, color: t.dim },
    serif: { fontSize: 17, fontFamily: serif, color: t.text, lineHeight: 27 },
    mono: { fontSize: 13, fontFamily: mono, color: t.text, lineHeight: 19 },
    label: { fontSize: 12, color: t.dim, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '600' },
  };
  const s = styles[v];
  return (
    <Text style={[s, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Button({ title, onPress, kind = 'primary', icon, disabled, loading, style, small }: { title: string; onPress?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'outline'; icon?: IoniconName; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : 'transparent';
  const fg = kind === 'primary' ? t.accentText : kind === 'danger' ? '#fff' : kind === 'outline' ? t.text : t.accent;
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [{ backgroundColor: bg, borderRadius: radius.md, paddingVertical: small ? 8 : 12, paddingHorizontal: small ? 12 : 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled ? 0.45 : pressed ? 0.75 : 1, borderWidth: kind === 'outline' ? 1 : 0, borderColor: t.border }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 15 }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ name, onPress, color, size = 22, style, disabled, badge }: { name: IoniconName; onPress?: () => void; color?: string; size?: number; style?: StyleProp<ViewStyle>; disabled?: boolean; badge?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => [{ padding: 8, borderRadius: radius.pill, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }, style]}>
      <Ionicons name={name} size={size} color={color ?? t.text} />
      {badge ? <View style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent }} /> : null}
    </Pressable>
  );
}

export function Field({ label, hint, style, multiline, ...rest }: { label?: string; hint?: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T v="label">{label}</T> : null}
      <TextInput
        placeholderTextColor={t.faint}
        multiline={multiline}
        style={[{ backgroundColor: t.surface, color: t.text, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, borderWidth: 1, borderColor: t.border, minHeight: multiline ? 88 : undefined, textAlignVertical: multiline ? 'top' : 'center' }, style]}
        {...rest}
      />
      {hint ? <T v="faint">{hint}</T> : null}
    </View>
  );
}

export function Card({ children, style, onPress, onLongPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; onLongPress?: () => void }) {
  const t = useTheme();
  const s = [{ backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: t.border }, style];
  if (onPress || onLongPress) return <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={({ pressed }) => [s, { opacity: pressed ? 0.8 : 1 }]}>{children}</Pressable>;
  return <View style={s}>{children}</View>;
}

export function Row({ children, style, gap = space.sm, between }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; between?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, justifyContent: between ? 'space-between' : undefined }, style]}>{children}</View>;
}

export function ListItem({ title, subtitle, right, onPress, onLongPress, icon, chevron = true }: { title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; onLongPress?: () => void; icon?: IoniconName; chevron?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, opacity: pressed ? 0.7 : 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border })}>
      {icon ? <Ionicons name={icon} size={20} color={t.dim} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T numberOfLines={1}>{title}</T>
        {subtitle ? <T v="faint" numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {right}
      {chevron && onPress ? <Ionicons name="chevron-forward" size={16} color={t.faint} /> : null}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, color, small }: { label: string; selected?: boolean; onPress?: () => void; color?: string; small?: boolean }) {
  const t = useTheme();
  const c = color ?? t.accent;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ paddingVertical: small ? 4 : 7, paddingHorizontal: small ? 9 : 12, borderRadius: radius.pill, backgroundColor: selected ? c : t.surface2, borderWidth: 1, borderColor: selected ? c : t.border, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color: selected ? t.accentText : t.text, fontSize: small ? 12 : 13, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'dim' }: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'dim' | 'info' | 'accent' }) {
  const t = useTheme();
  const c = { ok: t.ok, warn: t.warn, danger: t.danger, dim: t.faint, info: t.info, accent: t.accent }[tone];
  return (
    <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: c }}>
      <Text style={{ color: c, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.md, padding: 3 }}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={{ flex: 1, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: value === o.key ? t.surface : 'transparent', alignItems: 'center' }}>
          <Text style={{ color: value === o.key ? t.text : t.dim, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Row between style={{ paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T>{label}</T>
        {hint ? <T v="faint">{hint}</T> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: t.accent, false: t.border }} thumbColor={Platform.OS === 'android' ? (value ? t.accentText : t.dim) : undefined} />
    </Row>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ gap: 10, marginBottom: space.xl }}>
      <Row between>
        <T v="label">{title}</T>
        {right}
      </Row>
      {children}
    </View>
  );
}

export function Sheet({ open, onClose, title, children, full }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; full?: boolean }) {
  const t = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: full ? '92%' : '80%' }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.border, marginTop: 8 }} />
          {title ? (
            <T v="h" style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
              {title}
            </T>
          ) : null}
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function MenuItem({ label, icon, onPress, danger, hint }: { label: string; icon?: IoniconName; onPress: () => void; danger?: boolean; hint?: string }) {
  const t = useTheme();
  const c = danger ? t.danger : t.text;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, opacity: pressed ? 0.6 : 1 })}>
      {icon ? <Ionicons name={icon} size={20} color={c} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: c, fontSize: 16 }}>{label}</Text>
        {hint ? <T v="faint">{hint}</T> : null}
      </View>
    </Pressable>
  );
}

export function Empty({ icon, title, hint, action }: { icon: IoniconName; title: string; hint?: string; action?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: 10, flex: 1 }}>
      <Ionicons name={icon} size={40} color={t.faint} />
      <T v="h" style={{ textAlign: 'center' }}>{title}</T>
      {hint ? <T v="dim" style={{ textAlign: 'center' }}>{hint}</T> : null}
      {action}
    </View>
  );
}

export function Banner({ text, tone = 'danger', onClose }: { text: string; tone?: 'danger' | 'warn' | 'info' | 'ok'; onClose?: () => void }) {
  const t = useTheme();
  const c = { danger: t.danger, warn: t.warn, info: t.info, ok: t.ok }[tone];
  return (
    <Row style={{ backgroundColor: t.surface2, borderLeftWidth: 3, borderLeftColor: c, padding: 12, borderRadius: radius.sm }}>
      <T style={{ flex: 1 }}>{text}</T>
      {onClose ? <IconButton name="close" size={16} onPress={onClose} /> : null}
    </Row>
  );
}

export function Stepper({ value, onChange, min = 0, max = 10, step = 1, format }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  const t = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <Row gap={0} style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.md, overflow: 'hidden' }}>
      <Pressable onPress={() => onChange(clamp(value - step))} style={{ padding: 10 }}><Ionicons name="remove" size={18} color={t.text} /></Pressable>
      <Text style={{ color: t.text, minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{format ? format(value) : String(value)}</Text>
      <Pressable onPress={() => onChange(clamp(value + step))} style={{ padding: 10 }}><Ionicons name="add" size={18} color={t.text} /></Pressable>
    </Row>
  );
}

export function Pill({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> } & Pick<PressableProps, 'hitSlop'>) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: t.surface2, opacity: pressed ? 0.7 : 1 }, style]}>
      {children}
    </Pressable>
  );
}

export { Ionicons };
