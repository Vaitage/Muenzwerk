"""Konten für die Vermögensübersicht: anlegen, ändern, Kontostände eintragen.

Die Verläufe und das Nettovermögen rechnet die App selbst (web/analytics.js)
aus den hier gespeicherten Stichtagswerten und den Umsätzen des Girokontos.
"""

import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, defaults, ledger

router = APIRouter(prefix="/api/accounts")

TYPES = "^(giro|savings|depot|loan)$"
ICON = r"^[A-Za-z][A-Za-z0-9]{0,29}$"   # Schlüssel aus web/icons.js
DATE = r"^\d{4}-\d{2}-\d{2}$"
# Obergrenze für Beträge (10 Mrd. €): passt sicher in SQLite-Ganzzahlen
MAX_CENTS = 10**12
DEFAULT_ICONS = {"giro": "bank", "savings": "piggy", "depot": "trend", "loan": "receipt"}
# Umbuchungen auf Spar- und Depotkonten sind Ersparnisse, Kreditraten Kredit.
# Werte sind Schlüssel aus defaults.py (der Name hängt von der Sprache ab).
RULE_CATEGORY = {"savings": "savings", "depot": "savings", "loan": "loan"}


def get_db():
    with db.session() as conn:
        yield conn


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    type: str = Field(pattern=TYPES)
    icon: str | None = Field(default=None, pattern=ICON)
    match: str = Field(default="", max_length=80)
    include_in_total: bool = True
    loan_rate_percent: float | None = Field(default=None, ge=0, le=30)
    loan_payment_cents: int | None = Field(default=None, ge=0, le=MAX_CENTS)
    loan_original_cents: int | None = Field(default=None, ge=0, le=MAX_CENTS)
    value_cents: int | None = Field(default=None, ge=-MAX_CENTS, le=MAX_CENTS)  # Startwert (bei Kredit: Restschuld)
    value_date: str | None = Field(default=None, pattern=DATE)


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    icon: str | None = Field(default=None, pattern=ICON)
    match: str | None = Field(default=None, max_length=80)
    include_in_total: bool | None = None
    loan_rate_percent: float | None = Field(default=None, ge=0, le=30)
    loan_payment_cents: int | None = Field(default=None, ge=0, le=MAX_CENTS)
    loan_original_cents: int | None = Field(default=None, ge=0, le=MAX_CENTS)


class ValueIn(BaseModel):
    value_cents: int = Field(ge=-MAX_CENTS, le=MAX_CENTS)
    date: str | None = Field(default=None, pattern=DATE)


def _match_key(text: str) -> str:
    text = (text or "").strip()
    return ledger.iban_key(text) if ledger.looks_like_iban(text) else ledger.normalize(text)


def _account(conn: sqlite3.Connection, row) -> dict:
    values = conn.execute(
        "SELECT id, date, value_cents, source FROM account_values WHERE account_id = ? ORDER BY date",
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"], "name": row["name"], "type": row["type"], "icon": row["icon"],
        "match": row["match"], "bank": bool(row["bank_uid"]),
        "include_in_total": bool(row["include_in_total"]),
        "loan_rate_percent": row["loan_rate_bp"] / 100 if row["loan_rate_bp"] is not None else None,
        "loan_payment_cents": row["loan_payment_cents"],
        "loan_original_cents": row["loan_original_cents"],
        "values": [dict(v) for v in values],
    }


def _ensure_rule(conn: sqlite3.Connection, acc_type: str, match: str) -> int:
    """Legt für die Umbuchungen eine Regel an und sortiert offene Umsätze ein."""
    if not match or acc_type not in RULE_CATEGORY:
        return 0
    key = RULE_CATEGORY[acc_type]
    savings = key in defaults.SAVINGS_KEYS
    # Standardkategorie in einer der beiden Sprachen, sonst irgendeine Spar-Kategorie
    cat = conn.execute(
        "SELECT id FROM categories WHERE kind = 'expense' AND name IN (?, ?)", defaults.all_names(key)
    ).fetchone()
    if cat is None and savings:
        cat = conn.execute(
            "SELECT id FROM categories WHERE kind = 'expense' AND is_savings = 1 ORDER BY sort, id"
        ).fetchone()
    if cat is None:
        cur = conn.execute(
            "INSERT INTO categories (name, kind, icon, sort, is_savings) VALUES (?, 'expense', ?, 999, ?)",
            (defaults.category_name(key), "piggy" if savings else "bank", int(savings)),
        )
        cat_id = cur.lastrowid
    else:
        cat_id = cat["id"]
    conn.execute(
        "INSERT OR IGNORE INTO rules (pattern, category_id, source) VALUES (?, ?, 'user')", (match, cat_id)
    )
    return ledger.apply_rules_to_open(conn)


@router.get("")
def list_accounts(conn=Depends(get_db)):
    rows = conn.execute("SELECT * FROM accounts ORDER BY type, sort, id").fetchall()
    return [_account(conn, r) for r in rows]


