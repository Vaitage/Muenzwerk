from datetime import date

import pytest

from app import db, ledger


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    db.init(c)
    yield c
    c.close()


def cat_id(conn, name):
    return conn.execute("SELECT id FROM categories WHERE name = ?", (name,)).fetchone()["id"]


def tx(id_, day, amount, who, purpose=""):
    return {"id": id_, "booking_date": day, "amount_cents": amount, "counterparty": who, "purpose": purpose}


def test_standard_categories_present(conn):
    names = {r["name"] for r in conn.execute("SELECT name FROM categories WHERE kind='expense'")}
    assert {"Allgemein", "Restaurant", "Wohnen", "Lebensmittel", "Mobilität", "Unterhaltung"} <= names


def test_budget_month_salary_end_of_month_counts_for_next_month():
    assert ledger.compute_budget_month(date(2026, 10, 30), True, 15) == "2026-11"
    assert ledger.compute_budget_month(date(2026, 12, 29), True, 15) == "2027-01"


def test_budget_month_late_salary_stays():
    # Gehalt kommt verspätet am 2. -> zählt für den laufenden Monat
    assert ledger.compute_budget_month(date(2026, 11, 2), True, 15) == "2026-11"


def test_budget_month_normal_expense_stays():
    assert ledger.compute_budget_month(date(2026, 10, 30), False, 15) == "2026-10"


def test_import_categorizes_and_skips_duplicates(conn):
    items = [
        tx("a", "2026-10-03", -2350, "REWE Markt GmbH", "Kartenzahlung"),
        tx("b", "2026-10-30", 285000, "Muster GmbH", "Lohn/Gehalt 10/2026"),
        tx("c", "2026-10-04", -1999, "AMAZON EU S.A R.L.", "Bestellung"),
    ]
    r = ledger.import_transactions(conn, items)
    assert (r["new"], r["categorized"], r["uncategorized"], r["pending"]) == (3, 2, 1, 0)
    assert ledger.import_transactions(conn, items)["new"] == 0

    rows = {r["id"]: r for r in conn.execute("SELECT * FROM transactions")}
    assert rows["a"]["category_id"] == cat_id(conn, "Lebensmittel")
    assert rows["b"]["category_id"] == cat_id(conn, "Gehalt")
    assert rows["b"]["budget_month"] == "2026-11"
    assert rows["c"]["category_id"] is None


def test_verdienstabrechnung_ist_gehalt_spesen_nicht(conn):
    # Lohn und Spesen kommen vom selben Arbeitgeber; nur der Lohn ist Gehalt
    zweck = "mandatereference:,creditorid:,remittanceinformation:"
    ledger.import_transactions(conn, [
        tx("lohn", "2027-01-28", 420000, "Muster GmbH", zweck + "Verdienstabrechnung 01.2027"),
        tx("spesen", "2027-01-28", 5600, "Muster GmbH", zweck + "Expenses 4711"),
    ])
    rows = {r["id"]: r for r in conn.execute("SELECT * FROM transactions")}
    assert rows["lohn"]["category_id"] == cat_id(conn, "Gehalt")
    assert rows["lohn"]["budget_month"] == "2027-02"  # Ende Januar -> zählt für Februar
    assert rows["spesen"]["category_id"] != cat_id(conn, "Gehalt")
    assert rows["spesen"]["budget_month"] == "2027-01"


def test_alle_gleichen_uebernehmen_auch_schon_zugeordnete(conn):
    # Kleingeld-Abbuchungen: der Zweck nennt den Laden, daher greifen sonst Start-Regeln
    ledger.import_transactions(conn, [
        tx("k1", "2026-07-02", -40, "Kleingeld Plus - Sparen", "Aus Kauf 9,60- bei REWE"),
        tx("k2", "2026-08-11", -27, "Kleingeld Plus - Sparen", "Aus Kauf 3,73- bei BAECKER"),
        tx("k3", "2026-09-05", -15, "KLEINGELD PLUS SPAREN 2", "Aus Kauf 4,85- bei Kiosk"),
        tx("x", "2026-09-05", -999, "Anderer Empfänger", ""),
    ])
    assert conn.execute("SELECT category_id FROM transactions WHERE id='k1'").fetchone()[0] == cat_id(conn, "Lebensmittel")

    sparen = cat_id(conn, "Sparen")
    res = ledger.assign_category(conn, "k2", sparen, remember=True, apply_similar=True)
    assert res["also_assigned"] == 2
    rows = dict(conn.execute("SELECT id, category_id FROM transactions").fetchall())
    assert rows["k1"] == rows["k2"] == rows["k3"] == sparen
    assert rows["x"] is None

    # Künftige Abbuchungen: eigene Regel schlägt die Start-Regel "rewe"
    ledger.import_transactions(conn, [tx("k4", "2026-10-01", -12, "Kleingeld Plus - Sparen", "bei REWE")])
    assert conn.execute("SELECT category_id FROM transactions WHERE id='k4'").fetchone()[0] == sparen


