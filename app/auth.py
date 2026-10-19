"""Anmeldung per Passkey (WebAuthn) – auf dem iPhone also mit Face ID.

Es gibt genau einen Nutzer. Auf dem Pi liegt nur der öffentliche Teil des
Passkeys; der geheime Teil bleibt im Schlüsselbund des iPhones.

- Solange noch kein Passkey eingerichtet ist, braucht der erste Passkey den
  Einrichtungscode. Er steht im Log des Containers und lässt sich jederzeit
  anzeigen:  docker exec haushaltsbuch python -m app.auth code
  So kann kein anderes Gerät im Tailnet die frische Installation übernehmen.
  Weitere Passkeys nur, wer angemeldet ist.
- Nach der Anmeldung gilt eine Sitzung (Cookie). Sie endet nach
  AUTH_IDLE_MINUTES ohne Benutzung und spätestens nach AUTH_MAX_HOURS.
- Passkeys verloren (z. B. neues iPhone ohne iCloud-Schlüsselbund)?
  Auf dem Pi:  docker exec haushaltsbuch python -m app.auth zuruecksetzen
- Wird ein Passkey gelöscht, enden alle Sitzungen außer der eigenen.
"""

import hashlib
import logging
import os
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from . import db

log = logging.getLogger("uvicorn.error")



def auth_required() -> bool:
    """Abschalten nur für Tests und die Entwicklung am PC (HAUSHALTSBUCH_AUTH=0)."""
    return os.environ.get("HAUSHALTSBUCH_AUTH", "1") != "0"

IDLE_MINUTES = int(os.environ.get("AUTH_IDLE_MINUTES", "15"))
MAX_HOURS = int(os.environ.get("AUTH_MAX_HOURS", "12"))


def cookie_name(base: str = "hb_sitzung") -> str:
    """Cookies unterscheiden nicht nach Port. Laufen zwei Installationen unter
    derselben Adresse (z. B. :443 und :8443), braucht jede ihr eigenes Cookie."""
    port = urlsplit(os.environ.get("PUBLIC_URL", "")).port
    return base if port in (None, 443) else f"{base}_{port}"


def challenge_cookie() -> str:
    return cookie_name("hb_challenge")

USER_ID = b"haushaltsbuch-nutzer"
CHALLENGE_SECONDS = 300

# Ohne Anmeldung erreichbar: die Anmeldung selbst und die Rückleitung von der
# Bank (die kommt oft in Safari statt in der Homescreen-App an und ist über
# den Zufallswert "state" abgesichert).
OPEN_PATHS = ("/api/auth/", "/api/bank/callback")

router = APIRouter(prefix="/api/auth")

# Es gibt nur einen Server-Prozess, daher reicht der Speicher. Jede Anfrage
# bekommt ihre eigene Challenge (Kennung im kurzlebigen Cookie). So kann ein
# anderes Gerät eine laufende Anmeldung nicht durch eigene Anfragen ungültig machen.
_challenges: dict[str, tuple[str, bytes, float]] = {}
MAX_CHALLENGES = 100

# Einrichtungscode: ohne die verwechselbaren Zeichen 0/O, 1/I/L
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def get_db():
    with db.session() as conn:
        yield conn


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

def _origin(request: Request) -> str:
    return os.environ.get("PUBLIC_URL", str(request.base_url)).rstrip("/")


def _rp_id(request: Request) -> str:
    return urlsplit(_origin(request)).hostname or "localhost"


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _secure(request: Request) -> bool:
    return _origin(request).startswith("https://")


def _remember_challenge(request: Request, response: Response, kind: str, challenge: bytes) -> None:
    now = time.monotonic()
    for key in [k for k, (_, _, until) in _challenges.items() if until < now]:
        del _challenges[key]
    while len(_challenges) >= MAX_CHALLENGES:   # Älteste zuerst verwerfen
        del _challenges[next(iter(_challenges))]
    cid = secrets.token_urlsafe(16)
    _challenges[cid] = (kind, challenge, now + CHALLENGE_SECONDS)
    response.set_cookie(
        challenge_cookie(), cid, max_age=CHALLENGE_SECONDS, httponly=True,
        secure=_secure(request), samesite="strict", path="/api/auth/",
    )


