"""Bankanbieter. Welcher genutzt wird, steuert die Variable BANK_PROVIDER."""

import os

from .base import BankNotConfigured, BankProvider, ConsentExpired, NoBankProvider


# Warum noch keine Bank verbunden werden kann (für Hinweise in der App)
SETUP_TEXT = {
    "no_provider": "Für diese Installation ist noch keine Bank eingerichtet.",
    "missing_app_id": "Die App-ID von Enable Banking fehlt.",
    "missing_key": "Der Schlüssel von Enable Banking fehlt.",
}

# Was der Einrichtungs-Assistent speichert (Tabelle settings). Es hat Vorrang vor der .env,
# damit sich alles in der App ändern lässt; ohne Eintrag gilt wie bisher die .env.
DB_KEYS = {"provider": "bank_provider", "app_id": "eb_app_id", "bank": "eb_bank", "country": "eb_country"}
KEY_FILE_NAME = "enablebanking.pem"


def data_dir() -> str:
    """Ordner der Datenbank (im Container /data) – dort liegt auch der vom Assistenten gespeicherte Schlüssel."""
    from .. import db

    return os.path.dirname(os.path.abspath(db.DB_PATH))


def _stored(conn) -> dict:
    def read(c):
        rows = c.execute("SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?)",
                         (*DB_KEYS.values(), "eb_key")).fetchall()
        return {r["key"]: r["value"] for r in rows}
    if conn is not None:
        return read(conn)
    from .. import db

    try:
        with db.session() as c:
            return read(c)
    except Exception:          # z. B. Tabelle noch nicht angelegt
        return {}


def bank_config(conn=None) -> dict:
    """Wirksame Bank-Einstellungen: Assistent (Datenbank) vor .env."""
    st = _stored(conn)
    key_file = (os.path.join(data_dir(), KEY_FILE_NAME) if st.get("eb_key") == "data"
                else os.environ.get("ENABLEBANKING_KEY_FILE", "").strip())
    return {
        "provider": (st.get("bank_provider") or os.environ.get("BANK_PROVIDER", "demo")).strip().lower(),
        "app_id": (st.get("eb_app_id") or os.environ.get("ENABLEBANKING_APP_ID", "")).strip(),
        "key_file": key_file,
        "bank": st.get("eb_bank") or os.environ.get("ENABLEBANKING_BANK", "ING"),
        "country": st.get("eb_country") or os.environ.get("ENABLEBANKING_COUNTRY", "DE"),
        "from_app": bool(st),
    }


def setup_problem(conn=None) -> str | None:
    """Schlüssel aus SETUP_TEXT, wenn die Bankanbindung noch nicht eingerichtet ist, sonst None."""
    cfg = bank_config(conn)
    if cfg["provider"] == "none":
        return "no_provider"
    if cfg["provider"] == "enablebanking":
        if not cfg["app_id"]:
            return "missing_app_id"
        if not cfg["key_file"] or not os.path.isfile(cfg["key_file"]):
            return "missing_key"
    return None


def get_provider(conn=None) -> BankProvider:
    cfg = bank_config(conn)
    if cfg["provider"] == "none":
        return NoBankProvider()
    if cfg["provider"] == "enablebanking":
        from .enablebanking import EnableBankingProvider

        problem = setup_problem(conn)
        if problem:
            raise BankNotConfigured(SETUP_TEXT[problem])
        return EnableBankingProvider.from_config(cfg)
    from .demo import DemoProvider

    return DemoProvider()


__all__ = ["SETUP_TEXT", "bank_config", "data_dir", "BankNotConfigured", "BankProvider", "ConsentExpired", "get_provider", "setup_problem"]
