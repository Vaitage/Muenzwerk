"""Anbindung an Enable Banking (PSD2) für die ING Deutschland.

Enable Banking hat einen kostenlosen "eingeschränkten Modus" für die eigenen
Konten. Einrichtung (einmalig, siehe README):

1. Konto bei Enable Banking anlegen, im Control Panel eine "Production"-App
   erstellen, Redirect-URL = https://<deine-adresse>/api/bank/callback
2. Die heruntergeladene Schlüsseldatei (.pem) auf den Pi legen.
3. In .env eintragen:
       BANK_PROVIDER=enablebanking
       ENABLEBANKING_APP_ID=<Application ID>
       ENABLEBANKING_KEY_FILE=/data/enablebanking.pem

Wichtig: Dieser Teil ist vorbereitet, kann aber erst auf dem Raspberry Pi mit
echten Zugangsdaten getestet werden. Die Arbeitsumgebung, in der der Entwurf
entstand, darf Enable Banking nicht erreichen.
"""

import hashlib
import os
import re
import secrets
import time
from datetime import date, datetime, timedelta, timezone

import httpx

from .base import BankProvider, ConnectResult, ConnectStart, ConsentExpired

API = "https://api.enablebanking.com"

# Die ING setzt vor jeden Verwendungszweck Technik-Felder:
#   "mandatereference:<…>,creditorid:<…>,remittanceinformation:<eigentlicher Zweck>"
_ING_PRAEFIX = re.compile(r"^\s*mandatereference:[^,]*,creditorid:[^,]*,remittanceinformation:", re.IGNORECASE)


def is_card_payment(purpose: str) -> bool:
    """Kartenzahlung? Die ING schreibt "Kaufumsatz VISA Card" bzw. "girocard"."""
    return bool(re.search(r"kaufumsatz|visa card|girocard|mastercard|kartenzahlung", purpose or "", re.IGNORECASE))


def pending_day(tx: dict, purpose: str, today: date | None = None) -> str:
    """An welchem Tag eine Vormerkung in der App steht.

    Die ING nennt als booking_date den Tag, an dem sie später bucht – bei
    Kartenzahlungen oft eine Woche nach dem Kauf. Kartenzahlungen sind schon
    passiert und vom Kontostand abgezogen: frühestes gemeldetes Datum, höchstens
    heute. Angekündigte Lastschriften gelten an ihrem Fälligkeitstag."""
    today = today or date.today()
    days = sorted(d[:10] for d in (tx.get("booking_date"), tx.get("value_date"), tx.get("transaction_date")) if d)
    first = days[0]
    if is_card_payment(purpose):
        return min(first, today.isoformat())
    return first


def clean_purpose(text: str) -> str:
    """Schneidet die Technik-Felder der ING ab, damit nur der Verwendungszweck bleibt."""
    return " ".join(_ING_PRAEFIX.sub("", text or "").split())


