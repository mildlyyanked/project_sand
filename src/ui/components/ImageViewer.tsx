import React from 'react';
import { Image, Modal, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { IconButton, T } from './index';

const MAX = 6;

/**
 * A picture full screen: pinch to zoom where your fingers are, drag to look
 * around, double tap to zoom in or back out, swipe down (at full view) or
 * tap to close.
 */
export function ImageViewer({ uri, caption, open, onClose }: { uri: string | null | undefined; caption?: string; open: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const k = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const k0 = useSharedValue(1);
  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const fade = useSharedValue(1);

  const reset = () => { k.value = 1; x.value = 0; y.value = 0; fade.value = 1; };
  const close = () => { reset(); onClose(); };

  /** Keep the picture covering what it can: no dragging it off into the dark. */
  const clamp = (s: number) => {
    'worklet';
    const mx = (width * (s - 1)) / 2;
    const my = (height * 0.8 * (s - 1)) / 2;
    x.value = withTiming(Math.min(mx, Math.max(-mx, x.value)), { duration: 160 });
    y.value = withTiming(Math.min(my, Math.max(-my, y.value)), { duration: 160 });
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => { k0.value = k.value; x0.value = x.value; y0.value = y.value; fx.value = e.focalX - width / 2; fy.value = e.focalY - height / 2; })
    .onUpdate((e) => {
      const s = Math.min(MAX, Math.max(0.8, k0.value * e.scale));
      const f = s / k0.value;
      // The point under the fingers stays under them.
      x.value = fx.value - (fx.value - x0.value) * f + (e.focalX - width / 2 - fx.value);
      y.value = fy.value - (fy.value - y0.value) * f + (e.focalY - height / 2 - fy.value);
      k.value = s;
    })
    .onEnd(() => {
      if (k.value < 1) { k.value = withTiming(1); x.value = withTiming(0); y.value = withTiming(0); return; }
      clamp(k.value);
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => { x0.value = x.value; y0.value = y.value; })
    .onUpdate((e) => {
      x.value = x0.value + e.translationX;
      y.value = y0.value + e.translationY;
      if (k.value <= 1.01) { x.value = x0.value + e.translationX * 0.3; fade.value = Math.max(0.3, 1 - Math.abs(e.translationY) / 500); }
    })
    .onEnd((e) => {
      if (k.value <= 1.01) {
        if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 900) { runOnJS(close)(); return; }
        x.value = withTiming(0); y.value = withTiming(0); fade.value = withTiming(1);
        return;
      }
      clamp(k.value);
    });

  const double = Gesture.Tap().numberOfTaps(2).onEnd((e) => {
    if (k.value > 1.2) { k.value = withTiming(1); x.value = withTiming(0); y.value = withTiming(0); return; }
    const s = 2.5;
    const px = e.x - width / 2; const py = e.y - height / 2;
    k.value = withTiming(s); x.value = withTiming(-px * (s - 1)); y.value = withTiming(-py * (s - 1));
  });
  const single = Gesture.Tap().onEnd(() => { if (k.value <= 1.01) runOnJS(close)(); });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: k.value }] }));
  const back = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Modal visible={open && !!uri} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.94)' }, back]} />
        <GestureDetector gesture={Gesture.Race(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(double, single))}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
            <Animated.View style={[{ width, height: height * 0.8 }, style]}>
              {uri ? <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} /> : null}
            </Animated.View>
          </View>
        </GestureDetector>
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 36, right: 12 }}>
          <IconButton name="close" color="#fff" onPress={close} />
        </View>
        {caption ? <T v="faint" style={{ position: 'absolute', bottom: 28, alignSelf: 'center', color: '#bbb' }} pointerEvents="none">{caption}</T> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
