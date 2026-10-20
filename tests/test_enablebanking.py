from app.bank.enablebanking import EnableBankingProvider, clean_purpose

normalize = EnableBankingProvider._normalize


def eb_tx(**extra):
    tx = {
        "transaction_amount": {"amount": "39.95", "currency": "EUR"},
        "credit_debit_indicator": "DBIT",
        "creditor": {"name": "Beispiel-Markt"},
        "remittance_information": ["Einkauf", "Filiale 12"],
        "booking_date": "2026-10-15",
        "status": "BOOK",
    }
    tx.update(extra)
    return tx


def test_bank_id_wird_uebernommen():
    item = normalize(eb_tx(entry_reference="ABC123"))
    assert item["id"] == "eb-ABC123"
    assert item["amount_cents"] == -3995
    assert item["counterparty"] == "Beispiel-Markt"
    assert item["purpose"] == "Einkauf Filiale 12"


def test_ohne_bank_id_stabile_ersatz_id():
    a = normalize(eb_tx())
    b = normalize(eb_tx())
    assert a is not None
    assert a["id"].startswith("eb-h")
    assert a["id"] == b["id"]


def test_ersatz_id_unterscheidet_umsaetze():
    a = normalize(eb_tx())
    b = normalize(eb_tx(transaction_amount={"amount": "12.00", "currency": "EUR"}))
    assert a["id"] != b["id"]


def test_ing_technikfelder_werden_abgeschnitten():
    roh = "mandatereference:M-123,creditorid:DE98ZZZ09999999999,remittanceinformation:Ihr Einkauf bei Beispiel,  Nr. 7"
    item = normalize(eb_tx(entry_reference="X1", remittance_information=[roh]))
    assert item["purpose"] == "Ihr Einkauf bei Beispiel, Nr. 7"
    leer = "mandatereference:,creditorid:,remittanceinformation:Verdienstabrechnung 09.2026"
    assert clean_purpose(leer) == "Verdienstabrechnung 09.2026"
    assert clean_purpose("Normaler Zweck") == "Normaler Zweck"


def test_alte_umsaetze_werden_beim_start_bereinigt():
    from app import db

    c = db.connect(":memory:")
    db.init(c)
    c.execute(
        "INSERT INTO transactions (id, booking_date, amount_cents, counterparty, purpose, budget_month) "
        "VALUES ('t1', '2026-10-01', -100, 'X', 'mandatereference:,creditorid:,remittanceinformation:Miete', '2026-10')"
    )
    db.init(c)
    assert c.execute("SELECT purpose FROM transactions WHERE id='t1'").fetchone()[0] == "Miete"


def test_vorgemerkt_wird_markiert_storniert_und_ohne_datum_uebersprungen():
    item = normalize(eb_tx(status="PDNG"))
    assert item["pending"] is True and item["id"].startswith("eb-p-")
    assert normalize(eb_tx(status="BOOK"))["pending"] is False
    assert normalize(eb_tx(status="CNCL")) is None
    assert normalize(eb_tx(booking_date=None)) is None


def test_pending_status_is_kept_and_marked():
    from app.bank.enablebanking import EnableBankingProvider
    tx = {"status": "PDNG", "transaction_amount": {"amount": "12.50", "currency": "EUR"},
          "credit_debit_indicator": "DBIT", "creditor": {"name": "REWE"},
          "transaction_date": "2026-10-18", "remittance_information": ["Kartenzahlung"]}
    item = EnableBankingProvider._normalize(tx)
    assert item["pending"] is True and item["amount_cents"] == -1250
    assert item["booking_date"] == "2026-10-18" and item["id"].startswith("eb-p-")
    assert EnableBankingProvider._normalize({**tx, "status": "CNCL"}) is None


