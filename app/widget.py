"""iPhone-Widget (App „Scriptable“): ein paar Zahlen mit eigenem, nur lesendem Schlüssel.

Ein Widget kann sich nicht per Face ID anmelden. Deshalb gibt es einen eigenen
Widget-Schlüssel, der genau eine Sache darf: ``GET /api/widget/data`` lesen.
Dort stehen nur wenige Zahlen (Übrig bis Monatsende, Tagesbudget, nächste
Fixkosten) – keine Umsätze, keine Kontodaten.

Die Zahlen rechnet die App selbst (web/analytics.js, wie in der Übersicht) und
schickt sie nach jedem Laden als „Schnappschuss“ hierher. So zeigt der Widget
genau dieselben Werte wie die App. Gespeichert wird nur ein Hash des Schlüssels.
"""

import hashlib
import hmac
import json
import secrets
import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import db, sync

router = APIRouter(prefix="/api/widget")

KEY_HASH = "widget_key_hash"
KEY_CREATED = "widget_key_created"
SNAPSHOT = "widget_snapshot"
DATA_PATH = "/api/widget/data"     # einziger Pfad ohne Anmeldung (siehe auth.OPEN_PATHS)


def get_db():
    with db.session() as conn:
        yield conn


def _get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def _put(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------- Schlüssel (nur angemeldet)

@router.get("/key")
def key_status(conn=Depends(get_db)):
    snap = _get(conn, SNAPSHOT)
    return {
        "active": _get(conn, KEY_HASH) is not None,
        "created": _get(conn, KEY_CREATED),
        "snapshot_at": json.loads(snap).get("computed_at") if snap else None,
    }


@router.post("/key")
def new_key(conn=Depends(get_db)):
    """Erzeugt einen neuen Schlüssel. Ein alter hört sofort auf zu gelten.
    Der Schlüssel wird nur dieses eine Mal angezeigt."""
    key = "mw_" + secrets.token_urlsafe(32)
    _put(conn, KEY_HASH, _hash(key))
    _put(conn, KEY_CREATED, _now())
    return {"key": key, **key_status(conn)}


@router.delete("/key", status_code=204)
def revoke_key(conn=Depends(get_db)):
    conn.execute("DELETE FROM settings WHERE key IN (?, ?)", (KEY_HASH, KEY_CREATED))


# --------------------------------------------------------------- Schnappschuss (nur angemeldet)

class DueItem(BaseModel):
    name: str = Field(max_length=80)
    amount_cents: int = Field(ge=0, le=10**10)
    day: int = Field(ge=1, le=31)


class DayItem(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    daily_cents: int = Field(ge=-10**10, le=10**10)


class Snapshot(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    budget_left_cents: int = Field(ge=-10**11, le=10**11)
    forecast_end_cents: int = Field(ge=-10**11, le=10**11)
    days_left: int = Field(ge=0, le=31)
    pending_cents: int = Field(ge=0, le=10**11)
    days: list[DayItem] = Field(max_length=3)
    next_fixed: list[DueItem] = Field(max_length=3)


@router.put("/snapshot")
def save_snapshot(body: Snapshot, conn=Depends(get_db)):
    if _get(conn, KEY_HASH) is None:
        return {"stored": False}           # ohne Widget nichts speichern
    data = {**body.model_dump(), "computed_at": _now()}
    _put(conn, SNAPSHOT, json.dumps(data, ensure_ascii=False))
    return {"stored": True}


# --------------------------------------------------------------- Für den Widget (nur mit Schlüssel)

@router.get("/data")
def widget_data(request: Request, conn=Depends(get_db)):
    stored = _get(conn, KEY_HASH)
    auth = request.headers.get("authorization", "")
    given = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not stored or not given or not hmac.compare_digest(_hash(given), stored):
        raise HTTPException(401, "Widget-Schlüssel ungültig.")
    snap = _get(conn, SNAPSHOT)
    bank = sync.status(conn)
    return {
        "snapshot": json.loads(snap) if snap else None,
        "bank": {"state": bank["state"], "days_left": bank["days_left"], "last_sync": bank["last_sync"]},
    }
