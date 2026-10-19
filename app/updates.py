"""Updates aus der App anstoßen (nur, wenn ``UPDATES_IN_APP=1`` gesetzt ist).

Die App selbst kann und darf am Pi nichts ändern: Sie läuft in einem Container
ohne Zugriff auf Docker oder Git. Stattdessen sprechen App und Update-Dienst
(tools/pi/selbst-aktualisieren.sh, läuft auf dem Pi per Cron jede Minute) nur
über zwei Dateien im Datenordner miteinander:

  <data>/update/status.json   schreibt der Dienst: installierter und neuester
                              Stand, Änderungen, letztes Ergebnis
  <data>/update/anfrage       schreibt die App: genau ein Wort aus AKTIONEN

Die App kann darüber also nur „bitte prüfen/aktualisieren“ sagen, aber keine
Befehle ausführen. Eingespielt wird nur auf Knopfdruck, nie automatisch.
Schalter ``UPDATES_IN_APP`` gehört nur in die .env der
Installation, die Updates auslösen darf (alle Installationen werden aktualisiert).
"""

import json
import os
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import db

router = APIRouter(prefix="/api/updates")

AKTIONEN = ("pruefen", "aktualisieren")
# Ab wann ein Status als veraltet gilt (Dienst läuft jede Minute)
DIENST_STILL_SEKUNDEN = 15 * 60


def enabled() -> bool:
    return os.environ.get("UPDATES_IN_APP", "").strip().lower() in ("1", "true", "ja", "yes")


def update_dir() -> Path:
    default = Path(db.DB_PATH).resolve().parent / "update"
    return Path(os.environ.get("HAUSHALTSBUCH_UPDATE_DIR", default))


def _status() -> dict | None:
    try:
        data = json.loads((update_dir() / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _pending() -> str | None:
    try:
        word = (update_dir() / "anfrage").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return word if word in AKTIONEN else None


def _answer() -> dict:
    status = _status()
    alive = None
    if status and isinstance(status.get("lebenszeichen"), (int, float)):
        alive = time.time() - status["lebenszeichen"] < DIENST_STILL_SEKUNDEN
    return {"status": status, "anfrage": _pending(), "dienst_aktiv": alive}


class UpdateAction(BaseModel):
    aktion: str = Field(pattern="^(" + "|".join(AKTIONEN) + ")$")


@router.get("")
def get_updates():
    if not enabled():
        raise HTTPException(404)
    return _answer()


@router.post("")
def request_update(body: UpdateAction):
    if not enabled():
        raise HTTPException(404)
    folder = update_dir()
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / "anfrage.tmp"
    tmp.write_text(body.aktion + "\n", encoding="utf-8")
    os.replace(tmp, folder / "anfrage")   # nie halb geschrieben
    return _answer()
