"""Kernlogik: Einsortieren, Budgetmonat und Import neuer Umsätze."""

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta

from .db import get_setting


# ---------------------------------------------------------------------------
# Budgetmonat
# ---------------------------------------------------------------------------

def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def next_month(month: str) -> str:
    year, mon = map(int, month.split("-"))
    return f"{year + 1:04d}-01" if mon == 12 else f"{year:04d}-{mon + 1:02d}"



def compute_budget_month(booking_date: date, shift_next_month: bool, shift_from_day: int) -> str:
    """Für welchen Monat zählt ein Umsatz?

    Normalerweise der Buchungsmonat. Gehört der Umsatz zu einer Kategorie mit
    "zählt zum Folgemonat" (z. B. Gehalt) und kommt er ab ``shift_from_day``
    an, zählt er zum nächsten Monat. Kommt das Gehalt einmal verspätet am
    Monatsanfang, bleibt es im Buchungsmonat – also genau dort, wo es hingehört.
    """
    month = month_of(booking_date)
    if shift_next_month and booking_date.day >= shift_from_day:
        return next_month(month)
    return month


# ---------------------------------------------------------------------------
# Regeln
# ---------------------------------------------------------------------------

@dataclass
class Rule:
    id: int
    pattern: str
    category_id: int
    kind: str
    is_savings: bool = False
    source: str = "starter"
    direction: str | None = None   # 'expense'/'income': gelernt an einem Umsatz dieser Richtung
    scope: str = "any"             # 'counterparty': nur der Empfänger zählt, 'any': auch Zweck und IBAN


def normalize(text: str) -> str:
    return " ".join((text or "").lower().split())


def counterparty_key(text: str) -> str:
    """Empfänger ohne Ziffern und Satzzeichen, damit ähnliche Schreibweisen
    zusammenfinden: "SumUp *Baeckerei Kraus 0815" ≈ "SUMUP BAECKEREI KRAUS"."""
    return " ".join(re.sub(r"[^a-zäöüß ]+", " ", (text or "").lower()).split())


def direction(amount_cents: int) -> str:
    return "income" if amount_cents > 0 else "expense"


def load_rules(conn: sqlite3.Connection) -> list[Rule]:
    rows = conn.execute(
        "SELECT r.id, r.pattern, r.category_id, r.source, r.direction, r.scope, c.kind, c.is_savings FROM rules r "
        "JOIN categories c ON c.id = r.category_id"
    ).fetchall()
    rules = [
        Rule(r["id"], normalize(r["pattern"]), r["category_id"], r["kind"], bool(r["is_savings"]),
             r["source"], r["direction"], r["scope"] or "any")
        for r in rows
    ]
    # Eigene Regeln vor Start-Regeln (sonst gewinnt z. B. "rewe" im Verwendungszweck
    # gegen den Empfänger), dann längere (genauere) Suchbegriffe, dann neuere.
    rules.sort(key=lambda r: (r.source != "user", -len(r.pattern), -r.id))
    return rules


def iban_key(text: str) -> str:
    """IBANs ohne Leerzeichen und klein geschrieben, damit sie vergleichbar sind."""
    return "".join((text or "").split()).lower()


def looks_like_iban(text: str) -> bool:
    key = iban_key(text)
    return len(key) >= 15 and key[:2].isalpha() and key[2:].isalnum() and key[2:4].isdigit()


