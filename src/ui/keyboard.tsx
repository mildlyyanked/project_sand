import React from 'react';
import { KeyboardAvoidingView as RNKeyboardAvoidingView, Platform, ScrollView, type ScrollViewProps, type ViewStyle, type StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView as KCKeyboardAvoidingView, KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller';

/** Height of the native stack header plus the status bar, for keyboard offsets on screens under a header. */
export function useHeaderOffset(): number {
  const insets = useSafeAreaInsets();
  return insets.top + (Platform.OS === 'ios' ? 44 : 56);
}

/**
 * Keyboard handling that works with Android edge-to-edge, where the window no
 * longer resizes for the IME. Native platforms use react-native-keyboard-controller;
 * web falls back to plain views.
 */
export function KeyboardRoot({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

export function KeyboardShift({ children, style, offset = 0 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; offset?: number }) {
  if (Platform.OS === 'web') return <RNKeyboardAvoidingView style={style}>{children}</RNKeyboardAvoidingView>;
  return (
    <KCKeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={style}>
      {children}
    </KCKeyboardAvoidingView>
  );
}

/**
 * A scrolling screen body that both shrinks for the keyboard and scrolls the
 * focused field above it. `headerOffset` is the header height when the screen
 * sits under a native stack header (the default); 0 inside modals.
 */
export function KeyboardScroll(props: ScrollViewProps & { bottomOffset?: number; headerOffset?: number }) {
  const header = useHeaderOffset();
  if (Platform.OS === 'web') return <ScrollView {...props} />;
  const { bottomOffset = 32, headerOffset = header, ...rest } = props;
  return (
    <KCKeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerOffset} style={{ flex: 1 }}>
      <KeyboardAwareScrollView bottomOffset={bottomOffset} {...rest} />
    </KCKeyboardAvoidingView>
  );
}
