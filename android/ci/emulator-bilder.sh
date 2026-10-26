#!/usr/bin/env bash
# Läuft in GitHub Actions im Android-Emulator (android.yml): App + Test installieren,
# Widget-Bilder rendern lassen, abholen, dazu Bildschirmfotos der Einrichtung.
set -euo pipefail
cd "$(dirname "$0")/.."
PKG=io.github.vaitage.muenzwerk
OUT=build/bilder
mkdir -p "$OUT"

gradle --no-daemon -q installDebug installDebugAndroidTest
adb shell am instrument -w -r "$PKG.test/androidx.test.runner.AndroidJUnitRunner" | tee "$OUT/instrument.txt"
grep -q "OK (" "$OUT/instrument.txt"

for f in $(adb shell run-as $PKG ls files/bilder | tr -d '\r'); do
  adb exec-out run-as $PKG cat "files/bilder/$f" > "$OUT/$f"
done

# Einrichtung, geöffnet über den Link aus Münzwerk (hell und dunkel, deutsch)
adb shell cmd locale set-app-locales $PKG --locales de-DE || echo "App-Sprache nicht gesetzt – Bilder auf Englisch"
for mode in no yes; do
  adb shell cmd uimode night $mode
  adb shell am force-stop $PKG
  adb shell am start -W -a android.intent.action.VIEW -d "'muenzwerk://setup?url=https://muenzwerk.beispiel.ts.net&key=mw_beispiel_nur_zum_zeigen'" $PKG
  sleep 3
  adb exec-out screencap -p > "$OUT/einrichten-$([ $mode = yes ] && echo dunkel || echo hell).png"
done
ls -la "$OUT"