def test_rueckgaengig_stellt_kategorien_und_regeln_wieder_her(conn):
    ledger.import_transactions(conn, [
        tx("k1", "2026-07-02", -40, "Kleingeld Plus - Sparen", "bei REWE"),
        tx("k2", "2026-08-11", -27, "Kleingeld Plus - Sparen", "bei Kiosk"),
        tx("k3", "2026-08-12", -30, "Kleingeld Plus - Sparen", "bei Kiosk"),
    ])
    vorher = dict(conn.execute("SELECT id, category_id FROM transactions").fetchall())
    regeln_vorher = conn.execute("SELECT COUNT(*) FROM rules").fetchone()[0]

    sparen, zinsen = cat_id(conn, "Sparen"), cat_id(conn, "Zinsen & Dividenden")
    ledger.with_undo(conn, "1", lambda: ledger.assign_category(conn, "k2", zinsen, remember=True))
    ledger.with_undo(conn, "2", lambda: ledger.assign_category(conn, "k2", sparen, remember=True, apply_similar=True))
    assert ledger.undo_count(conn) == 2
    assert set(dict(conn.execute("SELECT id, category_id FROM transactions").fetchall()).values()) == {sparen}

    # Ein Schritt zurück: wieder Zinsen-Regel und Zuordnung von Schritt 1
    assert ledger.undo_last(conn)["count"] == 3
    rows = dict(conn.execute("SELECT id, category_id FROM transactions").fetchall())
    assert rows["k2"] == rows["k3"] == zinsen and rows["k1"] == vorher["k1"]
    assert conn.execute("SELECT c.name FROM rules r JOIN categories c ON c.id = r.category_id "
                        "WHERE r.source = 'user'").fetchone()[0] == "Zinsen & Dividenden"

    # Noch einer: alles wie am Anfang
    assert ledger.undo_last(conn)["left"] == 0
    assert dict(conn.execute("SELECT id, category_id FROM transactions").fetchall()) == vorher
    assert conn.execute("SELECT COUNT(*) FROM rules").fetchone()[0] == regeln_vorher
    assert ledger.undo_last(conn) is None


def test_gelernte_regel_gilt_in_ihrer_richtung(conn):
    # Ausgabe bewusst einer Einnahmen-Kategorie zugeordnet -> Regel muss trotzdem greifen
    ledger.import_transactions(conn, [
        tx("a", "2026-10-01", -50, "Beispiel Verein", ""),
        tx("b", "2026-10-08", -50, "Beispiel Verein", ""),
        tx("c", "2026-10-09", 50, "Beispiel Verein", "Rückbuchung"),
    ])
    zinsen = cat_id(conn, "Zinsen & Dividenden")
    assert ledger.assign_category(conn, "a", zinsen, remember=True)["also_assigned"] == 1
    rows = dict(conn.execute("SELECT id, category_id FROM transactions").fetchall())
    assert rows["b"] == zinsen
    assert rows["c"] != zinsen   # die Gegenrichtung bleibt unberührt


def test_income_rule_never_hits_expense(conn):
    # "Lohnsteuer" enthält "lohn", ist aber eine Ausgabe -> nicht Gehalt
    ledger.import_transactions(conn, [tx("s", "2026-10-10", -50000, "Finanzamt", "Lohnsteuer")])
    row = conn.execute("SELECT category_id FROM transactions WHERE id='s'").fetchone()
    assert row["category_id"] == cat_id(conn, "Steuern")


def test_remember_learns_and_applies_to_open_items(conn):
    ledger.import_transactions(conn, [
        tx("1", "2026-10-02", -350, "SumUp *Baeckerei Kraus"),
        tx("2", "2026-10-09", -420, "SumUp *Baeckerei Kraus"),
        tx("3", "2026-10-11", -999, "Unbekannt GmbH"),
    ])
    res = ledger.assign_category(conn, "1", cat_id(conn, "Lebensmittel"), remember=True)
    assert res["also_assigned"] == 1
    assert conn.execute("SELECT category_id FROM transactions WHERE id='2'").fetchone()[0] == cat_id(conn, "Lebensmittel")
    assert conn.execute("SELECT category_id FROM transactions WHERE id='3'").fetchone()[0] is None

    # neue Zahlung beim nächsten Import wird automatisch erkannt
    ledger.import_transactions(conn, [tx("4", "2026-10-20", -280, "SumUp *Baeckerei Kraus")])
    assert conn.execute("SELECT category_id FROM transactions WHERE id='4'").fetchone()[0] == cat_id(conn, "Lebensmittel")


