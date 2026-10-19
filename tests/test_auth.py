"""Anmeldung per Passkey. Statt eines iPhones spielt ein kleiner
Software-Authenticator die Gegenseite (ES256, Attestation "none")."""

import base64
import hashlib
import json
import os
import sqlite3
import struct

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

ORIGIN = "http://testserver"
RP_ID = "testserver"


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class FakePasskey:
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(16)
        self.count = 0

    def _client_data(self, kind, challenge):
        return json.dumps({"type": kind, "challenge": challenge, "origin": ORIGIN}).encode()

    def register(self, options):
        nums = self.key.public_key().public_numbers()
        cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")})
        auth_data = (hashlib.sha256(RP_ID.encode()).digest() + bytes([0x45]) + struct.pack(">I", 0)
                     + bytes(16) + struct.pack(">H", len(self.cred_id)) + self.cred_id + cose)
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key", "response": {
            "clientDataJSON": b64(self._client_data("webauthn.create", options["challenge"])),
            "attestationObject": b64(att)}}

    def login(self, options):
        self.count += 1
        client_data = self._client_data("webauthn.get", options["challenge"])
        auth_data = hashlib.sha256(RP_ID.encode()).digest() + bytes([0x05]) + struct.pack(">I", self.count)
        sig = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key", "response": {
            "clientDataJSON": b64(client_data), "authenticatorData": b64(auth_data),
            "signature": b64(sig), "userHandle": b64(b"haushaltsbuch-nutzer")}}


def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("HAUSHALTSBUCH_DB", str(tmp_path / "test.db"))
    monkeypatch.setenv("SYNC_INTERVAL_HOURS", "0")
    monkeypatch.setenv("BANK_PROVIDER", "demo")
    monkeypatch.setenv("ALLOWED_HOSTS", "testserver,localhost")
    monkeypatch.delenv("HAUSHALTSBUCH_AUTH", raising=False)
    monkeypatch.delenv("PUBLIC_URL", raising=False)
    import importlib

    from app import db, main
    importlib.reload(db)
    importlib.reload(main)
    return TestClient(main.app, headers={"X-Haushaltsbuch": "1"})


def current_code() -> str:
    """Einrichtungscode, wie ihn der Nutzer im Log des Containers findet."""
    from app import auth, db
    with db.session() as conn:
        db.init(conn)
        return auth.setup_code(conn)


def register(client, pk, code=None):
    """Legt einen Passkey an. Für den ersten Passkey gehört der Einrichtungscode dazu."""
    code = current_code() if code is None else code
    options = client.post("/api/auth/register/options", json={"setup_code": code}).json()
    return client.post("/api/auth/register/verify",
                       json={"credential": pk.register(options), "name": "iPhone", "setup_code": code})


def login(client, pk):
    options = client.post("/api/auth/login/options").json()
    return client.post("/api/auth/login/verify", json={"credential": pk.login(options)})


