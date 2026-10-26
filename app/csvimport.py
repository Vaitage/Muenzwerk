"""Umsätze aus einer CSV-Datei der Bank nachtragen (z. B. ab Jahresanfang).

Über PSD2 liefert die Bank meist nur die letzten Monate. Ältere Buchungen gibt es im
Online-Banking als CSV-Export („Umsatzanzeige“ der ING). Diese Datei wird hier gelesen:

* ``POST /api/import/csv/preview`` – nur lesen und zählen, nichts speichern
* ``POST /api/import/csv``         – neue Buchungen speichern (Regeln ordnen sie zu)
* ``DELETE /api/import/csv``       – alle per CSV importierten Buchungen wieder entfernen

Doppelte Buchungen: Was schon von der Bank (PSD2) oder aus einem früheren Import da ist,
wird erkannt – gleicher Betrag, Datum höchstens 3 Tage auseinander, Empfänger passt. Jede
vorhandene Buchung „verbraucht“ dabei höchstens eine Zeile der Datei, damit zwei gleiche
Einkäufe am selben Tag nicht zu einem werden. Importierte Buchungen haben IDs ``csv-…``.
"""

import csv
import hashlib
import io
import re
import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, ledger, sync

router = APIRouter(prefix="/api/import")

MAX_CSV_CHARS = 8_000_000      # eine Umsatzanzeige über Jahre bleibt weit darunter
MATCH_DAYS = 3                 # Buchungs-/Wertstellungstag weichen zwischen CSV und PSD2 leicht ab
PREFIX = "csv-"

# Spaltennamen (klein, ohne Sonderzeichen) → Bedeutung. ING heute und früher, dazu gängige Varianten.
COLUMNS = {
    "date": ("buchung", "buchungstag", "buchungsdatum", "datum"),
    "value_date": ("valuta", "wertstellungsdatum", "wertstellung"),
    "counterparty": ("auftraggeberempfanger", "auftraggeberempfaenger", "empfanger", "empfaenger",
                     "zahlungsempfanger", "zahlungsempfaenger", "beguenstigterauftraggeber",
                     "begunstigterzahlungspflichtiger", "name"),
    "kind": ("buchungstext", "umsatzart"),
    "purpose": ("verwendungszweck",),
    "balance": ("saldo",),
    "amount": ("betrag", "betrageur", "umsatz"),
}


class CsvBody(BaseModel):
    csv: str = Field(max_length=MAX_CSV_CHARS)


def get_db():
    with db.session() as conn:
        yield conn


def _key(name: str) -> str:
    s = name.strip().lower()
    s = s.replace("ä", "a").replace("ö", "o").replace("ü", "u").replace("ß", "ss")
    return re.sub(r"[^a-z]", "", s)


def parse_amount(text: str) -> int | None:
    """„-1.234,56“ / „1234,56“ / „-12.50“ → Cent. None, wenn es keine Zahl ist."""
    s = (text or "").strip().replace(" ", "").replace(" ", "").replace("€", "").replace("EUR", "")
    if not s:
        return None
    neg = s.startswith("-") or s.startswith("−")
    s = s.lstrip("+-−")
    if "," in s:                      # deutsches Format: Punkte trennen Tausender
        s = s.replace(".", "").replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s):
        return None
    cents = round(float(s) * 100)
    return -cents if neg else cents


def parse_date(text: str) -> date | None:
    s = (text or "").strip()
    m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})", s)
    try:
        if m:
            d, mo, y = (int(x) for x in m.groups())
            return date(y + 2000 if y < 100 else y, mo, d)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            return date.fromisoformat(s)
    except ValueError:
        return None
    return None


def parse(text: str) -> dict:
    """Liest die Datei. Liefert {items, errors, saldo_end} – items im Format von ledger.import_transactions."""
    text = text.lstrip("﻿")
    sample = "\n".join(text.splitlines()[:40])
    delim = ";" if sample.count(";") >= sample.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))

    # Kopfzeile suchen: die erste Zeile mit Datum- und Betrag-Spalte (ING hat vorher einen Infoblock)
    header_at, cols = None, {}
    for i, row in enumerate(rows[:60]):
        keys = [_key(c) for c in row]
        found = {}
        for meaning, names in COLUMNS.items():
            for idx, k in enumerate(keys):
                if k in names and meaning not in found:
                    found[meaning] = idx
        if "date" in found and "amount" in found:
            header_at, cols = i, found
            break
    if header_at is None:
        raise HTTPException(400, "Keine Umsatzliste erkannt. Bitte die CSV-Datei aus dem Online-Banking (Umsätze → Export CSV) wählen.")

    items, errors, seen = [], 0, {}
    for row in rows[header_at + 1:]:
        if not any(c.strip() for c in row):
            continue
        get = lambda m: row[cols[m]].strip() if m in cols and cols[m] < len(row) else ""
        day = parse_date(get("date")) or parse_date(get("value_date"))
        cents = parse_amount(get("amount"))
        if day is None or cents is None:
            errors += 1
            continue
        party = " ".join(get("counterparty").split())
        purpose = " ".join(get("purpose").split())
        kind = get("kind")
        if not purpose and kind:
            purpose = kind
        balance = parse_amount(get("balance"))
        # Stabile ID: gleiche Zeile → gleiche ID, auch beim zweiten Import. Der Saldo unterscheidet
        # gleiche Einkäufe am selben Tag; fehlt er, zählt die laufende Nummer gleicher Zeilen.
        base = "|".join([day.isoformat(), str(cents), party, purpose, "" if balance is None else str(balance)])
        n = seen.get(base, 0)
        seen[base] = n + 1
        tx_id = PREFIX + hashlib.sha256(f"{base}|{n}".encode("utf-8")).hexdigest()[:24]
        items.append({
            "id": tx_id, "booking_date": day.isoformat(), "amount_cents": cents, "currency": "EUR",
            "counterparty": party, "purpose": purpose, "counterparty_iban": "", "pending": False,
            "_balance": balance,
        })
    items.sort(key=lambda i: i["booking_date"])
    return {"items": items, "errors": errors}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{3,}", ledger.normalize(text))}