def match_rule(
    rules: list[Rule], counterparty: str, purpose: str, amount_cents: int, iban: str = ""
) -> Rule | None:
    """Findet die passende Regel. Ausgaben bekommen nur Ausgaben-Kategorien,
    Einnahmen nur Einnahmen-Kategorien – so landet z. B. eine Rückzahlung von
    Amazon nicht versehentlich unter "Technologie". Ausnahmen: Spar-Kategorien
    gelten in beide Richtungen (Einzahlen und Abheben), und eine Regel, die an
    einem Umsatz gelernt wurde, gilt für dessen Richtung – auch wenn die
    Kategorie zur anderen Seite gehört."""
    kind = direction(amount_cents)
    haystack = normalize(f"{counterparty} {purpose}") + " " + iban_key(iban)
    key = counterparty_key(counterparty)
    for rule in rules:
        fits = rule.direction == kind if rule.direction else (rule.kind == kind or rule.is_savings)
        if not fits or not rule.pattern:
            continue
        # Beim Zuordnen gelernte Regeln gelten nur für den Empfänger. Sonst würde
        # z. B. eine Regel "mustermann" jede Miete mit "Mustermann" im Verwendungszweck treffen.
        if rule.scope == "counterparty":
            hit = key == rule.pattern
        else:
            hit = rule.pattern in haystack or key == rule.pattern
        if hit:
            return rule
    return None


# ---------------------------------------------------------------------------
# Umsätze schreiben
# ---------------------------------------------------------------------------

def _shift_info(conn: sqlite3.Connection) -> tuple[dict[int, bool], int]:
    shifts = {
        row["id"]: bool(row["shift_next_month"])
        for row in conn.execute("SELECT id, shift_next_month FROM categories")
    }
    return shifts, int(get_setting(conn, "shift_from_day"))


# Vorgemerkte Umsätze, die so lange nicht gebucht wurden, gelten als verfallen
# (z. B. Tankstellen-Reservierung, die nie abgebucht wird).
PENDING_MAX_DAYS = 21
# So weit dürfen Vormerkung und Buchung zeitlich auseinanderliegen.
PENDING_MATCH_DAYS = 10


def _find_pending_match(conn: sqlite3.Connection, item: dict) -> sqlite3.Row | None:
    """Sucht den vorgemerkten Umsatz, der zu einer neuen Buchung gehört.

    Banken vergeben für Vormerkung und Buchung meist verschiedene IDs. Deshalb
    wird über Betrag, Empfänger und Datum zugeordnet. Der Betrag muss gleich
    sein; der Empfänger muss passen, wenn beide einen haben."""
    rows = conn.execute(
        "SELECT * FROM transactions WHERE pending = 1 AND amount_cents = ?", (item["amount_cents"],)
    ).fetchall()
    booked = date.fromisoformat(item["booking_date"])
    key = counterparty_key(item["counterparty"])
    best, best_gap = None, None
    for row in rows:
        gap = abs((booked - date.fromisoformat(row["booking_date"])).days)
        if gap > PENDING_MATCH_DAYS:
            continue
        other = counterparty_key(row["counterparty"])
        if key and other and key != other and key not in other and other not in key:
            continue
        if best is None or gap < best_gap:
            best, best_gap = row, gap
    return best


