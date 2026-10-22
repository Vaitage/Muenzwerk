#!/usr/bin/env bash
# Spielt einen neuen Stand auf alle Installationen auf dem Pi auf
# (~/haushaltsbuch und ~/haushaltsbuch-*). Läuft AUF dem Pi, ohne sudo.
#
#   bash aktualisieren.sh <pfad-zum-git-bundle>
#
# Vom PC aus: bash tools/pi/vom-pc.sh aktualisieren
set -euo pipefail

BUNDLE="${1:?Pfad zum Git-Bundle fehlt}"

for DIR in "$HOME/haushaltsbuch" "$HOME"/haushaltsbuch-*; do
  [ -d "$DIR/.git" ] || continue
  echo "==> $(basename "$DIR")"
  git -C "$DIR" pull -q --ff-only "$BUNDLE" main
  (cd "$DIR" && docker compose up -d --build 2>&1 | tail -1)
done
rm -f "$BUNDLE"
