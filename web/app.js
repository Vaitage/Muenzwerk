// Münzwerk – Grundgerüst: Helfer, Zustand, Laden, Toast, Fenster (Sheets), Diagramme, Reiter.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

// Version dieser App-Dateien (gleich wie __version__ in app/__init__.py). Weicht die
// Version des Servers ab, zeigt das Handy noch eine zwischengespeicherte Fassung.
const APP_VERSION = "1.17.0";
const A = window.Analytics;
const { t, tn, ord, locale } = window.I18N;

// ------------------------------------------------------------------ Helfer
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
const euro0 = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmt = (cents) => euro.format(cents / 100 || 0);   // kein "-0,00 €"
const fmt0 = (cents) => euro0.format(Math.round(cents / 100) || 0);
const MONTHS = window.I18N.months;
const monthName = (m) => MONTHS[Number(m.split("-")[1]) - 1];
const monthLabel = (m) => `${monthName(m)} ${m.slice(0, 4)}`;
const shortMonth = (m) => monthName(m).slice(0, 3);
const addMonths = A.addMonths;
const today = new Date();
const thisMonth = A.isoOf(today).slice(0, 7);
const WEEKDAYS = window.I18N.weekdays;
const dayLabel = (iso) => {
  const d = new Date(iso + "T12:00:00");
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (diff === 0) return t("Heute");
  if (diff === 1) return t("Gestern");
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
};
const signed = (cents) => (cents > 0 ? "+" : "") + fmt(cents);

// ------------------------------------------------------------------ Zustand
const state = {
  view: "overview",
  month: thisMonth,
  statsPeriod: "month",
  statsExpTab: "cat",       // Statistik → Ausgaben: "cat" (Kategorien) oder "fixed"
  statsSection: "over",     // Statistik-Abschnitt: "over" (Überblick), "cal" (Kalender), "cats" (Kategorien)
  heatMode: "variable",     // Heatmap: "variable" (nur variable Ausgaben) oder "all"
  heatDay: null,            // in der Heatmap angetippter Tag (YYYY-MM-DD)
  statsMonth: thisMonth,
  statsYear: thisMonth.slice(0, 4),
  settingsKind: "expense",
  settingsPage: null,       // Unterseite von „Einstellungen“ (siehe SETTINGS_PAGES)
  txFilter: "all",          // "all" oder "open" (noch zuzuordnen)
  txQuery: "",              // Suchbegriff in Umsätze
  txRange: "year",          // Zeitraum der Suche: "month", "year", "all"
  accounts: [],
  categories: [],
  transactions: [],
  overrides: {},
  settings: { shift_from_day: 15, large_expense_cents: 25000, review_days: 3, dismissed_hints: [] },
  bank: { state: "none" },
  ctx: null,
};
const catById = (id) => state.categories.find((c) => c.id === id);
// Farbe je Kategorie (CSS-Klassen .hue1–.hue8): nach Symbol, damit Ähnliches gleich aussieht
// (Wohnen blau, Kredit/Versicherung violett, Mobilität orange, Einkauf türkis …); sonst fest nach Kategorie-Nummer.
const HUE_BY_ICON = {
  home: 1, graduation: 1, bank: 7, receipt: 7, car: 2, plane: 2, basket: 3, cup: 3, plug: 4, wrench: 4, laptop: 4, phone: 4,
  utensils: 5, gift: 5, smile: 5, shirt: 5, piggy: 6, coins: 6, wallet: 6, briefcase: 6, trend: 6, undo: 6,
  dumbbell: 6, shield: 7, headphones: 5, tag: 7, sparkle: 7, stethoscope: 8, heart: 8, paw: 8,
};
// Vorschlag für eine offene Zahlung (A.suggestCategory) als Text: Kategorie + Begründung
function suggestionFor(tx) {
  const s = A.suggestCategory(tx, state.ctx);
  const cat = s && catById(s.categoryId);
  if (!cat) return null;
  const why = s.reason === "payee" ? tn(s.count, "wie {n} Zahlung an diesen Empfänger", "wie {n} Zahlungen an diesen Empfänger")
    : s.reason === "similar" ? tn(s.count, "ähnlich wie {n} zugeordnete Zahlung", "ähnlich wie {n} zugeordnete Zahlungen")
    : t("typisch für diese Kategorie");
  return { cat, why };
}
const hueCls = (cat) => (cat ? `hue${HUE_BY_ICON[cat.icon] || ((Number(cat.id) || 0) % 8) + 1}` : "none");
const openCount = () => state.transactions.filter((t) => t.category_id == null).length;