def _take_challenge(request: Request, kind: str) -> bytes:
    cid = request.cookies.get(challenge_cookie(), "")
    stored_kind, challenge, until = _challenges.pop(cid, ("", b"", 0.0))
    if stored_kind != kind or not challenge or time.monotonic() > until:
        raise HTTPException(400, "Zeit abgelaufen, bitte noch einmal versuchen.")
    return challenge


# ---------------------------------------------------------------------------
# Einrichtungscode für den ersten Passkey
# ---------------------------------------------------------------------------

def _normalize_code(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def setup_code(conn: sqlite3.Connection) -> str:
    """Liefert den Einrichtungscode und legt ihn bei Bedarf an (Form ABCD-EFGH)."""
    row = conn.execute("SELECT value FROM settings WHERE key = 'setup_code'").fetchone()
    if row:
        return row["value"]
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    code = f"{raw[:4]}-{raw[4:]}"
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('setup_code', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (code,),
    )
    return code


def announce_setup_code(conn: sqlite3.Connection) -> None:
    """Beim Start: Ohne Passkey den Code ins Log schreiben, sonst einen alten verwerfen."""
    if not auth_required():
        log.warning("ACHTUNG: HAUSHALTSBUCH_AUTH=0 – die Anmeldung ist abgeschaltet, "
                    "jeder, der die App erreicht, sieht alle Daten. Nur zum lokalen Testen!")
        return
    if not os.environ.get("PUBLIC_URL", "").startswith("https://"):
        log.warning("PUBLIC_URL ist nicht gesetzt oder ohne https:// – Passkeys funktionieren "
                    "dann nur über localhost und das Sitzungs-Cookie ist nicht als Secure markiert.")
    if passkey_count(conn) == 0:
        log.warning("Noch kein Passkey eingerichtet. Einrichtungscode: %s", setup_code(conn))
    else:
        conn.execute("DELETE FROM settings WHERE key = 'setup_code'")


def _check_setup_code(conn: sqlite3.Connection, given: str) -> None:
    expected = _normalize_code(setup_code(conn))
    if not secrets.compare_digest(_normalize_code(given).encode(), expected.encode()):
        raise HTTPException(403, "Einrichtungscode falsch.")


def passkey_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM passkeys").fetchone()[0]


def session_valid(conn: sqlite3.Connection, token: str | None) -> bool:
    """Prüft das Sitzungs-Cookie und verlängert die Sitzung bei Benutzung."""
    if not token:
        return False
    row = conn.execute("SELECT * FROM auth_sessions WHERE token_hash = ?", (_hash(token),)).fetchone()
    if row is None:
        return False
    now = _now()
    last_seen = datetime.fromisoformat(row["last_seen"])
    if now >= datetime.fromisoformat(row["expires"]) or now - last_seen > timedelta(minutes=IDLE_MINUTES):
        conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (row["token_hash"],))
        return False
    # Nicht bei jeder Anfrage schreiben, das schont die SD-Karte
    if now - last_seen > timedelta(seconds=60):
        conn.execute("UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?", (now.isoformat(), row["token_hash"]))
    return True


def is_logged_in(request: Request, conn: sqlite3.Connection) -> bool:
    return not auth_required() or session_valid(conn, request.cookies.get(cookie_name()))


def needs_login(request: Request) -> bool:
    """Für die Schutzschicht in main.py: Muss diese Anfrage angemeldet sein?"""
    path = request.url.path
    if not auth_required() or not path.startswith("/api/") or path.startswith(OPEN_PATHS):
        return False
    with db.session() as conn:
        return not session_valid(conn, request.cookies.get(cookie_name()))


def _end_other_sessions(conn: sqlite3.Connection, request: Request) -> int:
    """Beendet alle Sitzungen außer der dieser Anfrage."""
    token = request.cookies.get(cookie_name()) or ""
    cur = conn.execute("DELETE FROM auth_sessions WHERE token_hash != ?", (_hash(token),))
    return cur.rowcount


