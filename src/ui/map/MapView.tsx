import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDecay, withTiming } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import type { MapDoc, Pt } from '@/core/map/types';
import { THEMES } from '@/core/map/style';
import { MapBase, MapMarks, type Overlay } from './MapCanvas';

export interface MapViewHandle {
  zoomBy(f: number): void;
  fit(): void;
  /** Centre on a map point, at a zoom. */
  focus(p: Pt, zoom?: number): void;
}

/**
 * A map you can move around: drag to pan, pinch to zoom, tap to pick. In
 * edit mode a drag that starts on something the editor wants (a pin, a
 * handle) moves that instead of the map. The base layer is drawn once;
 * pins and labels redraw after a zoom so they stay a readable size.
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
}>(function MapView({ base, doc, typeOf, overlay, onTap, onDragStart, onDrag, onDragEnd, onZoom }, ref) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const k = useSharedValue(1);
  const g = useRef({ k0: 1, tx0: 0, ty0: 0, fx: 0, fy: 0, dragging: false, start: [0, 0] as Pt, pinching: false });
  const t = THEMES[doc.theme] ?? THEMES.fantasy;

  // The map at zoom 1 fills the box's width or height, whichever it meets first.
  const unit = box.w && box.h ? Math.min(box.w / doc.w, box.h / doc.h) : 1;
  const fitW = doc.w * unit;
  const fitH = doc.h * unit;
  const ox = (box.w - fitW) / 2;
  const oy = (box.h - fitH) / 2;
  const MAX = 10;

  const toMap = useCallback((sx: number, sy: number): Pt => [((sx - tx.value - ox) / k.value) / unit, ((sy - ty.value - oy) / k.value) / unit], [ox, oy, unit, tx, ty, k]);
  const tolNow = useCallback(() => 22 / (unit * k.value), [unit, k]);

  /** Keep some of the map on screen however far it is pushed. */
  const clampT = useCallback(() => {
    'worklet';
    const w = fitW * k.value; const h = fitH * k.value;
    const minX = Math.min(0, box.w - w - ox) - box.w * 0.35; const maxX = Math.max(0, -ox) + box.w * 0.35;
    const minY = Math.min(0, box.h - h - oy) - box.h * 0.35; const maxY = Math.max(0, -oy) + box.h * 0.35;
    tx.value = Math.min(maxX, Math.max(minX, tx.value));
    ty.value = Math.min(maxY, Math.max(minY, ty.value));
  }, [fitW, fitH, box.w, box.h, ox, oy, k, tx, ty]);

  const settle = useCallback(() => { const z = k.value; setZoom(z); onZoom?.(z); }, [k, onZoom]);

  const zoomAt = useCallback((sx: number, sy: number, to: number, animate = true) => {
    const nk = Math.min(MAX, Math.max(1, to));
    const f = nk / k.value;
    const nx = sx - ox - (sx - ox - tx.value) * f;
    const ny = sy - oy - (sy - oy - ty.value) * f;
    if (animate) { k.value = withTiming(nk, { duration: 220 }); tx.value = withTiming(nx, { duration: 220 }); ty.value = withTiming(ny, { duration: 220 }); }
    else { k.value = nk; tx.value = nx; ty.value = ny; }
    setZoom(nk); onZoom?.(nk);
  }, [k, tx, ty, ox, oy, onZoom]);

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAt(box.w / 2, box.h / 2, k.value * f),
    fit: () => { k.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0); setZoom(1); onZoom?.(1); },
    focus: (p, z = 3) => {
      const nk = Math.min(MAX, Math.max(1, z));
      k.value = withTiming(nk); tx.value = withTiming(box.w / 2 - ox - p[0] * unit * nk); ty.value = withTiming(box.h / 2 - oy - p[1] * unit * nk);
      setZoom(nk); onZoom?.(nk);
    },
  }), [zoomAt, box.w, box.h, k, tx, ty, ox, oy, unit, onZoom]);

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
      if (k.value < 1) { k.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0); setZoom(1); onZoom?.(1); return; }
      clampT();
      settle();
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
      const w = fitW * k.value; const h = fitH * k.value;
      const minX = Math.min(0, box.w - w - ox) - box.w * 0.35; const maxX = Math.max(0, -ox) + box.w * 0.35;
      const minY = Math.min(0, box.h - h - oy) - box.h * 0.35; const maxY = Math.max(0, -oy) + box.h * 0.35;
      tx.value = withDecay({ velocity: e.velocityX, clamp: [minX, maxX], deceleration: 0.994 });
      ty.value = withDecay({ velocity: e.velocityY, clamp: [minY, maxY], deceleration: 0.994 });
    });

  const tap = Gesture.Tap().runOnJS(true).maxDistance(8).onEnd((e, ok) => { if (ok) onTap?.(toMap(e.x, e.y), tolNow()); });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: k.value }] }));

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
    if (z > 1.05) {
      const ox0 = (width - fw) / 2; const oy0 = (height - fh) / 2;
      k.value = z; tx.value = width / 2 - ox0 - (fw * z) / 2; ty.value = height / 2 - oy0 - (fh * z) / 2;
      setZoom(z); onZoom?.(z);
    }
  };

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, Gesture.Race(pan, tap))}>
      <View style={{ flex: 1, overflow: 'hidden', backgroundColor: t.bg }} onLayout={onLayout} collapsable={false}>
        {box.w ? (
          <Animated.View style={[{ position: 'absolute', left: ox, top: oy, width: fitW, height: fitH, transformOrigin: 'left top' }, style]}>
            <Svg width={fitW} height={fitH} viewBox={`0 0 ${doc.w} ${doc.h}`}>
              <MapBase doc={base} />
              <MapMarks doc={doc} typeOf={typeOf} scale={zoom * unit} overlay={overlay} />
            </Svg>
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
});
