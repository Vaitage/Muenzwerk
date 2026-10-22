"""iPhone-Mitteilungen über Web Push (z. B. „Gehalt ist da“).

Seit iOS 16.4 können Web-Apps auf dem Homescreen Mitteilungen bekommen. Der Pi
schickt sie an den Mitteilungsdienst des Geräts (bei iPhones: Apple), der sie
zustellt. Der Inhalt ist Ende-zu-Ende verschlüsselt (RFC 8291, aes128gcm); der
Dienst sieht weder Betrag noch Namen. Ausweis des Absenders: VAPID (RFC 8292).
Alles mit `cryptography` (kommt mit PyJWT[crypto]) – kein zusätzliches Paket.
"""

import base64
import json
import logging
import os
import sqlite3
import time
from datetime import date, timedelta
from urllib.parse import urlparse

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db

log = logging.getLogger("haushaltsbuch")
router = APIRouter(prefix="/api/push")

# Nur an echte Mitteilungsdienste senden (der Pi soll keine beliebigen Adressen aufrufen)
PUSH_HOSTS = (".push.apple.com", "fcm.googleapis.com", ".push.services.mozilla.com", ".notify.windows.com")
# Kontaktadresse im VAPID-Ausweis (verlangt der Dienst; wird nicht angezeigt).
# Apple lehnt Ausweise mit Platzhalter-Adressen ab (403 BadJwtToken), z. B. example.com
# oder localhost. Deshalb: PUSH_CONTACT, sonst die https-Adresse der Installation.
_FAKE_HOSTS = ("example.com", "example.org", "example.net", "localhost", ".local", ".invalid", ".test")


def _usable_contact(value: str) -> bool:
    value = value.strip()
    if " " in value:
        return False
    if value.startswith("mailto:"):
        host = value[7:].rpartition("@")[2].lower()
    elif value.startswith("https://"):
        host = (urlparse(value).hostname or "").lower()
    else:
        return False
    return "." in host and not any(host == h.lstrip(".") or host.endswith(h) for h in _FAKE_HOSTS)


def contact() -> str:
    for value in (os.environ.get("PUSH_CONTACT", ""), os.environ.get("PUBLIC_URL", "").rstrip("/")):
        if _usable_contact(value):
            return value.strip()
    return "mailto:muenzwerk@example.com"      # geht bei Apple nicht – die App weist darauf hin
SALARY_MAX_AGE_DAYS = 3        # ältere Gehaltsbuchungen (z. B. beim ersten Abruf) lösen nichts aus


def get_db():
    with db.session() as conn:
        yield conn


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _setting(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def _put(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, value))


# --------------------------------------------------------------- Schlüssel des Pi (VAPID)

def vapid_key(conn: sqlite3.Connection) -> ec.EllipticCurvePrivateKey:
    """Eigener Schlüssel dieser Installation; wird beim ersten Mal erzeugt (liegt in der Datenbank)."""
    pem = _setting(conn, "vapid_private")
    if pem:
        return serialization.load_pem_private_key(pem.encode(), password=None)
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    _put(conn, "vapid_private", pem)
    return key


def public_key_b64(key: ec.EllipticCurvePrivateKey) -> str:
    return _b64(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))


def vapid_header(key: ec.EllipticCurvePrivateKey, endpoint: str) -> str:
    u = urlparse(endpoint)
    token = jwt.encode({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": contact()},
                       key, algorithm="ES256")
    return f"vapid t={token}, k={public_key_b64(key)}"


# --------------------------------------------------------------- Verschlüsselung (RFC 8291)

def encrypt(payload: bytes, p256dh: str, auth: str, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    ua_public = _unb64(p256dh)
    auth_secret = _unb64(auth)
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = server_key.public_key().public_bytes(serialization.Encoding.X962,
                                                    serialization.PublicFormat.UncompressedPoint)
    shared = server_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public))
    ikm = HKDF(hashes.SHA256(), 32, auth_secret, b"WebPush: info\x00" + ua_public + as_public).derive(shared)
    salt = salt or os.urandom(16)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)     # \x02 = letzter Datensatz
    return salt + (4096).to_bytes(4, "big") + bytes([len(as_public)]) + as_public + body


def allowed_endpoint(endpoint: str) -> bool:
    u = urlparse(endpoint)
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h.lstrip(".") or host.endswith(h) for h in PUSH_HOSTS)


def send(conn: sqlite3.Connection, title: str, body: str, url: str = "/") -> int:
    """Schickt eine Mitteilung an alle Abos. Liefert die Zahl der erfolgreichen Zustellungen.
    Abgelaufene Abos (404/410) werden gelöscht. Fehler stoppen nie den Abruf."""
    subs = conn.execute("SELECT * FROM push_subscriptions").fetchall()
    if not subs:
        return 0
    key = vapid_key(conn)
    payload = json.dumps({"title": title, "body": body, "url": url}, ensure_ascii=False).encode()
    ok, errors = 0, []
    for s in subs:
        if not allowed_endpoint(s["endpoint"]):
            continue
        try:
            resp = httpx.post(s["endpoint"], content=encrypt(payload, s["p256dh"], s["auth"]), timeout=10, headers={
                "Authorization": vapid_header(key, s["endpoint"]),
                "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
                "TTL": str(24 * 3600), "Urgency": "normal",
            })
            if resp.status_code in (404, 410):
                conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (s["endpoint"],))
                errors.append(f"{resp.status_code} – Anmeldung abgelaufen")
            elif resp.is_success:
                ok += 1
            else:
                errors.append(f"{resp.status_code} {_reason(resp)}".strip())
                log.warning("Mitteilung abgelehnt (%s, Absender %s): %s", resp.status_code, contact(), resp.text[:200])
        except Exception as exc:
            errors.append(type(exc).__name__)
            log.exception("Mitteilung konnte nicht gesendet werden")
    # Letzten Fehler merken, damit die App ihn unter „Mitteilungen“ zeigen kann
    if ok:
        conn.execute("DELETE FROM settings WHERE key = 'push_last_error'")
    elif errors:
        _put(conn, "push_last_error", "; ".join(dict.fromkeys(errors))[:200])
    return ok


