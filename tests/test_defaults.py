"""Standardkategorien in beiden Sprachen (DEFAULT_LANGUAGE)."""

import pytest

from app import accounts, db, defaults, ledger


def fresh(monkeypatch, lang):
    monkeypatch.setenv("DEFAULT_LANGUAGE", lang)
    c = db.connect(":memory:")
    db.init(c)
    return c


def names(conn, kind):
    return {r["name"] for r in conn.execute("SELECT name FROM categories WHERE kind = ?", (kind,))}


def test_englische_kategorien(monkeypatch):
    conn = fresh(monkeypatch, "en")
    assert {"Groceries", "Housing", "Savings", "Loan"} <= names(conn, "expense")
    assert {"Salary", "Refunds"} <= names(conn, "income")
    assert "Lebensmittel" not in names(conn, "expense")
    # Start-Regeln zeigen auf die englischen Kategorien
    ledger.import_transactions(conn, [{"id": "a", "booking_date": "2026-10-01", "amount_cents": -2000,
                                       "counterparty": "REWE Markt", "purpose": ""}])
    row = conn.execute("SELECT c.name FROM transactions t JOIN categories c ON c.id = t.category_id").fetchone()
    assert row["name"] == "Groceries"
    saved = conn.execute("SELECT is_savings FROM categories WHERE name = 'Savings'").fetchone()
    assert saved["is_savings"] == 1


def test_deutsch_ist_standard(monkeypatch):
    monkeypatch.delenv("DEFAULT_LANGUAGE", raising=False)
    assert defaults.language() == "de"
    monkeypatch.setenv("DEFAULT_LANGUAGE", "fr")
    assert defaults.language() == "de"


@pytest.mark.parametrize("lang,expected", [("de", "Sparen"), ("en", "Savings")])
def test_umbuchungsregel_findet_spar_kategorie(monkeypatch, lang, expected):
    conn = fresh(monkeypatch, lang)
    n_before = len(names(conn, "expense"))
    accounts._ensure_rule(conn, "savings", "tagesgeld plus")
    rule = conn.execute(
        "SELECT c.name FROM rules r JOIN categories c ON c.id = r.category_id WHERE r.pattern = 'tagesgeld plus'"
    ).fetchone()
    assert rule["name"] == expected
    assert len(names(conn, "expense")) == n_before   # keine doppelte Kategorie


def test_umbuchungsregel_legt_kredit_an_wenn_geloescht(monkeypatch):
    conn = fresh(monkeypatch, "en")
    conn.execute("DELETE FROM categories WHERE name = 'Loan'")
    accounts._ensure_rule(conn, "loan", "car loan")
    assert "Loan" in names(conn, "expense")
