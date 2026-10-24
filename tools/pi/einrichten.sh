#!/usr/bin/env bash
# Richtet den Raspberry Pi (oder einen anderen Debian-Rechner) für Münzwerk ein. Läuft AUF dem Pi.
# Aufgerufen von „tools/pi/vom-pc.sh installieren“ (Git-Bundle vom PC) oder von install.sh
# (öffentliches Repository). Mehrfach ausführen schadet nicht.
#
#   bash einrichten.sh <git-bundle oder Repository-Adresse>
#
# Einstellbar: ZIEL (Ordner, Standard ~/haushaltsbuch), TS_HOST (Name im Tailnet, Standard haushaltsbuch).
# Einziger Schritt, der den Nutzer braucht: die Tailscale-Anmeldung im Browser. Am Ende stehen
# Adresse und Einrichtungscode da – auch als QR-Code zum Scannen mit dem Handy.
set -euo pipefail

QUELLE="${1:-$HOME/haushaltsbuch.bundle}"
ZIEL="${ZIEL:-$HOME/haushaltsbuch}"
TS_HOST="${TS_HOST:-haushaltsbuch}"
NUTZER="$(id -un)"

schritt() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# Alles mitprotokollieren, damit sich der Ablauf auch von außen verfolgen lässt
exec > >(tee -a "$HOME/einrichtung.log") 2>&1
echo "=== Einrichtung gestartet $(date '+%d.%m.%Y %H:%M') ==="

# sudo-Passwort einmal abfragen und für die ganze Laufzeit gültig halten
echo "Bitte das Passwort von $NUTZER eingeben (für sudo):"
sudo -v
while true; do sudo -n -v; sleep 50; kill -0 "$$" 2>/dev/null || exit; done &

schritt "System aktualisieren"
sudo apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get -y -q full-upgrade
sudo DEBIAN_FRONTEND=noninteractive apt-get -y -q install git curl ca-certificates unattended-upgrades python3 qrencode

schritt "Docker installieren"
if ! command -v docker >/dev/null; then
  # Offizielles Installationsskript von Docker. Klappt das nicht (z. B. weil die
  # Debian-Version dort noch fehlt), die Pakete aus Debian nehmen.
  if ! curl -fsSL https://get.docker.com | sudo sh; then
    sudo apt-get -y -q install docker.io docker-compose
  fi
fi
sudo usermod -aG docker "$NUTZER"
sudo systemctl enable --now docker
# "docker compose" (Plugin) oder "docker-compose" (Debian-Paket)
if sudo docker compose version >/dev/null 2>&1; then COMPOSE=(sudo docker compose); else COMPOSE=(sudo docker-compose); fi

schritt "Tailscale installieren"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sudo sh
fi
sudo systemctl enable --now tailscaled
if ! sudo tailscale status >/dev/null 2>&1; then
  echo
  echo "Gleich erscheint ein Link. Bitte im Browser öffnen und den Pi in Tailscale anmelden."
  sudo tailscale up --hostname="$TS_HOST"
fi
TS_NAME="$(sudo tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
echo "Tailscale-Adresse: $TS_NAME"

schritt "Münzwerk holen"
if [ -d "$ZIEL/.git" ]; then
  git -C "$ZIEL" pull --ff-only "$QUELLE" main
else
  git clone --branch main "$QUELLE" "$ZIEL"
fi
mkdir -p "$ZIEL/data"
chmod 700 "$ZIEL/data"

schritt ".env anlegen"
if [ ! -f "$ZIEL/.env" ]; then
  # Bank noch offen: die richtet der Assistent in der App ein („Einstellungen → Bank einrichten“)
  sed -e "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$TS_NAME|" \
      -e "s|^ALLOWED_HOSTS=.*|ALLOWED_HOSTS=localhost,127.0.0.1,$TS_NAME|" \
      -e "s|^BANK_PROVIDER=.*|BANK_PROVIDER=none|" \
      "$ZIEL/.env.example" > "$ZIEL/.env"
  chmod 600 "$ZIEL/.env"
  echo "Neu angelegt. Die Bank richtest du gleich in der App ein."
else
  echo "Vorhanden, bleibt unverändert."
fi

schritt "App bauen und starten"
cd "$ZIEL"
"${COMPOSE[@]}" up -d --build

schritt "HTTPS über Tailscale (nur im eigenen Tailnet, kein funnel)"
if ! sudo tailscale serve --bg 8000; then
  echo "HINWEIS: tailscale serve ging nicht. Meist müssen im Tailscale-Adminbereich"
  echo "unter DNS erst 'MagicDNS' und 'HTTPS Certificates' eingeschaltet werden,"
  echo "danach dieses Skript erneut starten."
fi

schritt "Fertig"
for i in $(seq 1 30); do
  curl -fs -o /dev/null http://127.0.0.1:8000/ && break
  sleep 2
done
if curl -fs -o /dev/null http://127.0.0.1:8000/; then
  # Adresse mit Einrichtungscode für den ersten Passkey (ohne Code, wenn schon einer da ist)
  LINK="$(sudo docker exec haushaltsbuch python -m app.auth link 2>/dev/null || echo "https://$TS_NAME/")"
  echo
  echo "Münzwerk läuft. Weiter geht's am Handy:"
  echo "  1. Tailscale-App installieren und mit demselben Konto anmelden."
  echo "  2. Diesen QR-Code mit der Kamera scannen (oder die Adresse öffnen):"
  echo
  if command -v qrencode >/dev/null; then qrencode -t ansiutf8 -m 2 "$LINK"; fi
  echo "  $LINK"
  echo
  echo "  3. Passkey anlegen (der Code ist schon eingetragen), dann führt die App durch die Bank-Einrichtung."
  echo "  iPhone: in Safari „Teilen → Zum Home-Bildschirm“, damit Münzwerk wie eine App startet."
else
  echo "App antwortet noch nicht. Log ansehen: cd $ZIEL && ${COMPOSE[*]} logs"
fi
