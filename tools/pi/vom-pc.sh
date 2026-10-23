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
#   bash tools/pi/vom-pc.sh bank-einrichten <ordner> <app-id> <schlüssel.pem>
#                                               Enable Banking für eine Installation einrichten,
#                                               z. B. haushaltsbuch-2 8823dfc8-… ~/Downloads/8823dfc8-….pem
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

bank_einrichten() {
  # Schlüssel kopieren, .env der Installation setzen, Container neu erzeugen, Ergebnis prüfen.
  local ordner="${1:?Ordner auf dem Pi fehlt, z. B. haushaltsbuch-2}"
  local app_id="${2:?App-ID von Enable Banking fehlt}"
  local pem="${3:?Pfad zur .pem-Datei fehlt}"
  [[ "$ordner" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Ungültiger Ordnername: $ordner" >&2; exit 1; }
  [[ "$app_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "Das sieht nicht wie eine App-ID aus: $app_id" >&2; exit 1; }
  [ -f "$pem" ] || { echo "Datei nicht gefunden: $pem" >&2; exit 1; }
  grep -q "PRIVATE KEY" "$pem" || { echo "$pem ist kein privater Schlüssel (.pem von Enable Banking)" >&2; exit 1; }

  ssh "$PI" "test -f ~/$ordner/.env" || { echo "Auf dem Pi gibt es ~/$ordner/.env nicht." >&2; exit 1; }
  scp -q "$pem" "$PI:$ordner/data/enablebanking.pem"
  # Läuft auf dem Pi; Ordner und App-ID kommen als $1 und $2 an
  ssh "$PI" bash -s -- "$ordner" "$app_id" <<'SKRIPT'
set -euo pipefail
cd ~/"$1"
chmod 600 data/enablebanking.pem
setze() {   # Schlüssel=Wert in .env setzen (ersetzen oder anhängen)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
setze BANK_PROVIDER enablebanking
setze ENABLEBANKING_APP_ID "$2"
setze ENABLEBANKING_KEY_FILE /data/enablebanking.pem
docker compose up -d >/dev/null
name=$(grep -E '^CONTAINER_NAME=' .env | cut -d= -f2 || true); name=${name:-haushaltsbuch}
url=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2- || true)
for i in $(seq 1 20); do docker exec "$name" true 2>/dev/null && break; sleep 2; done
ergebnis=$(docker exec "$name" python -c "from app.bank import setup_problem; print(setup_problem() or 'ok')")
if [ "$ergebnis" != ok ]; then
  echo "Noch nicht fertig ($ergebnis). Aktuelle Werte:"; grep -E '^(BANK_PROVIDER|ENABLEBANKING_|PUBLIC_URL)' .env; exit 1
fi
echo "Fertig: Enable Banking ist für ~/$1 eingerichtet."
if [ -n "$url" ]; then
  echo "Bei Enable Banking muss als Redirect-URL stehen:  ${url%/}/api/bank/callback"
else
  echo "Achtung: PUBLIC_URL ist in der .env leer – ohne sie klappt die Rückleitung von der Bank nicht."
fi
echo "Dann in der App: Einstellungen → Bank → Verbinden."
SKRIPT
}

case "${1:-}" in
  installieren) installieren ;;
  aktualisieren) aktualisieren ;;
  updates-einrichten) updates_einrichten ;;
  bank-einrichten) shift; bank_einrichten "$@" ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1 ;;
esac
