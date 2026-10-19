# Münzwerk – notes for AI coding assistants

Self-hosted household budget app: fetches bank transactions via PSD2 (Enable Banking),
sorts them into categories automatically and runs as a home-screen web app.
See `README.md` for features, setup and security; `CONTRIBUTING.md` for the rules below in detail.

## Tech
- Backend: Python, FastAPI, SQLite (`app/`); calculations in the browser (`web/analytics.js`)
- Frontend: plain HTML/CSS/JS without a build step (`web/`)
- Bank provider is pluggable via `BANK_PROVIDER` (`demo` | `enablebanking` | `none`), see `app/bank/`
- UI in German and English: texts go through `t("German text")`; add the English version to `web/i18n.js`
- Default categories in both languages: `app/defaults.py` (`DEFAULT_LANGUAGE`)
- Demo without a server: `python tools/build_demo.py` → `dist/demo.html`
- README images: `python tools/screenshots.py en|de`
- Tests: `pytest` and `node --test tests/*.test.mjs`

## Rules
- Never commit real bank data, IBANs, `.env`, `data/` or `*.pem`. Demo and test data stay made up.
- Write requests from the frontend need the header `X-Haushaltsbuch: 1` (CSRF protection).
- Escape all untrusted text (payee, reference, names) with `esc()` before inserting it into HTML.
- Keep it runnable on a Raspberry Pi: few dependencies, no build step.
- Code comments are mostly German for historical reasons; English is fine for new code.