def test_vormerkung_am_kauftag_lastschrift_am_faelligkeitstag():
    from datetime import date

    from app.bank.enablebanking import pending_day

    heute = date(2026, 10, 18)
    karte = {"booking_date": "2026-10-27", "value_date": "2026-10-16", "transaction_date": "2026-10-27"}
    assert pending_day(karte, "13:09Kaufumsatz VISA CardEUR 22,00", heute) == "2026-10-16"
    # Kauf am Wochenende: Valuta erst Montag, steht trotzdem heute
    wochenende = {"booking_date": "2026-10-28", "value_date": "2026-10-19", "transaction_date": "2026-10-28"}
    assert pending_day(wochenende, "Kaufumsatz girocard", heute) == "2026-10-18"
    lastschrift = {"booking_date": "2026-10-19", "value_date": "2026-10-19", "transaction_date": "2026-10-19"}
    assert pending_day(lastschrift, "Tibber Rechnung 123", heute) == "2026-10-19"


# --- Abruf: Vormerkungen, Nutzer-Kopfzeilen, Fehlertexte -------------------
from datetime import date

import httpx
import pytest

from app.bank import ConsentExpired


def provider_with(responses):
    """Provider, dessen Anfragen aus einer Funktion params -> Antwort kommen."""
    p = EnableBankingProvider.__new__(EnableBankingProvider)
    calls = []

    def fake_request(method, path, params=None, **kw):
        calls.append(dict(params or {}))
        return responses(params or {})
    p._request = fake_request
    return p, calls


def http_error(status, text="x"):
    return httpx.HTTPStatusError(text, request=httpx.Request("GET", "x"), response=httpx.Response(status))


def test_automatischer_abruf_nur_eine_anfrage():
    p, calls = provider_with(lambda params: {"transactions": [eb_tx(entry_reference="B1")]})
    items = p.fetch_transactions("s", ["konto"], date(2026, 10, 1))
    assert [i["id"] for i in items] == ["eb-B1"]
    assert calls == [{"date_from": "2026-10-01"}]      # kein Enddatum, keine Zusatzabfrage
    assert p.last_info["pending_query"] == "nur bei „Jetzt abrufen“"


def test_jetzt_abrufen_fragt_vormerkungen_nach():
    def responses(params):
        if params.get("transaction_status") == "PDNG":
            return {"transactions": [eb_tx(entry_reference="P1", status="PDNG")]}
        return {"transactions": [eb_tx(entry_reference="B1")]}
    p, calls = provider_with(responses)
    p.ask_pending = True
    items = p.fetch_transactions("s", ["konto"], date(2026, 10, 1))
    assert {i["id"] for i in items} == {"eb-B1", "eb-p-P1"}
    assert len(calls) == 2
    assert p.last_info["pending_query"] == "1 geliefert"
    assert p.last_info["counts"] == {"BOOK": 1, "PDNG (nachgefragt)": 1}


def test_vorgemerkte_schon_dabei_keine_zweite_anfrage():
    txs = [eb_tx(entry_reference="B1"), eb_tx(entry_reference="P1", status="PDNG")]
    p, calls = provider_with(lambda params: {"transactions": txs})
    p.ask_pending = True
    assert len(p.fetch_transactions("s", ["konto"], date(2026, 10, 1))) == 2
    assert len(calls) == 1


def test_nachfrage_fehlgeschlagen_gebuchtes_bleibt():
    def responses(params):
        if params.get("transaction_status"):
            raise http_error(400, "400 transactions: WRONG_TRANSACTIONS_PERIOD")
        return {"transactions": [eb_tx(entry_reference="B1")]}
    p, _ = provider_with(responses)
    p.ask_pending = True
    assert [i["id"] for i in p.fetch_transactions("s", ["konto"], date(2026, 10, 1))] == ["eb-B1"]
    assert "WRONG_TRANSACTIONS_PERIOD" in p.last_info["pending_query"]


def test_abgelaufene_freigabe_bei_nachfrage_wird_gemeldet():
    def responses(params):
        if params.get("transaction_status"):
            raise ConsentExpired("expired")
        return {"transactions": []}
    p, _ = provider_with(responses)
    p.ask_pending = True
    with pytest.raises(ConsentExpired):
        p.fetch_transactions("s", ["konto"], date(2026, 10, 1))


