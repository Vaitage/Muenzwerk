"""Baut dist/demo.html: die komplette App als eine Datei, die ohne Server läuft.

Aufruf:  python tools/build_demo.py
Gedacht für die Vorschau auf dem Handy, bevor der Raspberry Pi bereitsteht.
"""

import base64
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402

# App-Dateien in Ladereihenfolge (wie in web/index.html)
APP_FILES = ["app.js", "app-overview.js", "app-transactions.js", "app-stats.js", "app-wealth.js",
             "app-sheets.js", "app-settings.js", "app-push-widget.js", "app-setup.js", "app-import.js", "app-start.js"]
from app.bank.demo import DemoProvider  # noqa: E402


def demo_accounts() -> list[dict]:
    """Erfundene Beispielkonten für die Vorschau (keine echten Daten)."""
    from app.bank.demo import DEMO_IBAN_EXTRA, DEMO_IBAN_KREDIT

    t = date.today()
    d = lambda days: (t - timedelta(days=days)).isoformat()  # noqa: E731
    base = {"bank": False, "include_in_total": True, "loan_rate_percent": None, "loan_payment_cents": None, "loan_original_cents": None}
    return [
        {**base, "id": 1, "name": "Girokonto", "type": "giro", "icon": "bank", "match": "", "bank": True,
         "values": [{"id": 1, "date": d(0), "value_cents": 234567, "source": "bank"}]},
        # Wie bei der ING: Extra-Konto kommt nicht per PSD2 – ab und zu von Hand, dazwischen fortgeschrieben (+ Zinsen)
        {**base, "id": 2, "name": "Extra-Konto Rücklage", "type": "savings", "icon": "piggy", "match": DEMO_IBAN_EXTRA.lower(),
         "loan_rate_percent": 2.0,
         "values": [{"id": 2, "date": d(160), "value_cents": 120000, "source": "manual"},
                    {"id": 7, "date": d(40), "value_cents": 165000, "source": "manual"}]},
        {**base, "id": 3, "name": "Direkt-Depot", "type": "depot", "icon": "trend", "match": "direkt-depot",
         "values": [{"id": 3, "date": d(400), "value_cents": 980000, "source": "manual"},
                    {"id": 4, "date": d(190), "value_cents": 1215000, "source": "manual"},
                    {"id": 5, "date": d(20), "value_cents": 1398000, "source": "manual"}]},
        {**base, "id": 4, "name": "Ratenkredit", "type": "loan", "icon": "receipt", "match": DEMO_IBAN_KREDIT.lower(),
         "loan_rate_percent": 5.49, "loan_payment_cents": 32000, "loan_original_cents": 2000000,
         "values": [{"id": 6, "date": d(0), "value_cents": 1482050, "source": "manual"}]},
    ]


def main() -> None:
    conn = db.connect(":memory:")
    db.init(conn)
    categories = [
        {**dict(r), "shift_next_month": bool(r["shift_next_month"]), "is_savings": bool(r["is_savings"])}
        for r in conn.execute("SELECT id, name, kind, icon, sort, shift_next_month, is_savings FROM categories")
    ]
    rules = [dict(r) for r in conn.execute("SELECT id, pattern, category_id, source FROM rules")]
    txs = DemoProvider().fetch_transactions("demo", ["demo"], date.today() - timedelta(days=DemoProvider.history_days))
    data = {"categories": categories, "rules": rules, "transactions": txs, "accounts": demo_accounts()}

    web = ROOT / "web"
    html = (web / "index.html").read_text(encoding="utf-8")
    css = (web / "styles.css").read_text(encoding="utf-8")
    icon_png = base64.b64encode((web / "icon-180.png").read_bytes()).decode()
    scripts = "\n".join([
        "window.DEMO_DATA = " + json.dumps(data, ensure_ascii=False) + ";",
        (web / "theme.js").read_text(encoding="utf-8"),
        (web / "icons.js").read_text(encoding="utf-8"),
        (web / "i18n.js").read_text(encoding="utf-8"),
        (web / "analytics.js").read_text(encoding="utf-8"),
        (ROOT / "tools" / "demo-api.js").read_text(encoding="utf-8"),
        *[(web / f).read_text(encoding="utf-8") for f in APP_FILES],
    ]).replace("</script", "<\\/script")

    html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}\n</style>")
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', "")
    html = html.replace('  <script src="theme.js"></script>\n', "")   # steckt unten im Skript-Block
    html = html.replace('href="icon-180.png"', f'href="data:image/png;base64,{icon_png}"')
    html = html.replace('<link rel="icon" type="image/png" href="icon-192.png">', f'<link rel="icon" type="image/png" href="data:image/png;base64,{icon_png}">')
    tags = ["icons.js", "i18n.js", "analytics.js", "api.js", "auth.js", *APP_FILES]
    block = "\n".join(f'  <script src="{f}"></script>' for f in tags)
    assert block in html, "Skript-Liste in index.html passt nicht zu APP_FILES"
    html = html.replace(block, f"  <script>\n{scripts}\n  </script>")
    html = html.replace("<title>Münzwerk</title>", "<title>Münzwerk Demo</title>")
    # Band „Demo – erfundene Daten“ unter der Kopfzeile; Text setzt demo-api.js in der Sprache des Geräts
    html = html.replace('    <header class="top" id="top"></header>\n',
                        '    <header class="top" id="top"></header>\n    <div class="demo-banner" id="demo-banner"></div>\n')
    assert 'id="demo-banner"' in html, "Kopfzeile in index.html nicht gefunden"

    out = ROOT / "dist" / "demo.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out} ({out.stat().st_size // 1024} KB, {len(txs)} Demo-Umsätze)")

    # Variante als Seiteninhalt ohne <html>/<head>/<body> (für eine gehostete Vorschau,
    # die das Grundgerüst selbst mitbringt und die Ränder für Notch/Home-Bar schon setzt).
    body = html.split("<body>", 1)[1].split("</body>", 1)[0]
    fragment = (
        "<title>Münzwerk Demo</title>\n"
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        f"<style>\n{css}\n.top {{ padding-top: 10px; }}\n</style>\n"
        f"{body}"
    )
    frag_out = ROOT / "dist" / "haushaltsbuch-vorschau.html"
    frag_out.write_text(fragment, encoding="utf-8")
    print(frag_out)


if __name__ == "__main__":
    main()
