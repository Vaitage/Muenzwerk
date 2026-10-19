"""Updates aus der App: App schreibt nur eine Anfrage, liest den Status des Dienstes."""

import json
import time

from fastapi.testclient import TestClient

from tests.test_api import make_client


def test_ohne_schalter_gibt_es_keine_updates(tmp_path, monkeypatch):
    monkeypatch.delenv("UPDATES_IN_APP", raising=False)
    with make_client(tmp_path, monkeypatch) as client:
        assert client.get("/api/updates").status_code == 404
        assert client.post("/api/updates", json={"aktion": "aktualisieren"}).status_code == 404
    assert not (tmp_path / "update").exists()


def test_anfrage_und_status(tmp_path, monkeypatch):
    monkeypatch.setenv("UPDATES_IN_APP", "1")
    with make_client(tmp_path, monkeypatch) as client:
        r = client.get("/api/updates").json()
        assert r == {"status": None, "anfrage": None, "dienst_aktiv": None}

        # Dienst hat einen Status geschrieben
        (tmp_path / "update").mkdir()
        status = {"lebenszeichen": int(time.time()), "installiert": {"commit": "abc1234", "titel": "x", "datum": ""},
                  "verfuegbar": None, "laeuft": False, "auto": True}
        (tmp_path / "update" / "status.json").write_text(json.dumps(status))
        r = client.get("/api/updates").json()
        assert r["status"]["installiert"]["commit"] == "abc1234" and r["dienst_aktiv"] is True

        r = client.post("/api/updates", json={"aktion": "aktualisieren"}).json()
        assert r["anfrage"] == "aktualisieren"
        assert (tmp_path / "update" / "anfrage").read_text().strip() == "aktualisieren"

        # Nur bekannte Wörter, nichts anderes landet in der Datei
        assert client.post("/api/updates", json={"aktion": "rm -rf /"}).status_code == 422
        assert client.post("/api/updates", json={"aktion": "auto_an"}).status_code == 422
        assert (tmp_path / "update" / "anfrage").read_text().strip() == "aktualisieren"

        # Alter Status: Dienst meldet sich nicht mehr
        status["lebenszeichen"] = int(time.time()) - 3600
        (tmp_path / "update" / "status.json").write_text(json.dumps(status))
        assert client.get("/api/updates").json()["dienst_aktiv"] is False


def test_anfrage_braucht_csrf_header(tmp_path, monkeypatch):
    monkeypatch.setenv("UPDATES_IN_APP", "1")
    with make_client(tmp_path, monkeypatch):
        from app import main
        bare = TestClient(main.app)
        assert bare.post("/api/updates", json={"aktion": "pruefen"}).status_code == 403