def test_seiten_behalten_den_filter():
    pages = {None: {"transactions": [], "continuation_key": "k2"},
             "k2": {"transactions": [eb_tx(entry_reference="P1", status="PDNG")]}}

    def responses(params):
        if not params.get("transaction_status"):
            return {"transactions": [eb_tx(entry_reference="B1")]}
        return pages[params.get("continuation_key")]
    p, calls = provider_with(responses)
    p.ask_pending = True
    items = p.fetch_transactions("s", ["konto"], date(2026, 10, 1))
    assert "eb-p-P1" in {i["id"] for i in items}
    assert calls[-1] == {"date_from": "2026-10-01", "transaction_status": "PDNG", "continuation_key": "k2"}


def test_fehlertext_enthaelt_grund_der_bank(monkeypatch):
    p = EnableBankingProvider.__new__(EnableBankingProvider)
    p._token = lambda: "t"
    p.psu_headers = {"Psu-Ip-Address": "100.64.0.7", "Psu-User-Agent": "iPhone"}
    seen = {}

    def handler(request):
        seen.update(request.headers)
        return httpx.Response(429, json={"error": "ASPSP_RATE_LIMIT_EXCEEDED"})
    real = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(httpx.HTTPStatusError) as exc:
        p._request("GET", "/accounts/abc/transactions", params={"date_from": "2026-10-13"})
    assert "ASPSP_RATE_LIMIT_EXCEEDED" in str(exc.value) and str(exc.value).startswith("429 transactions")
    assert seen["psu-ip-address"] == "100.64.0.7" and seen["psu-user-agent"] == "iPhone"


# --- sync.run: Kopfzeilen weiterreichen, bei Ablehnung einmal ohne ----------
def test_sync_nutzer_kopfzeilen_und_rueckfall(tmp_path, monkeypatch):
    from app import db, sync
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    p, calls = provider_with(lambda params: {"transactions": [eb_tx(entry_reference="B1")]})
    used = []
    real_fetch = p.fetch_transactions

    def fetch(*a):
        used.append(p.psu_headers)
        if p.psu_headers:
            raise http_error(422, "422 transactions: PSU_HEADER_NOT_PROVIDED")
        return real_fetch(*a)
    p.fetch_transactions = fetch
    p.fetch_balances = lambda *a: []
    with db.session() as conn:
        db.init(conn)
        sync.save_connection(conn, "enablebanking", "s", ["konto"], "2027-04-15")
        r = sync.run(conn, p, psu={"Psu-Ip-Address": "1.2.3.4", "Psu-User-Agent": "x"}, manual=False)
    assert r["ok"] and r["new"] == 1
    assert used == [{"Psu-Ip-Address": "1.2.3.4", "Psu-User-Agent": "x"}, None]


def test_sync_rueckfall_auch_bei_400_ohne_psu_im_text(tmp_path, monkeypatch):
    from app import db, sync
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    p, _ = provider_with(lambda params: {"transactions": [eb_tx(entry_reference="B1")]})
    used = []
    real_fetch = p.fetch_transactions

    def fetch(*a):
        used.append(bool(p.psu_headers))
        if p.psu_headers:
            raise http_error(400, "400 transactions: Invalid IP address")
        return real_fetch(*a)
    p.fetch_transactions = fetch
    p.fetch_balances = lambda *a: []
    with db.session() as conn:
        db.init(conn)
        sync.save_connection(conn, "enablebanking", "s", ["konto"], "2027-04-15")
        r = sync.run(conn, p, psu={"Psu-Ip-Address": "100.64.0.7", "Psu-User-Agent": "x"})
    assert r["ok"] and used == [True, False]


def test_sync_limit_429_kein_zweiter_versuch(tmp_path, monkeypatch):
    from app import db, sync
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    p, _ = provider_with(lambda params: {"transactions": []})
    used = []

    def fetch(*a):
        used.append(1)
        raise http_error(429, "429 transactions: ASPSP_RATE_LIMIT_EXCEEDED")
    p.fetch_transactions = fetch
    with db.session() as conn:
        db.init(conn)
        sync.save_connection(conn, "enablebanking", "s", ["konto"], "2027-04-15")
        r = sync.run(conn, p, psu={"Psu-Ip-Address": "100.64.0.7", "Psu-User-Agent": "x"})
        err = sync.status(conn)["last_error"]
    assert not r["ok"] and len(used) == 1 and "ASPSP_RATE_LIMIT_EXCEEDED" in err
