#!/usr/bin/env bash
# Update-Dienst für alle Installationen auf dem Pi. Läuft AUF dem Pi per Cron
# jede Minute, ohne sudo. Eingerichtet wird er mit tools/pi/updates-einrichten.sh,
# das auch diese Datei nach ~/.local/bin/kontor-update.sh kopiert.
#
# Jede Minute (kostet praktisch nichts):
#   - liest eine Anfrage aus der App (<haupt>/data/update/anfrage, siehe app/updates.py):
#     pruefen | aktualisieren
#   - schreibt den Stand für die App nach <haupt>/data/update/status.json
# Einmal pro Stunde (oder auf Anfrage „pruefen“) schaut er bei GitHub nach einem
# neuen Stand von main, damit die App „Neue Version verfügbar“ zeigen kann.
# Eingespielt wird nur, wenn in der App „Jetzt aktualisieren“ getippt wurde.
#
# Sicherungen:
#   - nur Fast-Forward von main (umgeschriebene Historie wird nicht übernommen)
#   - lässt sich der neue Stand nicht bauen oder startet die App danach nicht,
#     geht die Installation auf den vorherigen Stand zurück
#   - läuft nie doppelt (flock)
set -euo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"   # Cron hat nur einen knappen PATH

CONF="$HOME/.config/kontor-update.conf"
CACHE="$HOME/.cache/kontor-update"
# shellcheck source=/dev/null
source "$CONF"                       # HAUPT, REPO_URL, ggf. GIT_SSH_COMMAND
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh}" GIT_TERMINAL_PROMPT=0
PRUEF_ABSTAND="${PRUEF_ABSTAND:-3600}"   # Sekunden zwischen zwei Blicken zu GitHub
APP_DIR="$HAUPT/data/update"
mkdir -p "$CACHE" "$APP_DIR"

exec 9>"$CACHE/lock"
flock -n 9 || exit 0

log() { echo "$(date '+%d.%m.%Y %H:%M') $*"; }