@router.post("", status_code=201)
def create_account(body: AccountIn, conn=Depends(get_db)):
    match = _match_key(body.match)
    cur = conn.execute(
        "INSERT INTO accounts (name, type, icon, match, include_in_total, loan_rate_bp, "
        "loan_payment_cents, loan_original_cents) VALUES (?,?,?,?,?,?,?,?)",
        (
            body.name.strip(), body.type, body.icon or DEFAULT_ICONS[body.type], match,
            int(body.include_in_total),
            round(body.loan_rate_percent * 100) if body.loan_rate_percent is not None else None,
            body.loan_payment_cents, body.loan_original_cents,
        ),
    )
    acc_id = cur.lastrowid
    if body.value_cents is not None:
        conn.execute(
            "INSERT INTO account_values (account_id, date, value_cents) VALUES (?, ?, ?)",
            (acc_id, body.value_date or date.today().isoformat(),
             abs(body.value_cents) if body.type == "loan" else body.value_cents),
        )
    assigned = _ensure_rule(conn, body.type, match)
    row = conn.execute("SELECT * FROM accounts WHERE id = ?", (acc_id,)).fetchone()
    return {**_account(conn, row), "assigned": assigned}


@router.patch("/{acc_id}")
def update_account(acc_id: int, body: AccountPatch, conn=Depends(get_db)):
    row = conn.execute("SELECT * FROM accounts WHERE id = ?", (acc_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    fields = {}
    if body.name is not None:
        fields["name"] = body.name.strip()
    if body.icon is not None:
        fields["icon"] = body.icon
    if body.match is not None:
        fields["match"] = _match_key(body.match)
    if body.include_in_total is not None:
        fields["include_in_total"] = int(body.include_in_total)
    if body.loan_rate_percent is not None:
        fields["loan_rate_bp"] = round(body.loan_rate_percent * 100)
    if body.loan_payment_cents is not None:
        fields["loan_payment_cents"] = body.loan_payment_cents
    if body.loan_original_cents is not None:
        fields["loan_original_cents"] = body.loan_original_cents
    for key, value in fields.items():
        conn.execute(f"UPDATE accounts SET {key} = ? WHERE id = ?", (value, acc_id))
    assigned = _ensure_rule(conn, row["type"], fields["match"]) if fields.get("match") else 0
    row = conn.execute("SELECT * FROM accounts WHERE id = ?", (acc_id,)).fetchone()
    return {**_account(conn, row), "assigned": assigned}


@router.delete("/{acc_id}", status_code=204)
def delete_account(acc_id: int, conn=Depends(get_db)):
    conn.execute("DELETE FROM accounts WHERE id = ?", (acc_id,))


@router.post("/{acc_id}/values", status_code=201)
def add_value(acc_id: int, body: ValueIn, conn=Depends(get_db)):
    acc = conn.execute("SELECT type FROM accounts WHERE id = ?", (acc_id,)).fetchone()
    if acc is None:
        raise HTTPException(404)
    value = abs(body.value_cents) if acc["type"] == "loan" else body.value_cents  # Restschuld immer positiv
    conn.execute(
        "INSERT INTO account_values (account_id, date, value_cents, source) VALUES (?, ?, ?, 'manual') "
        "ON CONFLICT(account_id, date) DO UPDATE SET value_cents = excluded.value_cents, source = 'manual'",
        (acc_id, body.date or date.today().isoformat(), value),
    )
    return {"ok": True}


@router.delete("/{acc_id}/values/{value_id}", status_code=204)
def delete_value(acc_id: int, value_id: int, conn=Depends(get_db)):
    conn.execute("DELETE FROM account_values WHERE id = ? AND account_id = ?", (value_id, acc_id))


# ---------------------------------------------------------------------------
# Kontostände von der Bank übernehmen (wird beim Abruf aufgerufen)
# ---------------------------------------------------------------------------

def store_bank_balances(conn: sqlite3.Connection, balances: list[dict]) -> None:
    """Legt Konten, die die Bank liefert, automatisch an und speichert den
    heutigen Stand. ``balances``: [{uid, name, type, iban, balance_cents}]."""
    today = date.today().isoformat()
    for b in balances:
        row = conn.execute("SELECT id FROM accounts WHERE bank_uid = ?", (b["uid"],)).fetchone()
        if row is None:
            match = ledger.iban_key(b.get("iban", "")) if b["type"] != "giro" else ""
            cur = conn.execute(
                "INSERT INTO accounts (name, type, icon, match, bank_uid) VALUES (?, ?, ?, ?, ?)",
                (b["name"], b["type"], DEFAULT_ICONS[b["type"]], match, b["uid"]),
            )
            acc_id = cur.lastrowid
            _ensure_rule(conn, b["type"], match)
        else:
            acc_id = row["id"]
        conn.execute(
            "INSERT INTO account_values (account_id, date, value_cents, source) VALUES (?, ?, ?, 'bank') "
            "ON CONFLICT(account_id, date) DO UPDATE SET value_cents = excluded.value_cents, source = 'bank'",
            (acc_id, today, abs(b["balance_cents"]) if b["type"] == "loan" else b["balance_cents"]),
        )
