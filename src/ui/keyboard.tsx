import React from 'react';
import { KeyboardAvoidingView as RNKeyboardAvoidingView, Platform, ScrollView, type ScrollViewProps, type ViewStyle, type StyleProp } from 'react-native';
import { KeyboardAvoidingView as KCKeyboardAvoidingView, KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller';

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

export function KeyboardScroll(props: ScrollViewProps & { bottomOffset?: number }) {
  if (Platform.OS === 'web') return <ScrollView {...props} />;
  const { bottomOffset = 24, ...rest } = props;
  return <KeyboardAwareScrollView bottomOffset={bottomOffset} {...rest} />;
}