def test_changing_shift_day_recomputes(conn):
    ledger.import_transactions(conn, [tx("g", "2026-10-20", 285000, "Muster GmbH", "Gehalt")])
    assert conn.execute("SELECT budget_month FROM transactions").fetchone()[0] == "2026-11"
    conn.execute("UPDATE settings SET value='25' WHERE key='shift_from_day'")
    ledger.recompute_budget_months(conn)
    assert conn.execute("SELECT budget_month FROM transactions").fetchone()[0] == "2026-10"


def test_manual_budget_month_survives_recompute(conn):
    ledger.import_transactions(conn, [tx("m", "2026-10-28", -5000, "Irgendwer")])
    ledger.set_budget_month(conn, "m", "2026-11")
    ledger.recompute_budget_months(conn)
    assert conn.execute("SELECT budget_month FROM transactions").fetchone()[0] == "2026-11"
    ledger.set_budget_month(conn, "m", None)
    assert conn.execute("SELECT budget_month FROM transactions").fetchone()[0] == "2026-10"


def test_savings_rule_matches_both_directions(conn):
    ledger.import_transactions(conn, [
        tx("in", "2026-10-02", -20000, "Eigenes Extra-Konto", "Dauerauftrag"),
        tx("out", "2026-10-20", 15000, "Eigenes Extra-Konto", "Umbuchung"),
    ])
    sparen = cat_id(conn, "Sparen")
    rows = {r["id"]: r["category_id"] for r in conn.execute("SELECT id, category_id FROM transactions")}
    assert rows == {"in": sparen, "out": sparen}


def test_pending_shown_then_replaced_by_booking(conn):
    from datetime import date, timedelta
    today = date.today()
    d = lambda n: (today - timedelta(days=n)).isoformat()  # noqa: E731
    pend = {"id": "p1", "booking_date": d(0), "amount_cents": -2350, "counterparty": "REWE Markt GmbH",
            "purpose": "Kartenzahlung", "pending": True}
    r = ledger.import_transactions(conn, [pend], window_start=today - timedelta(days=7))
    assert r["new_pending"] == 1 and r["pending"] == 1
    row = conn.execute("SELECT * FROM transactions WHERE id='p1'").fetchone()
    assert row["pending"] == 1 and row["category_id"] == cat_id(conn, "Lebensmittel")

    # Von Hand umsortiert, während vorgemerkt
    ledger.assign_category(conn, "p1", cat_id(conn, "Restaurant"))

    # Erneuter Abruf, noch vorgemerkt: nichts doppelt
    r = ledger.import_transactions(conn, [pend], window_start=today - timedelta(days=7))
    assert r["new_pending"] == 0 and conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1

    # Zwei Tage später gebucht, mit anderer ID und Schreibweise
    booked = {"id": "b1", "booking_date": d(-2), "amount_cents": -2350, "counterparty": "REWE MARKT GMBH 0815",
              "purpose": "Kartenzahlung girocard"}
    r = ledger.import_transactions(conn, [booked], window_start=today - timedelta(days=7))
    assert r["confirmed"] == 1 and r["pending"] == 0
    rows = conn.execute("SELECT * FROM transactions").fetchall()
    assert [x["id"] for x in rows] == ["b1"]
    assert rows[0]["category_id"] == cat_id(conn, "Restaurant")  # Handzuordnung bleibt
    assert rows[0]["pending"] == 0


def test_pending_dropped_when_bank_no_longer_reports_it(conn):
    from datetime import date, timedelta
    today = date.today()
    hold = {"id": "p2", "booking_date": today.isoformat(), "amount_cents": -10000,
            "counterparty": "ARAL Station", "purpose": "Reservierung", "pending": True}
    ledger.import_transactions(conn, [hold], window_start=today - timedelta(days=7))
    # Nächster Abruf: Reservierung ist weg, nichts gebucht
    r = ledger.import_transactions(conn, [], window_start=today - timedelta(days=7))
    assert r["pending"] == 0
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0