class EnableBankingProvider(BankProvider):
    name = "enablebanking"

    def __init__(self, app_id: str, private_key: str, bank_name: str = "ING", country: str = "DE"):
        self.app_id = app_id
        self.private_key = private_key
        self.bank_name = bank_name
        self.country = country

    @classmethod
    def from_env(cls) -> "EnableBankingProvider":
        app_id = os.environ["ENABLEBANKING_APP_ID"]
        with open(os.environ["ENABLEBANKING_KEY_FILE"], encoding="utf-8") as fh:
            key = fh.read()
        return cls(
            app_id,
            key,
            bank_name=os.environ.get("ENABLEBANKING_BANK", "ING"),
            country=os.environ.get("ENABLEBANKING_COUNTRY", "DE"),
        )

    # -- Hilfsfunktionen ----------------------------------------------------

    def _token(self) -> str:
        import jwt  # PyJWT, nur hier gebraucht

        now = int(time.time())
        return jwt.encode(
            {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + 3600},
            self.private_key,
            algorithm="RS256",
            headers={"kid": self.app_id},
        )

    def _request(self, method: str, path: str, **kwargs) -> dict:
        headers = {"Authorization": f"Bearer {self._token()}"}
        with httpx.Client(base_url=API, timeout=30) as client:
            resp = client.request(method, path, headers=headers, **kwargs)
        if resp.status_code in (401, 403) and "expired" in resp.text.lower():
            raise ConsentExpired(resp.text)
        if resp.status_code == 422 and "session" in resp.text.lower():
            raise ConsentExpired(resp.text)
        resp.raise_for_status()
        return resp.json()

    # -- Verbinden ------------------------------------------------------------

    def start_connect(self, redirect_url: str) -> ConnectStart:
        state = secrets.token_urlsafe(16)
        # Die Bank begrenzt die Dauer selbst (meist 90 oder 180 Tage);
        # wir fragen das Maximum an und übernehmen, was zurückkommt.
        valid_until = (datetime.now(timezone.utc) + timedelta(days=180)).isoformat()
        data = self._request("POST", "/auth", json={
            "access": {"valid_until": valid_until},
            "aspsp": {"name": self.bank_name, "country": self.country},
            "state": state,
            "redirect_url": redirect_url,
            "psu_type": "personal",
        })
        return ConnectStart(url=data["url"], state=state)

    # ISO-20022-Kontoarten -> Kontotyp in der App
    ACCOUNT_TYPES = {"CACC": "giro", "SVGS": "savings", "LOAN": "loan", "MOMA": "savings"}

    def finish_connect(self, code: str) -> ConnectResult:
        data = self._request("POST", "/sessions", json={"code": code})
        accounts = []
        for a in data.get("accounts", []):
            acc_type = self.ACCOUNT_TYPES.get(a.get("cash_account_type") or "", "giro")
            accounts.append({
                "uid": a["uid"],
                "name": a.get("name") or a.get("product") or "Konto",
                "type": acc_type,
                "iban": (a.get("account_id") or {}).get("iban", ""),
            })
        # Ins Haushaltsbuch kommen nur die Umsätze der Girokonten; Umbuchungen
        # aufs Sparkonto sieht man dort ohnehin schon.
        giro = [a["uid"] for a in accounts if a["type"] == "giro"] or [a["uid"] for a in accounts]
        valid_until = (data.get("access") or {}).get("valid_until", "")[:10]
        if not valid_until:
            valid_until = (date.today() + timedelta(days=90)).isoformat()
        return ConnectResult(session_id=data["session_id"], account_ids=giro, valid_until=valid_until, accounts=accounts)

    def fetch_balances(self, session_id, accounts) -> list[dict]:
        preferred = ["CLBD", "ITBD", "XPCD", "ITAV", "CLAV"]
        result = []
        for a in accounts:
            data = self._request("GET", f"/accounts/{a['uid']}/balances")
            balances = data.get("balances", [])
            if not balances:
                continue
            balances.sort(key=lambda b: preferred.index(b.get("balance_type")) if b.get("balance_type") in preferred else 99)
            amount = float(balances[0]["balance_amount"]["amount"])
            result.append({**a, "balance_cents": round(amount * 100)})
        return result

    # -- Umsätze --------------------------------------------------------------

    def _fetch_pages(self, uid: str, params: dict, counts: dict) -> list[dict]:
        result = []
        while True:
            data = self._request("GET", f"/accounts/{uid}/transactions", params=params)
            for tx in data.get("transactions", []):
                status = str(tx.get("status") or "?")
                counts[status] = counts.get(status, 0) + 1
                item = self._normalize(tx)
                if item:
                    result.append(item)
            key = data.get("continuation_key")
            if not key:
                return result
            params = {**params, "continuation_key": key}

    def fetch_transactions(self, session_id, account_ids, since: date) -> list[dict]:
        result: dict[str, dict] = {}
        counts: dict[str, int] = {}
        pending_query = "nicht nötig"
        for uid in account_ids:
            items = self._fetch_pages(uid, {"date_from": since.isoformat()}, counts)
            # Ohne Filter liefern manche Banken nur Gebuchtes. Kam nichts Vorgemerktes,
            # einmal ausdrücklich danach fragen; geht das nicht, bleibt es beim Gebuchten.
            if not any(i["pending"] for i in items):
                extra: dict[str, int] = {}
                try:
                    items += self._fetch_pages(uid, {"date_from": since.isoformat(), "transaction_status": "PDNG"}, extra)
                    pending_query = f"{sum(extra.values())} geliefert"
                except ConsentExpired:
                    raise
                except Exception as exc:  # Bank kennt den Filter nicht
                    status = getattr(getattr(exc, "response", None), "status_code", None)
                    pending_query = f"Fehler {status}" if status else "Fehler"
                for k, v in extra.items():
                    counts[f"{k} (nachgefragt)"] = counts.get(f"{k} (nachgefragt)", 0) + v
            for i in items:
                result.setdefault(i["id"], i)
        self.last_info = {"counts": counts, "pending_query": pending_query, "since": since.isoformat()}
        return list(result.values())

    @staticmethod
    def _normalize(tx: dict) -> dict | None:
        status = tx.get("status")
        if status in (None, "BOOK"):
            pending = False
        elif status in ("PDNG", "HOLD"):
            pending = True   # vorgemerkt, z. B. Kartenzahlung vor der Buchung
        else:
            return None      # storniert, abgelehnt, nur zur Information
        amount = float(tx["transaction_amount"]["amount"])
        if tx.get("credit_debit_indicator") == "DBIT":
            amount = -abs(amount)
        else:
            amount = abs(amount)
        party = tx.get("creditor") if amount < 0 else tx.get("debtor")
        party_account = tx.get("creditor_account") if amount < 0 else tx.get("debtor_account")
        purpose = clean_purpose(" ".join(tx.get("remittance_information") or []))
        booking = tx.get("booking_date") or tx.get("value_date") or tx.get("transaction_date")
        if not booking:
            return None
        day = booking[:10]
        if pending:
            day = pending_day(tx, purpose)
        tx_id = tx.get("entry_reference") or tx.get("transaction_id")
        if not tx_id:
            # Nicht jede Bank liefert eine Buchungs-ID. Dann eine stabile ID aus
            # den Buchungsdaten bilden, damit der Umsatz nicht verloren geht und
            # beim überlappenden nächsten Abruf nicht doppelt kommt.
            key = "|".join([booking[:10], str(round(amount * 100)), (party or {}).get("name", "") or "", purpose])
            tx_id = ("p" if pending else "h") + hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
        return {
            "id": f"eb-{'p-' if pending else ''}{tx_id}",
            "booking_date": day,
            "amount_cents": round(amount * 100),
            "currency": tx["transaction_amount"].get("currency", "EUR"),
            "counterparty": (party or {}).get("name", "") or "",
            "purpose": purpose,
            "counterparty_iban": (party_account or {}).get("iban", "") or "",
            "pending": pending,
        }
