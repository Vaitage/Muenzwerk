#!/usr/bin/env bash
# Alles, was vom Windows-PC (Git Bash) aus auf dem Pi passiert, in einem Skript.
# Der Code geht als Git-Bundle per SSH auf den Pi; der Pi braucht dafür keinen
# Zugang zum GitHub-Repository. Nur committete Stände von main kommen an.
#
#   bash tools/pi/vom-pc.sh installieren        Erstinstallation (Docker, Tailscale, App)
#   bash tools/pi/vom-pc.sh aktualisieren       Stand von main auf alle Installationen
#                                               (Notfallweg, falls der Knopf in der App nicht geht)
#   bash tools/pi/vom-pc.sh updates-einrichten  Updates aus der App einrichten
#                                               („Einstellungen → Updates → Jetzt aktualisieren“)
#
# Einstellungen über Umgebungsvariablen:
#   PI=haushaltsbuch        Eintrag in ~/.ssh/config
#   PI_ORDNER=haushaltsbuch Ordner der Hauptinstallation auf dem Pi
#   REPO_URL=…              Repository für die Updates aus der App (Standard: origin)
set -euo pipefail

PI="${PI:-haushaltsbuch}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bundle() {
  git -C "$REPO" bundle create -q "$TMP/hb.bundle" main
}

installieren() {
  bundle
  scp -q "$TMP/hb.bundle" "$REPO/tools/pi/einrichten.sh" "$PI:"
  # -t, damit die Tailscale-Anmeldung den Link anzeigen kann
  ssh -t "$PI" 'bash ~/einrichten.sh ~/hb.bundle'
}

aktualisieren() {
  bundle
  scp -q "$TMP/hb.bundle" "$REPO/tools/pi/aktualisieren.sh" "$PI:"
  ssh "$PI" 'bash ~/aktualisieren.sh ~/hb.bundle && rm ~/aktualisieren.sh'
}

updates_einrichten() {
  # Bei einem privaten Repository zeigt der Pi einen Schlüssel an, der einmal bei GitHub
  # eingetragen wird (Settings → Deploy keys, ohne Schreibrecht); danach noch einmal starten.
  local url="${REPO_URL:-$(git -C "$REPO" remote get-url origin)}"
  local ziel="${PI_ORDNER:-haushaltsbuch}"
  aktualisieren          # damit die Skripte auf dem Pi aktuell sind
  ssh -t "$PI" "bash ~/$ziel/tools/pi/updates-einrichten.sh '$url'"
}

case "${1:-}" in
  installieren) installieren ;;
  aktualisieren) aktualisieren ;;
  updates-einrichten) updates_einrichten ;;
  *)
    sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
    exit 1 ;;
esac
