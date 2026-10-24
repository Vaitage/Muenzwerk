#!/usr/bin/env bash
# Legt auf dem Pi eine weitere, komplett getrennte Installation an
# (eigene Datenbank, eigener Passkey, eigene Bankverbindung). Läuft AUF dem Pi.
#
#   bash weitere-installation.sh <name> <port> <https-port>
#   z. B. bash weitere-installation.sh 2 8001 8443
#
# Danach erreichbar unter https://<tailscale-name>:<https-port> (nur im Tailnet).
# Braucht einmal das sudo-Passwort (für tailscale serve).
set -euo pipefail

NAME="${1:?Name fehlt}"
PORT="${2:?Port fehlt}"
HTTPS_PORT="${3:?HTTPS-Port fehlt}"
HAUPT="$HOME/haushaltsbuch"
ZIEL="$HOME/haushaltsbuch-$NAME"

TS_NAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

if [ ! -d "$ZIEL/.git" ]; then
  git clone -q "$HAUPT" "$ZIEL"
fi
mkdir -p "$ZIEL/data"
chmod 700 "$ZIEL/data"

if [ ! -f "$ZIEL/.env" ]; then
  sed -e "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$TS_NAME:$HTTPS_PORT|" \
      -e "s|^ALLOWED_HOSTS=.*|ALLOWED_HOSTS=localhost,127.0.0.1,$TS_NAME|" \
      -e "s|^BANK_PROVIDER=.*|BANK_PROVIDER=none|" \
      "$HAUPT/.env.example" > "$ZIEL/.env"
  printf '\n# Weitere Installation auf diesem Pi\nCONTAINER_NAME=haushaltsbuch-%s\nPORT=%s\n' "$NAME" "$PORT" >> "$ZIEL/.env"
  chmod 600 "$ZIEL/.env"
fi

cd "$ZIEL"
docker compose up -d --build

echo "Bitte das sudo-Passwort eingeben (für tailscale serve):"
sudo tailscale serve --bg --https="$HTTPS_PORT" "$PORT"

for i in $(seq 1 30); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 2
done
LINK="$(docker exec "haushaltsbuch-$NAME" python -m app.auth link 2>/dev/null || echo "https://$TS_NAME:$HTTPS_PORT/")"
echo "Fertig. Mit dem Handy scannen (Tailscale an), Passkey anlegen, dann führt die App durch die Bank-Einrichtung:"
command -v qrencode >/dev/null && qrencode -t ansiutf8 -m 2 "$LINK"
echo "  $LINK"