def _same_party(a: str, b: str) -> bool:
    ka, kb = ledger.counterparty_key(a), ledger.counterparty_key(b)
    if not ka or not kb or ka == kb or ka in kb or kb in ka:
        return True
    return bool(_words(a) & _words(b))          # „REWE Markt GmbH“ ↔ „REWE SAGT DANKE“


def classify(conn: sqlite3.Connection, items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Teilt die Zeilen in (neu, schon vorhanden)."""
    existing = conn.execute(
        "SELECT id, booking_date, amount_cents, counterparty FROM transactions"
    ).fetchall()
    known_ids = {r["id"] for r in existing}
    by_amount: dict[int, list] = {}
    for r in existing:
        if not r["id"].startswith(PREFIX):
            by_amount.setdefault(r["amount_cents"], []).append(r)
    used: set[str] = set()
    new, dup = [], []
    for item in items:
        if item["id"] in known_ids:
            dup.append(item)
            continue
        day = date.fromisoformat(item["booking_date"])
        best, best_gap = None, None
        for r in by_amount.get(item["amount_cents"], []):
            if r["id"] in used:
                continue
            gap = abs((day - date.fromisoformat(r["booking_date"])).days)
            if gap > MATCH_DAYS or not _same_party(item["counterparty"], r["counterparty"]):
                continue
            if best is None or gap < best_gap:
                best, best_gap = r, gap
        if best is not None:
            used.add(best["id"])
            dup.append(item)
        else:
            new.append(item)
    return new, dup


def _summary(conn: sqlite3.Connection, text: str) -> dict:
    parsed = parse(text)
    items = parsed["items"]
    if not items:
        raise HTTPException(400, "Die Datei enthält keine Buchungen.")
    new, dup = classify(conn, items)
    first_bank = conn.execute(
        "SELECT MIN(booking_date) FROM transactions WHERE id NOT LIKE 'csv-%' AND pending = 0"
    ).fetchone()[0]
    later_new = [i for i in new if first_bank and i["booking_date"] >= first_bank]
    return {
        "rows": len(items), "errors": parsed["errors"],
        "from": items[0]["booking_date"], "to": items[-1]["booking_date"],
        "new": len(new), "duplicates": len(dup),
        "income_cents": sum(i["amount_cents"] for i in new if i["amount_cents"] > 0),
        "expense_cents": sum(i["amount_cents"] for i in new if i["amount_cents"] < 0),
        "first_bank": first_bank,
        # neue Zeilen im Zeitraum, den die Bank schon liefert – zum Nachsehen vor dem Übernehmen
        "overlap": [
            {"date": i["booking_date"], "amount_cents": i["amount_cents"], "counterparty": i["counterparty"]}
            for i in later_new[:20]
        ],
        "overlap_count": len(later_new),
        "_new": new,
    }


@router.post("/csv/preview")
def preview(body: CsvBody, conn=Depends(get_db)):
    s = _summary(conn, body.csv)
    s.pop("_new")
    return s


@router.post("/csv")
def run_import(body: CsvBody, conn=Depends(get_db)):
    # nicht gleichzeitig mit einem Bankabruf schreiben
    if not sync._RUN_LOCK.acquire(timeout=sync.WAIT_FOR_RUNNING_SECONDS):
        raise HTTPException(409, "Gerade läuft ein Bankabruf. Bitte gleich noch einmal versuchen.")
    try:
        s = _summary(conn, body.csv)
        new = [{k: v for k, v in i.items() if not k.startswith("_")} for i in s.pop("_new")]
        result = ledger.import_transactions(conn, new)
        conn.commit()
    finally:
        sync._RUN_LOCK.release()
    return {**s, "imported": result["new"], "categorized": result["categorized"],
            "uncategorized": result["uncategorized"]}


@router.get("/csv")
def status(conn=Depends(get_db)):
    row = conn.execute(
        "SELECT COUNT(*), MIN(booking_date), MAX(booking_date) FROM transactions WHERE id LIKE 'csv-%'"
    ).fetchone()
    return {"count": row[0], "from": row[1], "to": row[2]}


@router.delete("/csv")
def remove(conn=Depends(get_db)):
    n = conn.execute("DELETE FROM transactions WHERE id LIKE 'csv-%'").rowcount
    conn.commit()
    return {"removed": n}
