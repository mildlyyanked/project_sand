# Release signing key

This keystore signs every APK the release workflow builds, so each build installs over the previous one and keeps the app's data.

It is committed on purpose, by the owner's decision, because this repository is public and GitHub secrets could not be set from the tooling in use. Consequences:

- Anyone can sign an APK that Android treats as an update to Sand. Only install Sand builds from this repository's Releases page.
- Never publish this app to a store with this key.

To move to a private key later: create a new keystore, add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` as repository secrets (they take precedence over these files), delete this folder, and uninstall the app once before installing the first build with the new key.
