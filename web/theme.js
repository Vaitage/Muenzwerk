// Design: Automatisch (wie das Gerät), Hell oder Dunkel. Wird im <head> geladen,
// damit beim Öffnen nichts kurz in der falschen Farbe aufblitzt. Die Wahl gilt
// pro Gerät (wie die Sprache); styles.css reagiert auf <html data-theme="…">.
window.Theme = (() => {
  "use strict";
  const KEY = "muenzwerk-theme";
  const CHOICES = ["auto", "light", "dark"];
  // Farbe der Statusleiste je Design (wie --bg in styles.css)
  const BAR = { light: "#f2f2f7", dark: "#000000" };

  const read = () => {
    try { const v = localStorage.getItem(KEY); return CHOICES.includes(v) ? v : "auto"; } catch { return "auto"; }
  };

  function apply(choice) {
    const root = document.documentElement;
    if (choice === "auto") delete root.dataset.theme; else root.dataset.theme = choice;
    // Eingabefelder, Scrollbalken usw. passend zeichnen
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", choice === "auto" ? "light dark" : choice);
    // Statusleiste: bei fester Wahl beide Einträge (hell/dunkel) auf dieselbe Farbe
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      const forMedia = (m.getAttribute("media") || "").includes("dark") ? "dark" : "light";
      m.setAttribute("content", BAR[choice === "auto" ? forMedia : choice]);
    });
  }

  function set(choice) {
    if (!CHOICES.includes(choice)) return;
    try { if (choice === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch {}
    apply(choice);
  }

  apply(read());
  return { get: read, set, choices: CHOICES };
})();
