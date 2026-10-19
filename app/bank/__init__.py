"""Bankanbieter. Welcher genutzt wird, steuert die Variable BANK_PROVIDER."""

import os

from .base import BankNotConfigured, BankProvider, ConsentExpired, NoBankProvider


# Warum noch keine Bank verbunden werden kann (für Hinweise in der App)
SETUP_TEXT = {
    "no_provider": "Für diese Installation ist noch keine Bank eingerichtet.",
    "missing_app_id": "ENABLEBANKING_APP_ID fehlt in der .env.",
    "missing_key": "Der Schlüssel von Enable Banking fehlt (ENABLEBANKING_KEY_FILE).",
}


def setup_problem() -> str | None:
    """Schlüssel aus SETUP_TEXT, wenn die Bankanbindung noch nicht eingerichtet ist, sonst None."""
    name = os.environ.get("BANK_PROVIDER", "demo").lower()
    if name == "none":
        return "no_provider"
    if name == "enablebanking":
        if not os.environ.get("ENABLEBANKING_APP_ID", "").strip():
            return "missing_app_id"
        key = os.environ.get("ENABLEBANKING_KEY_FILE", "").strip()
        if not key or not os.path.isfile(key):
            return "missing_key"
    return None


def get_provider() -> BankProvider:
    name = os.environ.get("BANK_PROVIDER", "demo").lower()
    if name == "none":
        return NoBankProvider()
    if name == "enablebanking":
        from .enablebanking import EnableBankingProvider

        problem = setup_problem()
        if problem:
            raise BankNotConfigured(SETUP_TEXT[problem])
        return EnableBankingProvider.from_env()
    from .demo import DemoProvider

    return DemoProvider()


__all__ = ["SETUP_TEXT", "BankNotConfigured", "BankProvider", "ConsentExpired", "get_provider", "setup_problem"]