async function loadAll() {
  const [cats, txs, ovs, settings, bank, accounts, undo, server, goals] = await Promise.all([
    API.categories(), API.transactions(), API.overrides(), API.settings(), API.bankStatus(), API.accounts(),
    API.undoStatus ? API.undoStatus() : { count: 0 },
    API.version ? API.version() : null,
    API.goals ? API.goals() : [],
  ]);
  state.goals = goals || [];
  state.undoCount = undo.count;
  state.serverVersion = server?.version || null;
  state.accounts = accounts;
  state.categories = cats;
  state.transactions = txs;
  state.overrides = Object.fromEntries(ovs.map((o) => [o.pattern, o.is_fixed]));
  state.settings = settings;
  state.bank = bank;
  state.ctx = A.createContext({
    transactions: txs, categories: cats, overrides: state.overrides, settings, today,
  });
  state.goalRep = A.goalsReport(state.ctx, state.goals);
  sendWidgetSnapshot();
}

// Zahlen für das iPhone-Widget: dieselben wie in der Übersicht. Der Server
// speichert sie nur, wenn ein Widget-Schlüssel existiert (app/widget.py).
function widgetSnapshot() {
  const r = withGoals(A.monthReport(thisMonth, state.ctx));
  const pending = (state.ctx.byMonth.get(thisMonth) || []).filter((x) => x.pending && x.amount_cents < 0)
    .reduce((s, x) => s - x.amount_cents, 0);
  return {
    month: thisMonth,
    budget_left_cents: Math.round(r.budgetLeft),
    forecast_end_cents: Math.round(r.forecastEnd),
    days_left: r.daysLeftIncl,
    pending_cents: pending,
    days: r.preview.map((p) => ({ date: p.iso, daily_cents: Math.round(p.daily) })),
    next_fixed: [...r.openFixed].sort((a, b) => a.day - b.day).slice(0, 3)
      .map((x) => ({ name: String(x.name).slice(0, 80), amount_cents: Math.abs(Math.round(x.amount_cents)), day: x.day })),
  };
}
function sendWidgetSnapshot() {
  if (!API.widgetSnapshot) return Promise.resolve();   // Vorschau ohne Server
  try { return API.widgetSnapshot(widgetSnapshot()).catch(() => {}); } catch (err) { console.warn(err); return Promise.resolve(); }
}

// ------------------------------------------------------------------ Toast
let toastTimer;
// action: { label, run } zeigt einen Knopf im Hinweis (z. B. "Rückgängig")
function toast(msg, action) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("has-action", !!action);
  if (action) {
    const btn = document.createElement("button");
    btn.textContent = action.label;
    btn.addEventListener("click", () => { el.classList.remove("show"); action.run(); });
    el.append(btn);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), action ? 6000 : 2600);
}

// Letzte Zuordnung zurücknehmen (geht mehrere Schritte zurück)
async function undoLast() {
  try {
    const r = await API.undo();
    toast(r.count > 1 ? t("Rückgängig: {n} Umsätze wie vorher", { n: r.count }) : t("Rückgängig gemacht"));
  } catch (err) { toast(err.message); }
  await reload();
}

// ------------------------------------------------------------------ Sheet
// onBack: wohin "Zurück" führt (Standard: Fenster schließen). In der
// Homescreen-App gibt es keine Zurück-Taste vom Browser.
function openSheet(html, { onBack } = {}) {
  closeSheet(true);
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.innerHTML = `<div class="sheet-top"><button class="sheet-back" data-sheet-back>${icon("chevronLeft")}${t("Zurück")}</button><div class="grabber"></div></div>${html}`;
  scrim.addEventListener("click", () => closeSheet());
  sheet.querySelector("[data-sheet-back]").addEventListener("click", (e) => {
    e.stopPropagation();
    (onBack || closeSheet)();
  });
  document.body.append(scrim, sheet);
  document.documentElement.classList.add("sheet-open");   // Seite dahinter scrollt nicht mit
  requestAnimationFrame(() => { scrim.classList.add("open"); sheet.classList.add("open"); });
  dragToClose(sheet, scrim);
  return sheet;
}

