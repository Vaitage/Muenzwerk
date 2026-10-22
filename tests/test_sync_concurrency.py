"""Abruf und Datenbank: keine Sperre während der Bank-Anfrage, nie zwei Abrufe gleichzeitig."""
import threading
import time

from app import db, sync
from app.bank.demo import DemoProvider


def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "t.db"))
    with db.session() as conn:
        db.init(conn)
        sync.save_connection(conn, "demo", "s", ["a"], "2027-04-15", [{"uid": "a", "name": "Giro"}])


def test_kontostaende_abfragen_sperrt_die_datenbank_nicht(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch)
    started = threading.Event()

    class SlowBalances(DemoProvider):
        def fetch_balances(self, session_id, accounts):
            started.set()
            time.sleep(3)          # Bank antwortet langsam
            return []

    def background():
        with db.session() as conn:
            sync.run(conn, SlowBalances())

    t = threading.Thread(target=background)
    t.start()
    assert started.wait(10)
    t0 = time.monotonic()
    with db.session() as conn:     # z. B. eine Zuordnung in der App
        conn.execute("INSERT INTO settings (key, value) VALUES ('probe', '1')")
    waited = time.monotonic() - t0
    t.join()
    assert waited < 1, f"Schreiben musste {waited:.1f}s auf die Bank warten"


def test_zwei_abrufe_gleichzeitig(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch)
    calls = []

    class SlowFetch(DemoProvider):
        def fetch_transactions(self, *args):
            calls.append(1)
            items = super().fetch_transactions(*args)
            time.sleep(1)
            return items

    results = []

    def run():
        with db.session() as conn:
            results.append(sync.run(conn, SlowFetch()))

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1                     # die Bank wurde nur einmal gefragt
    assert all(r["ok"] for r in results)       # keiner scheitert
    assert sorted(bool(r.get("joined")) for r in results) == [False, True]
    with db.session() as conn:
        n = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    assert n == max(r["new"] for r in results) > 0
