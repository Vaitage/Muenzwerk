#!/usr/bin/env bash
# Münzwerk installieren – ein Befehl auf einem frischen Raspberry Pi (Raspberry Pi OS 64 Bit) oder
# einem anderen Debian/Ubuntu-Rechner, angemeldet als normaler Benutzer mit sudo:
#
#   curl -fsSL https://raw.githubusercontent.com/Vaitage/muenzwerk/main/install.sh | bash
#
# Installiert Docker und Tailscale, holt Münzwerk nach ~/muenzwerk, startet es und macht es
# per HTTPS in deinem Tailnet erreichbar (tailscale serve, nie öffentlich). Am Ende steht ein
# QR-Code: mit dem Handy scannen, Passkey anlegen, den Rest erklärt die App.
# Mehrfach ausführen schadet nicht (dann wird nur aktualisiert).
set -euo pipefail

REPO="${MUENZWERK_REPO:-https://github.com/Vaitage/muenzwerk.git}"
export ZIEL="${ZIEL:-$HOME/muenzwerk}"
export TS_HOST="${TS_HOST:-muenzwerk}"

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als normaler Benutzer starten (nicht als root) – sudo wird bei Bedarf gefragt." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null; then
  echo "Dieser Installer braucht Debian, Ubuntu oder Raspberry Pi OS (apt-get)." >&2
  exit 1
fi

echo "Münzwerk wird nach $ZIEL installiert. Bitte das Passwort für sudo eingeben, wenn danach gefragt wird."
command -v git >/dev/null || { sudo apt-get update -q && sudo apt-get -y -q install git; }
if [ -d "$ZIEL/.git" ]; then
  git -C "$ZIEL" pull --ff-only -q "$REPO" main
else
  git clone -q --branch main "$REPO" "$ZIEL"
fi
# Eingaben (sudo, Tailscale-Anmeldung) vom Terminal lesen, nicht aus dieser Pipe
exec bash "$ZIEL/tools/pi/einrichten.sh" "$REPO" </dev/tty
