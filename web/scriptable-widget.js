// Münzwerk – iPhone-Widget für die App „Scriptable“ (https://scriptable.app)
//
// Einrichten (steht auch in Münzwerk unter „Einstellungen → iPhone-Widget“):
//  1. Dieses Skript in Scriptable als neues Skript einfügen, Name z. B. „Münzwerk“.
//  2. Einmal in Scriptable starten und den Widget-Schlüssel aus Münzwerk einfügen.
//     Er wird im Schlüsselbund des iPhones gespeichert, nicht in diesem Skript.
//  3. Auf dem Homescreen ein Scriptable-Widget hinzufügen und dieses Skript wählen.
//
// Der Widget liest nur ein paar Zahlen (Übrig, Tagesbudget, nächste Fixkosten).
// Tailscale muss auf dem iPhone an sein, sonst zeigt er den letzten Stand.

const MUENZWERK_URL = "__MUENZWERK_URL__";   // setzt Münzwerk beim Kopieren ein
const KEY_NAME = "muenzwerk-widget-key";
const CACHE_FILE = "muenzwerk-widget.json";

const DE = String(Device.language() || "").toLowerCase().startsWith("de");
const L = DE ? {
  title: "Münzwerk", left: "Übrig bis Monatsende", today: "Heute", tomorrow: "Morgen", after: "Übermorgen",
  perDay: "pro Tag", next: "Als Nächstes", on: "am", asOf: "Stand", offline: "offline",
  stale: "Münzwerk öffnen für neue Zahlen", noKey: "Skript einmal in Scriptable starten und den Widget-Schlüssel eingeben.",
  badKey: "Widget-Schlüssel ungültig – in Münzwerk neu erzeugen.", noData: "Noch keine Zahlen – Münzwerk einmal öffnen.",
  unreachable: "Pi nicht erreichbar – ist Tailscale an?", bank: "Bankfreigabe", days: "Tage", expired: "abgelaufen",
  fetchFailed: "Letzter Bankabruf fehlgeschlagen",
  askTitle: "Widget-Schlüssel", askText: "In Münzwerk unter „Einstellungen → iPhone-Widget“ erzeugen und hier einfügen.",
  save: "Speichern", cancel: "Abbrechen",
} : {
  title: "Münzwerk", left: "Left until month end", today: "Today", tomorrow: "Tomorrow", after: "In 2 days",
  perDay: "per day", next: "Next", on: "on", asOf: "As of", offline: "offline",
  stale: "Open Münzwerk for new numbers", noKey: "Run this script once in Scriptable and enter the widget key.",
  badKey: "Widget key invalid – create a new one in Münzwerk.", noData: "No numbers yet – open Münzwerk once.",
  unreachable: "Pi not reachable – is Tailscale on?", bank: "Bank access", days: "days", expired: "expired",
  fetchFailed: "Last bank fetch failed",
  askTitle: "Widget key", askText: "Create it in Münzwerk under “Settings → iPhone widget” and paste it here.",
  save: "Save", cancel: "Cancel",
};
const LOCALE = DE ? "de-DE" : "en-GB";

// ------------------------------------------------------------------ Farben
const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  text: Color.dynamic(new Color("#111114"), new Color("#f5f5f7")),
  muted: Color.dynamic(new Color("#6e6e76"), new Color("#8e8e93")),
  pos: Color.dynamic(new Color("#1f9d4c"), new Color("#30d158")),
  neg: Color.dynamic(new Color("#d70015"), new Color("#ff6961")),
  accent: Color.dynamic(new Color("#5856d6"), new Color("#6e6cf0")),
  warn: Color.dynamic(new Color("#c77700"), new Color("#ffb340")),
};