# Protokoll klein halten
LOG="$HOME/kontor-update.log"
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 1000 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# ---------------------------------------------------------------- Status für die App
# Ergebnis des letzten Updates für die App: Zeit, Code, Commit, Einzelheiten.
# Codes: aktualisiert | aktuell | zurueckgenommen | teilweise | kein_ff | offline
ergebnis() { printf '%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$1" "${2:0:7}" "${3:-}" > "$CACHE/letztes"; }

status_schreiben() {  # $1 = 1, solange gerade aktualisiert wird
  LAEUFT="${1:-0}" HAUPT="$HAUPT" CACHE="$CACHE" APP_DIR="$APP_DIR" python3 - <<'PY'
import json, os, subprocess, time

haupt, cache, ziel = os.environ["HAUPT"], os.environ["CACHE"], os.environ["APP_DIR"]

def git(*args):
    r = subprocess.run(["git", "-C", haupt, *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""

def lies(name):
    try:
        with open(os.path.join(cache, name), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""

def commit(ref):
    out = git("log", "-1", "--format=%H%x1f%cI%x1f%s", ref)
    if not out:
        return None
    h, d, s = out.split("\x1f", 2)
    return {"commit": h[:7], "datum": d, "titel": s}

neu = lies("neu")
installiert = commit("HEAD")
verfuegbar = None
aenderungen = []
neuer_stand = neu and neu != git("rev-parse", "HEAD")
if neuer_stand and subprocess.run(["git", "-C", haupt, "merge-base", "--is-ancestor", "HEAD", neu],
                                  capture_output=True).returncode == 0:
        verfuegbar = commit(neu)
        for zeile in git("log", "-20", "--format=%H%x1f%cI%x1f%s", f"HEAD..{neu}").splitlines():
            h, d, s = zeile.split("\x1f", 2)
            aenderungen.append({"commit": h[:7], "datum": d, "titel": s})

letztes = None
if lies("letztes"):
    teile = (lies("letztes").split("\t") + ["", "", "", ""])[:4]
    letztes = {"zeit": teile[0], "ergebnis": teile[1], "commit": teile[2], "details": teile[3]}

geprueft = lies("geprueft")
status = {
    "lebenszeichen": int(time.time()),
    "geprueft": int(geprueft) if geprueft.isdigit() else None,
    "installiert": installiert,
    "verfuegbar": verfuegbar,
    "aenderungen": aenderungen,
    "laeuft": os.environ.get("LAEUFT") == "1",
    "fehlgeschlagen": (lies("fehlgeschlagen") or "")[:7] or None,
    "letztes": letztes,
}
tmp = os.path.join(ziel, "status.json.tmp")
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(status, fh, ensure_ascii=False)
os.chmod(tmp, 0o644)
os.replace(tmp, os.path.join(ziel, "status.json"))
PY
}

# ---------------------------------------------------------------- Anfrage aus der App
ANFRAGE=""
if [ -f "$APP_DIR/anfrage" ]; then
  ANFRAGE="$(head -c 40 "$APP_DIR/anfrage" | tr -dc 'a-z_')"
  rm -f "$APP_DIR/anfrage"
fi
case "$ANFRAGE" in
  pruefen|aktualisieren) ;;
  *) ANFRAGE="" ;;
esac

# ---------------------------------------------------------------- bei GitHub nachsehen
JETZT="$(date +%s)"
ZULETZT="$(cat "$CACHE/geprueft" 2>/dev/null || echo 0)"
if [ "$ANFRAGE" = pruefen ] || [ "$ANFRAGE" = aktualisieren ] || [ $(( JETZT - ZULETZT )) -ge "$PRUEF_ABSTAND" ]; then
  if git -C "$HAUPT" fetch -q "$REPO_URL" main 2>"$CACHE/fetch.err"; then
    git -C "$HAUPT" rev-parse FETCH_HEAD > "$CACHE/neu"
    echo "$JETZT" > "$CACHE/geprueft"
  else
    log "GitHub nicht erreichbar: $(head -c 200 "$CACHE/fetch.err")"
    if [ -n "$ANFRAGE" ]; then ergebnis offline "" "$(head -c 120 "$CACHE/fetch.err" | tr '\n\t' '  ')"; fi
  fi
fi

NEU="$(cat "$CACHE/neu" 2>/dev/null || true)"
ALT_HAUPT="$(git -C "$HAUPT" rev-parse HEAD)"
installieren=0
if [ -n "$NEU" ] && [ "$NEU" != "$ALT_HAUPT" ]; then
  if ! git -C "$HAUPT" merge-base --is-ancestor HEAD "$NEU" 2>/dev/null; then
    if [ "$(cat "$CACHE/fehlgeschlagen" 2>/dev/null)" != "$NEU" ]; then
      log "Neuer Stand ${NEU:0:7} ist kein Fast-Forward – übersprungen (bitte von Hand prüfen)."
      echo "$NEU" > "$CACHE/fehlgeschlagen"
      ergebnis kein_ff "$NEU"
    fi
  elif [ "$ANFRAGE" = aktualisieren ]; then
    installieren=1
  fi
elif [ "$ANFRAGE" = aktualisieren ]; then
  ergebnis aktuell "$NEU"
fi

if [ "$installieren" = 0 ]; then
  status_schreiben 0
  exit 0
fi

# ---------------------------------------------------------------- aufspielen
status_schreiben 1

# Wartet, bis die App auf ihrem Port antwortet
laeuft() {
  local port="$1"
  for _ in $(seq 1 45); do
    curl -fs -o /dev/null "http://127.0.0.1:$port/" && return 0
    sleep 2
  done
  return 1
}

# Spielt den Stand $2 im Ordner $1 auf; bei Fehler zurück zum alten Stand
aufspielen() {
  local dir="$1" ziel="$2" alt port
  alt="$(git -C "$dir" rev-parse HEAD)"
  port="$(sed -n 's/^PORT=//p' "$dir/.env" 2>/dev/null | tail -1)"
  port="${port:-8000}"
  git -C "$dir" merge -q --ff-only "$ziel"
  if (cd "$dir" && docker compose build -q >/dev/null 2>"$CACHE/build.err" && docker compose up -d >/dev/null 2>&1) \
     && laeuft "$port"; then
    log "$(basename "$dir"): ${alt:0:7} -> $(git -C "$dir" rev-parse --short HEAD) ($(git -C "$dir" log -1 --format=%s))"
    return 0
  fi
  log "$(basename "$dir"): neuer Stand startet nicht – zurück auf ${alt:0:7}. $(tail -c 300 "$CACHE/build.err" 2>/dev/null | tr '\n' ' ')"
  git -C "$dir" reset -q --hard "$alt"
  (cd "$dir" && docker compose up -d --build >/dev/null 2>&1) || log "$(basename "$dir"): auch der alte Stand startet nicht!"
  return 1
}

if ! aufspielen "$HAUPT" "$NEU"; then
  echo "$NEU" > "$CACHE/fehlgeschlagen"
  ergebnis zurueckgenommen "$NEU" "$(tail -c 120 "$CACHE/build.err" 2>/dev/null | tr '\n\t' '  ')"
  status_schreiben 0
  exit 1
fi
rm -f "$CACHE/fehlgeschlagen"

# Weitere Installationen (<haupt>-2, <haupt>-…) holen den Stand vom Hauptordner
FEHLER=""
for dir in "$HAUPT"-*; do
  [ -d "$dir/.git" ] || continue
  if ! { git -C "$dir" fetch -q "$HAUPT" main && aufspielen "$dir" FETCH_HEAD; }; then
    FEHLER="$FEHLER $(basename "$dir")"
  fi
done
if [ -n "$FEHLER" ]; then
  ergebnis teilweise "$NEU" "${FEHLER# }"
else
  ergebnis aktualisiert "$NEU"
fi
status_schreiben 0

# Neueste Fassung dieses Skripts für den nächsten Lauf (neue Datei, der laufende Prozess liest weiter die alte)
install -m 755 "$HAUPT/tools/pi/selbst-aktualisieren.sh" "$HOME/.local/bin/kontor-update.sh"
docker image prune -f >/dev/null 2>&1 || true
