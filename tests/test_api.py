from datetime import date

from fastapi.testclient import TestClient


def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("HAUSHALTSBUCH_DB", str(tmp_path / "test.db"))
    monkeypatch.setenv("SYNC_INTERVAL_HOURS", "0")
    monkeypatch.setenv("BANK_PROVIDER", "demo")
    monkeypatch.setenv("HAUSHALTSBUCH_AUTH", "0")
    monkeypatch.setenv("ALLOWED_HOSTS", "testserver,localhost")
    import importlib

    from app import db, main
    importlib.reload(db)
    importlib.reload(main)
    return TestClient(main.app, headers={"X-Haushaltsbuch": "1"})


def test_demo_flow(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        assert client.get("/api/bank/status").json()["state"] == "none"

        url = client.post("/api/bank/connect").json()["url"]
        resp = client.get(url.replace("http://testserver", ""), follow_redirects=False)
        assert resp.status_code == 307

        status = client.get("/api/bank/status").json()
        assert status["state"] == "active" and status["days_left"] == 90

        month = date.today().strftime("%Y-%m")
        in_month = client.get("/api/transactions", params={"month": month}).json()
        assert any(t["amount_cents"] < 0 for t in in_month)

        open_items = client.get("/api/transactions", params={"uncategorized": "true"}).json()
        first = open_items[0]
        cats = client.get("/api/categories").json()
        target = next(c for c in cats if c["name"] == "Allgemein")
        res = client.patch(f"/api/transactions/{first['id']}",
                           json={"set_category": True, "category_id": target["id"], "remember": True}).json()
        assert res["category"] == "Allgemein"
        after = client.get("/api/transactions", params={"uncategorized": "true"}).json()
        assert len(after) == len(open_items) - 1 - res["also_assigned"]

        # Erneuter Abruf legt nichts doppelt an
        assert client.post("/api/bank/sync").json()["new"] == 0

        # Die App wird ausgeliefert
        assert "Münzwerk" in client.get("/").text


def test_bad_callback_state_rejected(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        client.post("/api/bank/connect")
        assert client.get("/api/bank/callback", params={"code": "x", "state": "falsch"}).status_code == 400


def test_overrides_settings_and_savings(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        client.put("/api/recurring-overrides", json={"pattern": "Max  Mustermann", "is_fixed": True})
        assert client.get("/api/recurring-overrides").json() == [{"pattern": "max mustermann", "is_fixed": True}]
        client.delete("/api/recurring-overrides", params={"pattern": "max mustermann"})
        assert client.get("/api/recurring-overrides").json() == []

        s = client.patch("/api/settings", json={"large_expense_cents": 50000}).json()
        assert s["large_expense_cents"] == 50000

        cats = client.get("/api/categories").json()
        assert next(c for c in cats if c["name"] == "Sparen")["is_savings"] is True


def test_accounts_and_bank_balances(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        url = client.post("/api/bank/connect").json()["url"]
        client.get(url.replace("http://testserver", ""), follow_redirects=False)
        accs = client.get("/api/accounts").json()
        by_name = {a["name"]: a for a in accs}
        assert by_name["Girokonto"]["type"] == "giro" and by_name["Girokonto"]["bank"]
        assert by_name["Extra-Konto Rücklage"]["values"][0]["value_cents"] == 185000

        # Kredit von Hand: Raten werden über die IBAN erkannt und als "Kredit" einsortiert
        res = client.post("/api/accounts", json={
            "name": "Ratenkredit", "type": "loan", "match": "DE00 1111 2222 3333 4444 09",
            "loan_rate_percent": 5.49, "loan_payment_cents": 32000, "value_cents": -1500000,
        }).json()
        assert res["match"] == "de00111122223333444409"
        assert res["loan_rate_percent"] == 5.49
        txs = client.get("/api/transactions").json()
        rates = [t for t in txs if "Ratenkredit" in t["purpose"]]
        assert rates and all(t["category"] == "Kredit" for t in rates)

        acc_id = res["id"]
        client.post(f"/api/accounts/{acc_id}/values", json={"value_cents": 1490000, "date": "2026-10-01"})
        vals = next(a for a in client.get("/api/accounts").json() if a["id"] == acc_id)["values"]
        assert len(vals) == 2
        client.delete(f"/api/accounts/{acc_id}")
        assert all(a["id"] != acc_id for a in client.get("/api/accounts").json())


def test_protection_layers(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        # ändernde Anfrage ohne eigenen Header wird abgelehnt (Schutz vor fremden Webseiten)
        assert client.post("/api/bank/sync", headers={"X-Haushaltsbuch": ""}).status_code == 403
        # fremder Hostname wird abgelehnt (Schutz vor DNS-Rebinding)
        assert client.get("/api/transactions", headers={"Host": "evil.example"}).status_code == 400
        # Sicherheits-Header und kein Caching der Finanzdaten
        r = client.get("/api/transactions")
        assert r.headers["cache-control"] == "no-store"
        assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
        # keine offene API-Dokumentation
        assert client.get("/docs").status_code == 404


def test_demo_pending_card_payments(tmp_path, monkeypatch):
    from datetime import date, timedelta

    from app.bank import demo
    with make_client(tmp_path, monkeypatch) as client:
        url = client.post("/api/bank/connect").json()["url"]
        client.get(url.replace("http://testserver", ""), follow_redirects=False)
        txs = client.get("/api/transactions").json()
        recent = (date.today() - timedelta(days=demo.PENDING_DEMO_DAYS - 1)).isoformat()
        for t in txs:
            if t["pending"]:
                assert t["booking_date"] >= recent and "Kartenzahlung" in t["purpose"]
        r = client.post("/api/bank/sync").json()
        assert r["ok"] and r["new"] == 0 and r["new_pending"] == 0


def test_ohne_bank_kein_demo(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        monkeypatch.setenv("BANK_PROVIDER", "none")
        resp = client.post("/api/bank/connect")
        assert resp.status_code == 409
        assert "nicht eingerichtet" in resp.json()["detail"]
        assert client.post("/api/bank/sync").json()["reason"] == "not_connected"
        assert client.get("/api/transactions").json() == []


def test_bank_nicht_eingerichtet_wird_gemeldet(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        monkeypatch.setenv("BANK_PROVIDER", "none")
        assert client.get("/api/bank/status").json()["setup"] == "no_provider"

        # Enable Banking gewählt, aber App-ID und Schlüssel fehlen: Hinweis statt Serverfehler
        monkeypatch.setenv("BANK_PROVIDER", "enablebanking")
        monkeypatch.delenv("ENABLEBANKING_APP_ID", raising=False)
        assert client.get("/api/bank/status").json()["setup"] == "missing_app_id"
        resp = client.post("/api/bank/connect")
        assert resp.status_code == 409 and "ENABLEBANKING_APP_ID" in resp.json()["detail"]
        assert client.post("/api/bank/sync").json() == {"ok": False, "reason": "not_connected"}

        monkeypatch.setenv("ENABLEBANKING_APP_ID", "erfunden-123")
        monkeypatch.setenv("ENABLEBANKING_KEY_FILE", str(tmp_path / "fehlt.pem"))
        assert client.get("/api/bank/status").json()["setup"] == "missing_key"

        (tmp_path / "da.pem").write_text("kein echter Schlüssel")
        monkeypatch.setenv("ENABLEBANKING_KEY_FILE", str(tmp_path / "da.pem"))
        assert client.get("/api/bank/status").json()["setup"] is None

        monkeypatch.setenv("BANK_PROVIDER", "demo")
        assert client.get("/api/bank/status").json()["setup"] is None


def test_eingaben_werden_geprueft(tmp_path, monkeypatch):
    """Unsinnige Eingaben enden in 422 statt in einem Serverfehler oder Datenmüll."""
    with make_client(tmp_path, monkeypatch) as client:
        # Icons sind nur Namen aus web/icons.js
        assert client.post("/api/categories", json={"name": "X", "kind": "expense", "icon": "<svg onload=x>"}).status_code == 422
        assert client.post("/api/categories", json={"name": "X", "kind": "expense", "icon": "a" * 500}).status_code == 422
        assert client.post("/api/categories", json={"name": "X", "kind": "expense", "icon": "coins"}).status_code == 201
        # Konten: Datum im Format JJJJ-MM-TT, Beträge in vernünftigen Grenzen
        base = {"name": "Spar", "type": "savings"}
        assert client.post("/api/accounts", json={**base, "value_cents": 100, "value_date": "gestern"}).status_code == 422
        assert client.post("/api/accounts", json={**base, "value_cents": 10**20}).status_code == 422
        assert client.post("/api/accounts", json={**base, "icon": "x y"}).status_code == 422
        acc = client.post("/api/accounts", json={**base, "value_cents": 100, "value_date": "2026-10-01"})
        assert acc.status_code == 201
        acc_id = acc.json()["id"]
        assert client.post(f"/api/accounts/{acc_id}/values", json={"value_cents": 10**19}).status_code == 422
        # Monatsangaben
        assert client.get("/api/transactions", params={"month": "Oktober"}).status_code == 422
        assert client.get("/api/transactions", params={"month": "2026-1"}).status_code == 422
        assert client.get("/api/transactions", params={"month": "2026-10"}).status_code == 200


def test_version_gleich_in_server_und_app(tmp_path, monkeypatch):
    import re
    from pathlib import Path

    from app import __version__
    app_js = (Path(__file__).resolve().parent.parent / "web" / "app.js").read_text(encoding="utf-8")
    assert re.search(r'const APP_VERSION = "([^"]+)"', app_js).group(1) == __version__
    with make_client(tmp_path, monkeypatch) as client:
        assert client.get("/api/version").json() == {"version": __version__}
        # App-Dateien: nachfragen statt alte Fassung behalten; Finanzdaten nie speichern
        assert client.get("/app.js").headers["cache-control"] == "no-cache"
        assert client.get("/api/version").headers["cache-control"] == "no-store"


def test_zeitzone_wird_geprueft(monkeypatch):
    from app import main
    monkeypatch.delenv("TZ", raising=False)
    assert main.timezone_problem() is None
    monkeypatch.setenv("TZ", "UTC")
    assert main.timezone_problem() is None
    monkeypatch.setenv("TZ", "Gibt/Es_Nicht")
    assert "Zeitzonendaten fehlen" in main.timezone_problem()


def test_doppelte_kategorie_meldet_409(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        new = {"name": "Sport", "kind": "expense", "icon": "tag"}
        assert client.post("/api/categories", json=new).status_code == 201
        resp = client.post("/api/categories", json=new)
        assert resp.status_code == 409 and "gibt es schon" in resp.json()["detail"]
