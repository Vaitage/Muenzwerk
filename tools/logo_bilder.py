"""Erzeugt aus web/logo.svg die Bilder der App: Homescreen-Symbole und Startbilder fürs iPhone.

    python tools/logo_bilder.py

Schreibt web/icon-180.png, web/icon-192.png, web/icon-512.png, web/splash/*.png und docs/logo.svg.
Braucht Playwright mit Chromium (wie tools/screenshots.py). Nur nach einer Änderung am Logo nötig.
"""

import asyncio
import os
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
ACCENT = "#5856d6"

# iPhone-Startbilder: (CSS-Breite, CSS-Höhe, Pixeldichte) – Hochformat
SPLASH = [
    (440, 956, 3), (402, 874, 3), (420, 912, 3), (430, 932, 3), (393, 852, 3), (428, 926, 3),
    (390, 844, 3), (375, 812, 3), (414, 896, 3), (414, 896, 2), (375, 667, 2),
]


def mark(color: str) -> str:
    svg = (WEB / "logo.svg").read_text(encoding="utf-8").split("\n", 1)[1]
    return svg.replace("currentColor", color)


def splash_name(w: int, h: int, r: int) -> str:
    return f"splash-{w * r}x{h * r}.png"


def splash_links() -> str:
    """<link>-Zeilen für index.html (Startbild je Gerätegröße)."""
    return "\n".join(
        f'  <link rel="apple-touch-startup-image" href="splash/{splash_name(w, h, r)}" '
        f'media="(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: portrait)">'
        for w, h, r in SPLASH
    )


async def main() -> None:
    (WEB / "splash").mkdir(exist_ok=True)
    (ROOT / "docs" / "logo.svg").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n' + mark(ACCENT), encoding="utf-8")
    white = mark("#ffffff")
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
        # Symbole: Fläche randlos (iOS/Android runden selbst ab), Zeichen in der sicheren Mitte
        for size in (180, 192, 512):
            page = await b.new_page(viewport={"width": size, "height": size})
            await page.set_content(f"""<body style="margin:0;background:{ACCENT};display:grid;place-items:center;height:100vh">
                <div style="width:66%;height:66%">{white.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>""")
            await page.screenshot(path=str(WEB / f"icon-{size}.png"))
            await page.close()
        # Startbilder: Logo und Schriftzug auf Akzentfarbe (wie der Startbildschirm im Entwurf)
        for w, h, r in SPLASH:
            page = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=r)
            await page.set_content(f"""<body style="margin:0;background:{ACCENT};height:100vh;display:flex;flex-direction:column;
                align-items:center;justify-content:center;gap:22px;font-family:'Inter Display','Inter',system-ui,sans-serif">
                <div style="width:{round(w * 0.34)}px;height:{round(w * 0.34)}px">{white.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
                <div style="color:#fff;font-size:{round(w * 0.085)}px;font-weight:800;letter-spacing:-0.02em">Münzwerk</div></body>""")
            await page.screenshot(path=str(WEB / "splash" / splash_name(w, h, r)))
            await page.close()
        await b.close()
    print(splash_links())


if __name__ == "__main__":
    asyncio.run(main())
