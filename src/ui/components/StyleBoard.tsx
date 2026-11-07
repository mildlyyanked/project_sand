import React from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import type { Library, LibKind } from '@/core/world/drafts';
import { BIBLE_FIELDS, type ArtBible } from '@/core/world/schema';
import { imageOf } from '@/core/world/portraits';
import { Ionicons, T } from './index';
import { openEntry } from './Entry';
import { radius, serif, space, useTheme } from '../theme';

interface Pic { id: string; kind: LibKind; name: string; uri: string }

/** Every picture in a world, by kind. */
function picturesOf(lib: Library | null): Record<'portraits' | 'places' | 'things' | 'sigils', Pic[]> {
  const out = { portraits: [] as Pic[], places: [] as Pic[], things: [] as Pic[], sigils: [] as Pic[] };
  if (!lib) return out;
  const add = (k: keyof typeof out, id: string, kind: LibKind, name: string, data: Record<string, unknown> | undefined) => { const i = imageOf(data); if (i) out[k].push({ id, kind, name, uri: i.uri }); };
  for (const c of lib.characters) add('portraits', c.id, 'character', c.name, c.data as Record<string, unknown>);
  for (const s of lib.species) add('portraits', s.id, 'species', s.name, s.data);
  for (const e of lib.entities) add(e.kind === 'location' ? 'places' : e.kind === 'organization' ? 'sigils' : 'things', e.id, e.kind, e.name, e.data);
  return out;
}

const line = (b: ArtBible, k: keyof ArtBible) => b[k]?.trim() ?? '';

/**
 * A world's style bible as a mood board: the pictures it has made, gathered
 * the way the bible frames them. The look heads it as a quote over a collage
 * of everything; then portraits as a gallery, places as wide views, things
 * as studies and sigils as a row of seals, each under its line of the bible.
 * Every picture opens its entry.
 */
export function StyleBoard({ bible, lib }: { bible: ArtBible; lib: Library | null }) {
  const t = useTheme();
  const p = picturesOf(lib);
  const all = [...p.places, ...p.portraits, ...p.things, ...p.sigils];
  const hero = p.places[0] ?? p.portraits[0] ?? all[0];
  const mosaic = all.filter((x) => x !== hero).slice(0, 6);
  const any = BIBLE_FIELDS.some((f) => line(bible, f.key));
  const caption = (k: keyof ArtBible) => (line(bible, k) ? <T v="dim" style={{ fontStyle: 'italic' }}>{line(bible, k)}</T> : null);
  const open = (x: Pic) => () => openEntry(x.kind, x.id);

  if (!all.length && !any) return <T v="faint">No style bible yet, and no pictures: pictures use the app’s bible. Tap the pencil to write one, or have the helper write it.</T>;

  return (
    <View style={{ gap: space.lg }}>
      {line(bible, 'look') ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: t.accent }} />
          <T style={{ flex: 1, fontFamily: serif, fontSize: 17, lineHeight: 25, fontStyle: 'italic' }}>{line(bible, 'look')}</T>
        </View>
      ) : null}

      {hero ? (
        <View style={{ gap: 4 }}>
          <Pressable onPress={open(hero)} style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
            <Image source={{ uri: hero.uri }} resizeMode="cover" style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: t.surface2 }} />
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.45)' }}>
              <T style={{ color: '#fff' }} numberOfLines={1}>{hero.name}</T>
            </View>
          </Pressable>
          {mosaic.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {mosaic.map((x) => (
                <Pressable key={x.id} onPress={open(x)} style={{ width: '32.6%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden' }}>
                  <Image source={{ uri: x.uri }} resizeMode="cover" style={{ width: '100%', height: '100%', backgroundColor: t.surface2 }} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {p.portraits.length || line(bible, 'portraits') ? (
        <View style={{ gap: 8 }}>
          <Head icon="person-outline" label="Portraits" n={p.portraits.length} />
          {caption('portraits')}
          {p.portraits.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {p.portraits.map((x) => (
                <Pressable key={x.id} onPress={open(x)} style={{ width: 108, gap: 4 }}>
                  <Image source={{ uri: x.uri }} resizeMode="cover" style={{ width: 108, height: 144, borderRadius: radius.md, backgroundColor: t.surface2 }} />
                  <T v="small" numberOfLines={1}>{x.name}</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : <Empty what="portraits" />}
        </View>
      ) : null}

      {p.places.length || line(bible, 'places') ? (
        <View style={{ gap: 8 }}>
          <Head icon="image-outline" label="Places" n={p.places.length} />
          {caption('places')}
          {p.places.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {p.places.map((x) => (
                <Pressable key={x.id} onPress={open(x)} style={{ width: 230, gap: 4 }}>
                  <Image source={{ uri: x.uri }} resizeMode="cover" style={{ width: 230, height: 144, borderRadius: radius.md, backgroundColor: t.surface2 }} />
                  <T v="small" numberOfLines={1}>{x.name}</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : <Empty what="views of places" />}
        </View>
      ) : null}

      {p.things.length || line(bible, 'things') ? (
        <View style={{ gap: 8 }}>
          <Head icon="cube-outline" label="Things" n={p.things.length} />
          {caption('things')}
          {p.things.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {p.things.map((x) => (
                <Pressable key={x.id} onPress={open(x)} style={{ width: 92, gap: 4 }}>
                  <Image source={{ uri: x.uri }} resizeMode="cover" style={{ width: 92, height: 92, borderRadius: radius.sm, backgroundColor: t.surface2 }} />
                  <T v="small" numberOfLines={1}>{x.name}</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : <Empty what="pictures of things" />}
        </View>
      ) : null}

      {p.sigils.length || line(bible, 'sigils') ? (
        <View style={{ gap: 8 }}>
          <Head icon="flag-outline" label="Sigils" n={p.sigils.length} />
          {caption('sigils')}
          {p.sigils.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 14, borderRadius: radius.lg, backgroundColor: t.surface2 }}>
              {p.sigils.map((x) => (
                <Pressable key={x.id} onPress={open(x)} style={{ alignItems: 'center', gap: 4, width: 72 }}>
                  <Image source={{ uri: x.uri }} resizeMode="cover" style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: t.border, backgroundColor: t.surface }} />
                  <T v="small" numberOfLines={1}>{x.name}</T>
                </Pressable>
              ))}
            </View>
          ) : <Empty what="sigils" />}
        </View>
      ) : null}
    </View>
  );
}

function Head({ icon, label, n }: { icon: 'person-outline' | 'image-outline' | 'cube-outline' | 'flag-outline'; label: string; n: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Ionicons name={icon} size={14} color={t.dim} />
      <T v="small" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}{n ? ` · ${n}` : ''}</T>
    </View>
  );
}

function Empty({ what }: { what: string }) {
  return <T v="faint">No {what} yet. Paint one from its page, or try the bible on an entry while editing the world.</T>;
}
