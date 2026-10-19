"""Macht die Bilder für die README aus der Vorschau (dist/demo.html).

Aufruf:  python tools/build_demo.py && python tools/screenshots.py [en|de]
         en -> docs/images/ (README.md), de -> docs/bilder/ (README.de.md)
Braucht:  pip install playwright && python -m playwright install chromium
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DEMO = (ROOT / "dist" / "demo.html").as_uri()
# Chromium-Pfad: Standard von Playwright, sonst per Umgebungsvariable CHROMIUM
CHROMIUM = os.environ.get("CHROMIUM")

LANG = (sys.argv[1] if len(sys.argv) > 1 else "en").lower()
OUT = ROOT / "docs" / ("bilder" if LANG == "de" else "images")
LOCALE = "de-DE" if LANG == "de" else "en-GB"
NAMES = {
    "de": ["01-uebersicht", "02-prognose", "03-umsaetze", "04-zuordnen", "05-suche", "06-statistik-monat",
           "07-statistik-jahr", "08-vermoegen", "09-kredit", "10-fixkosten", "11-uebersicht-hell"],
    "en": ["01-overview", "02-forecast", "03-transactions", "04-categorize", "05-search", "06-stats-month",
           "07-stats-year", "08-wealth", "09-loan", "10-fixed-costs", "11-overview-light"],
}["de" if LANG == "de" else "en"]


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM) if CHROMIUM else await p.chromium.launch()
        opts = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale=LOCALE)
        ctx = await b.new_context(color_scheme="dark", **opts)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(DEMO)
        await page.wait_for_timeout(3200)  # Toasts abwarten
        shots = iter(NAMES)

        async def shot():
            await page.wait_for_timeout(350)
            await page.screenshot(path=f"{OUT}/{next(shots)}.png")

        async def tab(t):
            await page.click(f"[data-tab={t}]")
            await page.evaluate("window.scrollTo(0,0)")

        await shot()
        await page.evaluate("document.querySelector('[data-chart=month]').closest('.card').scrollIntoView({block:'start'}); window.scrollBy(0,-120)")
        await shot()
        await tab("transactions"); await shot()
        await page.click("[data-txfilter=open]"); await page.wait_for_timeout(300)
        await page.click("[data-tx]"); await page.wait_for_timeout(400); await shot()
        await page.mouse.click(195, 20); await page.wait_for_timeout(400)
        await page.click("[data-txfilter=all]"); await page.type("#tx-search", "amazon"); await shot()
        await page.click("[data-action=clear-search]")
        await tab("stats"); await shot()
        await page.click("[data-period=year]"); await shot()
        await tab("wealth"); await shot()
        await page.click("[data-account='4']"); await page.wait_for_timeout(400); await shot()
        await page.mouse.click(195, 20); await page.wait_for_timeout(400)
        await tab("settings"); await page.wait_for_timeout(300)
        await page.evaluate("document.querySelectorAll('.card')[1].scrollIntoView({block:'start'}); window.scrollBy(0,-110)")
        await shot()
        # heller Modus
        ctx2 = await b.new_context(color_scheme="light", **opts)
        p2 = await ctx2.new_page()
        await p2.goto(DEMO)
        await p2.wait_for_timeout(3200)
        await p2.screenshot(path=f"{OUT}/{next(shots)}.png")
        print(OUT, errs or "ohne Fehler")
        await b.close()

asyncio.run(main())