def _start_session(conn: sqlite3.Connection, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = _now()
    conn.execute("DELETE FROM auth_sessions WHERE expires < ?", (now.isoformat(),))
    conn.execute(
        "INSERT INTO auth_sessions (token_hash, created, last_seen, expires) VALUES (?, ?, ?, ?)",
        (_hash(token), now.isoformat(), now.isoformat(), (now + timedelta(hours=MAX_HOURS)).isoformat()),
    )
    response.set_cookie(
        cookie_name(), token, max_age=MAX_HOURS * 3600, httponly=True,
        secure=_secure(request), samesite="lax", path="/",
    )


# ---------------------------------------------------------------------------
# Schnittstelle
# ---------------------------------------------------------------------------

@router.get("/status")
def status(request: Request, conn=Depends(get_db)):
    count = passkey_count(conn)
    return {
        "required": auth_required(),
        "logged_in": is_logged_in(request, conn),
        "has_passkey": count > 0,
        "idle_minutes": IDLE_MINUTES,
    }


class RegisterStart(BaseModel):
    setup_code: str = Field(default="", max_length=20)


@router.post("/register/options")
def register_options(request: Request, body: RegisterStart | None = None, conn=Depends(get_db)):
    if passkey_count(conn) == 0:
        if auth_required():
            _check_setup_code(conn, body.setup_code if body else "")
    elif not is_logged_in(request, conn):
        raise HTTPException(403, "Weitere Passkeys nur nach der Anmeldung.")
    existing = [r["id"] for r in conn.execute("SELECT id FROM passkeys")]
    options = generate_registration_options(
        rp_id=_rp_id(request),
        rp_name="Münzwerk",
        user_id=USER_ID,
        user_name="Münzwerk",
        user_display_name="Münzwerk",
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(i)) for i in existing],
    )
    response = Response(options_to_json(options), media_type="application/json")
    _remember_challenge(request, response, "register", options.challenge)
    return response


class CredentialIn(BaseModel):
    credential: dict
    name: str = Field(default="", max_length=200)
    setup_code: str = Field(default="", max_length=20)


@router.post("/register/verify")
def register_verify(body: CredentialIn, request: Request, response: Response, conn=Depends(get_db)):
    first = passkey_count(conn) == 0
    if first:
        if auth_required():
            _check_setup_code(conn, body.setup_code)
    elif not is_logged_in(request, conn):
        raise HTTPException(403, "Weitere Passkeys nur nach der Anmeldung.")
    try:
        verified = verify_registration_response(
            credential=body.credential,
            expected_challenge=_take_challenge(request, "register"),
            expected_rp_id=_rp_id(request),
            expected_origin=_origin(request),
            require_user_verification=True,
        )
    except HTTPException:
        raise
    except Exception as exc:
        # Einzelheiten nur ins Log, nicht an den Aufrufer
        log.info("Passkey-Registrierung abgelehnt: %s", exc)
        raise HTTPException(400, "Passkey konnte nicht geprüft werden")
    name = (body.name or "").strip()[:40] or f"Passkey vom {_now():%d.%m.%Y}"
    conn.execute(
        "INSERT INTO passkeys (id, public_key, sign_count, name, created) VALUES (?, ?, ?, ?, ?)",
        (bytes_to_base64url(verified.credential_id), verified.credential_public_key,
         verified.sign_count, name, _now().isoformat()),
    )
    if first:
        conn.execute("DELETE FROM settings WHERE key = 'setup_code'")
        _start_session(conn, request, response)
    response.delete_cookie(challenge_cookie(), path="/api/auth/")
    return {"ok": True}


@router.post("/login/options")
def login_options(request: Request, conn=Depends(get_db)):
    ids = [r["id"] for r in conn.execute("SELECT id FROM passkeys")]
    if not ids:
        raise HTTPException(409, "Noch kein Passkey eingerichtet.")
    options = generate_authentication_options(
        rp_id=_rp_id(request),
        allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(i)) for i in ids],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    response = Response(options_to_json(options), media_type="application/json")
    _remember_challenge(request, response, "login", options.challenge)
    return response