def _reason(resp: httpx.Response) -> str:
    """Kurzer Grund aus der Antwort des Dienstes (Apple: {"reason": "BadJwtToken"})."""
    try:
        data = resp.json()
        return str(data.get("reason") or data.get("message") or data.get("error") or "")[:80]
    except Exception:
        return resp.text.strip()[:80]


# --------------------------------------------------------------- Gehalt ist da

def _euro(cents: int) -> str:
    s = f"{abs(cents) / 100:,.2f}"
    if os.environ.get("DEFAULT_LANGUAGE", "de").lower().startswith("de"):
        s = s.replace(",", "X").replace(".", ",").replace("X", ".")
        return f"{s} €"
    return f"€{s}"


def salary_message(conn: sqlite3.Connection, new_ids: list[str]) -> tuple[str, str] | None:
    """Neue Gehaltsbuchung unter den gerade importierten Umsätzen? (Kategorie mit „Folgemonat“)"""
    if not new_ids:
        return None
    since = (date.today() - timedelta(days=SALARY_MAX_AGE_DAYS)).isoformat()
    marks = ",".join("?" * len(new_ids))
    row = conn.execute(
        f"SELECT t.amount_cents, t.counterparty FROM transactions t JOIN categories c ON c.id = t.category_id "
        f"WHERE t.id IN ({marks}) AND t.pending = 0 AND t.amount_cents > 0 AND c.kind = 'income' "
        f"AND c.shift_next_month = 1 AND t.booking_date >= ? ORDER BY t.amount_cents DESC LIMIT 1",
        (*new_ids, since),
    ).fetchone()
    if row is None:
        return None
    de = os.environ.get("DEFAULT_LANGUAGE", "de").lower().startswith("de")
    title = "Gehalt ist da" if de else "Your salary is in"
    if _setting(conn, "push_show_amount") == "0":
        body = "Tippen für deinen neuen Monat." if de else "Tap to see your new month."
    else:
        who = (row["counterparty"] or "").strip()[:60]
        amount = "+" + _euro(row["amount_cents"])
        body = (f"{amount}{' von ' + who if who else ''}. Tippen für deinen neuen Monat." if de
                else f"{amount}{' from ' + who if who else ''}. Tap to see your new month.")
    return title, body


def notify_new_transactions(conn: sqlite3.Connection, new_ids: list[str]) -> None:
    msg = salary_message(conn, new_ids)
    if msg:
        send(conn, *msg)


# --------------------------------------------------------------- Schnittstelle (nur angemeldet)

class Keys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=200)
    auth: str = Field(min_length=8, max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)
    keys: Keys


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)


class PushSettings(BaseModel):
    show_amount: bool


@router.get("")
def push_status(conn=Depends(get_db)):
    return {
        "public_key": public_key_b64(vapid_key(conn)),
        "subscriptions": conn.execute("SELECT COUNT(*) FROM push_subscriptions").fetchone()[0],
        "show_amount": _setting(conn, "push_show_amount") != "0",
        "last_error": _setting(conn, "push_last_error"),
        # Apple braucht eine echte Kontaktadresse (PUSH_CONTACT oder https-PUBLIC_URL)
        "contact_ok": contact() != "mailto:muenzwerk@example.com",
        # Wann der Pi im Hintergrund abruft (dann kommt auch die Mitteilung)
        "sync_times": os.environ.get("SYNC_TIMES", "06:30,10:00,14:00,20:00")
        if os.environ.get("SYNC_INTERVAL_HOURS", "6") not in ("0", "0.0") else "",
    }


@router.post("/subscribe")
def subscribe(body: SubscriptionIn, conn=Depends(get_db)):
    if not allowed_endpoint(body.endpoint):
        raise HTTPException(422, "Unbekannter Mitteilungsdienst.")
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), _unb64(body.keys.p256dh))
    except ValueError as exc:
        raise HTTPException(422, "Ungültiger Schlüssel.") from exc
    conn.execute(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?) "
        "ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
        (body.endpoint, body.keys.p256dh, body.keys.auth),
    )
    return {"ok": True}


@router.post("/unsubscribe")
def unsubscribe(body: EndpointIn, conn=Depends(get_db)):
    conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (body.endpoint,))
    return {"ok": True}


@router.patch("/settings")
def update_settings(body: PushSettings, conn=Depends(get_db)):
    _put(conn, "push_show_amount", "1" if body.show_amount else "0")
    return push_status(conn)


@router.post("/test")
def test_message(conn=Depends(get_db)):
    de = os.environ.get("DEFAULT_LANGUAGE", "de").lower().startswith("de")
    if not conn.execute("SELECT 1 FROM push_subscriptions LIMIT 1").fetchone():
        raise HTTPException(409, "Auf dem Pi ist kein Gerät für Mitteilungen angemeldet.")
    sent = send(conn, "Münzwerk", "Mitteilungen funktionieren." if de else "Notifications work.")
    if not sent:
        reason = _setting(conn, "push_last_error") or "?"
        conn.commit()        # Fehler gemerkt lassen, auch wenn die Antwort ein Fehler ist
        raise HTTPException(502, f"Der Mitteilungsdienst hat abgelehnt: {reason}")
    return {"sent": sent}
