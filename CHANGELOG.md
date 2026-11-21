# Changelog

## 0.3.0 (first public release)

- **Run:** run, hot reload, hot restart, stop and attach; device, debug/profile/release, entrypoint, flavor, `--dart-define`, `--dart-define-from-file` and extra flags; named run configurations per package.
- **Inspector:** live widget tree with source locations and jump to source; screenshots; platform and brightness overrides; debug paint, performance overlay, select widget on device, slow animations, debug banner; widget/render/layer/semantics text dumps; DevTools pages.
- **Build:** `flutter build` for Android, iOS, web and desktop in any mode, with a release-signing check (debug-signed release builds, missing `key.properties` or keystore, no iOS team).
- **Tests:** test overview tree (files → groups → tests) with results; run all, one file, group or test, only failures, or with coverage.
- **Checks:** analyze, format, `dart fix`, build_runner, gen-l10n, clean, doctor; Flutter SDK update check and `flutter upgrade` (FVM-aware).
- **Packages:** outdated dependencies, upgrades, add/remove, pub.dev links, edit `pubspec.yaml`.
- **Devices:** connected devices, emulator GPS location, launch emulators, create Android emulators from installed system images.
- `flutter create` for workspaces without a project; widget file templates.
- Follows the focused Orca workspace and finds Flutter apps inside monorepos. Dart syntax highlighting. Android Studio-style shortcuts.
