#!/usr/bin/env bash
# Richtet Updates aus der App ein: Der Pi schaut stündlich bei GitHub nach einem
# neuen Stand von main; in der App erscheint dann „Neue Version verfügbar“, und
# „Jetzt aktualisieren“ spielt ihn auf alle Installationen auf
# (tools/pi/selbst-aktualisieren.sh). Automatisch eingespielt wird nie.
# Läuft AUF dem Pi, ohne sudo.
#
#   bash updates-einrichten.sh [github-url]
#   z. B. bash updates-einrichten.sh https://github.com/<name>/muenzwerk
#
# Öffentliches Repository: Der Pi holt per HTTPS, ohne Schlüssel.
# Privates Repository: Das Skript legt einen eigenen SSH-Schlüssel an und zeigt ihn
# an. Den einmal bei GitHub als „Deploy key“ OHNE Schreibrecht eintragen und das
# Skript noch einmal starten. Der Pi kann damit nur lesen, nichts ändern.
#
# Danach gibt es in der App dieser Installation unter „Mehr“ den Bereich „Updates“
# (UPDATES_IN_APP=1 in ihrer .env). Ausschalten: crontab -e und die Zeile mit
# kontor-update.sh löschen.
set -euo pipefail

HAUPT="${HAUPT:-$(cd "$(dirname "$0")/../.." && pwd)}"
URL="${1:-$(git -C "$HAUPT" remote get-url origin 2>/dev/null || true)}"

# owner/repo aus https://github.com/owner/repo(.git) oder git@github.com:owner/repo(.git)
SLUG="$(printf '%s' "$URL" | sed -nE 's#^(https://github\.com/|git@github\.com:)([^/]+/[^/]+)$#\2#p' | sed 's/\.git$//')"
if [ -z "$SLUG" ]; then
  echo "Bitte die GitHub-Adresse des Repositorys angeben, z. B.:"
  echo "  bash $0 https://github.com/<name>/muenzwerk"
  exit 1
fi
[ -d "$HAUPT/.git" ] || { echo "$HAUPT ist kein Git-Ordner."; exit 1; }
command -v flock >/dev/null || { echo "flock fehlt (Paket util-linux)."; exit 1; }

export GIT_TERMINAL_PROMPT=0
SSH_BEFEHL=""
if git ls-remote -q "https://github.com/$SLUG.git" HEAD >/dev/null 2>&1; then
  REPO_URL="https://github.com/$SLUG.git"
  echo "Öffentliches Repository – kein Schlüssel nötig."
else
  # Privat: eigener, nur lesender Schlüssel nur für dieses Repository
  KEY="$HOME/.ssh/kontor_deploy_ed25519"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  [ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "kontor-update@$(hostname)" -f "$KEY"
  # Hostschlüssel von GitHub (Fingerabdruck SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU,
  # siehe docs.github.com „GitHub's SSH key fingerprints“) – so wird nichts blind vertraut
  KNOWN="$HOME/.ssh/known_hosts_github"
  echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > "$KNOWN"
  SSH_BEFEHL="ssh -i $KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN -o StrictHostKeyChecking=yes"
  REPO_URL="git@github.com:$SLUG.git"
  if ! GIT_SSH_COMMAND="$SSH_BEFEHL" git ls-remote -q "$REPO_URL" HEAD >/dev/null 2>&1; then
    echo
    echo "Privates Repository: Der Pi braucht einmal eine Leseberechtigung."
    echo "1. https://github.com/$SLUG/settings/keys/new öffnen"
    echo "2. Title: Pi Auto-Update"
    echo "3. Key: diese Zeile komplett einfügen:"
    echo
    cat "$KEY.pub"
    echo
    echo "4. „Allow write access“ NICHT anhaken, dann „Add key“."
    echo "5. Danach dieses Skript noch einmal starten."
    exit 2
  fi
  echo "Zugriff auf $SLUG klappt (nur lesend)."
fi

mkdir -p "$HOME/.config" "$HOME/.local/bin" "$HOME/.cache/kontor-update"
{
  printf 'HAUPT=%q\n' "$HAUPT"
  printf 'REPO_URL=%q\n' "$REPO_URL"
  [ -n "$SSH_BEFEHL" ] && printf 'GIT_SSH_COMMAND=%q\n' "$SSH_BEFEHL"
} > "$HOME/.config/kontor-update.conf"
install -m 755 "$HAUPT/tools/pi/selbst-aktualisieren.sh" "$HOME/.local/bin/kontor-update.sh"

# Jede Minute: schaut nur nach Anfragen aus der App; zu GitHub geht es stündlich
ZEILE="* * * * * $HOME/.local/bin/kontor-update.sh >> $HOME/kontor-update.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'kontor-update.sh' || true; echo "$ZEILE" ) | crontab -
echo "Eingerichtet: Der Pi schaut stündlich nach Updates, eingespielt wird nur per Knopf in der App."
echo "Protokoll: ~/kontor-update.log"

# Bereich „Updates“ in der App – nur in der Hauptinstallation (ein Update betrifft alle)
if ! grep -q '^UPDATES_IN_APP=' "$HAUPT/.env" 2>/dev/null; then
  printf '\n# Updates aus der App anstoßen (nur diese Installation)\nUPDATES_IN_APP=1\n' >> "$HAUPT/.env"
  (cd "$HAUPT" && docker compose up -d >/dev/null 2>&1) || true
  echo "In der App unter „Mehr“ gibt es jetzt den Bereich „Updates“."
fi

echo "Erste Prüfung …"
if "$HOME/.local/bin/kontor-update.sh" >> "$HOME/kontor-update.log" 2>&1; then
  echo "OK. Installiert: $(git -C "$HAUPT" log -1 --format='%h %s')"
else
  echo "Erster Lauf hatte ein Problem, siehe: tail ~/kontor-update.log"
fi
