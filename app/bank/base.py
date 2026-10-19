"""Gemeinsame Schnittstelle aller Bankanbieter.

Jeder Anbieter liefert Umsätze im selben, einfachen Format:

    {
        "id": "eindeutige-id-der-bank",
        "booking_date": "2026-10-28",
        "amount_cents": -4599,        # negativ = Ausgabe
        "currency": "EUR",
        "counterparty": "REWE Markt GmbH",
        "purpose": "Kartenzahlung ...",
        "counterparty_iban": "",      # falls die Bank sie liefert
        "pending": False,             # True = nur vorgemerkt (noch nicht gebucht)
    }

So bleibt der Rest der App unabhängig davon, woher die Daten kommen.
"""

from dataclasses import dataclass, field
from datetime import date


class ConsentExpired(Exception):
    """Die Freigabe bei der Bank ist abgelaufen und muss erneuert werden."""


class BankNotConfigured(Exception):
    """Es ist noch keine Bank eingerichtet (BANK_PROVIDER=none)."""


@dataclass
class ConnectStart:
    url: str            # dorthin wird der Nutzer zur Bestätigung geschickt
    state: str          # Prüfwert gegen untergeschobene Rückläufer


@dataclass
class ConnectResult:
    session_id: str
    account_ids: list[str]          # Konten, deren Umsätze ins Haushaltsbuch gehen (Girokonto)
    valid_until: str                # ISO-Datum
    # Alle freigegebenen Konten für die Vermögensübersicht:
    # [{uid, name, type ('giro'|'savings'|'depot'|'loan'), iban}]
    accounts: list[dict] = field(default_factory=list)


class BankProvider:
    name = "base"
    # So weit zurück wird beim ersten Abruf geholt. Viele Banken liefern ohne
    # erneute Bestätigung nur 90 Tage; mehr fragen schadet nicht.
    history_days = 120

    def start_connect(self, redirect_url: str) -> ConnectStart:
        raise NotImplementedError

    def finish_connect(self, code: str) -> ConnectResult:
        raise NotImplementedError

    def fetch_transactions(self, session_id: str, account_ids: list[str], since: date) -> list[dict]:
        raise NotImplementedError

    def fetch_balances(self, session_id: str, accounts: list[dict]) -> list[dict]:
        """Aktuelle Kontostände: [{uid, name, type, iban, balance_cents}]."""
        return []


class NoBankProvider(BankProvider):
    """Noch keine Bank eingerichtet, und die Demo-Bank soll nicht angeboten
    werden (z. B. eine neue Installation, bevor die echte Bank verbunden ist)."""
    name = "none"

    def start_connect(self, redirect_url: str) -> ConnectStart:
        raise BankNotConfigured("Die Bank ist noch nicht eingerichtet.")

    def finish_connect(self, code: str) -> ConnectResult:
        raise BankNotConfigured("Die Bank ist noch nicht eingerichtet.")

    def fetch_transactions(self, session_id, account_ids, since) -> list[dict]:
        return []