def import_transactions(conn: sqlite3.Connection, items: list[dict], window_start: date | None = None) -> dict:
    """Speichert neue Umsätze und sortiert sie über die Regeln ein.

    ``items`` sind normierte Umsätze eines Bankanbieters (siehe bank/base.py).
    Bereits bekannte IDs werden übersprungen, damit ein erneuter Abruf nichts
    doppelt anlegt.

    Vorgemerkte Umsätze (``pending``) werden sofort angezeigt. Kommt später die
    Buchung, ersetzt sie die Vormerkung; eine von Hand gewählte Kategorie wird
    dabei übernommen. ``window_start`` ist der Beginn des abgerufenen Zeitraums:
    Vormerkungen darin, die die Bank nicht mehr meldet, sind erledigt und werden
    entfernt.
    """
    rules = load_rules(conn)
    shifts, shift_day = _shift_info(conn)
    new = categorized = confirmed = 0
    booked_items = [i for i in items if not i.get("pending")]
    pending_items = [i for i in items if i.get("pending")]

    def insert(item: dict, pending: bool, inherit: sqlite3.Row | None = None) -> bool:
        booking = date.fromisoformat(item["booking_date"])
        iban = item.get("counterparty_iban", "") or ""
        if inherit is not None and inherit["categorized_by"] == "user":
            cat_id, by = inherit["category_id"], "user"
        else:
            rule = match_rule(rules, item["counterparty"], item["purpose"], item["amount_cents"], iban)
            cat_id, by = (rule.category_id, "rule") if rule else (None, None)
        if inherit is not None and inherit["budget_month_manual"]:
            budget, manual = inherit["budget_month"], 1
        else:
            budget, manual = compute_budget_month(booking, shifts.get(cat_id, False), shift_day), 0
        conn.execute(
            "INSERT INTO transactions (id, booking_date, amount_cents, currency, counterparty, "
            "purpose, counterparty_iban, category_id, budget_month, budget_month_manual, "
            "categorized_by, pending) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                item["id"], item["booking_date"], item["amount_cents"], item.get("currency", "EUR"),
                item["counterparty"], item["purpose"], iban, cat_id, budget, manual, by, int(pending),
            ),
        )
        return cat_id is not None

    # 1. Gebuchte Umsätze; eine passende Vormerkung wird ersetzt
    for item in booked_items:
        if conn.execute("SELECT 1 FROM transactions WHERE id = ?", (item["id"],)).fetchone():
            continue
        match = _find_pending_match(conn, item)
        if match is not None:
            conn.execute("DELETE FROM transactions WHERE id = ?", (match["id"],))
            confirmed += 1
        categorized += insert(item, False, match)
        new += 1

    # 2. Vormerkungen, die die Bank nicht mehr meldet, sind gebucht oder verfallen
    current = {i["id"] for i in pending_items}
    stale_before = (date.today() - timedelta(days=PENDING_MAX_DAYS)).isoformat()
    for row in conn.execute("SELECT id, booking_date FROM transactions WHERE pending = 1").fetchall():
        gone = window_start is not None and row["booking_date"] >= window_start.isoformat() and row["id"] not in current
        if gone or row["booking_date"] < stale_before:
            conn.execute("DELETE FROM transactions WHERE id = ?", (row["id"],))

    # 3. Aktuelle Vormerkungen anlegen oder auffrischen (Betrag kann sich ändern)
    added_pending = 0
    for item in pending_items:
        exists = conn.execute(
            "SELECT category_id, budget_month, budget_month_manual FROM transactions WHERE id = ?", (item["id"],)
        ).fetchone()
        if exists:
            # Ändert sich das Datum, kann sich auch der Monat ändern
            budget = exists["budget_month"] if exists["budget_month_manual"] else compute_budget_month(
                date.fromisoformat(item["booking_date"]), shifts.get(exists["category_id"], False), shift_day)
            conn.execute(
                "UPDATE transactions SET booking_date = ?, amount_cents = ?, counterparty = ?, purpose = ?, "
                "budget_month = ? WHERE id = ? AND pending = 1",
                (item["booking_date"], item["amount_cents"], item["counterparty"], item["purpose"], budget, item["id"]),
            )
        else:
            insert(item, True)
            added_pending += 1

    pending_total = conn.execute("SELECT COUNT(*) FROM transactions WHERE pending = 1").fetchone()[0]
    return {
        "new": new, "categorized": categorized, "uncategorized": new - categorized,
        "confirmed": confirmed, "new_pending": added_pending, "pending": pending_total,
    }


def recompute_budget_months(conn: sqlite3.Connection) -> None:
    """Rechnet die Budgetmonate neu, z. B. nach Änderung der Lohn-Einstellung.
    Von Hand gesetzte Monate bleiben unangetastet."""
    shifts, shift_day = _shift_info(conn)
    rows = conn.execute(
        "SELECT id, booking_date, category_id FROM transactions WHERE budget_month_manual = 0"
    ).fetchall()
    for row in rows:
        budget = compute_budget_month(
            date.fromisoformat(row["booking_date"]), shifts.get(row["category_id"], False), shift_day
        )
        conn.execute("UPDATE transactions SET budget_month = ? WHERE id = ?", (budget, row["id"]))


