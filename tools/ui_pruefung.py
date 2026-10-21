"""Prüft die Oberfläche der Vorschau (dist/demo.html) auf Lesbarkeit und Bedienbarkeit.

Gemessen wird in iPhone-Breite (390 px), hell und dunkel, auf allen Reitern und im Umsatz-Fenster:
  - Kontrast: normaler Text mindestens 4,5:1, großer Text (ab 24 px, fett ab 18,7 px) 3:1
  - Schriftgröße: mindestens 12 px (Ausnahme: Beschriftung der Reiter, 11 px wie bei iOS),
    Diagramm-Achsen mindestens 11 px
  - Tippflächen: mindestens 44 × 44 px (eine unsichtbare Vergrößerung per ::after zählt mit)

Aufruf:  python tools/build_demo.py && python tools/ui_pruefung.py
Braucht:  pip install playwright && python -m playwright install chromium
Rückgabe: 0 = alles in Ordnung, 1 = Befunde (werden aufgelistet)
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DEMO = (ROOT / "dist" / "demo.html").as_uri()
CHROMIUM = os.environ.get("CHROMIUM")

MIN_TARGET = 44
MIN_FONT = 12

# Läuft im Browser: sammelt Befunde der gerade sichtbaren Seite
MEASURE = r"""
({ minTarget, minFont }) => {
  // Farbe als [r, g, b, a] (0–255, a 0–1); versteht rgb(), rgba() und color(srgb …)
  const parse = (c) => {
    if (!c || c === "transparent") return [0, 0, 0, 0];
    const nums = (c.match(/-?[\d.]+/g) || []).map(Number);
    if (c.startsWith("color(")) {
      const [r, g, b, a = 1] = nums;
      return [r * 255, g * 255, b * 255, a];
    }
    const [r = 0, g = 0, b = 0, a = 1] = nums;
    return [r, g, b, a];
  };
  const over = (top, under) => {           // top über under legen
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // Hintergrund hinter einem Element: Ebenen von innen nach außen mischen
  const backdrop = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    if (!layers.length || layers[layers.length - 1][3] < 1) bg = parse(getComputedStyle(document.body).backgroundColor);
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };
  const opacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const name = (el) => {
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
    const parent = el.parentElement && typeof el.parentElement.className === "string" && el.parentElement.className.trim()
      ? "." + el.parentElement.className.trim().split(/\s+/)[0] + " " : "";
    return parent + el.tagName.toLowerCase() + cls;
  };
  const visible = (el, r) => {
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    return opacity(el) > 0.05;
  };
  const out = [];
  const seen = new Set();
  const add = (kind, el, detail) => {
    const key = kind + "|" + name(el) + "|" + detail;
    if (!seen.has(key)) { seen.add(key); out.push({ kind, el: name(el), detail, text: (el.textContent || "").trim().slice(0, 40) }); }
  };

  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const cs = getComputedStyle(el);
    const inSvg = !!el.closest("svg");

    // Text mit eigenem Inhalt
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText) {
      const size = parseFloat(cs.fontSize);
      if (inSvg) {
        if (size < minFont - 1) add("schrift", el, `${size}px (Diagramm, Soll ≥ ${minFont - 1}px)`);
      } else {
        const isTabLabel = !!el.closest(".tab") && !el.classList.contains("badge");
        if (size < minFont && !(isTabLabel && size >= 11)) add("schrift", el, `${size}px (Soll ≥ ${minFont}px)`);
        // Kontrast nur bei voll sichtbarem Text (abgeschaltete Knöpfe zählen nicht)
        if (opacity(el) >= 0.99 && !el.closest("[disabled]")) {
          const fg = parse(cs.color);
          const bg = backdrop(el);
          const c = ratio(over(fg, bg), bg);
          const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
          const need = large ? 3 : 4.5;
          if (c < need - 0.005) add("kontrast", el, `${c.toFixed(2)}:1 (Soll ≥ ${need}:1)`);
        }
      }
    }

    // Tippflächen
    if (!inSvg && el.matches("button, a[href], [role=button], input:not([type=hidden]), select, summary, textarea")) {
      if (el.disabled) continue;
      let w = r.width, h = r.height;
      // Unsichtbare Vergrößerung über ::after/::before (position:absolute; inset < 0)
      for (const pseudo of ["::after", "::before"]) {
        const p = getComputedStyle(el, pseudo);
        if (p.content === "none" || p.position !== "absolute") continue;
        const t = parseFloat(p.top), b = parseFloat(p.bottom), l = parseFloat(p.left), rr = parseFloat(p.right);
        if ([t, b, l, rr].every((v) => !isNaN(v))) {
          w = Math.max(w, r.width - l - rr);
          h = Math.max(h, r.height - t - b);
        }
      }
      // Ein Eingabefeld zählt mit seinem sichtbaren Rahmen (z. B. Suchfeld, Schalter)
      const box = el.matches("input") && el.parentElement ? el.parentElement.getBoundingClientRect() : null;
      if (box && el.matches("input[type=checkbox], input[type=search], input[type=text]")) {
        w = Math.max(w, box.width); h = Math.max(h, box.height);
      }
      if (w < minTarget - 0.5 || h < minTarget - 0.5) add("tippflaeche", el, `${Math.round(w)}×${Math.round(h)}px (Soll ≥ ${minTarget}×${minTarget})`);
    }
  }
  return out;
}
"""


async def check() -> list[dict]:
    findings = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(**({"executable_path": CHROMIUM} if CHROMIUM else {}))
        for scheme in ("light", "dark"):
            ctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                            color_scheme=scheme, is_mobile=True, has_touch=True, locale="de-DE")
            page = await ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(DEMO)
            await page.wait_for_selector("[data-tab=overview]")
            await page.wait_for_timeout(800)

            async def measure(where):
                for f in await page.evaluate(MEASURE, {"minTarget": MIN_TARGET, "minFont": MIN_FONT}):
                    findings.append({**f, "where": f"{scheme}/{where}"})

            for tab in ("overview", "transactions", "stats", "wealth", "settings"):
                await page.click(f"[data-tab={tab}]")
                await page.wait_for_timeout(400)
                await measure(tab)
            await page.click("[data-tab=transactions]")
            await page.wait_for_timeout(300)
            await page.click("[data-tx]")
            await page.wait_for_timeout(500)
            await measure("umsatz-fenster")
            for e in errors:
                findings.append({"kind": "js-fehler", "el": "-", "detail": e, "text": "", "where": scheme})
            await ctx.close()
        await browser.close()
    return findings


def main() -> int:
    findings = asyncio.run(check())
    if not findings:
        print("UI-Prüfung: keine Befunde (Kontrast, Schriftgröße, Tippflächen).")
        return 0
    # gleiche Befunde aus mehreren Ansichten zusammenfassen
    grouped: dict[tuple, list[str]] = {}
    for f in findings:
        grouped.setdefault((f["kind"], f["el"], f["detail"], f["text"]), []).append(f["where"])
    for (kind, el, detail, text), where in sorted(grouped.items()):
        print(f"{kind:12} {el}  {detail}  „{text}“  [{', '.join(sorted(set(where)))}]")
    print(f"\n{len(grouped)} Befunde.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
