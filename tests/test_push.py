"""Web Push: Verschlüsselung (RFC 8291), VAPID, Abos und die Mitteilung „Gehalt ist da“."""
import base64
from datetime import date, timedelta

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from app import push
from tests.test_api import make_client


def b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def test_verschluesselung_wie_rfc8291_anhang_a():
    # Beispiel aus RFC 8291, Anhang A (feste Schlüssel und Salt -> bekanntes Ergebnis)
    server = ec.derive_private_key(int.from_bytes(b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
    out = push.encrypt(
        b"When I grow up, I want to be a watermelon",
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        "BTBZMqHH6r4Tts7J_aSIgg",
        salt=b64("DGv6ra1nlYgDCS1FRnbzlw"),
        server_key=server,
    )
    expected = ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_"
                "yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
    assert push._b64(out) == expected


def test_nur_echte_mitteilungsdienste():
    assert push.allowed_endpoint("https://web.push.apple.com/QGdsk...")
    assert push.allowed_endpoint("https://fcm.googleapis.com/fcm/send/abc")
    assert push.allowed_endpoint("https://updates.push.services.mozilla.com/wpush/v2/x")
    assert not push.allowed_endpoint("http://web.push.apple.com/x")          # kein https
    assert not push.allowed_endpoint("https://evil-push.apple.com.example.org/x")
    assert not push.allowed_endpoint("https://192.168.1.1/x")
    assert not push.allowed_endpoint("https://localhost:8000/api")


def ua_keys():
    key = ec.generate_private_key(ec.SECP256R1())
    from cryptography.hazmat.primitives import serialization
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return push._b64(pub), push._b64(b"0123456789abcdef")


def test_abo_anmelden_und_status(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        st = client.get("/api/push").json()
        assert len(b64(st["public_key"])) == 65 and st["subscriptions"] == 0 and st["show_amount"] is True
        assert client.get("/api/push").json()["public_key"] == st["public_key"]      # bleibt gleich
        p256dh, auth = ua_keys()
        bad = client.post("/api/push/subscribe", json={"endpoint": "https://example.org/x", "keys": {"p256dh": p256dh, "auth": auth}})
        assert bad.status_code == 422
        broken = client.post("/api/push/subscribe", json={"endpoint": "https://web.push.apple.com/x", "keys": {"p256dh": "A" * 40, "auth": auth}})
        assert broken.status_code == 422
        ok = client.post("/api/push/subscribe", json={"endpoint": "https://web.push.apple.com/x", "keys": {"p256dh": p256dh, "auth": auth}})
        assert ok.status_code == 200
        assert client.get("/api/push").json()["subscriptions"] == 1
        assert client.patch("/api/push/settings", json={"show_amount": False}).json()["show_amount"] is False
        client.post("/api/push/unsubscribe", json={"endpoint": "https://web.push.apple.com/x"})
        assert client.get("/api/push").json()["subscriptions"] == 0


def _salary(conn, days_ago=0, amount=285000, cat_shift=True):
    cat = conn.execute("SELECT id FROM categories WHERE kind = 'income' AND shift_next_month = ? LIMIT 1",
                       (1 if cat_shift else 0,)).fetchone()["id"]
    tid = f"t-{days_ago}-{amount}-{cat_shift}"
    d = (date.today() - timedelta(days=days_ago)).isoformat()
    conn.execute("INSERT INTO transactions (id, booking_date, amount_cents, counterparty, category_id, budget_month) "
                 "VALUES (?, ?, ?, 'Muster GmbH', ?, ?)", (tid, d, amount, cat, d[:7]))
    return tid


def test_gehalt_ist_da(tmp_path, monkeypatch):
    monkeypatch.setenv("DEFAULT_LANGUAGE", "de")
    from app import db
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    with db.session() as conn:
        db.init(conn)
        new = _salary(conn)
        assert push.salary_message(conn, [new]) == ("Gehalt ist da", "+2.850,00 € von Muster GmbH. Tippen für deinen neuen Monat.")
        old = _salary(conn, days_ago=10, amount=285001)
        assert push.salary_message(conn, [old]) is None                    # alte Buchung, z. B. beim ersten Abruf
        other = _salary(conn, amount=5000, cat_shift=False)
        assert push.salary_message(conn, [other]) is None                  # keine Gehalts-Kategorie
        assert push.salary_message(conn, []) is None
        push._put(conn, "push_show_amount", "0")
        assert push.salary_message(conn, [new]) == ("Gehalt ist da", "Tippen für deinen neuen Monat.")


def test_senden_mit_vapid_und_abgelaufene_abos(tmp_path, monkeypatch):
    from app import db
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    sent = []

    class Resp:
        def __init__(self, code): self.status_code = code; self.is_success = 200 <= code < 300; self.text = ""

    def fake_post(url, content, timeout, headers):
        sent.append((url, headers, content))
        return Resp(410 if "gone" in url else 201)
    monkeypatch.setattr(push.httpx, "post", fake_post)
    with db.session() as conn:
        db.init(conn)
        p256dh, auth = ua_keys()
        for ep in ("https://web.push.apple.com/ok", "https://web.push.apple.com/gone"):
            conn.execute("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)", (ep, p256dh, auth))
        assert push.send(conn, "Gehalt ist da", "Test") == 1
        assert [r[0] for r in conn.execute("SELECT endpoint FROM push_subscriptions")] == ["https://web.push.apple.com/ok"]
        url, headers, body = sent[0]
        assert headers["Content-Encoding"] == "aes128gcm" and body[:16] != b"Gehalt ist da"[:16]
        token = headers["Authorization"].split("t=")[1].split(",")[0]
        claims = jwt.decode(token, push.vapid_key(conn).public_key(), algorithms=["ES256"], audience="https://web.push.apple.com")
        assert claims["sub"].startswith("mailto:")


def test_abruf_meldet_neues_gehalt(tmp_path, monkeypatch):
    from app import db, sync
    from app.bank.demo import DemoProvider
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    got = []
    monkeypatch.setattr(push, "send", lambda conn, title, body, url="/": got.append((title, body)) or 1)

    class Salary(DemoProvider):
        def fetch_transactions(self, *a):
            return [{"id": "eb-gehalt-1", "booking_date": date.today().isoformat(), "amount_cents": 285000,
                     "currency": "EUR", "counterparty": "Muster GmbH", "purpose": "LOHN/GEHALT 10/26",
                     "counterparty_iban": "", "pending": False}]
    with db.session() as conn:
        db.init(conn)
        conn.execute("INSERT INTO rules (pattern, category_id, source) SELECT 'muster gmbh', id, 'user' FROM categories "
                     "WHERE kind = 'income' AND shift_next_month = 1 LIMIT 1")
        sync.save_connection(conn, "demo", "s", ["a"], "2027-04-15")
        assert sync.run(conn, Salary())["new"] == 1
        assert sync.run(conn, Salary())["new"] == 0          # zweiter Abruf: schon bekannt, keine zweite Mitteilung
    assert len(got) == 1 and got[0][0] == "Gehalt ist da"


def test_absenderadresse_fuer_apple(monkeypatch):
    # Apple lehnt Platzhalter ab (403 BadJwtToken) – dann lieber die https-Adresse der Installation
    monkeypatch.delenv("PUSH_CONTACT", raising=False)
    monkeypatch.setenv("PUBLIC_URL", "https://pi.beispiel.ts.net/")
    assert push.contact() == "https://pi.beispiel.ts.net"
    monkeypatch.setenv("PUSH_CONTACT", "mailto:ich@beispiel.de")
    assert push.contact() == "mailto:ich@beispiel.de"
    for bad in ("mailto:x@example.com", "mailto: x@beispiel.de", "ich@beispiel.de", "https://localhost"):
        monkeypatch.setenv("PUSH_CONTACT", bad)
        assert push.contact() == "https://pi.beispiel.ts.net", bad
    monkeypatch.setenv("PUBLIC_URL", "http://192.168.1.5:8000")
    monkeypatch.delenv("PUSH_CONTACT")
    assert push.contact() == "mailto:muenzwerk@example.com"


def test_ablehnung_wird_gemerkt_und_gemeldet(tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "https://pi.beispiel.ts.net")

    class Resp:
        status_code, is_success, text = 403, False, '{"reason":"BadJwtToken"}'
        def json(self): return {"reason": "BadJwtToken"}
    monkeypatch.setattr(push.httpx, "post", lambda *a, **k: Resp())
    with make_client(tmp_path, monkeypatch) as client:
        h = {"X-Haushaltsbuch": "1"}
        assert client.post("/api/push/test", headers=h).status_code == 409      # nichts angemeldet
        p256dh, auth = ua_keys()
        client.post("/api/push/subscribe", headers=h,
                    json={"endpoint": "https://web.push.apple.com/abc", "keys": {"p256dh": p256dh, "auth": auth}})
        r = client.post("/api/push/test", headers=h)
        assert r.status_code == 502 and "403 BadJwtToken" in r.json()["detail"]
        st = client.get("/api/push").json()
        assert st["last_error"] == "403 BadJwtToken" and st["contact_ok"] is True
