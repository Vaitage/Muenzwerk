# Notes for AI assistants

Before changing anything, read in this order:

1. `CLAUDE.md` – tech overview and rules
2. `README.md` – features, structure, setup, security
3. `app/main.py` and `web/app.js` – entry points of server and UI (the UI is split into `web/app*.js`, loaded in the order listed in `web/index.html`; add new files there and to `APP_FILES` in `tools/build_demo.py`)

Key rules:
- Never commit real bank data, IBANs, `.env`, `data/` or `*.pem`.
- UI texts go through `t("German text")` with an English version in `web/i18n.js`.
- Run `pytest` and `node --test tests/*.test.mjs` after every change.
