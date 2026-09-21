#!/usr/bin/env node
/**
 * Point the release build type at a real keystore.
 *
 * `expo prebuild` generates android/app/build.gradle with release signed by the
 * debug keystore. This adds a `release` signingConfig that reads from Gradle
 * properties (SAND_STORE_FILE, SAND_STORE_PASSWORD, SAND_KEY_ALIAS,
 * SAND_KEY_PASSWORD) and switches the release build type to it.
 *
 * Usage: node scripts/android-signing.js [path/to/android/app/build.gradle]
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let src = fs.readFileSync(file, 'utf8');

if (src.includes('signingConfigs.release')) {
  console.log('already patched:', file);
  process.exit(0);
}

const releaseConfig = `        release {
            storeFile file(findProperty('SAND_STORE_FILE') ?: 'release.keystore')
            storePassword findProperty('SAND_STORE_PASSWORD')
            keyAlias findProperty('SAND_KEY_ALIAS')
            keyPassword findProperty('SAND_KEY_PASSWORD')
        }
`;

// 1. Add the release signing config right after the debug one.
const debugBlock = /(    signingConfigs \{\n        debug \{[\s\S]*?\n        \}\n)/;
if (!debugBlock.test(src)) throw new Error('debug signingConfig block not found in ' + file);
src = src.replace(debugBlock, `$1${releaseConfig}`);

// 2. Switch the release build type to it.
const releaseType = /(    buildTypes \{[\s\S]*?\n        release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
if (!releaseType.test(src)) throw new Error('release buildType signingConfig not found in ' + file);
src = src.replace(releaseType, '$1signingConfig signingConfigs.release');

fs.writeFileSync(file, src);
console.log('patched:', file);
