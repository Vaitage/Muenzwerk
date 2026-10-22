"""Web-Server: liefert die App aus und stellt die Schnittstelle bereit."""

import asyncio
import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field

from . import __version__, accounts, auth, db, ledger, sync, updates, widget
from .bank import BankNotConfigured, get_provider

log = logging.getLogger("haushaltsbuch")
WEB_DIR = Path(__file__).resolve().parent.parent / "web"
SYNC_INTERVAL_HOURS = float(os.environ.get("SYNC_INTERVAL_HOURS", "6"))


def psu_headers(request: Request) -> dict:
    """Kopfzeilen für die Bank, wenn der Nutzer den Abruf selbst auslöst (App offen).
    Hinter `tailscale serve` steht die Adresse des Handys in X-Forwarded-For."""
    ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    ip = ip or (request.client.host if request.client else "")
    agent = request.headers.get("user-agent", "")[:200]
    return {"Psu-Ip-Address": ip, "Psu-User-Agent": agent} if ip and agent else {}


def sync_or_reason(conn, psu: dict | None = None, manual: bool = False) -> dict:
    """Abruf; ist die Bank noch nicht eingerichtet, nur der Grund statt eines Fehlers."""
    try:
        provider = get_provider()
    except BankNotConfigured:
        connected = sync.get_connection(conn) is not None
        return {"ok": False, "reason": "not_configured" if connected else "not_connected"}
    return sync.run(conn, provider, psu=psu, manual=manual)


def run_sync_once() -> dict:
    with db.session() as conn:
        return sync_or_reason(conn)


async def sync_loop() -> None:
    """Holt regelmäßig neue Umsätze – auch wenn die App gerade zu ist."""
    while True:
        await asyncio.sleep(SYNC_INTERVAL_HOURS * 3600)
        try:
            result = await asyncio.to_thread(run_sync_once)
            log.info("Automatischer Abruf: %s", result)
        except Exception:
            log.exception("Automatischer Abruf fehlgeschlagen")


def timezone_problem() -> str | None:
    """Meldung, wenn TZ gesetzt ist, aber nicht wirkt (fehlende Zeitzonendaten)."""
    tz = os.environ.get("TZ", "").strip()
    if not tz or tz.upper() in ("UTC", "ETC/UTC", "GMT"):
        return None
    if Path("/usr/share/zoneinfo", tz.lstrip(":")).is_file():
        return None
    return (f"TZ={tz} ist gesetzt, aber die Zeitzonendaten fehlen – die App rechnet in UTC. "
            "Container neu bauen (Dockerfile installiert tzdata).")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if problem := timezone_problem():
        log.warning(problem)
    with db.session() as conn:
        db.init(conn)
        auth.announce_setup_code(conn)
    task = asyncio.create_task(sync_loop()) if SYNC_INTERVAL_HOURS > 0 else None
    yield
    if task:
        task.cancel()


# Die automatische API-Dokumentation (/docs) ist nur im Entwicklungsmodus an.
DEBUG = os.environ.get("HAUSHALTSBUCH_DEBUG") == "1"
app = FastAPI(
    title="Münzwerk", lifespan=lifespan,
    docs_url="/docs" if DEBUG else None, redoc_url=None, openapi_url="/openapi.json" if DEBUG else None,
)

# ---------------------------------------------------------------------------
# Schutzschichten
# ---------------------------------------------------------------------------

# 1. Nur unter den eigenen Adressen antworten. Schützt gegen "DNS-Rebinding",
#    bei dem eine fremde Webseite den Browser auf den Pi umlenkt und mitliest.
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1,*.ts.net").split(",") if h.strip()]

# 2. Ändernde Anfragen brauchen einen eigenen Header. Den kann eine fremde
#    Webseite ohne Erlaubnis (CORS) nicht setzen, also auch nichts auslösen.
CSRF_HEADER = "x-haushaltsbuch"

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


