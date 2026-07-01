#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/releases"
APP_DIR="$ROOT_DIR/app"

mkdir -p "$RELEASE_DIR/windows" "$RELEASE_DIR/android"

if [ ! -x "$APP_DIR/../submodules/flutter/bin/flutter" ]; then
  echo "Flutter SDK not found at $APP_DIR/../submodules/flutter/bin/flutter" >&2
  exit 1
fi

cd "$APP_DIR"
"$APP_DIR/../submodules/flutter/bin/flutter" config --enable-windows-desktop
"$APP_DIR/../submodules/flutter/bin/flutter" config --enable-linux-desktop
"$APP_DIR/../submodules/flutter/bin/flutter" config --enable-macos-desktop
"$APP_DIR/../submodules/flutter/bin/flutter" pub get

if [ -n "${ANDROID_HOME:-}" ] || [ -n "${ANDROID_SDK_ROOT:-}" ]; then
  echo "Building Android APK"
  "$APP_DIR/../submodules/flutter/bin/flutter" build apk --release
  cp build/app/outputs/flutter-apk/app-release.apk "$RELEASE_DIR/android/localsend-bridge.apk"
else
  echo "Android SDK not configured; skipping APK build"
fi

if command -v powershell.exe >/dev/null 2>&1; then
  echo "Building Windows EXE"
  "$APP_DIR/../submodules/flutter/bin/flutter" build windows --release
  find build/windows/x64/runner/Release -maxdepth 1 -type f \( -name '*.exe' -o -name '*.dll' \) -print | head -n 20
else
  echo "PowerShell is not available; skipping Windows build"
fi

cat > "$RELEASE_DIR/README.md" <<'EOF'
# LocalSend bridge release artifacts

This directory contains release-ready build outputs for the bridge/screen-share workflow branch.

## Files
- android/localsend-bridge.apk: Android APK build output when the Android SDK is available.
- windows/: Windows build output directory when the Windows toolchain is available.

## Build notes
- The APK build requires Android SDK setup via ANDROID_HOME or ANDROID_SDK_ROOT.
- The Windows build requires the Windows desktop toolchain and a PowerShell-capable environment.
EOF

echo "Release artifacts are available in $RELEASE_DIR"
