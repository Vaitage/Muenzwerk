#!/usr/bin/env bash
# Bringt den Stand von main auf alle Installationen auf dem Pi. Läuft in Git
# Bash auf dem PC. Nur committete Stände kommen an; sudo ist nicht nötig.
#
#   bash tools/pi/aktualisieren-vom-pc.sh
set -euo pipefail

PI="${PI:-haushaltsbuch}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git -C "$REPO" bundle create -q "$TMP/hb.bundle" main
scp -q "$TMP/hb.bundle" "$REPO/tools/pi/aktualisieren.sh" "$PI:"
ssh "$PI" 'bash ~/aktualisieren.sh ~/hb.bundle && rm ~/aktualisieren.sh'
