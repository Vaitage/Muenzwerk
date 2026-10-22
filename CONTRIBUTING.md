# Contributing / Mitmachen

Thanks for your interest in Münzwerk! It's a hobby project maintained in spare time,
so please be patient with reviews. Issues and pull requests in **English or German** are welcome.

🇩🇪 Deutsch: siehe unten.

## Ground rules

- **Never commit or post real bank data:** no IBANs, account numbers, real amounts or payees,
  `.env`, `data/`, `*.pem` or unredacted screenshots. Demo and test data are always made up.
- For bigger changes, open an issue first so we can agree on the direction.
- Keep it simple: plain HTML/CSS/JS without a build step, FastAPI + SQLite on the server,
  few dependencies. Münzwerk should keep running on a Raspberry Pi.
- Security matters more than features. Untrusted text (payee, reference) must always be escaped,
  write requests need the `X-Haushaltsbuch: 1` header (CSRF protection).

## Getting started

```bash
pip install --require-hashes -r requirements.txt && pip install pytest
HAUSHALTSBUCH_AUTH=0 uvicorn app.main:app --reload    # http://localhost:8000, demo bank
pytest
node --test tests/*.test.mjs
```

`python tools/build_demo.py` builds a self-contained demo (`dist/demo.html`) that's handy
for UI work and screenshots.

**Dependencies** are pinned with hashes. Edit `requirements.in`, then regenerate with Python 3.14:
`pip install pip-tools && pip-compile --generate-hashes --strip-extras --no-emit-index-url requirements.in`.
The base image in the `Dockerfile` is pinned by digest. Dependabot proposes updates monthly.

## Translations

The UI is German and English. Texts go through `t()` with the **German text as key**:

```js
t("Speichern")                         // "Save" in English
t("seit {date}", { date })             // placeholders in braces
tn(n, "{n} Umsatz", "{n} Umsätze")     // singular / plural
```

Add the English version to the `EN` table in `web/i18n.js`. `tests/i18n.test.mjs` fails
if a text has no translation or the placeholders don't match. Server error messages are
German too and get translated in the browser the same way.

## Code style

- Python: standard library style, type hints where helpful, SQL only with placeholders.
- JavaScript: no frameworks, no build; escape everything with `esc()` before putting it into HTML.
- Comments are mostly German for historical reasons; new comments may be English.
- Add or update tests for behaviour changes.

## Pull requests

1. Fork and create a branch.
2. Make your change with tests; run `pytest` and `node --test tests/*.test.mjs`.
3. Describe what and why in the PR. Screenshots only with demo data.

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE).

---

## Deutsch

Danke fürs Interesse! Münzwerk ist ein Hobbyprojekt, Reviews können also etwas dauern.
Issues und Pull Requests auf Deutsch oder Englisch sind willkommen.

- **Niemals echte Bankdaten** committen oder posten (IBANs, Beträge, Empfänger, `.env`,
  `data/`, `*.pem`, ungeschwärzte Bilder). Demo- und Testdaten sind immer erfunden.
- Für größere Änderungen bitte erst ein Issue aufmachen.
- Einfach halten: kein Build, wenige Abhängigkeiten, muss auf einem Raspberry Pi laufen.
- Neue Texte in der Oberfläche über `t("Deutscher Text")` und mit englischer Fassung in
  `web/i18n.js` – der Test `tests/i18n.test.mjs` prüft das.
- Vor dem Pull Request: `pytest` und `node --test tests/*.test.mjs`.

Mit einem Beitrag stimmst du zu, dass er unter der [AGPL-3.0](LICENSE) steht.