def similar_ids(conn: sqlite3.Connection, tx: sqlite3.Row) -> list[str]:
    """Andere Umsätze vom gleichen (oder ähnlich geschriebenen) Empfänger in
    derselben Richtung – also z. B. alle Abbuchungen von "Kleingeld Plus"."""
    key = counterparty_key(tx["counterparty"])
    if not key:
        return []
    op = ">" if tx["amount_cents"] > 0 else "<="
    rows = conn.execute(
        f"SELECT id, counterparty FROM transactions WHERE id != ? AND amount_cents {op} 0", (tx["id"],)
    ).fetchall()
    return [r["id"] for r in rows if counterparty_key(r["counterparty"]) == key]


def assign_category(
    conn: sqlite3.Connection, tx_id: str, category_id: int | None,
    remember: bool = False, apply_similar: bool = False,
) -> dict:
    """Ordnet einen Umsatz von Hand zu.

    Mit ``apply_similar`` bekommen alle Umsätze vom gleichen Empfänger dieselbe
    Kategorie, auch schon zugeordnete. Mit ``remember`` entsteht eine Regel aus
    dem Empfänger; sie greift sofort für noch offene Umsätze und künftig beim Import.
    """
    tx = conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if tx is None:
        raise KeyError(tx_id)

    conn.execute(
        "UPDATE transactions SET category_id = ?, categorized_by = ? WHERE id = ?",
        (category_id, "user" if category_id else None, tx_id),
    )

    also_assigned = 0
    if apply_similar and category_id:
        ids = similar_ids(conn, tx)
        conn.executemany(
            "UPDATE transactions SET category_id = ?, categorized_by = 'user' WHERE id = ?",
            [(category_id, i) for i in ids],
        )
        also_assigned = len(ids)

    pattern = counterparty_key(tx["counterparty"]) or normalize(tx["counterparty"])
    if remember and category_id and pattern:
        # Eine ältere eigene Regel für denselben Empfänger wird ersetzt
        conn.execute("DELETE FROM rules WHERE source = 'user' AND pattern IN (?, ?)",
                     (pattern, normalize(tx["counterparty"])))
        conn.execute(
            "INSERT OR IGNORE INTO rules (pattern, category_id, source, direction, scope) VALUES (?, ?, 'user', ?, 'counterparty')",
            (pattern, category_id, direction(tx["amount_cents"])),
        )
        also_assigned += apply_rules_to_open(conn, exclude_id=tx_id)

    recompute_budget_months(conn)
    return {"also_assigned": also_assigned}


def apply_rules_to_open(conn: sqlite3.Connection, exclude_id: str | None = None) -> int:
    """Sortiert noch offene Umsätze mit den aktuellen Regeln ein. Gibt die Anzahl zurück."""
    rules = load_rules(conn)
    rows = conn.execute(
        "SELECT id, counterparty, purpose, counterparty_iban, amount_cents FROM transactions "
        "WHERE category_id IS NULL AND id != ?",
        (exclude_id or "",),
    ).fetchall()
    count = 0
    for row in rows:
        rule = match_rule(rules, row["counterparty"], row["purpose"], row["amount_cents"], row["counterparty_iban"])
        if rule:
            conn.execute(
                "UPDATE transactions SET category_id = ?, categorized_by = 'rule' WHERE id = ?",
                (rule.category_id, row["id"]),
            )
            count += 1
    if count:
        recompute_budget_months(conn)
    return count


def set_budget_month(conn: sqlite3.Connection, tx_id: str, month: str | None) -> None:
    """Setzt den Budgetmonat von Hand. ``None`` stellt die Automatik wieder her."""
    if month is None:
        conn.execute("UPDATE transactions SET budget_month_manual = 0 WHERE id = ?", (tx_id,))
        recompute_budget_months(conn)
    else:
        conn.execute(
            "UPDATE transactions SET budget_month = ?, budget_month_manual = 1 WHERE id = ?",
            (month, tx_id),
        )