def test_ohne_anmeldung_keine_daten(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        assert client.get("/api/categories").status_code == 401
        assert client.get("/api/transactions").status_code == 401
        st = client.get("/api/auth/status").json()
        assert st == {"required": True, "logged_in": False, "has_passkey": False, "idle_minutes": 15}
        # Die App-Oberfläche selbst (ohne Daten) lädt
        assert client.get("/").status_code == 200


def test_einrichten_anmelden_abmelden(tmp_path, monkeypatch):
    pk = FakePasskey()
    with make_client(tmp_path, monkeypatch) as client:
        assert register(client, pk).status_code == 200
        # Nach dem ersten Passkey ist man gleich angemeldet
        assert client.get("/api/categories").status_code == 200

        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/categories").status_code == 401

        assert login(client, pk).status_code == 200
        assert client.get("/api/categories").status_code == 200
        assert client.get("/api/auth/status").json()["logged_in"] is True


def test_fremdes_geraet_kann_keinen_zweiten_passkey_anlegen(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        assert register(client, FakePasskey()).status_code == 200
        client.cookies.clear()
        assert client.post("/api/auth/register/options").status_code == 403
        # Ein unbekannter Passkey kommt nicht rein
        assert login(client, FakePasskey()).status_code == 401
        assert client.get("/api/categories").status_code == 401


def test_falsche_signatur_wird_abgelehnt(tmp_path, monkeypatch):
    pk = FakePasskey()
    with make_client(tmp_path, monkeypatch) as client:
        register(client, pk)
        client.cookies.clear()
        options = client.post("/api/auth/login/options").json()
        cred = pk.login(options)
        cred["response"]["signature"] = b64(b"\x30\x06\x02\x01\x01\x02\x01\x01")
        assert client.post("/api/auth/login/verify", json={"credential": cred}).status_code == 401
        assert client.get("/api/categories").status_code == 401


def test_sitzung_endet_nach_leerlauf(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        register(client, FakePasskey())
        assert client.get("/api/categories").status_code == 200
        with sqlite3.connect(tmp_path / "test.db") as c:
            c.execute("UPDATE auth_sessions SET last_seen = '2000-01-01T00:00:00'")
        assert client.get("/api/categories").status_code == 401


def test_bank_rueckleitung_ohne_anmeldung_erreichbar(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        # Abgelehnt wegen falschem "state", nicht wegen fehlender Anmeldung
        assert client.get("/api/bank/callback", params={"code": "x", "state": "y"}).status_code == 400


def test_letzter_passkey_bleibt(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        register(client, FakePasskey())
        keys = client.get("/api/auth/passkeys").json()
        assert len(keys) == 1 and keys[0]["name"] == "iPhone"
        assert client.delete(f"/api/auth/passkeys/{keys[0]['id']}").status_code == 409
        # Zweiten Passkey (angemeldet) hinzufügen, dann darf einer weg
        assert register(client, FakePasskey()).status_code == 200
        assert client.delete(f"/api/auth/passkeys/{keys[0]['id']}").status_code == 204


def test_eigenes_cookie_je_installation(monkeypatch):
    from app import auth

    monkeypatch.setenv("PUBLIC_URL", "https://haushaltsbuch.beispiel.ts.net")
    assert auth.cookie_name() == "hb_sitzung"
    monkeypatch.setenv("PUBLIC_URL", "https://haushaltsbuch.beispiel.ts.net:8443")
    assert auth.cookie_name() == "hb_sitzung_8443"


# ---------------------------------------------------------------------------
# Härtung 18.10.2026
# ---------------------------------------------------------------------------

def test_erster_passkey_nur_mit_einrichtungscode(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        # Ohne oder mit falschem Code: kein Passkey, keine Challenge
        assert client.post("/api/auth/register/options").status_code == 403
        assert client.post("/api/auth/register/options", json={"setup_code": "AAAA-AAAA"}).status_code == 403
        # Auch direkt beim Prüfen wird der Code verlangt
        code = current_code()
        options = client.post("/api/auth/register/options", json={"setup_code": code}).json()
        res = client.post("/api/auth/register/verify",
                          json={"credential": FakePasskey().register(options), "setup_code": "falsch"})
        assert res.status_code == 403
        # Kleinschreibung und fehlender Bindestrich sind egal
        assert register(client, FakePasskey(), code=code.lower().replace("-", "")).status_code == 200
        assert client.get("/api/categories").status_code == 200
        # Danach ist der Code verbraucht
        with sqlite3.connect(tmp_path / "test.db") as c:
            assert c.execute("SELECT COUNT(*) FROM settings WHERE key = 'setup_code'").fetchone()[0] == 0


def test_einrichtungscode_bleibt_ueber_neustart_gleich(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch):
        first = current_code()
    with make_client(tmp_path, monkeypatch):
        assert current_code() == first
    assert len(first) == 9 and first[4] == "-"


def test_passkey_loeschen_beendet_andere_sitzungen(tmp_path, monkeypatch):
    pk_phone, pk_pad = FakePasskey(), FakePasskey()
    with make_client(tmp_path, monkeypatch) as phone:
        register(phone, pk_phone)
        register(phone, pk_pad)      # angemeldet: zweiter Passkey ohne Code
        with make_client(tmp_path, monkeypatch) as pad:
            assert login(pad, pk_pad).status_code == 200
            assert pad.get("/api/categories").status_code == 200
            # Das iPad geht verloren – auf dem iPhone wird sein Passkey gelöscht
            pad_id = b64(pk_pad.cred_id)
            assert phone.delete(f"/api/auth/passkeys/{pad_id}").status_code == 204
            assert pad.get("/api/categories").status_code == 401
            assert phone.get("/api/categories").status_code == 200


def test_andere_geraete_abmelden(tmp_path, monkeypatch):
    pk = FakePasskey()
    with make_client(tmp_path, monkeypatch) as phone:
        register(phone, pk)
        with make_client(tmp_path, monkeypatch) as other:
            assert login(other, pk).status_code == 200
            assert phone.post("/api/auth/logout-others").json() == {"ended": 1}
            assert other.get("/api/categories").status_code == 401
            assert phone.get("/api/categories").status_code == 200
            # Ohne Anmeldung geht das nicht
            assert other.post("/api/auth/logout-others").status_code == 401


def test_fremde_anfragen_stoeren_die_anmeldung_nicht(tmp_path, monkeypatch):
    pk = FakePasskey()
    with make_client(tmp_path, monkeypatch) as client:
        register(client, pk)
        client.post("/api/auth/logout")
        options = client.post("/api/auth/login/options").json()
        # Ein anderes Gerät im Tailnet fordert ständig neue Challenges an …
        with make_client(tmp_path, monkeypatch) as other:
            for _ in range(5):
                other.post("/api/auth/login/options")
            other.post("/api/auth/login/verify", json={"credential": {"id": "unbekannt"}})
        # … die eigene Anmeldung klappt trotzdem
        res = client.post("/api/auth/login/verify", json={"credential": pk.login(options)})
        assert res.status_code == 200


def test_challenge_nur_einmal_verwendbar(tmp_path, monkeypatch):
    pk = FakePasskey()
    with make_client(tmp_path, monkeypatch) as client:
        register(client, pk)
        client.post("/api/auth/logout")
        options = client.post("/api/auth/login/options").json()
        cid = client.cookies.get("hb_challenge")
        assert client.post("/api/auth/login/verify", json={"credential": pk.login(options)}).status_code == 200
        client.post("/api/auth/logout")
        client.cookies.set("hb_challenge", cid, path="/api/auth/")
        assert client.post("/api/auth/login/verify", json={"credential": pk.login(options)}).status_code == 400


def test_fehlerdetails_bleiben_im_log(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        code = current_code()
        client.post("/api/auth/register/options", json={"setup_code": code})
        res = client.post("/api/auth/register/verify", json={"credential": {"id": "kaputt"}, "setup_code": code})
        assert res.status_code == 400
        assert res.json()["detail"] == "Passkey konnte nicht geprüft werden"


def test_zuruecksetzen_erzeugt_neuen_code(tmp_path, monkeypatch):
    import subprocess
    import sys

    with make_client(tmp_path, monkeypatch) as client:
        old = current_code()
        register(client, FakePasskey(), code=old)
    env = {**os.environ, "HAUSHALTSBUCH_DB": str(tmp_path / "test.db")}
    out = subprocess.run([sys.executable, "-m", "app.auth", "zuruecksetzen"], env=env,
                         capture_output=True, text=True, check=True).stdout
    assert "Einrichtungscode:" in out and old not in out
    out = subprocess.run([sys.executable, "-m", "app.auth", "code"], env=env,
                         capture_output=True, text=True, check=True).stdout
    assert out.strip().split()[-1] == current_code()
