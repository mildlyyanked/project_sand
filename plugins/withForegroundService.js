// Declares Notifee's foreground service and the permissions Android 14+ requires
// for a data-sync foreground service, so a generation survives the app being
// backgrounded. See src/state/foreground.ts for the runtime side.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const PERMISSIONS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_DATA_SYNC', 'android.permission.POST_NOTIFICATIONS'];

module.exports = function withForegroundService(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    for (const name of PERMISSIONS) {
      if (!manifest.manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
        manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.service = app.service || [];
    if (!app.service.some((s) => s.$['android:name'] === 'app.notifee.core.ForegroundService')) {
      app.service.push({ $: { 'android:name': 'app.notifee.core.ForegroundService', 'android:foregroundServiceType': 'dataSync', 'android:exported': 'false' } });
    }
    return mod;
  });
};
