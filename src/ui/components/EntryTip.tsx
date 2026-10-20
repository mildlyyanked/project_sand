import React from 'react';
import { Dimensions, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { EntryTip as Tip } from '@/core/world/mentions';
import { Avatar } from './EntryImage';
import { Ionicons, Row, T } from './index';
import { radius, space, useTheme } from '@/ui/theme';

/**
 * The quick card for a library entry named in a passage: shown beside the
 * tapped name, above it when the name sits low on the screen. Tap outside to
 * close; the footer opens the entry or the passage's Lens.
 */
export function EntryTipCard({ tip, data, at, onClose, onOpen, onLens }: {
  tip: Tip | null;
  data?: Record<string, unknown> | null;
  /** Where the name was tapped, in window coordinates. */
  at: { y: number } | null;
  onClose(): void;
  onOpen(): void;
  onLens?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!tip || !at) return null;
  const h = Dimensions.get('window').height;
  const below = at.y < h * 0.55;
  const place = below ? { top: Math.max(insets.top + 8, at.y + 18) } : { bottom: Math.max(insets.bottom + 8, h - at.y + 18) };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1 }}>
        <Pressable onPress={() => undefined} style={{ position: 'absolute', left: space.lg, right: space.lg, ...place, maxWidth: 460, alignSelf: 'center', backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
          <Row gap={10} style={{ alignItems: 'center' }}>
            <Avatar data={data} name={tip.name} size={40} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '600' }} numberOfLines={1}>{tip.name}</T>
              <T v="small" numberOfLines={1}>{tip.kind}</T>
            </View>
          </Row>
          {tip.text ? <T v="dim">{tip.text}</T> : null}
          {tip.facts.map((f) => <T key={f.label} v="small"><T v="small" style={{ color: t.faint }}>{f.label}: </T>{f.value}</T>)}
          {tip.yours.map((y) => <T key={y} v="small" style={{ color: t.accent }}>{y}</T>)}
          <Row gap={16} style={{ marginTop: 2 }}>
            <Pressable onPress={onOpen} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="open-outline" size={14} color={t.accent} />
              <T v="small" style={{ color: t.accent }}>Open entry</T>
            </Pressable>
            {onLens ? (
              <Pressable onPress={onLens} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="scan-outline" size={14} color={t.accent} />
                <T v="small" style={{ color: t.accent }}>Lens</T>
              </Pressable>
            ) : null}
          </Row>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
