#!/usr/bin/env bash
# Nächtliches Backup auf dem Pi (Cron des Benutzers, unter dem die App läuft). Läuft AUF dem Pi.
#
# Für jede Installation (~/haushaltsbuch, ~/haushaltsbuch-*) entsteht ein
# verschlüsseltes Paket mit Datenbank, .env und Bankschlüssel:
#   ~/backups/<installation>_<datum>.tar.gz.cms
# Verschlüsselt wird mit dem öffentlichen Zertifikat ~/.backup-zertifikat.pem.
# Entschlüsseln kann nur der PC mit dem privaten Schlüssel
# (siehe tools/backup/pc-wiederherstellen.ps1). Der PC holt die Pakete ab.
set -euo pipefail

ZIEL="$HOME/backups"
ZERT="$HOME/.backup-zertifikat.pem"
BEHALTEN=14   # je Installation, die neuesten

umask 077
mkdir -p "$ZIEL"
STEMPEL="$(date +%Y-%m-%d_%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for DIR in "$HOME/haushaltsbuch" "$HOME"/haushaltsbuch-*; do
  [ -f "$DIR/docker-compose.yml" ] || continue
  NAME="$(basename "$DIR")"
  CONTAINER="$(sed -n 's/^CONTAINER_NAME=//p' "$DIR/.env" 2>/dev/null)"
  CONTAINER="${CONTAINER:-haushaltsbuch}"
  PAKET="$TMP/$NAME"
  mkdir -p "$PAKET"

  # Datenbank über SQLite selbst kopieren, damit sie auch bei laufender App stimmt
  docker exec "$CONTAINER" python -c \
    "import sqlite3; sqlite3.connect('/data/haushaltsbuch.db').backup(sqlite3.connect('/data/.backup-tmp.db'))"
  mv "$DIR/data/.backup-tmp.db" "$PAKET/haushaltsbuch.db"
  cp "$DIR/.env" "$PAKET/"
  cp "$DIR"/data/*.pem "$PAKET/" 2>/dev/null || true

  DATEI="$ZIEL/${NAME}_${STEMPEL}.tar.gz.cms"
  tar -C "$PAKET" -czf - . \
    | openssl cms -encrypt -binary -aes-256-gcm -outform DER -out "$DATEI" "$ZERT"
  rm -rf "$PAKET"
  echo "$(date '+%d.%m.%Y %H:%M') $NAME gesichert: $(basename "$DATEI") ($(du -h "$DATEI" | cut -f1))"

  # Ältere Pakete dieser Installation aufräumen
  ls -1t "$ZIEL/${NAME}_"*.tar.gz.cms | tail -n +$((BEHALTEN + 1)) | xargs -r rm -f
done