def test_pending_with_other_amount_is_not_matched(conn):
    from datetime import date
    today = date.today()
    ledger.import_transactions(conn, [{"id": "p3", "booking_date": today.isoformat(), "amount_cents": -5000,
                                       "counterparty": "Hotel", "purpose": "", "pending": True}], window_start=today)
    ledger.import_transactions(conn, [{"id": "b3", "booking_date": today.isoformat(), "amount_cents": -4999,
                                       "counterparty": "Kino", "purpose": ""}])   # ohne Zeitfenster: Vormerkung bleibt
    ids = {r["id"] for r in conn.execute("SELECT id FROM transactions")}
    assert ids == {"p3", "b3"}


def test_vormerkung_mit_neuem_datum_wechselt_den_monat(conn):
    ledger.import_transactions(conn, [{**tx("p1", "2026-11-02", -1500, "Bäckerei"), "pending": True}])
    assert conn.execute("SELECT budget_month FROM transactions WHERE id='p1'").fetchone()[0] == "2026-11"
    ledger.import_transactions(conn, [{**tx("p1", "2026-10-30", -1500, "Bäckerei"), "pending": True}])
    assert conn.execute("SELECT booking_date, budget_month FROM transactions WHERE id='p1'").fetchone()[:] == ("2026-10-30", "2026-10")


def test_gelernte_regel_schaut_nur_auf_den_empfaenger(conn):
    # Eigener Name als Empfänger -> Regel "mustermann"; der Name steht aber auch in der Miete
    ledger.import_transactions(conn, [
        tx("u1", "2026-10-15", -50000, "Mustermann", "Umbuchung"),
        tx("u2", "2026-11-15", -50000, "Mustermann", "Umbuchung"),
        tx("m1", "2026-10-01", -98000, "Beispiel Wohnbau GmbH", "Mustermann Musterweg 6"),
        tx("b1", "2026-10-09", -7000, "Erika Mustermann", ""),
    ])
    kredit = cat_id(conn, "Kredit")
    assert ledger.assign_category(conn, "u1", kredit, remember=True)["also_assigned"] == 1
    rows = dict(conn.execute("SELECT id, category_id FROM transactions").fetchall())
    assert rows["u2"] == kredit
    assert rows["m1"] != kredit and rows["b1"] != kredit


def test_neu_einsortieren_repariert_zu_viel_getroffene_regel(conn):
    ledger.import_transactions(conn, [
        tx("m1", "2026-10-01", -98000, "Beispiel Wohnbau GmbH", "Mustermann Musterweg 6"),
        tx("h1", "2026-10-02", -5000, "Mustermann", ""),
    ])
    kredit = cat_id(conn, "Kredit")
    # So sah eine alte Regel aus: sucht auch im Verwendungszweck
    conn.execute("INSERT INTO rules (pattern, category_id, source, direction, scope) VALUES ('mustermann', ?, 'user', 'expense', 'any')", (kredit,))
    ledger.reapply_rules(conn)
    assert conn.execute("SELECT category_id FROM transactions WHERE id='m1'").fetchone()[0] == kredit
    ledger.assign_category(conn, "h1", kredit)   # von Hand, bleibt
    conn.execute("UPDATE rules SET scope = 'counterparty' WHERE pattern = 'mustermann'")
    assert ledger.reapply_rules(conn) == 1
    rows = dict(conn.execute("SELECT id, category_id FROM transactions").fetchall())
    assert rows["m1"] is None and rows["h1"] == kredit


def test_umstellung_bestehender_regeln(tmp_path):
    from app import db
    c = db.connect(str(tmp_path / "alt.db"))
    db.init(c)
    c.execute("INSERT INTO transactions (id, booking_date, amount_cents, counterparty, purpose, budget_month) VALUES ('a','2026-10-01',-1,'Mustermann','', '2026-10')")
    c.execute("INSERT INTO rules (pattern, category_id, source, direction) VALUES ('mustermann', 1, 'user', 'expense')")
    c.execute("INSERT INTO rules (pattern, category_id, source, direction) VALUES ('muster ag spesen', 1, 'user', 'income')")
    # Spalte entfernen wie in einer alten Datenbank, dann Migration
    c.executescript("CREATE TABLE r2 AS SELECT id, pattern, category_id, source, direction, created_at FROM rules; DROP TABLE rules; ALTER TABLE r2 RENAME TO rules;")
    db.init(c)
    scopes = dict(c.execute("SELECT pattern, scope FROM rules WHERE source='user'").fetchall())
    assert scopes == {"mustermann": "counterparty", "muster ag spesen": "any"}
