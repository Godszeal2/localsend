# LocalSend bridge release artifacts

This directory contains release-ready build outputs for the bridge/screen-share workflow branch.

## Files
- android/localsend-bridge.apk: Android APK build output when the Android SDK is available.
- windows/: Windows build output directory when the Windows toolchain is available.

## Build notes
- The APK build requires Android SDK setup via ANDROID_HOME or ANDROID_SDK_ROOT.
- The Windows build requires the Windows desktop toolchain and a PowerShell-capable environment.
