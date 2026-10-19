#!/usr/bin/env bash
# Bringt den aktuellen Stand vom Windows-PC auf den Pi und richtet ihn ein.
# Läuft in Git Bash auf dem PC. Für Erstinstallation und spätere Updates.
#
#   bash tools/pi/auf-pi-bringen.sh
#
# Der Code geht als Git-Bundle per SSH auf den Pi. So braucht der Pi keinen
# Zugang zum privaten GitHub-Repository.
set -euo pipefail

PI="${PI:-haushaltsbuch}"          # Eintrag in ~/.ssh/config
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE="$(mktemp -d)/haushaltsbuch.bundle"

git -C "$REPO" bundle create "$BUNDLE" main
scp -q "$BUNDLE" "$REPO/tools/pi/einrichten.sh" "$PI:"
# -t, damit die Tailscale-Anmeldung den Link anzeigen kann
ssh -t "$PI" 'bash ~/einrichten.sh ~/haushaltsbuch.bundle'
rm -f "$BUNDLE"
