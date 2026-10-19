"""iPhone-Widget: eigener, nur lesender Schlüssel und ein Schnappschuss der Zahlen."""

from tests.test_api import make_client
from tests.test_auth import make_client as make_auth_client

SNAP = {
    "month": "2026-10", "budget_left_cents": 82061, "forecast_end_cents": 59013, "days_left": 13,
    "pending_cents": 3871,
    "days": [{"date": "2026-10-19", "daily_cents": 6312}, {"date": "2026-10-20", "daily_cents": 6700}],
    "next_fixed": [{"name": "Fitnessstudio", "amount_cents": 3300, "day": 21}],
}


def test_schluessel_und_daten(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        assert client.get("/api/widget/key").json()["active"] is False
        # Ohne Schlüssel wird nichts gespeichert und nichts herausgegeben
        assert client.put("/api/widget/snapshot", json=SNAP).json() == {"stored": False}
        assert client.get("/api/widget/data").status_code == 401

        key = client.post("/api/widget/key").json()["key"]
        assert key.startswith("mw_") and len(key) > 40
        assert client.put("/api/widget/snapshot", json=SNAP).json() == {"stored": True}

        ok = client.get("/api/widget/data", headers={"Authorization": f"Bearer {key}"})
        assert ok.status_code == 200
        body = ok.json()
        assert body["snapshot"]["budget_left_cents"] == 82061 and body["snapshot"]["computed_at"]
        assert set(body) == {"snapshot", "bank"}            # keine Umsätze, keine Konten
        assert set(body["bank"]) == {"state", "days_left", "last_sync"}

        assert client.get("/api/widget/data", headers={"Authorization": "Bearer falsch"}).status_code == 401
        assert client.get("/api/widget/data", headers={"Authorization": key}).status_code == 401

        # Neuer Schlüssel: der alte gilt sofort nicht mehr
        key2 = client.post("/api/widget/key").json()["key"]
        assert client.get("/api/widget/data", headers={"Authorization": f"Bearer {key}"}).status_code == 401
        assert client.get("/api/widget/data", headers={"Authorization": f"Bearer {key2}"}).status_code == 200

        # Sperren
        assert client.delete("/api/widget/key").status_code == 204
        assert client.get("/api/widget/data", headers={"Authorization": f"Bearer {key2}"}).status_code == 401


def test_schnappschuss_wird_geprueft(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        client.post("/api/widget/key")
        assert client.put("/api/widget/snapshot", json={**SNAP, "month": "Oktober"}).status_code == 422
        assert client.put("/api/widget/snapshot", json={**SNAP, "days": SNAP["days"] * 2}).status_code == 422
        too_long = {**SNAP, "next_fixed": [{"name": "x" * 200, "amount_cents": 1, "day": 1}]}
        assert client.put("/api/widget/snapshot", json=too_long).status_code == 422


def test_mit_anmeldung_ist_nur_der_datenpfad_offen(tmp_path, monkeypatch):
    with make_auth_client(tmp_path, monkeypatch) as client:
        # Schlüssel verwalten und Zahlen senden nur angemeldet
        assert client.get("/api/widget/key").status_code == 401
        assert client.post("/api/widget/key", headers={"X-Haushaltsbuch": "1"}).status_code == 401
        assert client.put("/api/widget/snapshot", json=SNAP, headers={"X-Haushaltsbuch": "1"}).status_code == 401
        # Der Datenpfad prüft den Widget-Schlüssel selbst (ohne Schlüssel: 401 von dort)
        r = client.get("/api/widget/data")
        assert r.status_code == 401 and "Widget" in r.json()["detail"]
        # Nichts anderes ist darüber zu erreichen
        assert client.get("/api/widget/datax").status_code == 401
        assert client.get("/api/transactions", headers={"Authorization": "Bearer egal"}).status_code == 401
