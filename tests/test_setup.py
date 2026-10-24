"""Einrichtungs-Assistent (app/setup.py): Enable Banking ohne .env und SSH einrichten."""
import os
import stat

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from tests.test_api import make_client

APP_ID = "11111111-2222-3333-4444-555555555555"


def pem(key) -> str:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode()


def fake_enablebanking(monkeypatch, redirect_urls=None, fail=None):
    """Ersetzt die Anfragen an Enable Banking (aus der Testumgebung nicht erreichbar)."""
    import httpx

    from app.bank.enablebanking import EnableBankingProvider
    calls = []

    def fake(self, method, path, **kw):
        calls.append((method, path, self.app_id, self.bank_name, self.country))
        if fail:
            req = httpx.Request(method, "https://api.enablebanking.com" + path)
            raise httpx.HTTPStatusError("401", request=req, response=httpx.Response(fail, request=req))
        if path == "/application":
            return {"name": "Mein Münzwerk", "environment": "PRODUCTION", "active": True,
                    "redirect_urls": redirect_urls or []}
        if path == "/aspsps":
            return {"aspsps": [{"name": "Sparkasse Musterstadt", "country": "DE"}, {"name": "ING", "country": "DE"}]}
        raise AssertionError(path)
    monkeypatch.setattr(EnableBankingProvider, "_request", fake)
    return calls


def test_einrichten_ohne_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "https://pi.beispiel.ts.net")
    with make_client(tmp_path, monkeypatch) as client:
        monkeypatch.setenv("BANK_PROVIDER", "none")
        monkeypatch.delenv("ENABLEBANKING_APP_ID", raising=False)
        st = client.get("/api/setup").json()
        assert st["problem"] == "no_provider"
        assert st["redirect_url"] == "https://pi.beispiel.ts.net/api/bank/callback"
        assert st["public_url_ok"] is True

        good = pem(rsa.generate_private_key(public_exponent=65537, key_size=2048))
        # Falsche Eingaben werden abgewiesen, ohne etwas zu speichern
        assert client.post("/api/setup/enablebanking", json={"app_id": "x" * 36, "key_pem": good}).status_code == 422
        assert client.post("/api/setup/enablebanking", json={"app_id": APP_ID, "key_pem": "-" * 200}).status_code == 422
        ec_key = pem(ec.generate_private_key(ec.SECP256R1()))
        assert client.post("/api/setup/enablebanking", json={"app_id": APP_ID, "key_pem": ec_key}).status_code == 422
        assert client.get("/api/setup").json()["problem"] == "no_provider"

        calls = fake_enablebanking(monkeypatch, redirect_urls=["https://pi.beispiel.ts.net/api/bank/callback"])
        r = client.post("/api/setup/enablebanking", json={"app_id": APP_ID.upper(), "key_pem": good}).json()
        assert r == {"ok": True, "name": "Mein Münzwerk", "environment": "PRODUCTION", "active": True,
                     "redirect_ok": True, "redirect_url": "https://pi.beispiel.ts.net/api/bank/callback"}
        # Schlüssel liegt im Datenordner, nur für den Besitzer lesbar
        key_file = tmp_path / "enablebanking.pem"
        assert key_file.read_text().startswith("-----BEGIN PRIVATE KEY-----")
        assert stat.S_IMODE(os.stat(key_file).st_mode) == 0o600
        st = client.get("/api/setup").json()
        assert st["problem"] is None and st["provider"] == "enablebanking" and st["app_id"] == APP_ID
        assert client.get("/api/bank/status").json()["setup"] is None

        # Bank wählen: Liste von Enable Banking, Auswahl gilt sofort
        banks = client.get("/api/setup/banks?country=DE").json()
        assert [b["name"] for b in banks] == ["ING", "Sparkasse Musterstadt"]
        assert client.put("/api/setup/bank", json={"bank": "Sparkasse Musterstadt", "country": "DE"}).status_code == 200
        assert client.put("/api/setup/bank", json={"bank": "<b>", "country": "DE"}).status_code == 422
        client.post("/api/setup/test")
        assert calls[-1][3] == "Sparkasse Musterstadt"


def test_redirect_falsch_und_schluessel_passt_nicht(tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "https://pi.beispiel.ts.net:8443")
    with make_client(tmp_path, monkeypatch) as client:
        good = pem(rsa.generate_private_key(public_exponent=65537, key_size=2048))
        fake_enablebanking(monkeypatch, redirect_urls=["https://pi.beispiel.ts.net/api/bank/callback"])
        r = client.post("/api/setup/enablebanking", json={"app_id": APP_ID, "key_pem": good}).json()
        assert r["ok"] is True and r["redirect_ok"] is False
        assert r["redirect_url"] == "https://pi.beispiel.ts.net:8443/api/bank/callback"
        fake_enablebanking(monkeypatch, fail=401)
        r = client.post("/api/setup/test").json()
        assert r["ok"] is False and "Schlüssel" in r["message"]


def test_env_gilt_weiter_und_assistent_hat_vorrang(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        key = tmp_path / "env.pem"
        key.write_text("egal")
        monkeypatch.setenv("BANK_PROVIDER", "enablebanking")
        monkeypatch.setenv("ENABLEBANKING_APP_ID", "env-app")
        monkeypatch.setenv("ENABLEBANKING_KEY_FILE", str(key))
        monkeypatch.setenv("ENABLEBANKING_BANK", "ING")
        from app import bank, db
        with db.session() as conn:
            cfg = bank.bank_config(conn)
            assert (cfg["app_id"], cfg["key_file"], cfg["bank"]) == ("env-app", str(key), "ING")
            conn.execute("INSERT INTO settings (key, value) VALUES ('eb_bank', 'DKB')")
            assert bank.bank_config(conn)["bank"] == "DKB"


def test_einrichtungslink_und_code_bleiben_gleich(tmp_path):
    """Der QR-Code der Installation (auth link) muss denselben Code tragen, den die App erwartet."""
    import subprocess
    import sys
    env = {**os.environ, "HAUSHALTSBUCH_DB": str(tmp_path / "t.db"), "PUBLIC_URL": "https://pi.beispiel.ts.net"}
    run = lambda *a: subprocess.run([sys.executable, "-m", "app.auth", *a], env=env, capture_output=True,  # noqa: E731
                                    text=True, check=True).stdout.strip()
    link = run("link")
    assert link.startswith("https://pi.beispiel.ts.net/?code=")
    assert run("code") == "Einrichtungscode: " + link.split("=")[1]
    assert run("link") == link
