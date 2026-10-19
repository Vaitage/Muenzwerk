"""Demo-Bank mit erfundenen Umsätzen.

Damit lässt sich die ganze App ausprobieren, ohne dass echte Bankdaten im
Spiel sind. Die Umsätze sind pro Monat fest (gleicher Zufallsstartwert), ein
erneuter Abruf liefert also dieselben IDs und legt nichts doppelt an.
"""

import calendar
import random
import secrets
from datetime import date, timedelta

from .base import BankProvider, ConnectResult, ConnectStart


def _last_weekday(year: int, month: int) -> int:
    day = calendar.monthrange(year, month)[1]
    while date(year, month, day).weekday() >= 5:
        day -= 1
    return day


# Erfundene IBANs, nur für die Demo.
DEMO_IBAN_EXTRA = "DE00111122223333444401"
DEMO_IBAN_KREDIT = "DE00111122223333444409"


def _month_items(year: int, month: int) -> list[tuple]:
    """(Tag, Empfänger, Verwendungszweck, Betrag) für einen Monat."""
    rnd = random.Random(year * 100 + month)
    days_in_month = calendar.monthrange(year, month)[1]
    items = [
        (1, "Hausverwaltung Nord GmbH", "Miete Wohnung", -850.00),
        (2, "Stadtwerke", "Abschlag Strom/Gas", -78.00),
        (3, "Telekom Deutschland GmbH", "Festnetz/Internet", -39.95),
        (5, "HUK-COBURG", "Kfz-Versicherung", -42.10),
        (7, "Spotify AB", "Spotify Premium", -11.99),
        (15, "Netflix International B.V.", "Netflix Abo", -13.99),
    ]
    shops = [
        ("REWE Markt GmbH", "Kartenzahlung girocard"),
        ("ALDI SUED", "Kartenzahlung girocard"),
        ("LIDL DIENSTLEISTUNG", "Kartenzahlung girocard"),
        ("EDEKA Center", "Kartenzahlung girocard"),
    ]
    for _ in range(rnd.randint(6, 9)):
        name, purpose = rnd.choice(shops)
        items.append((rnd.randint(1, days_in_month), name, purpose, -round(rnd.uniform(12, 88), 2)))
    for _ in range(2):
        items.append((rnd.randint(1, days_in_month), "ARAL Station", "Tanken", -round(rnd.uniform(52, 78), 2)))
    items.append((rnd.randint(1, days_in_month), "Lieferando.de", "Bestellung", -round(rnd.uniform(18, 34), 2)))

    # Absichtlich ohne passende Regel – landen in "Zuordnen".
    for _ in range(rnd.randint(1, 2)):
        items.append((rnd.randint(1, days_in_month), "AMAZON EU S.A R.L.", "Bestellung " + str(rnd.randint(300, 399)) + "-" + str(rnd.randint(1000000, 9999999)), -round(rnd.uniform(9, 65), 2)))
    for _ in range(rnd.randint(2, 4)):
        items.append((rnd.randint(1, days_in_month), "SumUp *Baeckerei Kraus", "Kartenzahlung", -round(rnd.uniform(2.5, 9.8), 2)))
    items.append((rnd.randint(1, days_in_month), "PayPal Europe S.a.r.l.", "PayPal Zahlung", -round(rnd.uniform(15, 49), 2)))
    if rnd.random() < 0.6:
        items.append((rnd.randint(1, days_in_month), "Max Mustermann", "Danke fürs Grillen", -float(rnd.choice([15, 20, 25, 40]))))
    if rnd.random() < 0.5:
        items.append((rnd.randint(1, days_in_month), "Fressnapf", "Kartenzahlung", -round(rnd.uniform(14, 40), 2)))
    if rnd.random() < 0.25:
        items.append((rnd.randint(1, days_in_month), "MediaMarkt", "Kartenzahlung", -round(rnd.uniform(280, 690), 2)))

    # Sparen: Dauerauftrag aufs Extra-Konto, ab und zu etwas zurückgeholt.
    items.append((2, "Eigenes Extra-Konto", "Dauerauftrag Extra-Konto", -200.00, DEMO_IBAN_EXTRA))
    if rnd.random() < 0.15:
        items.append((rnd.randint(10, days_in_month), "Eigenes Extra-Konto", "Umbuchung vom Extra-Konto", 150.00, DEMO_IBAN_EXTRA))
    # Depot-Sparplan und Kreditrate
    items.append((3, "ING-DiBa AG", "Sparplan Direkt-Depot", -150.00))
    items.append((1, "ING-DiBa AG", "Rate Ratenkredit", -320.00, DEMO_IBAN_KREDIT))

    # Gehalt am letzten Werktag des Monats – gedacht für den Folgemonat.
    items.append((_last_weekday(year, month), "Muster GmbH", f"Lohn/Gehalt {month:02d}/{year}", 2850.00))
    return items


# So viele Tage bleiben Demo-Kartenzahlungen "vorgemerkt"
PENDING_DEMO_DAYS = 2


class DemoProvider(BankProvider):
    name = "demo"
    history_days = 460  # gut 15 Monate, damit die Statistik etwas zeigt

    def start_connect(self, redirect_url: str) -> ConnectStart:
        state = secrets.token_urlsafe(16)
        # Die Demo-Bank "bestätigt" sofort und springt direkt zurück.
        return ConnectStart(url=f"{redirect_url}?code=demo&state={state}", state=state)

    def finish_connect(self, code: str) -> ConnectResult:
        return ConnectResult(
            session_id="demo-session",
            account_ids=["demo-girokonto"],
            valid_until=(date.today() + timedelta(days=90)).isoformat(),
            accounts=[
                {"uid": "demo-girokonto", "name": "Girokonto", "type": "giro", "iban": ""},
                {"uid": "demo-extra", "name": "Extra-Konto Rücklage", "type": "savings", "iban": DEMO_IBAN_EXTRA},
            ],
        )

    def fetch_balances(self, session_id, accounts) -> list[dict]:
        demo = {"demo-girokonto": 234567, "demo-extra": 185000}
        return [{**a, "balance_cents": demo.get(a["uid"], 0)} for a in accounts]

    def fetch_transactions(self, session_id, account_ids, since: date) -> list[dict]:
        today = date.today()
        result = []
        year, month = since.year, since.month
        while (year, month) <= (today.year, today.month):
            for n, (day, who, purpose, amount, *iban) in enumerate(_month_items(year, month)):
                booking = date(year, month, day)
                if since <= booking <= today:
                    # Kartenzahlungen der letzten 2 Tage sind wie bei der Bank
                    # erst vorgemerkt – mit eigener ID, wie bei echten Banken.
                    pending = "Kartenzahlung" in purpose and (today - booking).days < PENDING_DEMO_DAYS
                    result.append({
                        "id": f"demo-{'p-' if pending else ''}{year}-{month:02d}-{n}",
                        "pending": pending,
                        "booking_date": booking.isoformat(),
                        "amount_cents": round(amount * 100),
                        "currency": "EUR",
                        "counterparty": who,
                        "purpose": purpose,
                        "counterparty_iban": iban[0] if iban else "",
                    })
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        return result