// Am oberen Rand (Griff) nach unten ziehen schließt das Fenster – wie bei nativen Sheets.
// Schnell nach unten wischen reicht auch, wenn der Weg kurz ist.
function dragToClose(sheet, scrim) {
  const handle = $(".sheet-top", sheet);
  let startY = null, lastY = 0, lastT = 0, speed = 0;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;   // "Zurück" bleibt ein normaler Knopf
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    speed = 0;
    sheet.classList.add("dragging");
    scrim.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    const dy = Math.max(0, e.clientY - startY);
    speed = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT);   // px pro ms
    lastY = e.clientY;
    lastT = e.timeStamp;
    sheet.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
  });
  const end = (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    sheet.classList.remove("dragging");
    scrim.classList.remove("dragging");
    scrim.style.opacity = "";
    if (dy > 120 || (dy > 24 && speed > 0.5)) {
      sheet.style.transform = "translateY(100%)";
      closeSheet();
    } else {
      sheet.style.transform = "";
    }
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function closeSheet(instant = false) {
  document.documentElement.classList.remove("sheet-open");
  document.querySelectorAll(".scrim, .sheet").forEach((el) => {
    if (instant) return el.remove();
    el.classList.remove("open");
    setTimeout(() => el.remove(), 320);
  });
}
// variant "accent": normaler Knopf statt rotem (für Bestätigungen, die nichts löschen)
function confirmSheet(title, text, label, onYes, variant = "danger") {
  const sheet = openSheet(`
    <h3>${esc(title)}</h3>
    <div class="meta">${esc(text)}</div>
    <div style="display:flex;gap:8px">
      <button class="btn secondary" data-cancel style="flex:1">${t("Abbrechen")}</button>
      <button class="btn ${variant === "accent" ? "" : "danger"}" data-confirm style="flex:1">${esc(label)}</button>
    </div>`);
  sheet.addEventListener("click", async (ev) => {
    if (ev.target.closest("[data-cancel]")) return closeSheet();
    if (ev.target.closest("[data-confirm]")) { closeSheet(); await onYes(); }
  });
}

// ------------------------------------------------------------------ Diagramme (SVG)
// Kleine, eigene Diagramme: Linie mit Prognose, Balken, Verlauf.
const CH = { w: 340, h: 170, l: 8, r: 8, t: 14, b: 22 };

function niceTicks(min, max) {
  const span = Math.max(1, max - min);
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

function lineChart({ id, xs, series, xLabel, endLabel, yFormat = fmt0 }) {
  // series: [{points:[{x,y}], cls, dashed}]
  const all = series.flatMap((s) => s.points.map((p) => p.y)).concat([0]);
  let min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.12 || 10000;
  min -= pad; max += pad;
  const [x0, x1] = [xs[0], xs[xs.length - 1]];
  const X = (x) => CH.l + ((x - x0) / Math.max(1, x1 - x0)) * (CH.w - CH.l - CH.r);
  const Y = (y) => CH.t + (1 - (y - min) / (max - min)) * (CH.h - CH.t - CH.b);
  const ticks = niceTicks(min, max);
  const grid = ticks.map((v) => `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? "zero" : "grid"}"/>
    <text x="${CH.w - CH.r}" y="${Y(v) - 3}" class="ytick" text-anchor="end">${esc(yFormat(v * 1))}</text>`).join("");
  const xt = xLabel(xs).map(({ x, label }) => `<text x="${X(x)}" y="${CH.h - 6}" class="xtick" text-anchor="middle">${esc(label)}</text>`).join("");
  const paths = series.filter((s) => s.points.length).map((s) => {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    const area = s.area && s.points.length > 1
      ? `<path d="${d}L${X(s.points.at(-1).x)},${Y(0)}L${X(s.points[0].x)},${Y(0)}Z" class="area ${s.cls}"/>` : "";
    return `${area}<path d="${d}" class="line ${s.cls} ${s.dashed ? "dashed" : ""}"/>`;
  }).join("");
  let end = "";
  if (endLabel) {
    const p = endLabel.point;
    end = `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="5" class="enddot ${endLabel.cls}"/>`;
  }
  return `<div class="chart" data-chart="${id}">
    <svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="${esc(endLabel?.aria || t("Verlauf"))}">
      ${grid}${xt}${paths}${end}
      <line class="cross" y1="${CH.t}" y2="${CH.h - CH.b}" x1="0" x2="0" visibility="hidden"/>
      <rect class="hit" x="0" y="0" width="${CH.w}" height="${CH.h}"/>
    </svg><div class="tip" hidden></div></div>`;
}

function barChart({ id, groups, labels }) {
  // groups: [{label, values:[{v, cls}]}]
  const max = Math.max(1, ...groups.flatMap((g) => g.values.map((v) => v.v)));
  const n = groups.length;
  const slot = (CH.w - CH.l - CH.r) / Math.max(1, n);
  const k = groups[0]?.values.length || 1;
  const bw = Math.max(3, Math.min(n <= 3 ? 56 : 14, (slot - 6) / k - 2));
  const Y = (v) => CH.t + (1 - v / max) * (CH.h - CH.t - CH.b);
  const ticks = niceTicks(0, max).filter((v) => v > 0);
  const grid = ticks.map((v) => `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>
    <text x="${CH.w - CH.r}" y="${Y(v) - 3}" class="ytick" text-anchor="end">${esc(fmt0(v))}</text>`).join("");
  const bars = groups.map((g, i) => {
    const cx = CH.l + slot * (i + 0.5);
    const start = cx - (k * bw + (k - 1) * 2) / 2;
    return g.values.map((v, j) => {
      const h = Math.max(0, Y(0) - Y(v.v));
      const x = start + j * (bw + 2);
      const bar = h > 0 ? `<path d="M${x},${Y(0)}v${-(h - Math.min(3, h))}q0,-3 3,-3h${bw - 6}q3,0 3,3v${h - Math.min(3, h)}z" class="bar ${v.cls}"/>` : "";
      // Bei wenigen Balken steht der Betrag direkt darüber.
      const lbl = n <= 3 ? `<text x="${x + bw / 2}" y="${Y(v.v) - 6}" class="vlabel" text-anchor="middle">${esc(fmt0(v.v))}</text>` : "";
      return bar + lbl;
    }).join("") + `<text x="${cx}" y="${CH.h - 6}" class="xtick" text-anchor="middle">${esc(g.label)}</text>`;
  }).join("");
  return `<div class="chart" data-chart="${id}">
    <svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="${esc(labels || t("Balkendiagramm"))}">
      ${grid}<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>${bars}
      <rect class="slot" x="0" y="${CH.t}" width="${slot}" height="${CH.h - CH.t - CH.b}" visibility="hidden"/>
      <rect class="hit" x="0" y="0" width="${CH.w}" height="${CH.h}"/>
    </svg><div class="tip" hidden></div></div>`;
}

// Tippen/Ziehen über einem Diagramm zeigt die Werte an der Stelle.
const chartHandlers = {};
function wireCharts(root) {
  root.querySelectorAll("[data-chart]").forEach((el) => {
    const h = chartHandlers[el.dataset.chart];
    if (!h) return;
    const svg = $("svg", el), tip = $(".tip", el);
    const cross = $(".cross", el), slot = $(".slot", el);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const fx = ((ev.clientX - r.left) / r.width) * CH.w;
      const frac = Math.min(1, Math.max(0, (fx - CH.l) / (CH.w - CH.l - CH.r)));
      const res = h(frac);
      if (!res) return;
      tip.innerHTML = res.html;
      tip.hidden = false;
      const px = CH.l + res.frac * (CH.w - CH.l - CH.r);
      if (cross) { cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible"); }
      if (slot && res.slot) { slot.setAttribute("x", res.slot.x); slot.setAttribute("width", res.slot.w); slot.setAttribute("visibility", "visible"); }
      const left = (px / CH.w) * r.width;
      tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
    };
    const leave = () => {
      tip.hidden = true;
      if (cross) cross.setAttribute("visibility", "hidden");
      if (slot) slot.setAttribute("visibility", "hidden");
    };
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", leave);
  });
}

// ------------------------------------------------------------------ Grundgerüst
const TABS = [
  { id: "overview", label: t("Übersicht"), icon: "pie", title: t("Übersicht") },
  { id: "transactions", label: t("Umsätze"), icon: "list", title: t("Umsätze") },
  { id: "stats", label: t("Statistik"), icon: "chart", title: t("Statistik") },
  { id: "wealth", label: t("Vermögen"), icon: "piggy", title: t("Vermögen") },
  { id: "settings", label: t("Einstellungen"), icon: "settings", title: t("Einstellungen") },
];

function renderTabbar() {
  const open = openCount();
  $("#tabbar").innerHTML = `<div class="tabbar-inner">${TABS.map((t) => `
    <button class="tab" data-tab="${t.id}" ${state.view === t.id ? 'aria-current="page"' : ""}>
      ${icon(t.icon)}<span>${t.label}</span>
      ${t.id === "transactions" && open ? `<span class="badge" aria-hidden="true">${open > 9 ? "9+" : open}</span><span class="sr-only">${tn(open, "{n} offen", "{n} offen")}</span>` : ""}
    </button>`).join("")}</div>`;
}

function renderTop() {
  const tab = TABS.find((t) => t.id === state.view);
  const withMonth = state.view === "overview" || (state.view === "transactions" && state.txFilter === "all" && !state.txQuery.trim());
  const sub = state.view === "settings" && SETTINGS_PAGES[state.settingsPage];
  $("#top").innerHTML = `
    ${sub ? `<button class="top-back" data-settings-page="">${icon("chevronLeft")}${tab.label}</button>` : ""}
    <h1>${sub ? sub() : tab.title}</h1>
    ${withMonth ? `
      <div class="month-switch">
        <button class="icon-btn" data-month="-1" aria-label="${t("Vormonat")}" ${state.month <= state.ctx.firstMonth ? "disabled" : ""}>${icon("chevronLeft")}</button>
        <div class="label">${monthLabel(state.month)}</div>
        <button class="icon-btn" data-month="1" aria-label="${t("Folgemonat")}" ${state.month >= addMonths(thisMonth, 1) ? "disabled" : ""}>${icon("chevronRight")}</button>
      </div>` : ""}`;
}

// Große Beträge zählen kurz hoch, wenn sie zum ersten Mal oder mit neuem Wert erscheinen
// (nicht bei jedem Neuzeichnen, nicht bei „Bewegung reduzieren“). Text bleibt immer der Endwert,
// Bildschirmleser lesen nur den.
const countShown = new Map();
function countUp(root) {
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  for (const el of root.querySelectorAll("[data-count]")) {
    const to = Number(el.dataset.count), key = el.dataset.countKey;
    const from = countShown.has(key) ? countShown.get(key) : 0;
    countShown.set(key, to);
    if (calm || from === to || !Number.isFinite(to)) continue;
    const final = el.textContent;
    el.setAttribute("aria-label", final);
    const start = performance.now(), dur = 650;
    const step = (now) => {
      if (!el.isConnected) return;
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);              // schnell los, sanft aus
      el.textContent = p < 1 ? fmt(Math.round(from + (to - from) * e)) : final;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function render() {
  renderTop();
  renderTabbar();
  const main = $("#main");
  main.removeAttribute("aria-busy");
  Object.keys(chartHandlers).forEach((k) => delete chartHandlers[k]);
  try {
    main.innerHTML = {
      overview: viewOverview, transactions: viewTransactions, stats: viewStats, wealth: viewWealth, settings: viewSettings,
    }[state.view]();
    wireCharts(main);
    countUp(main);
    if (syncRunning) setSyncButtons(true);   // Knopf bleibt im Lade-Zustand
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="empty">${t("Konnte nicht anzeigen: {msg}", { msg: esc(err.message) })}</div>`;
  }
}

async function reload() {
  await loadAll();
  render();
}

// Leerer Bereich: was hier erscheint und wie es sich füllt (optional mit Knopf)
function emptyState(ic, title, text, action) {
  return `<div class="empty-state">${icon(ic)}<b>${esc(title)}</b><span>${esc(text)}</span>
    ${action ? `<button class="btn secondary" data-action="${action.action}">${esc(action.label)}</button>` : ""}</div>`;
}

function noticeHtml(ic, title, text, action, cls = "") {
  return `<button class="notice ${cls}" data-action="${action}">${icon(ic)}<div><b>${esc(title)}</b><span>${esc(text)}</span></div></button>`;
}

function bankNotices() {
  const b = state.bank;
  if (b.state === "none" && b.setup) return noticeHtml("bank", t("Bank noch nicht eingerichtet"), t("Tippe hier – ein Assistent führt dich durch."), "setup", "warn");
  if (b.state === "none") return noticeHtml("bank", t("Bank noch nicht verbunden"), t("Tippe hier, um dein Konto zu verknüpfen."), "goto-settings", "warn");
  if (b.state === "expired") return noticeHtml("bank", t("Bankfreigabe abgelaufen"), t("Einmal bei der Bank bestätigen, dann geht's weiter."), "connect", "warn");
  const problem = syncProblem(b);
  let html = "";
  // Abruf fehlgeschlagen: sichtbar, mit Grund in Klartext; Antippen versucht es nochmal
  if (problem) html += noticeHtml("refresh", t("Neue Umsätze konnten nicht geladen werden"), `${problem} ${t("Tippen, um es nochmal zu versuchen.")}`, "sync", "fail");
  if (b.state === "expiring") html += noticeHtml("bank", tn(b.days_left, "Bankfreigabe läuft in {n} Tag ab", "Bankfreigabe läuft in {n} Tagen ab"), t("Jetzt kurz erneuern, damit nichts fehlt."), "connect", "warn");
  return html;
}

// Grund für einen fehlgeschlagenen Abruf in Klartext (null = letzter Abruf hat geklappt).
// Der technische Text der Bank steht weiter unter „Einstellungen → Bank“.
function syncProblem(b) {
  const err = String(b.last_error || "");
  if (!err || err.startsWith("Kontostände") || b.state === "none" || b.state === "expired") return null;
  if (/ASPSP_RATE_LIMIT|\b429\b|rate limit/i.test(err)) return t("Die Bank lässt heute keine weiteren Abrufe zu (Tageslimit). In ein paar Stunden klappt es wieder.");
  if (/\b5\d\d\b|\b400\b|timeout|timed out|connect|network|ASPSP_ERROR|unavailable/i.test(err)) return t("Die Bank ist gerade nicht erreichbar.");
  return t("Der letzte Abruf hat nicht geklappt.");
}

// „Stand 08:42 · ING“ unter der Kernzahl; älter als 12 Stunden in Warnfarbe
function standHtml(r) {
  const b = state.bank;
  if (!b.last_sync || b.state === "none") return "";
  const at = new Date(b.last_sync);
  const sameDay = at.toDateString() === new Date().toDateString();
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const when = sameDay ? time : `${at.toLocaleDateString(locale, { day: "numeric", month: "short" })}, ${time}`;
  const old = Date.now() - at.getTime() > 12 * 3600 * 1000;
  const bank = b.provider === "demo" ? t("Demo-Bank") : b.bank_name || "";
  let html = `<div class="stand ${old ? "alt" : ""}">${icon("refresh")}<span>${t("Stand {when}", { when })}${bank ? ` · ${esc(bank)}` : ""}</span></div>`;
  // Liefert die Bank keine Vormerkungen, fehlen Kartenzahlungen, bis sie gebucht sind
  const f = b.last_fetch;
  if (r.status === "current" && f && !f.pending && f.newest) {
    const noon = new Date(today); noon.setHours(12, 0, 0, 0);
    const days = Math.round((noon - new Date(f.newest + "T12:00:00")) / 86400000);
    if (days >= 2) html += `<div class="stand">${icon("help")}<span>${t("Kartenzahlungen der letzten Tage fehlen evtl. noch – die Bank meldet sie erst, wenn sie gebucht sind.")}</span></div>`;
  }
  return html;
}