@router.post("/login/verify")
def login_verify(body: CredentialIn, request: Request, response: Response, conn=Depends(get_db)):
    cred_id = str(body.credential.get("id", ""))
    row = conn.execute("SELECT * FROM passkeys WHERE id = ?", (cred_id,)).fetchone()
    if row is None:
        _challenges.pop(request.cookies.get(challenge_cookie(), ""), None)
        raise HTTPException(401, "Dieser Passkey ist hier nicht bekannt.")
    try:
        verified = verify_authentication_response(
            credential=body.credential,
            expected_challenge=_take_challenge(request, "login"),
            expected_rp_id=_rp_id(request),
            expected_origin=_origin(request),
            credential_public_key=row["public_key"],
            credential_current_sign_count=row["sign_count"],
            require_user_verification=True,
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Anmeldung fehlgeschlagen.")
    conn.execute(
        "UPDATE passkeys SET sign_count = ?, last_used = ? WHERE id = ?",
        (verified.new_sign_count, _now().isoformat(), cred_id),
    )
    _start_session(conn, request, response)
    response.delete_cookie(challenge_cookie(), path="/api/auth/")
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response, conn=Depends(get_db)):
    token = request.cookies.get(cookie_name())
    if token:
        conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_hash(token),))
    response.delete_cookie(cookie_name(), path="/")
    return {"ok": True}


def _require_login(request: Request, conn: sqlite3.Connection) -> None:
    if not is_logged_in(request, conn):
        raise HTTPException(401, "Anmeldung nötig.")


@router.get("/passkeys")
def list_passkeys(request: Request, conn=Depends(get_db)):
    _require_login(request, conn)
    rows = conn.execute("SELECT id, name, created, last_used FROM passkeys ORDER BY created").fetchall()
    return [dict(r) for r in rows]


@router.delete("/passkeys/{passkey_id}", status_code=204)
def delete_passkey(passkey_id: str, request: Request, conn=Depends(get_db)):
    _require_login(request, conn)
    # Den letzten nicht löschen: Ohne Passkey dürfte jedes Gerät im Tailnet
    # einen neuen anlegen.
    if passkey_count(conn) <= 1:
        raise HTTPException(409, "Der letzte Passkey kann nicht gelöscht werden.")
    conn.execute("DELETE FROM passkeys WHERE id = ?", (passkey_id,))
    # Ein verlorenes Gerät könnte noch angemeldet sein: alle anderen Sitzungen beenden
    _end_other_sessions(conn, request)


@router.post("/logout-others")
def logout_others(request: Request, conn=Depends(get_db)):
    _require_login(request, conn)
    return {"ended": _end_other_sessions(conn, request)}


# ---------------------------------------------------------------------------
# Notfall auf dem Pi:  python -m app.auth zuruecksetzen
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if sys.argv[1:] not in (["zuruecksetzen"], ["code"]):
        print("Aufruf: python -m app.auth zuruecksetzen   (alle Passkeys löschen)\n"
              "        python -m app.auth code            (Einrichtungscode anzeigen)")
        sys.exit(2)
    with db.session() as conn:
        db.init(conn)
        if sys.argv[1] == "code":
            if passkey_count(conn):
                print("Es ist schon ein Passkey eingerichtet, ein Einrichtungscode wird nicht gebraucht.")
            else:
                print(f"Einrichtungscode: {setup_code(conn)}")
            sys.exit(0)
        n = passkey_count(conn)
        conn.execute("DELETE FROM passkeys")
        conn.execute("DELETE FROM auth_sessions")
        conn.execute("DELETE FROM settings WHERE key = 'setup_code'")
        code = setup_code(conn)
    print(f"{n} Passkey(s) und alle Sitzungen gelöscht. Neuen Passkey in der App einrichten, "
          f"Einrichtungscode: {code}")
