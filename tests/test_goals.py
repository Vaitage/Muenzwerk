"""Sparziele: Schnittstelle (Rechnung siehe tests/analytics.test.mjs)."""
from tests.test_api import make_client


def test_sparziele_anlegen_aendern_archivieren(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        assert client.get("/api/goals").json() == []
        g = client.post("/api/goals", json={
            "name": " Urlaub ", "icon": "plane", "target_cents": 240000,
            "target_month": "2027-05", "start_month": "2026-08"}).json()
        assert g["name"] == "Urlaub" and g["target_month"] == "2027-05" and g["monthly_cents"] is None

        # ohne Datum braucht es eine feste Rate
        r = client.post("/api/goals", json={"name": "Puffer", "target_cents": 100000, "start_month": "2026-10"})
        assert r.status_code == 422
        p = client.post("/api/goals", json={"name": "Puffer", "target_cents": 100000, "start_month": "2026-10",
                                             "monthly_cents": 5000}).json()
        assert p["monthly_cents"] == 5000

        # Datum vor dem Start, falsches Format, Symbol mit Sonderzeichen
        assert client.post("/api/goals", json={"name": "x", "target_cents": 1, "start_month": "2026-10",
                                               "target_month": "2026-09"}).status_code == 422
        assert client.post("/api/goals", json={"name": "x", "target_cents": 1, "start_month": "2026-13",
                                               "monthly_cents": 1}).status_code == 422
        assert client.post("/api/goals", json={"name": "x", "icon": "<b>", "target_cents": 1,
                                               "start_month": "2026-10", "monthly_cents": 1}).status_code == 422

        # Datum entfernen geht nur mit Rate
        assert client.patch(f"/api/goals/{g['id']}", json={"clear_target_month": True}).status_code == 422
        g2 = client.patch(f"/api/goals/{g['id']}", json={"clear_target_month": True, "monthly_cents": 20000}).json()
        assert g2["target_month"] is None and g2["monthly_cents"] == 20000
        assert client.patch(f"/api/goals/{g['id']}", json={"archived": True}).json()["archived"] is True
        assert client.patch("/api/goals/999", json={"archived": True}).status_code == 404

        assert client.delete(f"/api/goals/{p['id']}").status_code == 204
        assert [x["id"] for x in client.get("/api/goals").json()] == [g["id"]]


def test_sparziele_brauchen_csrf_kopfzeile(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        r = client.post("/api/goals", json={"name": "x", "target_cents": 1, "start_month": "2026-10",
                                            "monthly_cents": 1}, headers={"X-Haushaltsbuch": ""})
        assert r.status_code == 403
