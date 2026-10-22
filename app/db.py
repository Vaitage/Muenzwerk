"""SQLite-Datenbank: Schema, Verbindung und Startdaten."""

import os
import sqlite3
from contextlib import contextmanager

from . import defaults

DB_PATH = os.environ.get("HAUSHALTSBUCH_DB", os.path.join("data", "haushaltsbuch.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
    icon               TEXT NOT NULL DEFAULT 'tag',
    sort               INTEGER NOT NULL DEFAULT 0,
    shift_next_month   INTEGER NOT NULL DEFAULT 0,
    is_savings         INTEGER NOT NULL DEFAULT 0,   -- Ersparnis statt Ausgabe
    UNIQUE (name, kind)
);

CREATE TABLE IF NOT EXISTS rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern      TEXT NOT NULL,
    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    source       TEXT NOT NULL DEFAULT 'user',   -- 'starter' oder 'user'
    direction    TEXT,                           -- 'expense'/'income' bei gelernten Regeln
    scope        TEXT NOT NULL DEFAULT 'any',    -- 'counterparty': nur Empfänger, 'any': auch Zweck/IBAN
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (pattern, category_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id                     TEXT PRIMARY KEY,      -- eindeutige ID der Bank
    booking_date           TEXT NOT NULL,         -- YYYY-MM-DD
    amount_cents           INTEGER NOT NULL,      -- negativ = Ausgabe
    currency               TEXT NOT NULL DEFAULT 'EUR',
    counterparty           TEXT NOT NULL DEFAULT '',
    purpose                TEXT NOT NULL DEFAULT '',
    counterparty_iban      TEXT NOT NULL DEFAULT '',  -- IBAN der Gegenseite, falls bekannt
    category_id            INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    budget_month           TEXT NOT NULL,         -- YYYY-MM, zählt für diesen Monat
    budget_month_manual    INTEGER NOT NULL DEFAULT 0,
    categorized_by         TEXT,                  -- 'rule', 'user' oder NULL
    pending                INTEGER NOT NULL DEFAULT 0,  -- 1 = von der Bank nur vorgemerkt
    imported_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_budget_month ON transactions(budget_month);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

-- Korrekturen der Fixkosten-Erkennung je Empfänger (1 = fix, 0 = nicht fix)
CREATE TABLE IF NOT EXISTS recurring_overrides (
    pattern   TEXT PRIMARY KEY,
    is_fixed  INTEGER NOT NULL
);

-- Konten für die Vermögensübersicht: Girokonto, Sparkonten, Depots, Kredite.
-- Liegen nur hier in der eigenen Datenbank, nie im Code.
CREATE TABLE IF NOT EXISTS accounts (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    type                 TEXT NOT NULL CHECK (type IN ('giro', 'savings', 'depot', 'loan')),
    icon                 TEXT NOT NULL DEFAULT 'bank',
    match                TEXT NOT NULL DEFAULT '',   -- IBAN oder Stichwort der Umbuchungen
    bank_uid             TEXT UNIQUE,                -- Konto-ID bei der Bank, falls automatisch
    include_in_total     INTEGER NOT NULL DEFAULT 1,
    loan_rate_bp         INTEGER,                    -- Sollzins p. a. in Hundertstel-Prozent
    loan_payment_cents   INTEGER,                    -- monatliche Rate
    loan_original_cents  INTEGER,                    -- ursprünglicher Kreditbetrag (optional)
    sort                 INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kontostände zu einem Stichtag (von Hand eingetragen oder von der Bank).
-- Bei Krediten ist das die Restschuld als positiver Betrag.
CREATE TABLE IF NOT EXISTS account_values (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    value_cents  INTEGER NOT NULL,
    source       TEXT NOT NULL DEFAULT 'manual',
    UNIQUE (account_id, date)
);

CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_connection (
    id            INTEGER PRIMARY KEY CHECK (id = 1),  -- genau eine Verbindung
    provider      TEXT NOT NULL,
    session_id    TEXT,
    account_ids   TEXT,           -- kommagetrennt
    valid_until   TEXT,           -- ISO-Datum, Ablauf der Bankfreigabe
    status        TEXT NOT NULL,  -- 'active', 'expired', 'error', 'pending'
    last_sync     TEXT,
    last_error    TEXT,
    accounts_info TEXT            -- JSON: alle freigegebenen Konten
);

-- Rückgängig für Zuordnungen (siehe ledger.with_undo)
CREATE TABLE IF NOT EXISTS undo_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    created  TEXT NOT NULL,
    label    TEXT NOT NULL,
    data     TEXT NOT NULL     -- JSON: vorherige Kategorien und Regeln
);

-- Anmeldung per Passkey (siehe auth.py)
CREATE TABLE IF NOT EXISTS passkeys (
    id          TEXT PRIMARY KEY,   -- Credential-ID (base64url)
    public_key  BLOB NOT NULL,      -- nur der öffentliche Teil
    sign_count  INTEGER NOT NULL DEFAULT 0,
    name        TEXT NOT NULL,
    created     TEXT NOT NULL,
    last_used   TEXT
);

-- Sparziele: Das Geld bleibt auf dem Girokonto. Die App plant je Monat eine Rate im Budget ein;
-- fürs Ziel zählt, was am Monatsende übrig bleibt (höchstens die Rate). Rechnung: web/analytics.js.
CREATE TABLE IF NOT EXISTS savings_goals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT 'piggy',
    target_cents  INTEGER NOT NULL,
    target_month  TEXT,                 -- YYYY-MM, bis wann; NULL = ohne Datum
    monthly_cents INTEGER,              -- feste Rate, nur ohne Datum
    start_month   TEXT NOT NULL,        -- ab diesem Budgetmonat
    start_cents   INTEGER NOT NULL DEFAULT 0,   -- schon vorhanden
    archived      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Web-Push-Abos (iPhone-Mitteilungen); Endpunkt beim Mitteilungsdienst (Apple, Google, Mozilla)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash  TEXT PRIMARY KEY,   -- SHA-256 des Cookies, nie das Cookie selbst
    created     TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    expires     TEXT NOT NULL
);
"""


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or DB_PATH
    if path != ":memory:":
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    # Jede Anfrage bekommt ihre eigene Verbindung; FastAPI kann sie aber in
    # einem anderen Thread öffnen als benutzen, daher check_same_thread=False.
    conn = sqlite3.connect(path, check_same_thread=False)
    if path != ":memory:":
        # Datenbank nur für den eigenen Benutzer lesbar
        for f in (path, path + "-wal", path + "-shm"):
            try:
                os.chmod(f, 0o600)
            except OSError:
                pass
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def session(path: str | None = None):
    conn = connect(path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init(conn: sqlite3.Connection) -> None:
    """Legt das Schema an und füllt beim ersten Start die Standardwerte ein."""
    conn.executescript(SCHEMA)
    _migrate(conn)

    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        lang = defaults.language()
        ids = {}
        for i, (key, icon, de, en) in enumerate(defaults.EXPENSE_CATEGORIES):
            cur = conn.execute(
                "INSERT INTO categories (name, kind, icon, sort, is_savings) VALUES (?, 'expense', ?, ?, ?)",
                (en if lang == "en" else de, icon, i, int(key in defaults.SAVINGS_KEYS)),
            )
            ids[key] = cur.lastrowid
        for i, (key, icon, shift, de, en) in enumerate(defaults.INCOME_CATEGORIES):
            cur = conn.execute(
                "INSERT INTO categories (name, kind, icon, sort, shift_next_month) "
                "VALUES (?, 'income', ?, ?, ?)",
                (en if lang == "en" else de, icon, i, int(shift)),
            )
            ids[key] = cur.lastrowid
        for pattern, key in defaults.STARTER_RULES.items():
            conn.execute(
                "INSERT OR IGNORE INTO rules (pattern, category_id, source) VALUES (?, ?, 'starter')",
                (pattern, ids[key]),
            )

    for key, value in defaults.DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    """Ergänzt Spalten, die es in älteren Datenbanken noch nicht gab."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(categories)")}
    if "is_savings" not in cols:
        conn.execute("ALTER TABLE categories ADD COLUMN is_savings INTEGER NOT NULL DEFAULT 0")
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(transactions)")}
    if "counterparty_iban" not in cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN counterparty_iban TEXT NOT NULL DEFAULT ''")
    if "pending" not in cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN pending INTEGER NOT NULL DEFAULT 0")
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(rules)")}
    if "direction" not in cols:
        # Richtung des Umsatzes, an dem eine eigene Regel gelernt wurde
        conn.execute("ALTER TABLE rules ADD COLUMN direction TEXT")
    if "scope" not in cols:
        # Beim Zuordnen gelernte Regeln (mit Richtung) gelten nur für den Empfänger
        conn.execute("ALTER TABLE rules ADD COLUMN scope TEXT NOT NULL DEFAULT 'any'")
        # (genau die, deren Suchbegriff ein Empfängername ist)
        from .ledger import counterparty_key

        names = {counterparty_key(r["counterparty"]) for r in conn.execute("SELECT DISTINCT counterparty FROM transactions")}
        for r in conn.execute("SELECT id, pattern FROM rules WHERE source = 'user' AND direction IS NOT NULL").fetchall():
            if r["pattern"] in names:
                conn.execute("UPDATE rules SET scope = 'counterparty' WHERE id = ?", (r["id"],))
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(bank_connection)")}
    if "accounts_info" not in cols:
        conn.execute("ALTER TABLE bank_connection ADD COLUMN accounts_info TEXT")
    # Kategorie für Kreditraten gibt es erst seit der Vermögensübersicht.
    # Nur einmal, damit eine gelöschte Kategorie nicht wiederkommt.
    done = conn.execute("SELECT 1 FROM settings WHERE key = 'migration_kredit'").fetchone()
    if not done and conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]:
        conn.execute("INSERT INTO settings (key, value) VALUES ('migration_kredit', '1')")
        conn.execute(
            "INSERT OR IGNORE INTO categories (name, kind, icon, sort) "
            "SELECT 'Kredit', 'expense', 'bank', COALESCE(MAX(sort), 0) + 1 FROM categories WHERE kind = 'expense'"
        )
    # Ältere ING-Umsätze haben noch die Technik-Felder vor dem Verwendungszweck.
    from .bank.enablebanking import clean_purpose

    rows = conn.execute("SELECT id, purpose FROM transactions WHERE purpose LIKE 'mandatereference:%'").fetchall()
    for row in rows:
        conn.execute("UPDATE transactions SET purpose = ? WHERE id = ?", (clean_purpose(row["purpose"]), row["id"]))


def get_setting(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else defaults.DEFAULT_SETTINGS[key]
