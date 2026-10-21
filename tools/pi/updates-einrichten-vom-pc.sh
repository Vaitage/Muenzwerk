#!/usr/bin/env bash
# Richtet vom PC aus die Updates aus der App auf dem Pi ein. Läuft in Git Bash
# auf dem PC. Bringt zuerst den aktuellen Stand per Bundle auf den Pi (damit die
# Skripte dort sind) und startet dann tools/pi/updates-einrichten.sh.
#
#   bash tools/pi/updates-einrichten-vom-pc.sh
#
# Bei einem privaten Repository zeigt es einen Schlüssel an, der einmal bei GitHub
# eingetragen wird; danach dieses Skript noch einmal starten. Ab dann reicht in der
# App „Einstellungen → Updates → Jetzt aktualisieren“ – der PC muss nicht mehr an sein.
set -euo pipefail

PI="${PI:-haushaltsbuch}"          # Eintrag in ~/.ssh/config
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
URL="${REPO_URL:-$(git -C "$REPO" remote get-url origin)}"
ZIEL="${PI_ORDNER:-haushaltsbuch}"  # Ordner der Hauptinstallation auf dem Pi

bash "$REPO/tools/pi/aktualisieren-vom-pc.sh"
ssh -t "$PI" "bash ~/$ZIEL/tools/pi/updates-einrichten.sh '$URL'"
