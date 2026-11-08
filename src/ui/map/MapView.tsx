import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDecay, withTiming } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import type { MapDoc, Pt } from '@/core/map/types';
import { THEMES, scaleBar } from '@/core/map/style';
import { MapBase, MapMarks, type Overlay } from './MapCanvas';
import { T } from '../components';

export interface MapViewHandle {
  zoomBy(f: number): void;
  fit(): void;
  /** Centre on a map point, at a zoom. */
  focus(p: Pt, zoom?: number): void;
}

const MAX = 32;
/** How much beyond the screen is drawn, each side, so a pan has map to show before the redraw. */
const PAD = 0.2;
const MS = 230;

/**
 * A map you can move around: drag to pan, pinch to zoom, tap to pick. In
 * edit mode a drag that starts on something the editor wants (a pin, a
 * handle) moves that instead of the map.
 *
 * The map is drawn for the part of it on screen, at the screen's own
 * resolution, so it stays sharp however far you zoom. While a finger moves,
 * the last drawing is moved and scaled; when it lets go, the map is drawn
 * again for where it now is.
 */
export const MapView = forwardRef<MapViewHandle, {
  base: MapDoc;
  doc: MapDoc;
  typeOf?: (id: string) => string | undefined;
  overlay?: Overlay;
  onTap?: (p: Pt, tol: number) => void;
  /** Return true to take the drag (it then moves something, not the map). */
  onDragStart?: (p: Pt, tol: number) => boolean;
  onDrag?: (p: Pt, start: Pt) => void;
  onDragEnd?: () => void;
  onZoom?: (zoom: number) => void;
  /** Where the scale bar sits, from the top. */
  barTop?: number;
}>(function MapView({ base, doc, typeOf, overlay, onTap, onDragStart, onDrag, onDragEnd, onZoom, barTop = 12 }, ref) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The view the map was last drawn for.
  const [c, setC] = useState({ k: 1, tx: 0, ty: 0 });
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const k = useSharedValue(1);
  const g = useRef({ k0: 1, tx0: 0, ty0: 0, fx: 0, fy: 0, dragging: false, start: [0, 0] as Pt, pinching: false });
  const t = THEMES[doc.theme] ?? THEMES.fantasy;

  // At zoom 1 the whole map fits the box.
  const unit = box.w && box.h ? Math.min(box.w / doc.w, box.h / doc.h) : 1;
  const fitW = doc.w * unit;
  const fitH = doc.h * unit;
  const ox = (box.w - fitW) / 2;
  const oy = (box.h - fitH) / 2;
  const L = -box.w * PAD;
  const Tp = -box.h * PAD;
  const RW = box.w * (1 + 2 * PAD);
  const RH = box.h * (1 + 2 * PAD);

  const commit = useCallback(() => {
    const z = k.value;
    setC({ k: z, tx: tx.value, ty: ty.value });
    onZoom?.(z);
  }, [k, tx, ty, onZoom]);

  const toMap = useCallback((sx: number, sy: number): Pt => [((sx - tx.value - ox) / k.value) / unit, ((sy - ty.value - oy) / k.value) / unit], [ox, oy, unit, tx, ty, k]);
  const tolNow = useCallback(() => 22 / (unit * k.value), [unit, k]);

  /** How far the map may be pushed: some of it always stays on screen. */
  const bounds = useCallback((z: number) => {
    const w = fitW * z; const h = fitH * z;
    return { minX: Math.min(0, box.w - w - ox) - box.w * 0.35, maxX: Math.max(0, -ox) + box.w * 0.35, minY: Math.min(0, box.h - h - oy) - box.h * 0.35, maxY: Math.max(0, -oy) + box.h * 0.35 };
  }, [fitW, fitH, box.w, box.h, ox, oy]);

  const animateTo = useCallback((z: number, x: number, y: number) => {
    k.value = withTiming(z, { duration: MS });
    tx.value = withTiming(x, { duration: MS });
    ty.value = withTiming(y, { duration: MS }, (done) => {
      'worklet';
      if (done) runOnJS(commit)();
    });
  }, [k, tx, ty, commit]);

  const zoomAt = useCallback((sx: number, sy: number, to: number) => {
    const nk = Math.min(MAX, Math.max(1, to));
    const f = nk / k.value;
    animateTo(nk, sx - ox - (sx - ox - tx.value) * f, sy - oy - (sy - oy - ty.value) * f);
  }, [k, tx, ty, ox, oy, animateTo]);

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAt(box.w / 2, box.h / 2, k.value * f),
    fit: () => animateTo(1, 0, 0),
    focus: (p, z = 3) => {
      const nk = Math.min(MAX, Math.max(1, z));
      animateTo(nk, box.w / 2 - ox - p[0] * unit * nk, box.h / 2 - oy - p[1] * unit * nk);
    },
  }), [zoomAt, animateTo, box.w, box.h, k, ox, oy, unit]);

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart((e) => { g.current = { ...g.current, k0: k.value, tx0: tx.value, ty0: ty.value, fx: e.focalX, fy: e.focalY, pinching: true }; })
    .onUpdate((e) => {
      const s = g.current;
      const nk = Math.min(MAX, Math.max(0.9, s.k0 * e.scale));
      const f = nk / s.k0;
      // The point under the fingers stays under them, and follows them as they move.
      tx.value = e.focalX - ox - (s.fx - ox - s.tx0) * f;
      ty.value = e.focalY - oy - (s.fy - oy - s.ty0) * f;
      k.value = nk;
    })
    .onEnd(() => {
      g.current.pinching = false;
      if (k.value < 1) { animateTo(1, 0, 0); return; }
      const b = bounds(k.value);
      tx.value = Math.min(b.maxX, Math.max(b.minX, tx.value));
      ty.value = Math.min(b.maxY, Math.max(b.minY, ty.value));
      commit();
    });

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(4)
    .averageTouches(true)
    .onStart((e) => {
      const p = toMap(e.x - e.translationX, e.y - e.translationY);
      const take = !g.current.pinching && e.numberOfPointers === 1 && !!onDragStart?.(p, tolNow());
      g.current = { ...g.current, tx0: tx.value, ty0: ty.value, dragging: take, start: p };
    })
    .onUpdate((e) => {
      if (g.current.dragging) { onDrag?.(toMap(e.x, e.y), g.current.start); return; }
      if (g.current.pinching) return;
      tx.value = g.current.tx0 + e.translationX;
      ty.value = g.current.ty0 + e.translationY;
    })
    .onEnd((e) => {
      if (g.current.dragging) { g.current.dragging = false; onDragEnd?.(); return; }
      if (g.current.pinching) return;
      const b = bounds(k.value);
      const fast = Math.hypot(e.velocityX, e.velocityY) > 300;
      if (!fast) { tx.value = Math.min(b.maxX, Math.max(b.minX, tx.value)); ty.value = Math.min(b.maxY, Math.max(b.minY, ty.value)); commit(); return; }
      tx.value = withDecay({ velocity: e.velocityX, clamp: [b.minX, b.maxX], deceleration: 0.992 });
      ty.value = withDecay({ velocity: e.velocityY, clamp: [b.minY, b.maxY], deceleration: 0.992 }, (done) => {
        'worklet';
        if (done) runOnJS(commit)();
      });
    });

  const tap = Gesture.Tap().runOnJS(true).maxDistance(8).onEnd((e, ok) => { if (ok) onTap?.(toMap(e.x, e.y), tolNow()); });

  // The last drawing, moved and scaled to where the map is now.
  const style = useAnimatedStyle(() => {
    const f = k.value / c.k;
    return {
      transform: [
        { translateX: ox + tx.value - f * (ox + c.tx) - L + f * L },
        { translateY: oy + ty.value - f * (oy + c.ty) - Tp + f * Tp },
        { scale: f },
      ],
    };
  }, [c, ox, oy, L, Tp]);

  // First look: on a tall phone the whole map is a thin strip, so open it filling most of the height, centred.
  const opened = useRef(false);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: width, h: height });
    if (opened.current || !width || !height) return;
    opened.current = true;
    const u = Math.min(width / doc.w, height / doc.h);
    const fw = doc.w * u; const fh = doc.h * u;
    const z = Math.min(2.4, Math.max(1, (height * 0.8) / fh));
    const ox0 = (width - fw) / 2; const oy0 = (height - fh) / 2;
    const x = z > 1.05 ? width / 2 - ox0 - (fw * z) / 2 : 0;
    const y = z > 1.05 ? height / 2 - oy0 - (fh * z) / 2 : 0;
    k.value = z; tx.value = x; ty.value = y;
    setC({ k: z, tx: x, ty: y });
    onZoom?.(z);
  };

  // The part of the map drawn, in map units.
  const px = c.k * unit;
  const view = useMemo(() => ({ x: (L - ox - c.tx) / px, y: (Tp - oy - c.ty) / px, w: RW / px, h: RH / px }), [L, Tp, ox, oy, c, px, RW, RH]);
  // What is on screen: labels stay inside it.
  const screen = useMemo(() => ({ x: (-ox - c.tx) / px, y: (-oy - c.ty) / px, w: box.w / px, h: box.h / px }), [ox, oy, c, px, box.w, box.h]);
  const bar = scaleBar(doc.scale, 90 / px);
  const ink = t.glow ? t.coast : t.ink;

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, Gesture.Race(pan, tap))}>
      <View style={{ flex: 1, overflow: 'hidden', backgroundColor: t.bg }} onLayout={onLayout} collapsable={false}>
        {box.w ? (
          <Animated.View style={[{ position: 'absolute', left: L, top: Tp, width: RW, height: RH, transformOrigin: 'left top' }, style]}>
            <Svg width={RW} height={RH} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
              <MapBase doc={base} decor={false} zoom={c.k} px={px} view={view} />
              <MapMarks doc={doc} typeOf={typeOf} scale={px} overlay={overlay} view={screen} />
            </Svg>
          </Animated.View>
        ) : null}
        {box.w ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: barTop, alignSelf: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: t.halo + 'cc' }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <T v="small" style={{ color: ink, fontWeight: '700', fontSize: 11 }}>N↑</T>
              <View style={{ alignItems: 'center' }}>
                <T v="small" style={{ color: ink, fontSize: 11 }}>{bar.label}</T>
                <View style={{ width: bar.units * px, height: 5, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: ink }} />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
});