@app.middleware("http")
async def protect(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get(CSRF_HEADER) != "1":
            return JSONResponse({"detail": "Anfrage abgelehnt."}, status_code=403)
    # 3. Finanzdaten nur nach Anmeldung per Passkey (siehe auth.py)
    if await asyncio.to_thread(auth.needs_login, request):
        response = JSONResponse({"detail": "Anmeldung nötig."}, status_code=401)
    else:
        response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if path.startswith("/api/"):
        # Finanzdaten nicht im Browser-Cache auf dem Handy ablegen
        response.headers["Cache-Control"] = "no-store"
    else:
        # App-Dateien bei jedem Öffnen kurz nachfragen (ETag, meist nur "unverändert").
        # Ohne diese Angabe behält Safari als Homescreen-App alte Fassungen tagelang.
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


# Als Letztes hinzugefügt = läuft als Erstes
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
app.include_router(accounts.router)
app.include_router(auth.router)
app.include_router(updates.router)
app.include_router(widget.router)


def get_db():
    with db.session() as conn:
        yield conn


# ---------------------------------------------------------------------------
# Kategorien
# ---------------------------------------------------------------------------

# Icon-Namen sind Schlüssel aus web/icons.js
ICON = r"^[A-Za-z][A-Za-z0-9]{0,29}$"
MONTH = r"^\d{4}-\d{2}$"


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    kind: str = Field(pattern="^(expense|income)$")
    icon: str = Field(default="tag", pattern=ICON)
    shift_next_month: bool = False
    is_savings: bool = False


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    icon: str | None = Field(default=None, pattern=ICON)
    shift_next_month: bool | None = None
    is_savings: bool | None = None


def _category(row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "kind": row["kind"], "icon": row["icon"],
        "sort": row["sort"], "shift_next_month": bool(row["shift_next_month"]),
        "is_savings": bool(row["is_savings"]),
    }


@app.get("/api/categories")
def list_categories(conn=Depends(get_db)):
    rows = conn.execute("SELECT * FROM categories ORDER BY kind, sort, name").fetchall()
    return [_category(r) for r in rows]


@app.post("/api/categories", status_code=201)
def create_category(body: CategoryIn, conn=Depends(get_db)):
    sort = conn.execute(
        "SELECT COALESCE(MAX(sort), -1) + 1 FROM categories WHERE kind = ?", (body.kind,)
    ).fetchone()[0]
    try:
        cur = conn.execute(
            "INSERT INTO categories (name, kind, icon, sort, shift_next_month, is_savings) VALUES (?,?,?,?,?,?)",
            (body.name.strip(), body.kind, body.icon, sort, int(body.shift_next_month), int(body.is_savings)),
        )
    except sqlite3.IntegrityError as exc:   # gleicher Name und gleiche Art gibt es schon
        raise HTTPException(409, "Diese Kategorie gibt es schon.") from exc
    return _category(conn.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.patch("/api/categories/{cat_id}")
def update_category(cat_id: int, body: CategoryPatch, conn=Depends(get_db)):
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (cat_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    if body.name is not None:
        conn.execute("UPDATE categories SET name = ? WHERE id = ?", (body.name.strip(), cat_id))
    if body.icon is not None:
        conn.execute("UPDATE categories SET icon = ? WHERE id = ?", (body.icon, cat_id))
    if body.shift_next_month is not None:
        conn.execute("UPDATE categories SET shift_next_month = ? WHERE id = ?", (int(body.shift_next_month), cat_id))
        ledger.recompute_budget_months(conn)
    if body.is_savings is not None:
        conn.execute("UPDATE categories SET is_savings = ? WHERE id = ?", (int(body.is_savings), cat_id))
    return _category(conn.execute("SELECT * FROM categories WHERE id = ?", (cat_id,)).fetchone())


@app.delete("/api/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int, conn=Depends(get_db)):
    # Umsätze dieser Kategorie wandern zurück in "Zuordnen".
    conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    ledger.recompute_budget_months(conn)


# ---------------------------------------------------------------------------
# Regeln
# ---------------------------------------------------------------------------

@app.get("/api/rules")
def list_rules(conn=Depends(get_db)):
    rows = conn.execute(
        "SELECT r.id, r.pattern, r.source, r.category_id, c.name AS category, c.kind "
        "FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.source DESC, r.pattern"
    ).fetchall()
    return [dict(r) for r in rows]



@app.delete("/api/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, conn=Depends(get_db)):
    conn.execute("DELETE FROM rules WHERE id = ?", (rule_id,))


# ---------------------------------------------------------------------------
# Fixkosten-Korrekturen
# ---------------------------------------------------------------------------
# Die Erkennung selbst läuft in der App (web/analytics.js). Hier wird nur
# gespeichert, wenn der Nutzer sie für einen Empfänger korrigiert.

class OverrideIn(BaseModel):
    pattern: str = Field(min_length=1, max_length=120)
    is_fixed: bool


@app.get("/api/recurring-overrides")
def list_overrides(conn=Depends(get_db)):
    return [
        {"pattern": r["pattern"], "is_fixed": bool(r["is_fixed"])}
        for r in conn.execute("SELECT * FROM recurring_overrides ORDER BY pattern")
    ]


@app.put("/api/recurring-overrides")
def set_override(body: OverrideIn, conn=Depends(get_db)):
    conn.execute(
        "INSERT INTO recurring_overrides (pattern, is_fixed) VALUES (?, ?) "
        "ON CONFLICT(pattern) DO UPDATE SET is_fixed = excluded.is_fixed",
        (ledger.normalize(body.pattern), int(body.is_fixed)),
    )
    return {"ok": True}


@app.delete("/api/recurring-overrides", status_code=204)
def delete_override(pattern: str = Query(max_length=120), conn=Depends(get_db)):
    conn.execute("DELETE FROM recurring_overrides WHERE pattern = ?", (ledger.normalize(pattern),))


# ---------------------------------------------------------------------------
# Umsätze
# ---------------------------------------------------------------------------

TX_SELECT = (
    "SELECT t.*, c.name AS category, c.icon AS category_icon, c.kind AS category_kind "
    "FROM transactions t LEFT JOIN categories c ON c.id = t.category_id "
)


def _tx(row) -> dict:
    d = dict(row)
    d["budget_month_manual"] = bool(d["budget_month_manual"])
    d["pending"] = bool(d.get("pending"))
    d["shifted"] = d["budget_month"] != d["booking_date"][:7]
    return d


@app.get("/api/transactions")
def list_transactions(month: str | None = Query(default=None, pattern=MONTH), uncategorized: bool = False, conn=Depends(get_db)):
    where, args = [], []
    if month:
        where.append("t.budget_month = ?")
        args.append(month)
    if uncategorized:
        where.append("t.category_id IS NULL")
    sql = TX_SELECT + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY t.booking_date DESC, t.imported_at DESC"
    return [_tx(r) for r in conn.execute(sql, args).fetchall()]


class TxPatch(BaseModel):
    category_id: int | None = None
    set_category: bool = False          # True, wenn category_id gesetzt/entfernt werden soll
    remember: bool = False              # Regel aus dem Empfänger anlegen
    apply_similar: bool = False         # alle Umsätze vom gleichen Empfänger mit zuordnen
    budget_month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    budget_month_auto: bool = False     # Automatik wiederherstellen


@app.patch("/api/transactions/{tx_id}")
def update_transaction(tx_id: str, body: TxPatch, conn=Depends(get_db)):
    extra = {}
    try:
        if body.set_category:
            extra = ledger.with_undo(conn, "Zuordnung", lambda: ledger.assign_category(
                conn, tx_id, body.category_id, body.remember, body.apply_similar))
            extra["undo_count"] = ledger.undo_count(conn)
        if body.budget_month_auto:
            ledger.set_budget_month(conn, tx_id, None)
        elif body.budget_month:
            ledger.set_budget_month(conn, tx_id, body.budget_month)
    except KeyError as exc:
        raise HTTPException(404) from exc
    row = conn.execute(TX_SELECT + "WHERE t.id = ?", (tx_id,)).fetchone()
    return {**_tx(row), **extra}


@app.get("/api/undo")
def undo_status(conn=Depends(get_db)):
    return {"count": ledger.undo_count(conn)}


@app.post("/api/undo")
def undo(conn=Depends(get_db)):
    result = ledger.undo_last(conn)
    if result is None:
        raise HTTPException(409, "Nichts mehr rückgängig zu machen.")
    return result


# ---------------------------------------------------------------------------
# Einstellungen
# ---------------------------------------------------------------------------

class SettingsPatch(BaseModel):
    shift_from_day: int | None = Field(default=None, ge=1, le=31)
    large_expense_cents: int | None = Field(default=None, ge=1000, le=10_000_000)


def _put_setting(conn, key: str, value) -> None:
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


@app.get("/api/version")
def version():
    return {"version": __version__}


@app.get("/api/settings")
def get_settings(conn=Depends(get_db)):
    return {
        "shift_from_day": int(db.get_setting(conn, "shift_from_day")),
        "large_expense_cents": int(db.get_setting(conn, "large_expense_cents")),
    }


@app.patch("/api/settings")
def update_settings(body: SettingsPatch, conn=Depends(get_db)):
    if body.shift_from_day is not None:
        _put_setting(conn, "shift_from_day", body.shift_from_day)
        ledger.recompute_budget_months(conn)
    if body.large_expense_cents is not None:
        _put_setting(conn, "large_expense_cents", body.large_expense_cents)
    return get_settings(conn)


# ---------------------------------------------------------------------------
# Bank
# ---------------------------------------------------------------------------

@app.get("/api/bank/status")
def bank_status(conn=Depends(get_db)):
    return sync.status(conn)


@app.post("/api/bank/connect")
def bank_connect(request: Request, conn=Depends(get_db)):
    base = os.environ.get("PUBLIC_URL", str(request.base_url)).rstrip("/")
    try:
        start = get_provider().start_connect(f"{base}/api/bank/callback")
    except BankNotConfigured as exc:
        raise HTTPException(409, str(exc) or "Die Bank ist noch nicht eingerichtet.") from exc
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('pending_state', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (start.state,),
    )
    return {"url": start.url}


@app.get("/api/bank/callback")
def bank_callback(code: str, state: str, conn=Depends(get_db)):
    expected = conn.execute("SELECT value FROM settings WHERE key = 'pending_state'").fetchone()
    if expected is None or expected["value"] != state:
        raise HTTPException(400, "Ungültige Rückmeldung der Bank.")
    conn.execute("DELETE FROM settings WHERE key = 'pending_state'")
    provider = get_provider()
    result = provider.finish_connect(code)
    sync.save_connection(conn, provider.name, result.session_id, result.account_ids, result.valid_until, result.accounts)
    conn.commit()   # Verbindung speichern, bevor der erste Abruf wieder die Bank fragt
    sync.run(conn, provider)
    return RedirectResponse("/?verbunden=1")


@app.post("/api/bank/sync")
def bank_sync(request: Request, manual: bool = False, conn=Depends(get_db)):
    return sync_or_reason(conn, psu=psu_headers(request), manual=manual)


# Die App selbst (muss als Letztes kommen, damit /api Vorrang hat).
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
