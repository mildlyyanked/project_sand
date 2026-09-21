// Dynamic config so CI can stamp version and versionCode without editing files.
const version = process.env.APP_VERSION || '1.0.0';
const versionCode = Number(process.env.ANDROID_VERSION_CODE || 1);

module.exports = {
  expo: {
    name: 'Sand',
    slug: 'sand',
    version,
    scheme: 'sand',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: { supportsTablet: true },
    android: {
      package: 'io.milesware.sand',
      versionCode,
      adaptiveIcon: {
        backgroundColor: '#0E0F12',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: { favicon: './assets/favicon.png' },
    plugins: ['expo-router', 'expo-sqlite', 'expo-secure-store', 'expo-system-ui'],
    experiments: { typedRoutes: true },
  },
};