// ------------------------------------------------------------------ Rechnen (ohne Scriptable-Teile)
function euro(cents, digits) {
  const d = digits == null ? 0 : digits;
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(cents / 100);
  } catch (e) {
    return (cents / 100).toFixed(d).replace(".", DE ? "," : ".") + " €";
  }
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function clock(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const sameDay = isoDate(d) === isoDate(new Date());
  return sameDay
    ? d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

// Was der Widget zeigt – aus der Antwort von /api/widget/data und dem heutigen Datum
function buildModel(data, now, offline) {
  const snap = data && data.snapshot;
  if (!snap) return { message: L.noData };
  const today = isoDate(now);
  const idx = snap.days.findIndex((d) => d.date === today);
  const names = [L.today, L.tomorrow, L.after];
  const days = idx < 0 ? [] : snap.days.slice(idx).map((d, i) => ({ label: names[i], cents: d.daily_cents }));
  const bank = data.bank || {};
  let warning = null;
  if (bank.state === "expired") warning = `${L.bank} ${L.expired}`;
  else if (bank.state === "expiring") warning = `${L.bank}: ${bank.days_left} ${L.days}`;
  else if (bank.error) warning = L.fetchFailed;
  return {
    left: snap.budget_left_cents,
    days,
    stale: idx < 0 || snap.month !== today.slice(0, 7),
    next: (snap.next_fixed || []).filter((x) => x.day >= now.getDate()).slice(0, 1)[0] || null,
    asOf: snap.computed_at,
    offline: !!offline,
    warning,
  };
}

// ------------------------------------------------------------------ Laden
async function getKey(interactive) {
  if (Keychain.contains(KEY_NAME)) return Keychain.get(KEY_NAME);
  if (!interactive) return null;
  const a = new Alert();
  a.title = L.askTitle;
  a.message = L.askText;
  a.addSecureTextField("mw_…", "");
  a.addAction(L.save);
  a.addCancelAction(L.cancel);
  if ((await a.present()) < 0) return null;
  const key = a.textFieldValue(0).trim();
  if (!key) return null;
  Keychain.set(KEY_NAME, key);
  return key;
}

function cachePath() {
  const fm = FileManager.local();
  return [fm, fm.joinPath(fm.documentsDirectory(), CACHE_FILE)];
}

async function load(key) {
  const req = new Request(MUENZWERK_URL.replace(/\/$/, "") + "/api/widget/data");
  req.headers = { Authorization: "Bearer " + key };
  req.timeoutInterval = 10;
  const [fm, path] = cachePath();
  try {
    const data = await req.loadJSON();
    const status = req.response ? req.response.statusCode : 200;
    if (status === 401) return { error: "badKey" };
    if (status !== 200) throw new Error("HTTP " + status);
    fm.writeString(path, JSON.stringify(data));
    return { data };
  } catch (e) {
    if (fm.fileExists(path)) return { data: JSON.parse(fm.readString(path)), offline: true };
    return { error: "unreachable" };
  }
}

// ------------------------------------------------------------------ Darstellen
function text(stack, value, size, color, weight) {
  const t = stack.addText(value);
  t.font = weight === "bold" ? Font.boldSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function footer(w, m) {
  w.addSpacer();
  const parts = [];
  if (m.stale) parts.push(L.stale);
  else if (m.asOf) parts.push(`${m.offline ? L.offline + " · " : ""}${L.asOf} ${clock(m.asOf)}`);
  if (parts.length) text(w, parts.join(" · "), 10, m.stale || m.offline ? C.warn : C.muted);
}

function render(m, family) {
  const w = new ListWidget();
  w.url = MUENZWERK_URL;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const accessory = family && family.startsWith("accessory");
  if (!accessory) { w.backgroundColor = C.bg; w.setPadding(14, 14, 12, 14); }

  if (m.message) {
    if (!accessory) text(w, L.title, 12, C.accent, "semibold");
    const t = text(w, m.message, accessory ? 12 : 13, accessory ? Color.white() : C.text);
    t.lineLimit = 4;
    return w;
  }
  const todayCents = m.days.length && !m.stale ? m.days[0].cents : null;

  if (family === "accessoryInline") {
    text(w, todayCents != null ? `${L.today} ${euro(todayCents)}` : `${euro(m.left)}`, 12, Color.white());
    return w;
  }
  if (family === "accessoryRectangular" || family === "accessoryCircular") {
    text(w, L.title, 11, Color.white(), "semibold");
    text(w, euro(m.left), 18, Color.white(), "bold");
    if (todayCents != null) text(w, `${L.today} ${euro(todayCents)}`, 12, Color.white());
    return w;
  }

  text(w, L.title, 12, C.accent, "semibold");
  w.addSpacer(4);
  text(w, L.left, 11, C.muted);
  text(w, euro(m.left), family === "small" ? 24 : 28, m.left >= 0 ? C.pos : C.neg, "bold");

  if (family === "small") {
    if (todayCents != null) text(w, `${L.today} ${euro(todayCents)}`, 13, C.text, "semibold");
  } else if (m.days.length && !m.stale) {
    w.addSpacer(6);
    const row = w.addStack();
    row.layoutHorizontally();
    row.spacing = 14;
    for (const d of m.days) {
      const col = row.addStack();
      col.layoutVertically();
      text(col, d.label, 10, C.muted);
      text(col, euro(d.cents), 15, d.cents >= 0 ? C.text : C.neg, "semibold");
    }
    if (m.next) {
      w.addSpacer(6);
      text(w, `${L.next}: ${m.next.name} −${euro(m.next.amount_cents)} ${L.on} ${m.next.day}.`, 11, C.muted);
    }
  }
  if (m.warning) text(w, m.warning, 10, C.warn, "semibold");
  footer(w, m);
  return w;
}

// ------------------------------------------------------------------ Start
async function run() {
  const inApp = !config.runsInWidget;
  let key = await getKey(inApp);
  let model;
  if (!key) model = { message: L.noKey };
  else {
    const res = await load(key);
    if (res.error === "badKey") {
      model = { message: L.badKey };
      if (inApp) Keychain.remove(KEY_NAME);   // beim nächsten Start neu fragen
    } else if (res.error) model = { message: L.unreachable };
    else model = buildModel(res.data, new Date(), res.offline);
  }
  const family = config.widgetFamily || "medium";
  const widget = render(model, family);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

await run();
