"""Standardkategorien und Start-Regeln (Deutsch und Englisch).

Alles hier ist nur der Startzustand: Kategorien und Regeln lassen sich in der
App ändern, löschen und ergänzen. In welcher Sprache die Kategorien beim
ersten Start angelegt werden, bestimmt ``DEFAULT_LANGUAGE`` (``de`` oder ``en``).
"""

import os

LANGUAGES = ("de", "en")


def language() -> str:
    """Sprache für die Kategorien beim ersten Start."""
    lang = os.environ.get("DEFAULT_LANGUAGE", "de").strip().lower()[:2]
    return lang if lang in LANGUAGES else "de"


# (Schlüssel, Icon, Deutsch, Englisch)
EXPENSE_CATEGORIES = [
    ("general", "tag", "Allgemein", "General"),
    ("restaurant", "utensils", "Restaurant", "Eating out"),
    ("housing", "home", "Wohnen", "Housing"),
    ("insurance", "shield", "Versicherung", "Insurance"),
    ("health", "stethoscope", "Gesundheit", "Health"),
    ("clothing", "shirt", "Bekleidung", "Clothing"),
    ("education", "graduation", "Bildung", "Education"),
    ("gifts", "gift", "Geschenke", "Gifts"),
    ("pets", "paw", "Haustier", "Pets"),
    ("kids", "smile", "Kinder", "Kids"),
    ("groceries", "basket", "Lebensmittel", "Groceries"),
    ("transport", "car", "Mobilität", "Transport"),
    ("utilities", "plug", "Nebenkosten", "Utilities"),
    ("travel", "plane", "Reisen", "Travel"),
    ("taxes", "receipt", "Steuern", "Taxes"),
    ("tech", "laptop", "Technologie", "Tech"),
    ("entertainment", "headphones", "Unterhaltung", "Entertainment"),
    ("savings", "piggy", "Sparen", "Savings"),
    ("loan", "bank", "Kredit", "Loan"),
]

# Diese Kategorien sind keine Ausgaben, sondern Ersparnisse (z. B. Überweisung
# aufs Extra-Konto). Rücküberweisungen zählen als "Abheben".
SAVINGS_KEYS = {"savings"}

# (Schlüssel, Icon, zählt zum Folgemonat, Deutsch, Englisch)
INCOME_CATEGORIES = [
    ("salary", "wallet", True, "Gehalt", "Salary"),
    ("side_income", "briefcase", False, "Nebeneinkünfte", "Side income"),
    ("refunds", "undo", False, "Erstattungen", "Refunds"),
    ("interest", "coins", False, "Zinsen & Dividenden", "Interest & dividends"),
    ("gifts_received", "gift", False, "Geschenke erhalten", "Gifts received"),
    ("other_income", "tag", False, "Sonstige Einnahmen", "Other income"),
]

# Suchbegriff -> Kategorie-Schlüssel. Ein Begriff trifft, wenn er im Empfänger
# oder im Verwendungszweck vorkommt (Groß-/Kleinschreibung egal). Die Begriffe
# richten sich nach dem, was auf dem Kontoauszug steht, nicht nach der Sprache
# der Oberfläche – deshalb gelten immer alle.
STARTER_RULES = {
    # Ausgaben
    "rewe": "groceries",
    "edeka": "groceries",
    "aldi": "groceries",
    "lidl": "groceries",
    "kaufland": "groceries",
    "netto": "groceries",
    "penny": "groceries",
    "lieferando": "restaurant",
    "mcdonald": "restaurant",
    "burger king": "restaurant",
    "aral": "transport",
    "shell": "transport",
    "esso": "transport",
    "jet tankstelle": "transport",
    "deutsche bahn": "transport",
    "db vertrieb": "transport",
    "hvv": "transport",
    "miete": "housing",
    "stadtwerke": "utilities",
    "vattenfall": "utilities",
    "rundfunk": "utilities",
    "telekom": "utilities",
    "vodafone": "utilities",
    "versicherung": "insurance",
    "huk-coburg": "insurance",
    "allianz": "insurance",
    "apotheke": "health",
    "fressnapf": "pets",
    "finanzamt": "taxes",
    "netflix": "entertainment",
    "spotify": "entertainment",
    "disney plus": "entertainment",
    "zalando": "clothing",
    "mediamarkt": "tech",
    "saturn": "tech",
    "extra-konto": "savings",
    "tagesgeld": "savings",
    "sparplan": "savings",
    "ratenkredit": "loan",
    # Einnahmen
    "gehalt": "salary",
    "lohn": "salary",
    # So steht der Lohn bei vielen Arbeitgebern im Verwendungszweck
    "verdienstabrechnung": "salary",
    "salary": "salary",
    "payroll": "salary",
    "erstattung": "refunds",
    "refund": "refunds",
    "zinsen": "interest",
}

DEFAULT_SETTINGS = {
    # Einnahmen in Kategorien mit "zählt zum Folgemonat" werden ab diesem
    # Tag des Monats dem nächsten Monat zugerechnet.
    "shift_from_day": "15",
    # Einzelne Ausgaben ab diesem Betrag (in Cent) zählen als "große Ausgabe".
    "large_expense_cents": "25000",
}


def _names() -> dict[str, tuple[str, str]]:
    out = {key: (de, en) for key, _icon, de, en in EXPENSE_CATEGORIES}
    out.update({key: (de, en) for key, _icon, _shift, de, en in INCOME_CATEGORIES})
    return out


def category_name(key: str, lang: str | None = None) -> str:
    de, en = _names()[key]
    return en if (lang or language()) == "en" else de


def all_names(key: str) -> tuple[str, str]:
    """Der Name in beiden Sprachen (zum Wiederfinden einer Standardkategorie)."""
    return _names()[key]


def translations() -> dict[str, str]:
    """Deutscher Name -> englischer Name (für die Vorschau)."""
    return {de: en for de, en in _names().values()}
