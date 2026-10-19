# Security / Sicherheit

Münzwerk handles personal financial data, so security reports are taken seriously –
even though this is a hobby project without guaranteed response times.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately via
[GitHub's private vulnerability reporting](https://github.com/Vaitage/muenzwerk/security/advisories/new)
(*Security* tab → *Report a vulnerability*).

Please include what is affected, how to reproduce it and what an attacker could do.
Use made-up data only – never send real bank data, keys or `.env` files.

You can expect a first answer within about two weeks. Once a fix is available,
the advisory will be published and you'll be credited if you like.

## Supported versions

Only the latest state of the `main` branch receives fixes.

## Scope

In scope: the server (`app/`), the web app (`web/`), the Docker setup and the scripts in `tools/`.

Out of scope: Enable Banking, your bank, Tailscale and other third-party services –
please report issues there directly. Setups that ignore the documented precautions
(e.g. exposing the app to the internet with `tailscale funnel` or a port forward)
are not considered vulnerabilities of Münzwerk.

---

## Deutsch

Bitte **kein öffentliches Issue** anlegen, sondern vertraulich über
[„Report a vulnerability“](https://github.com/Vaitage/muenzwerk/security/advisories/new)
im Reiter *Security* melden. Nur erfundene Daten verwenden – niemals echte Bankdaten,
Schlüssel oder `.env`-Dateien schicken. Eine erste Antwort gibt es in der Regel
innerhalb von zwei Wochen; Korrekturen gibt es nur für den aktuellen Stand von `main`.
