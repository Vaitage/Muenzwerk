"""CSV-Import (app/csvimport.py) – mit erfundenen Daten im Format der ING-Umsatzanzeige."""

import pytest
from fastapi import HTTPException

from app import csvimport, db, ledger

ING = """Umsatzanzeige;Datei erstellt am: 26.10.2026 22:10
;Letztes Update: aktuell

IBAN;DE00 1234 5678 9012 3456 78
Kontoname;Girokonto
Bank;ING
Kunde;Max Mustermann
Zeitraum;01.01.2026 - 26.10.2026
Saldo;1.234,56;EUR

Sortierung;Datum absteigend

In der CSV-Datei finden Sie alle bereits gebuchten Umsätze. Die vorgemerkten Umsätze werden nicht aufgenommen.

Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung
02.07.2026;02.07.2026;REWE Markt GmbH;Lastschrift;REWE SAGT DANKE 12345;1.234,56;EUR;-23,45;EUR
30.06.2026;30.06.2026;Beispiel AG;Gehalt/Rente;Lohn Juni;1.258,01;EUR;2.500,00;EUR
15.03.2026;15.03.2026;Stadtwerke Musterstadt;Lastschrift;Abschlag Strom;-1.241,99;EUR;-65,00;EUR
15.03.2026;15.03.2026;Bäckerei Krume;Lastschrift;Kartenzahlung;-1.176,99;EUR;-3,20;EUR
15.03.2026;15.03.2026;Bäckerei Krume;Lastschrift;Kartenzahlung;-1.173,79;EUR;-3,20;EUR
02.01.2026;02.01.2026;Vermietung Beispiel;Dauerauftrag;Miete Januar;-1.170,59;EUR;-850,00;EUR
kaputt;;;;;;;;
"""


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    db.init(c)
    yield c
    c.close()


def test_zahlen_und_daten():
    assert csvimport.parse_amount("-1.234,56") == -123456
    assert csvimport.parse_amount("2.500,00") == 250000
    assert csvimport.parse_amount("12.50") == 1250
    assert csvimport.parse_amount("abc") is None
    assert str(csvimport.parse_date("02.01.2026")) == "2026-01-02"
    assert csvimport.parse_date("31.02.2026") is None


def test_liest_ing_datei():
    p = csvimport.parse(ING)
    items = p["items"]
    assert len(items) == 6 and p["errors"] == 1
    assert items[0]["booking_date"] == "2026-01-02"          # aufsteigend sortiert
    rewe = items[-1]
    assert rewe["amount_cents"] == -2345 and rewe["counterparty"] == "REWE Markt GmbH"
    assert rewe["purpose"] == "REWE SAGT DANKE 12345"
    # zwei gleiche Bäckerei-Einkäufe am selben Tag bleiben zwei (Saldo unterscheidet sie)
    assert len({i["id"] for i in items}) == 6
    # gleiche Datei → gleiche IDs
    assert [i["id"] for i in csvimport.parse(ING)["items"]] == [i["id"] for i in items]


def test_ohne_umsatzliste_fehler():
    with pytest.raises(HTTPException):
        csvimport.parse("Hallo;Welt\n1;2\n")


def test_erkennt_schon_vorhandene_bankbuchungen(conn):
    # Die Bank (PSD2) hat ab Juni geliefert – mit anderem Empfängernamen und einen Tag versetzt
    ledger.import_transactions(conn, [
        {"id": "eb-1", "booking_date": "2026-07-01", "amount_cents": -2345, "counterparty": "REWE SAGT DANKE", "purpose": ""},
        {"id": "eb-2", "booking_date": "2026-06-30", "amount_cents": 250000, "counterparty": "Beispiel AG", "purpose": "Lohn"},
    ])
    s = csvimport._summary(conn, ING)
    assert s["rows"] == 6 and s["duplicates"] == 2 and s["new"] == 4
    assert s["first_bank"] == "2026-06-30" and s["overlap_count"] == 0
    assert s["from"] == "2026-01-02" and s["to"] == "2026-07-02"


def test_gleicher_betrag_aber_anderer_empfaenger_ist_neu(conn):
    ledger.import_transactions(conn, [
        {"id": "eb-9", "booking_date": "2026-07-02", "amount_cents": -2345, "counterparty": "Tankstelle Nord", "purpose": ""},
    ])
    new, dup = csvimport.classify(conn, csvimport.parse(ING)["items"])
    assert len(dup) == 0 and len(new) == 6


def test_eine_bankbuchung_deckt_nur_eine_zeile(conn):
    ledger.import_transactions(conn, [
        {"id": "eb-b", "booking_date": "2026-03-15", "amount_cents": -320, "counterparty": "Bäckerei Krume", "purpose": ""},
    ])
    new, dup = csvimport.classify(conn, csvimport.parse(ING)["items"])
    assert len(dup) == 1 and len(new) == 5


def test_api_import_zweimal_und_entfernen(tmp_path, monkeypatch):
    from tests.test_api import make_client
    with make_client(tmp_path, monkeypatch) as client:
        pre = client.post("/api/import/csv/preview", json={"csv": ING}).json()
        assert pre["new"] == 6 and pre["duplicates"] == 0 and "_new" not in pre
        assert client.get("/api/import/csv").json()["count"] == 0      # Vorschau speichert nichts

        res = client.post("/api/import/csv", json={"csv": ING}).json()
        assert res["imported"] == 6
        tx = client.get("/api/transactions", params={"month": "2026-03"}).json()
        assert sum(1 for t in tx if t["counterparty"] == "Bäckerei Krume") == 2

        again = client.post("/api/import/csv", json={"csv": ING}).json()
        assert again["imported"] == 0 and again["duplicates"] == 6

        st = client.get("/api/import/csv").json()
        assert st == {"count": 6, "from": "2026-01-02", "to": "2026-07-02"}
        assert client.delete("/api/import/csv").json()["removed"] == 6
        assert client.get("/api/import/csv").json()["count"] == 0

        bad = client.post("/api/import/csv/preview", json={"csv": "x;y\n"})
        assert bad.status_code == 400
