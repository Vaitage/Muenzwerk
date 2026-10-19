"""Abruf neuer Umsätze und Überwachung der Bankfreigabe."""

import os
import json
import sqlite3
from datetime import date, datetime, timedelta

from . import accounts, ledger
from .bank import BankProvider, ConsentExpired, setup_problem

# Bei späteren Abrufen etwas überlappen, falls die Bank nachträglich bucht.
OVERLAP_DAYS = 7
# Ab so vielen Resttagen warnt die App.
WARN_DAYS = 7


def get_connection(conn: sqlite3.Connection):
    return conn.execute("SELECT * FROM bank_connection WHERE id = 1").fetchone()


def status(conn: sqlite3.Connection) -> dict:
    row = get_connection(conn)
    if row is None:
        return {"state": "none", "days_left": None, "valid_until": None, "last_sync": None, "provider": None,
                # Grund, warum "Verbinden" noch nicht gehen kann (None = bereit)
                "setup": setup_problem()}
    days_left = None
    state = row["status"]
    if row["valid_until"]:
        days_left = (date.fromisoformat(row["valid_until"][:10]) - date.today()).days
        if days_left < 0:
            state = "expired"
        elif state == "active" and days_left <= WARN_DAYS:
            state = "expiring"
    return {
        "state": state,
        "days_left": days_left,
        "valid_until": row["valid_until"],
        "last_sync": row["last_sync"],
        "last_error": row["last_error"],
        "provider": row["provider"],
        # Anzeigename der Bank in den Einstellungen
        "bank_name": os.environ.get("ENABLEBANKING_BANK", "") if row["provider"] == "enablebanking" else "",
        "setup": setup_problem(),
    }


def save_connection(conn: sqlite3.Connection, provider: str, session_id: str,
                    account_ids: list[str], valid_until: str, accounts_info: list[dict] | None = None) -> None:
    conn.execute(
        "INSERT INTO bank_connection (id, provider, session_id, account_ids, valid_until, status, accounts_info) "
        "VALUES (1, ?, ?, ?, ?, 'active', ?) "
        "ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, session_id=excluded.session_id, "
        "account_ids=excluded.account_ids, valid_until=excluded.valid_until, status='active', "
        "last_error=NULL, accounts_info=excluded.accounts_info",
        (provider, session_id, ",".join(account_ids), valid_until, json.dumps(accounts_info or [])),
    )


def run(conn: sqlite3.Connection, provider: BankProvider) -> dict:
    row = get_connection(conn)
    if row is None:
        return {"ok": False, "reason": "not_connected"}
    if status(conn)["state"] == "expired":
        conn.execute("UPDATE bank_connection SET status = 'expired' WHERE id = 1")
        return {"ok": False, "reason": "expired"}

    if row["last_sync"]:
        since = datetime.fromisoformat(row["last_sync"]).date() - timedelta(days=OVERLAP_DAYS)
    else:
        since = date.today() - timedelta(days=provider.history_days)

    # Offene Vormerkungen immer mit abfragen, damit ihre Buchung erkannt wird
    oldest = conn.execute("SELECT MIN(booking_date) FROM transactions WHERE pending = 1").fetchone()[0]
    if oldest:
        since = min(since, date.fromisoformat(oldest))

    try:
        items = provider.fetch_transactions(row["session_id"], (row["account_ids"] or "").split(","), since)
    except ConsentExpired as exc:
        conn.execute("UPDATE bank_connection SET status = 'expired', last_error = ? WHERE id = 1", (str(exc)[:500],))
        return {"ok": False, "reason": "expired"}
    except Exception as exc:  # Netzwerk, Bank nicht erreichbar …
        conn.execute("UPDATE bank_connection SET last_error = ? WHERE id = 1", (str(exc)[:500],))
        return {"ok": False, "reason": "error", "detail": str(exc)[:200]}

    result = ledger.import_transactions(conn, items, window_start=since)
    conn.execute(
        "UPDATE bank_connection SET last_sync = ?, last_error = NULL WHERE id = 1",
        (datetime.now().isoformat(timespec="seconds"),),
    )

    # Kontostände für die Vermögensübersicht (Fehler hier stoppen den Abruf nicht).
    try:
        info = json.loads(row["accounts_info"] or "[]")
        if info:
            accounts.store_bank_balances(conn, provider.fetch_balances(row["session_id"], info))
    except Exception as exc:
        conn.execute("UPDATE bank_connection SET last_error = ? WHERE id = 1", (f"Kontostände: {exc}"[:500],))
    return {"ok": True, **result}
