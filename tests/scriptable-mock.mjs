// Nachbau der wenigen Scriptable-Teile, die web/scriptable-widget.js benutzt.
// So lässt sich das Widget-Skript ohne iPhone ausführen (Tests, Vorschaubilder).
import { readFileSync } from "node:fs";
import vm from "node:vm";

class Color {
  constructor(hex) { this.hex = hex; }
  static dynamic(light, dark) { const c = new Color(light.hex); c.dark = dark.hex; return c; }
  static white() { return new Color("#ffffff"); }
}
const Font = {
  systemFont: (size) => ({ size, weight: 400 }),
  semiboldSystemFont: (size) => ({ size, weight: 600 }),
  boldSystemFont: (size) => ({ size, weight: 700 }),
};
class WidgetStack {
  constructor() { this.items = []; this.horizontal = false; this.spacing = 0; }
  layoutHorizontally() { this.horizontal = true; }
  layoutVertically() { this.horizontal = false; }
  addText(value) { const t = { kind: "text", value }; this.items.push(t); return t; }
  addSpacer(size) { this.items.push({ kind: "spacer", size: size ?? null }); }
  addStack() { const s = new WidgetStack(); s.kind = "stack"; this.items.push(s); return s; }
}
const created = [];   // alle erzeugten Widgets (auch die, die nur angezeigt werden)
class ListWidget extends WidgetStack {
  constructor() { super(); created.push(this); }
  setPadding(...p) { this.padding = p; }
  async presentMedium() { this.presented = "medium"; }
}

// Führt das Skript aus. response: { status, body } oder "fail" (nicht erreichbar)
export async function runWidget({ family = "medium", inWidget = true, response, key = "mw_test", cache = null,
  language = "de", now = null, alertInput = null } = {}) {
  const src = readFileSync(new URL("../web/scriptable-widget.js", import.meta.url), "utf8")
    .replace("__MUENZWERK_URL__", "https://pi.example.ts.net");
  const keychain = new Map(key ? [["muenzwerk-widget-key", key]] : []);
  const files = new Map(cache ? [["/docs/muenzwerk-widget.json", JSON.stringify(cache)]] : []);
  const out = { widget: null, requests: [], keychain, files };
  class Request {
    constructor(url) { this.url = url; out.requests.push(this); }
    async loadJSON() {
      if (response === "fail") throw new Error("offline");
      this.response = { statusCode: response.status };
      return response.body;
    }
  }
  class Alert {
    addSecureTextField() {} addAction() {} addCancelAction() {}
    async present() { return alertInput == null ? -1 : 0; }
    textFieldValue() { return alertInput; }
  }
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now ?? RealDate.now()])); }
    static now() { return now ? new RealDate(now).getTime() : RealDate.now(); }
  }
  const ctx = vm.createContext({
    Color, Font, ListWidget, Request, Alert, Intl, JSON, String, Number, Math, isNaN, console,
    Date: now ? FakeDate : Date,
    Device: { language: () => language },
    config: { runsInWidget: inWidget, widgetFamily: inWidget ? family : null },
    Keychain: {
      contains: (k) => keychain.has(k), get: (k) => keychain.get(k),
      set: (k, v) => keychain.set(k, v), remove: (k) => keychain.delete(k),
    },
    FileManager: { local: () => ({
      documentsDirectory: () => "/docs", joinPath: (a, b) => `${a}/${b}`,
      fileExists: (p) => files.has(p), readString: (p) => files.get(p), writeString: (p, s) => files.set(p, s),
    }) },
    Script: { setWidget: (w) => { out.widget = w; }, complete: () => {} },
    __capture: (w) => { out.widget = w; },
  });
  // Scriptable erlaubt "await" ganz oben; für Node in eine async-Funktion packen
  const wrapped = `(async () => {\n${src}\n})()`;
  created.length = 0;
  await vm.runInContext(wrapped, ctx);
  out.widget = out.widget || created.at(-1) || null;   // in der App: das angezeigte Widget
  return out;
}

// Alle Texte eines Widgets in Lesereihenfolge
export function texts(w) {
  const all = [];
  const walk = (s) => s.items.forEach((i) => (i.kind === "text" ? all.push(i.value) : i.kind === "stack" ? walk(i) : null));
  if (w) walk(w);
  return all.map((t) => t.replace(/[\u00a0\u202f]/g, " "));   // geschützte Leerzeichen aus Intl
}

// Vorschau als HTML (für Bilder) – grob wie iOS: Systemschrift, Abstände, Farben
export function toHtml(w, { width, height, dark = false }) {
  const col = (c) => (c ? (dark && c.dark ? c.dark : c.hex) : "inherit");
  const node = (s) => s.items.map((i) => {
    if (i.kind === "text") {
      return `<div style="font-size:${i.font?.size ?? 14}px;font-weight:${i.font?.weight ?? 400};color:${col(i.textColor)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.value.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
    }
    if (i.kind === "spacer") return i.size == null ? `<div style="flex:1"></div>` : `<div style="height:${i.size}px;width:${i.size}px;flex:none"></div>`;
    return `<div style="display:flex;flex-direction:${i.horizontal ? "row" : "column"};gap:${i.spacing}px">${node(i)}</div>`;
  }).join("");
  const [t, l, b, r] = w.padding || [8, 8, 8, 8];
  return `<div style="width:${width}px;height:${height}px;box-sizing:border-box;padding:${t}px ${r}px ${b}px ${l}px;border-radius:22px;
    background:${col(w.backgroundColor) === "inherit" ? (dark ? "#000" : "#888") : col(w.backgroundColor)};display:flex;flex-direction:column;
    font-family:-apple-system,'SF Pro Text','Segoe UI',Roboto,sans-serif;overflow:hidden">${node(w)}</div>`;
}