# ---------------------------------------------------------------------------
# Rückgängig
# ---------------------------------------------------------------------------
# Vor jeder Zuordnung wird festgehalten, wie Umsätze und eigene Regeln
# aussahen. Gespeichert werden nur die Änderungen, die letzten UNDO_STEPS.

UNDO_STEPS = 20


def _undo_state(conn: sqlite3.Connection) -> tuple[dict, dict]:
    txs = {r["id"]: (r["category_id"], r["categorized_by"])
           for r in conn.execute("SELECT id, category_id, categorized_by FROM transactions")}
    rules = {r["id"]: dict(r) for r in conn.execute(
        "SELECT id, pattern, category_id, source, direction, scope FROM rules WHERE source = 'user'")}
    return txs, rules


def with_undo(conn: sqlite3.Connection, label: str, action):
    """Führt ``action()`` aus und merkt sich, wie es vorher war."""
    before_tx, before_rules = _undo_state(conn)
    result = action()
    after_tx, after_rules = _undo_state(conn)
    changed = [[i, *before_tx[i]] for i in before_tx if after_tx.get(i) != before_tx[i]]
    removed = [r for i, r in before_rules.items() if i not in after_rules]
    added = [i for i in after_rules if i not in before_rules]
    if changed or removed or added:
        conn.execute(
            "INSERT INTO undo_log (created, label, data) VALUES (datetime('now', 'localtime'), ?, ?)",
            (label, json.dumps({"tx": changed, "rules_removed": removed, "rules_added": added})),
        )
        conn.execute("DELETE FROM undo_log WHERE id NOT IN (SELECT id FROM undo_log ORDER BY id DESC LIMIT ?)",
                     (UNDO_STEPS,))
    return result


def undo_last(conn: sqlite3.Connection) -> dict | None:
    """Macht die letzte Zuordnung rückgängig. Gibt zurück, was es war."""
    row = conn.execute("SELECT * FROM undo_log ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        return None
    data = json.loads(row["data"])
    conn.executemany("UPDATE transactions SET category_id = ?, categorized_by = ? WHERE id = ?",
                     [(cat, by, i) for i, cat, by in data["tx"]])
    conn.executemany("DELETE FROM rules WHERE id = ?", [(i,) for i in data["rules_added"]])
    for r in data["rules_removed"]:
        conn.execute(
            "INSERT OR IGNORE INTO rules (id, pattern, category_id, source, direction, scope) VALUES (?, ?, ?, ?, ?, ?)",
            (r["id"], r["pattern"], r["category_id"], r["source"], r["direction"], r.get("scope", "any")),
        )
    conn.execute("DELETE FROM undo_log WHERE id = ?", (row["id"],))
    recompute_budget_months(conn)
    return {"label": row["label"], "count": len(data["tx"]), "left": undo_count(conn)}


def undo_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM undo_log").fetchone()[0]


def reapply_rules(conn: sqlite3.Connection) -> int:
    """Sortiert alle automatisch einsortierten Umsätze nach den aktuellen Regeln
    neu ein (z. B. nachdem eine Regel zu viel getroffen hat). Von Hand
    zugeordnete Umsätze bleiben, wie sie sind. Gibt die Zahl der Änderungen zurück."""
    rules = load_rules(conn)
    changed = 0
    rows = conn.execute(
        "SELECT id, counterparty, purpose, counterparty_iban, amount_cents, category_id FROM transactions "
        "WHERE categorized_by = 'rule' OR category_id IS NULL"
    ).fetchall()
    for row in rows:
        rule = match_rule(rules, row["counterparty"], row["purpose"], row["amount_cents"], row["counterparty_iban"])
        new = rule.category_id if rule else None
        if new != row["category_id"]:
            conn.execute("UPDATE transactions SET category_id = ?, categorized_by = ? WHERE id = ?",
                         (new, "rule" if new else None, row["id"]))
            changed += 1
    if changed:
        recompute_budget_months(conn)
    return changed
