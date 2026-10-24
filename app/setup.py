"""Einrichtungs-Assistent: Bankanbindung (Enable Banking) direkt in der App einrichten.

Statt .env und Schlüsseldatei per SSH: App-ID und .pem-Inhalt kommen über die App
(nur angemeldet, Schreibschutz-Header wie überall). Der Schlüssel landet mit Rechten nur
für den Besitzer im Datenordner, die übrigen Angaben in der Tabelle settings. Danach gilt
er sofort – ohne Neustart, und die App braucht dafür keinen Zugriff auf Docker.
"""

import logging
import os
import re
import tempfile

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import db
from .bank import KEY_FILE_NAME, BankNotConfigured, bank_config, data_dir, get_provider, setup_problem

log = logging.getLogger("haushaltsbuch")
router = APIRouter(prefix="/api/setup")

APP_ID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
BANK_NAME = re.compile(r"^[\w .,&()'/+-]{1,80}$")


def get_db():
    with db.session() as conn:
        yield conn


def _put(conn, key: str, value: str) -> None:
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def redirect_url(request: Request | None = None) -> str:
    base = os.environ.get("PUBLIC_URL", "").rstrip("/")
    if not base and request is not None:
        base = str(request.base_url).rstrip("/")
    return f"{base}/api/bank/callback"


@router.get("")
def setup_status(request: Request, conn=Depends(get_db)):
    cfg = bank_config(conn)
    return {
        "provider": cfg["provider"],
        "problem": setup_problem(conn),
        "redirect_url": redirect_url(request),
        "public_url_ok": os.environ.get("PUBLIC_URL", "").startswith("https://"),
        "app_id": cfg["app_id"],
        "key_present": bool(cfg["key_file"]) and os.path.isfile(cfg["key_file"]),
        "bank": cfg["bank"],
        "country": cfg["country"],
        "connected": conn.execute("SELECT 1 FROM bank_connection WHERE id = 1").fetchone() is not None,
    }


class EnableBankingIn(BaseModel):
    app_id: str = Field(min_length=36, max_length=36)
    key_pem: str = Field(min_length=100, max_length=20000)


def _check_key(pem: str) -> None:
    try:
        key = serialization.load_pem_private_key(pem.encode(), password=None)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "Das ist kein gültiger privater Schlüssel (.pem von Enable Banking).") from exc
    if not isinstance(key, rsa.RSAPrivateKey):
        raise HTTPException(422, "Enable Banking braucht einen RSA-Schlüssel.")


def _write_key(pem: str) -> None:
    """Schreibt den Schlüssel atomar mit Rechten 600 in den Datenordner."""
    folder = data_dir()
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".eb-", suffix=".pem")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(pem.strip() + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, os.path.join(folder, KEY_FILE_NAME))
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


@router.post("/enablebanking")
def save_enablebanking(body: EnableBankingIn, request: Request, conn=Depends(get_db)):
    if not APP_ID.match(body.app_id.strip()):
        raise HTTPException(422, "Die App-ID hat nicht das richtige Format (z. B. 8823dfc8-b56a-…).")
    _check_key(body.key_pem)
    _write_key(body.key_pem)
    _put(conn, "bank_provider", "enablebanking")
    _put(conn, "eb_app_id", body.app_id.strip().lower())
    _put(conn, "eb_key", "data")
    conn.commit()
    return test_connection(request, conn)


def _explain(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Enable Banking kennt diese Kombination aus App-ID und Schlüssel nicht. Passt die .pem-Datei zu dieser App?"
        return f"Enable Banking antwortet mit Fehler {code}."
    if isinstance(exc, httpx.HTTPError):
        return "Enable Banking ist gerade nicht erreichbar. Hat der Pi Internet?"
    return "Unerwarteter Fehler beim Prüfen."


@router.post("/test")
def test_connection(request: Request, conn=Depends(get_db)):
    """Fragt Enable Banking nach der eigenen App: prüft App-ID, Schlüssel und Redirect-URL."""
    try:
        provider = get_provider(conn)
    except BankNotConfigured as exc:
        return {"ok": False, "message": str(exc)}
    if not hasattr(provider, "application"):
        return {"ok": False, "message": "Für diese Installation ist Enable Banking nicht gewählt."}
    try:
        app = provider.application()
    except Exception as exc:          # Fehlerdetails nur ins Log
        log.warning("Prüfung bei Enable Banking fehlgeschlagen: %s", exc)
        return {"ok": False, "message": _explain(exc)}
    wanted = redirect_url(request)
    urls = [u.rstrip("/") for u in app.get("redirect_urls") or []]
    return {
        "ok": True,
        "name": app.get("name") or "",
        "environment": app.get("environment") or "",
        "active": app.get("active", True),
        "redirect_ok": wanted.rstrip("/") in urls,
        "redirect_url": wanted,
    }


@router.get("/banks")
def list_banks(country: str = "DE", conn=Depends(get_db)):
    if not re.fullmatch(r"[A-Z]{2}", country):
        raise HTTPException(422, "Länderkürzel wie DE oder AT.")
    try:
        provider = get_provider(conn)
        banks = provider.banks(country) if hasattr(provider, "banks") else []
    except BankNotConfigured as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        log.warning("Bankliste nicht geladen: %s", exc)
        raise HTTPException(502, _explain(exc)) from exc
    return sorted(banks, key=lambda b: b["name"].lower())


class BankIn(BaseModel):
    bank: str = Field(min_length=1, max_length=80)
    country: str = Field(pattern=r"^[A-Z]{2}$")


@router.put("/bank")
def choose_bank(body: BankIn, conn=Depends(get_db)):
    if not BANK_NAME.match(body.bank):
        raise HTTPException(422, "Ungültiger Bankname.")
    _put(conn, "eb_bank", body.bank)
    _put(conn, "eb_country", body.country)
    return {"bank": body.bank, "country": body.country}
