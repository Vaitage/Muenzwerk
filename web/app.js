(() => {
  "use strict";
  // Version dieser App-Dateien (gleich wie __version__ in app/__init__.py). Weicht die
  // Version des Servers ab, zeigt das Handy noch eine zwischengespeicherte Fassung.
  const APP_VERSION = "1.2.1";
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
    statsMonth: thisMonth,
    statsYear: thisMonth.slice(0, 4),
    settingsKind: "expense",
    settingsPage: null,       // Unterseite von „Mehr“ (siehe SETTINGS_PAGES)
    txFilter: "all",          // "all" oder "open" (noch zuzuordnen)
    txQuery: "",              // Suchbegriff in Umsätze
    txRange: "year",          // Zeitraum der Suche: "month", "year", "all"
    accounts: [],
    categories: [],
    transactions: [],
    overrides: {},
    settings: { shift_from_day: 15, large_expense_cents: 25000 },
    bank: { state: "none" },
    ctx: null,
  };
  const catById = (id) => state.categories.find((c) => c.id === id);
  const openCount = () => state.transactions.filter((t) => t.category_id == null).length;

  async function loadAll() {
    const [cats, txs, ovs, settings, bank, accounts, undo, server] = await Promise.all([
      API.categories(), API.transactions(), API.overrides(), API.settings(), API.bankStatus(), API.accounts(),
      API.undoStatus ? API.undoStatus() : { count: 0 },
      API.version ? API.version() : null,
    ]);
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
    { id: "settings", label: t("Mehr"), icon: "settings", title: t("Einstellungen") },
  ];

  function renderTabbar() {
    const open = openCount();
    $("#tabbar").innerHTML = `<div class="tabbar-inner">${TABS.map((t) => `
      <button class="tab" data-tab="${t.id}" ${state.view === t.id ? 'aria-current="page"' : ""}>
        ${icon(t.icon)}<span>${t.label}</span>
        ${t.id === "transactions" && open ? `<span class="badge">${open}</span>` : ""}
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

  function render() {
    renderTop();
    renderTabbar();
    const main = $("#main");
    Object.keys(chartHandlers).forEach((k) => delete chartHandlers[k]);
    try {
      main.innerHTML = {
        overview: viewOverview, transactions: viewTransactions, stats: viewStats, wealth: viewWealth, settings: viewSettings,
      }[state.view]();
      wireCharts(main);
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

  function noticeHtml(ic, title, text, action, cls = "") {
    return `<button class="notice ${cls}" data-action="${action}">${icon(ic)}<div><b>${esc(title)}</b><span>${esc(text)}</span></div></button>`;
  }

  function bankNotices() {
    const b = state.bank;
    if (b.state === "none" && b.setup) return noticeHtml("bank", t("Bank noch nicht eingerichtet"), t("Tippe hier für die nächsten Schritte."), "goto-settings", "warn");
    if (b.state === "none") return noticeHtml("bank", t("Bank noch nicht verbunden"), t("Tippe hier, um dein Konto zu verknüpfen."), "goto-settings", "warn");
    if (b.state === "expired") return noticeHtml("bank", t("Bankfreigabe abgelaufen"), t("Einmal bei der Bank bestätigen, dann geht's weiter."), "connect", "warn");
    if (b.state === "expiring") return noticeHtml("bank", tn(b.days_left, "Bankfreigabe läuft in {n} Tag ab", "Bankfreigabe läuft in {n} Tagen ab"), t("Jetzt kurz erneuern, damit nichts fehlt."), "connect", "warn");
    return "";
  }

  // ------------------------------------------------------------------ Übersicht
  function viewOverview() {
    const r = A.monthReport(state.month, state.ctx);
    const T = r.totals;
    const open = openCount();
    let html = bankNotices();
    if (open) html += noticeHtml("inbox", tn(open, "{n} Zahlung wartet auf eine Kategorie", "{n} Zahlungen warten auf eine Kategorie"), t("Einmal zuordnen – ähnliche erkennt die App dann selbst."), "goto-inbox");

    // Übrig im Monat, darunter Tagesbudget mit 3-Tage-Vorschau
    const heroLabel = r.status === "past" ? t("Übrig am Ende vom {month}", { month: monthName(r.month) }) : r.status === "future" ? t("Geplant übrig im {month}", { month: monthName(r.month) }) : t("Übrig bis Monatsende");
    const heroNotes = [];
    if (r.openFixedTotal) heroNotes.push(t("{amount} offene Fixkosten schon abgezogen", { amount: fmt(r.openFixedTotal) }));
    if (T.savings) heroNotes.push(t(T.savings > 0 ? "{amount} zur Seite gelegt" : "{amount} vom Sparkonto geholt", { amount: fmt(Math.abs(T.savings)) }));
    const pendingSum = (state.ctx.byMonth.get(r.month) || []).filter((x) => x.pending && x.amount_cents < 0).reduce((s, x) => s - x.amount_cents, 0);
    if (pendingSum) heroNotes.push(t("inkl. {amount} vorgemerkt", { amount: fmt(pendingSum) }));
    const showDays = r.status === "current" && r.preview.length;
    html += `<section class="card hero">
      <div class="sub">${heroLabel}</div>
      <div class="big ${r.budgetLeft >= 0 ? "pos" : "neg"}">${fmt(r.budgetLeft)}</div>
      ${heroNotes.map((n) => `<div class="sub">${n}</div>`).join("")}
      ${showDays ? `
        <div class="days-head"><span>${t("Pro Tag verfügbar")}</span><span>${tn(r.daysLeftIncl, "noch {n} Tag", "noch {n} Tage")}</span></div>
        <div class="days3">
          ${r.preview.map((p, i) => {
            const d = new Date(p.iso + "T12:00:00");
            const name = [t("Heute"), t("Morgen"), t("Übermorgen")][i];
            return `<div class="day3 ${i === 0 ? "now" : ""}">
              <div class="k">${name}<span>${WEEKDAYS[d.getDay()]} ${ord(d.getDate())}</span></div>
              <div class="v ${p.daily >= 0 ? "" : "neg"}">${i === 0 ? fmt(p.daily) : fmt0(p.daily)}</div>
              ${p.due.map((x) => `<div class="due">${esc(x.name)} −${fmt0(x.amount_cents)}</div>`).join("")}
              ${p.incoming.map((x) => `<div class="due in">${esc(x.name)} +${fmt0(x.amount_cents)}</div>`).join("")}
            </div>`;
          }).join("")}
        </div>
        <p class="note">${t("Wenn du weiter ausgibst wie bisher, etwa {amount} am Tag für Variables.", { amount: fmt0(r.pace) })}</p>` : ""}
    </section>`;

    // Prognose bis Monatsende
    const actual = r.series.actual.map((p) => ({ x: p.day, y: p.value }));
    const fc = r.series.forecast.map((p) => ({ x: p.day, y: p.value }));
    const xs = Array.from({ length: r.days }, (_, i) => i + 1);
    const endPoint = fc.length ? fc.at(-1) : actual.at(-1);
    chartHandlers.month = (frac) => {
      const day = Math.round(1 + frac * (r.days - 1));
      const a = actual.find((p) => p.x === day);
      const f = fc.find((p) => p.x === day);
      const p = a || f;
      if (!p) return null;
      return {
        frac: (day - 1) / Math.max(1, r.days - 1),
        html: `<b>${t("{day} {month}", { day: ord(day), month: shortMonth(r.month) })}</b><br>${a ? t("Stand") : t("Prognose")}: ${fmt(p.y)}`,
      };
    };
    html += `<section class="card">
      <h2>${r.status === "past" ? t("Verlauf im Monat") : t("Prognose Monatsende")}</h2>
      <div class="kpi"><span class="big2 ${r.forecastEnd >= 0 ? "pos" : "neg"}">${fmt(r.forecastEnd)}</span>
        <span class="sub">${r.status === "past" ? t("am Monatsende auf dem Konto geblieben") : t("bleiben voraussichtlich übrig")}</span></div>
      ${endPoint ? lineChart({
        id: "month",
        xs,
        series: [{ points: actual, cls: "s-main", area: true }, { points: fc, cls: "s-main", dashed: true }],
        xLabel: (x) => [1, 10, 20, r.days].map((d) => ({ x: d, label: ord(d) })),
        endLabel: { point: endPoint, cls: "s-main", aria: `${t("Prognose")} ${fmt(r.forecastEnd)}` },
      }) : ""}
      ${r.status !== "past" ? `<div class="legend"><span><i class="sw solid"></i>${t("bisher")}</span><span><i class="sw dash"></i>${t("Prognose")}</span></div>` : ""}
    </section>`;

    // Aufstellung
    const row = (label, cents, cls = "", sub = false) =>
      `<div class="line-row ${sub ? "sub-row" : ""}"><span>${label}</span><span class="${cls}">${fmt(cents)}</span></div>`;
    html += `<section class="card">
      <h2>${t("Aufstellung")}</h2>
      <div class="group">
        ${row(`${icon("wallet", "ic-s")} ${t("Einkommen")}`, T.income, "pos")}
        ${row(t("Regelmäßig"), T.income_regular, "pos-soft", true)}
        ${row(t("Variabel"), T.income_variable, "pos-soft", true)}
      </div>
      <div class="group">
        ${row(`${icon("basket", "ic-s")} ${t("Ausgaben")}`, -T.expense, "neg")}
        ${row(t("Fixkosten"), -T.fixed, "neg-soft", true)}
        ${row(t("Variable Ausgaben"), -T.variable, "neg-soft", true)}
        ${row(`${t("Große Ausgaben")} <small>${t("ab {amount}", { amount: fmt0(state.settings.large_expense_cents) })}</small>`, -T.large, "neg-soft", true)}
      </div>
      <div class="group">${row(`${icon("piggy", "ic-s")} ${t("Ersparnisse")}`, T.savings)}</div>
      ${r.openFixed.length ? `<div class="group">
        ${row(`${icon("calendar", "ic-s")} ${t("Noch offene Fixkosten")}`, -r.openFixedTotal, "neg")}
        ${r.openFixed.map((x) => row(`${esc(x.name)} <small>${x.overdue ? t("überfällig") : t("um den {day}", { day: ord(x.day) })}</small>`, -x.amount_cents, "neg-soft", true)).join("")}
      </div>` : ""}
      ${r.expectedIncome.length ? `<div class="group">
        ${row(`${icon("trend", "ic-s")} ${t("Erwartete Einnahmen")}`, r.expectedIncomeTotal, "pos")}
        ${r.expectedIncome.map((x) => row(`${esc(x.name)} <small>${t("um den {day}", { day: ord(x.day) })}</small>`, x.amount_cents, "", true)).join("")}
      </div>` : ""}
      <div class="group total">${row(t("Überschuss"), T.surplus, T.surplus >= 0 ? "pos" : "neg")}</div>
    </section>`;

    html += categoryCard(r.byCategory, T.expense, t("Ausgaben nach Kategorie"));
    return html;
  }

  // scope: aus welchem Zeitraum die Liste beim Antippen kommt ("stats" oder "overview")
  function categoryCard(list, total, title, { scope = "overview", head = "" } = {}) {
    const max = Math.max(1, ...list.map((c) => c.total));
    return `<section class="card">
      <h2>${title}</h2>${head}
      ${list.length ? list.map((c) => `
        <button class="catrow" data-statcat="${c.id ?? "none"}" data-scope="${scope}">
          <div class="bubble ${c.id ? "" : "none"}">${icon(c.icon)}</div>
          <div class="name"><div>${esc(c.name)} <small class="hint">${c.count}×</small></div><div class="bar"><i style="width:${(c.total / max) * 100}%"></i></div></div>
          <div class="amt">${fmt(c.total)}<small>${Math.round((c.total / Math.max(1, total)) * 100)} %</small></div>
        </button>`).join("") : `<div class="hint">${t("Keine Ausgaben in diesem Zeitraum.")}</div>`}
    </section>`;
  }

  // Umsätze des Zeitraums, der gerade in der Statistik gewählt ist (nach "zählt für")
  function statsPeriodList() {
    const p = state.statsPeriod;
    const keep = p === "month" ? (m) => m === state.statsMonth : p === "year" ? (m) => m.startsWith(state.statsYear) : () => true;
    return [...state.ctx.byMonth].filter(([m]) => keep(m)).flatMap(([, list]) => list);
  }
  function statsPeriodLabel() {
    const p = state.statsPeriod;
    return p === "month" ? monthLabel(state.statsMonth) : p === "year" ? state.statsYear : t("Gesamter Zeitraum");
  }
  const scopeList = (scope) => (scope === "stats" ? statsPeriodList() : state.ctx.byMonth.get(state.month) || []);
  const scopeLabel = (scope) => (scope === "stats" ? statsPeriodLabel() : monthLabel(state.month));

  // Fixkosten des Zeitraums, je Empfänger zusammengefasst
  function fixedGroups(list) {
    const groups = new Map();
    for (const t of list) {
      if (t.amount_cents >= 0 || state.ctx.classOf(t) !== "fixed") continue;
      const k = A.recurringKey(t);
      if (!groups.has(k)) groups.set(k, { key: k, name: t.counterparty || I18N.t("Unbekannt"), total: 0, count: 0, cat: catById(t.category_id) });
      const g = groups.get(k);
      g.total += -t.amount_cents;
      g.count++;
    }
    return [...groups.values()].sort((a, b) => b.total - a.total);
  }

  function expenseCard(s, T) {
    const tab = state.statsExpTab;
    const head = `<div class="seg" role="group" aria-label="${t("Ausgaben aufteilen")}">
        <button data-exptab="cat" aria-pressed="${tab === "cat"}">${t("Kategorien")}</button>
        <button data-exptab="fixed" aria-pressed="${tab === "fixed"}">${t("Fixkosten")}</button>
      </div>`;
    if (tab !== "fixed") return categoryCard(s.byCategory, T.expense, t("Ausgaben"), { scope: "stats", head });
    const groups = fixedGroups(statsPeriodList());
    const max = Math.max(1, ...groups.map((g) => g.total));
    return `<section class="card">
      <h2>${t("Ausgaben")}</h2>${head}
      <div class="line-row"><span>${t("Fixkosten gesamt")}</span><span class="neg">${fmt(-T.fixed)}</span></div>
      ${groups.length ? groups.map((g) => `
        <button class="catrow" data-statfix="${esc(g.key)}">
          <div class="bubble">${icon(g.cat?.icon || "receipt")}</div>
          <div class="name"><div>${esc(g.name)} <small class="hint">${g.count}×</small></div><div class="bar"><i style="width:${(g.total / max) * 100}%"></i></div></div>
          <div class="amt">${fmt(g.total)}<small>${Math.round((g.total / Math.max(1, T.expense)) * 100)} %</small></div>
        </button>`).join("") : `<div class="hint">${t("Keine Fixkosten in diesem Zeitraum. Welche Zahlungen als Fixkosten zählen, stellst du unter Mehr → Fixkosten ein.")}</div>`}
    </section>`;
  }

  // Liste von Umsätzen in einem Fenster; Antippen öffnet den Umsatz, "Zurück" kommt hierher zurück
  function openTxListSheet(title, sub, list, reopen) {
    const sorted = sortTx(list);
    const total = sorted.reduce((sum, t) => sum + t.amount_cents, 0);
    const sheet = openSheet(`
      <h3>${esc(title)}</h3>
      <div class="meta">${esc(sub)} · ${tn(sorted.length, "{n} Umsatz", "{n} Umsätze")} · ${signed(total)}</div>
      ${sorted.length ? groupedList(sorted) : `<div class="hint">${t("Keine Umsätze.")}</div>`}`);
    sheet.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tx]");
      if (!b) return;
      const t = state.transactions.find((x) => String(x.id) === b.dataset.tx);
      if (t) openTxSheet(t, reopen);
    });
  }

  function openCategoryList(catId, scope) {
    const id = catId === "none" ? null : Number(catId);
    const list = scopeList(scope).filter((t) => t.amount_cents < 0 && !state.ctx.isSavings(t) && (t.category_id ?? null) === id);
    const name = id == null ? t("Nicht zugeordnet") : catById(id)?.name || t("Kategorie");
    openTxListSheet(name, scopeLabel(scope), list, () => openCategoryList(catId, scope));
  }

  function openFixedList(key) {
    const list = statsPeriodList().filter((t) => t.amount_cents < 0 && state.ctx.classOf(t) === "fixed" && A.recurringKey(t) === key);
    openTxListSheet(list[0]?.counterparty || t("Fixkosten"), `${t("Fixkosten")} · ${statsPeriodLabel()}`, list, () => openFixedList(key));
  }

  // ------------------------------------------------------------------ Umsätze
  function txRow(tx) {
    const cat = tx.category_id ? catById(tx.category_id) : null;
    const cls = state.ctx.classOf(tx);
    const chips = [];
    if (tx.pending) chips.push(`<span class="chip muted">${t("vorgemerkt")}</span>`);
    if (!cat) chips.push(`<span class="chip warn">${t("offen")}</span>`);
    if (cls === "fixed") chips.push(`<span class="chip">${t("fix")}</span>`);
    if (cls === "large") chips.push(`<span class="chip">${t("groß")}</span>`);
    if (tx.budget_month !== tx.booking_date.slice(0, 7)) chips.push(`<span class="chip">${t("zählt für {month}", { month: shortMonth(tx.budget_month) })}</span>`);
    return `
      <button class="tx ${tx.pending ? "pending" : ""}" data-tx="${esc(tx.id)}">
        <div class="bubble ${cat ? "" : "none"}">${icon(cat ? cat.icon : "help")}</div>
        <div class="mid">
          <div class="who">${esc(tx.counterparty || t("Unbekannt"))}</div>
          <div class="what">${esc(cat ? cat.name : t("Nicht zugeordnet"))}${chips.join("")}</div>
        </div>
        <div class="amt ${tx.amount_cents > 0 ? "pos" : ""}">${signed(tx.amount_cents)}</div>
      </button>`;
  }

  function groupedList(list) {
    const groups = new Map();
    for (const t of list) {
      if (!groups.has(t.booking_date)) groups.set(t.booking_date, []);
      groups.get(t.booking_date).push(t);
    }
    return [...groups].map(([d, items]) => `
      <div class="day">${dayLabel(d)}</div>
      <div class="list">${items.map(txRow).join("")}</div>`).join("");
  }

  const sortTx = (list) => [...list].sort((a, b) => b.booking_date.localeCompare(a.booking_date) || String(b.id).localeCompare(String(a.id)));

  function viewTransactions() {
    return `
      <div class="search">
        ${icon("search")}
        <input type="search" id="tx-search" value="${esc(state.txQuery)}" placeholder="${t("Suchen, z. B. Amazon oder 39,95")}" autocomplete="off" autocorrect="off" autocapitalize="none" enterkeyhint="search" aria-label="${t("Umsätze durchsuchen")}">
        ${state.txQuery ? `<button class="search-clear" data-action="clear-search" aria-label="${t("Suche leeren")}">✕</button>` : ""}
      </div>
      <div id="tx-body">${txBody()}</div>`;
  }

  const RANGE_LABEL = { month: t("diesen Monat"), year: t("dieses Jahr"), all: t("insgesamt") };

  function txBody() {
    if (state.txQuery.trim()) {
      const r = A.searchTransactions(state.ctx, state.txQuery, state.txRange);
      const seg = `<div class="seg" role="group" aria-label="${t("Zeitraum der Suche")}">
        <button data-srange="month" aria-pressed="${state.txRange === "month"}">${t("Monat")}</button>
        <button data-srange="year" aria-pressed="${state.txRange === "year"}">${t("Jahr")}</button>
        <button data-srange="all" aria-pressed="${state.txRange === "all"}">${t("Alles")}</button>
      </div>`;
      if (!r || !r.count) return seg + `<div class="empty">${t("Keine Umsätze zu „{q}“ {range}.", { q: esc(state.txQuery.trim()), range: RANGE_LABEL[state.txRange] })}</div>`;
      return seg + `<section class="card search-sum">
          <div class="sub">${t("„{q}“ {range}", { q: esc(state.txQuery.trim()), range: RANGE_LABEL[state.txRange] })}</div>
          ${r.expense ? `<div class="big2 neg">${fmt(r.expense)}</div><div class="sub">${tn(r.count, "ausgegeben in {n} Buchung", "ausgegeben in {n} Buchungen")}${r.months > 1 ? ` · ${t("Ø {amount} pro Monat", { amount: fmt0(r.perMonth) })}` : ""}</div>`
            : `<div class="sub">${tn(r.count, "{n} Buchung", "{n} Buchungen")}</div>`}
          ${r.income ? `<div class="line-row"><span>${t("Eingenommen")}</span><span class="pos">${fmt(r.income)}</span></div>` : ""}
          ${r.saved ? `<div class="line-row"><span>${t("Gespart")}</span><span>${fmt(r.saved)}</span></div>` : ""}
        </section>${groupedList(r.list)}`;
    }
    const open = openCount();
    const seg = `<div class="seg" role="group" aria-label="${t("Filter")}">
        <button data-txfilter="all" aria-pressed="${state.txFilter === "all"}">${t("Alle")}</button>
        <button data-txfilter="open" aria-pressed="${state.txFilter === "open"}">${t("Zuordnen")}${open ? ` (${open})` : ""}</button>
      </div>${state.undoCount ? `
      <div class="undo-row"><button class="btn secondary" data-action="undo">${icon("undo")} ${t("Rückgängig")}${state.undoCount > 1 ? ` (${state.undoCount})` : ""}</button></div>` : ""}`;
    if (state.txFilter === "open") {
      const list = sortTx(state.transactions.filter((x) => x.category_id == null));
      if (!list.length) {
        return seg + `<div class="empty">${icon("check")}<div><b>${t("Alles zugeordnet")}</b></div><div>${t("Neue unbekannte Zahlungen tauchen hier auf.")}</div></div>`;
      }
      return seg + `<p class="lead">${t("Diese Zahlungen konnte die App nicht selbst einsortieren. Tippe eine an und wähle die Kategorie.")}</p>${groupedList(list)}`;
    }
    const list = sortTx(state.transactions.filter((x) => x.budget_month === state.month));
    if (!list.length) return seg + `<div class="empty">${t("Keine Umsätze in diesem Monat.")}</div>`;
    return seg + groupedList(list);
  }

  // ------------------------------------------------------------------ Statistik
  function viewStats() {
    const ctx = state.ctx;
    const p = state.statsPeriod;
    const value = p === "month" ? state.statsMonth : p === "year" ? state.statsYear : "all";
    const s = A.stats(p, value, ctx);
    const T = s.totals;
    const label = p === "month" ? monthLabel(value) : p === "year" ? value : `${monthLabel(ctx.firstMonth)} – ${monthLabel(ctx.lastMonth)}`;
    const canPrev = p === "month" ? value > ctx.firstMonth : p === "year" ? value > ctx.firstMonth.slice(0, 4) : false;
    const canNext = p === "month" ? value < ctx.lastMonth : p === "year" ? value < ctx.lastMonth.slice(0, 4) : false;

    let html = `
      <div class="seg" role="group" aria-label="${t("Zeitraum")}">
        <button data-period="month" aria-pressed="${p === "month"}">${t("Monat")}</button>
        <button data-period="year" aria-pressed="${p === "year"}">${t("Jahr")}</button>
        <button data-period="all" aria-pressed="${p === "all"}">${t("Alles")}</button>
      </div>
      ${p !== "all" ? `<div class="month-switch center">
        <button class="icon-btn" data-snav="-1" aria-label="${t("zurück")}" ${canPrev ? "" : "disabled"}>${icon("chevronLeft")}</button>
        <div class="label">${esc(label)}</div>
        <button class="icon-btn" data-snav="1" aria-label="${t("vor")}" ${canNext ? "" : "disabled"}>${icon("chevronRight")}</button>
      </div>` : `<div class="period-label">${esc(label)}</div>`}`;

    // Kennzahlen mit Vergleich
    // Jahre werden über den Monatsschnitt verglichen (das erste Jahr ist oft unvollständig).
    const cmp = (curTotal, prevTotal, goodUp) => {
      if (!s.previous || !prevTotal) return "";
      const cur = p === "year" ? curTotal / Math.max(1, s.monthsWithData) : curTotal;
      const prev = p === "year" ? prevTotal / Math.max(1, s.previousMonths) : prevTotal;
      const diff = cur - prev;
      if (Math.abs(diff) < 100) return `<span class="delta">${t("wie davor")}</span>`;
      const good = goodUp ? diff > 0 : diff < 0;
      const pct = Math.round((Math.abs(diff) / Math.abs(prev)) * 100);
      return `<span class="delta ${good ? "good" : "bad"}">${diff > 0 ? "▲" : "▼"} ${pct} % ${p === "month" ? t("zum Vormonat") : t("Monatsschnitt zum Vorjahr")}</span>`;
    };
    const P = s.previous || {};
    const kpi = (ic, name, cents, prev, goodUp, cls = "") => `
      <div class="kpi-row">
        <div class="bubble">${icon(ic)}</div>
        <div class="grow"><div>${name}</div>${cmp(cents, prev, goodUp)}${p !== "month" && s.monthsWithData > 1 ? `<div class="hint">${t("Ø {amount} pro Monat", { amount: fmt0(cents / s.monthsWithData) })}</div>` : ""}</div>
        <div class="val ${cls}">${fmt(cents)}</div>
      </div>`;
    html += `<section class="card">
      ${kpi("wallet", t("Einkommen"), T.income, P.income, true, "pos")}
      ${kpi("basket", t("Ausgaben"), T.expense, P.expense, false, "neg")}
      ${kpi("piggy", t("Ersparnisse"), T.savings, P.savings, true)}
      ${kpi("trend", t("Überschuss"), T.surplus, P.surplus, true, T.surplus >= 0 ? "pos" : "neg")}
    </section>`;

    // Balken: Einnahmen und Ausgaben je Woche, Monat bzw. Jahr
    {
      const groups = p === "month"
        ? [{ label: monthLabel(value), title: monthLabel(value), income: T.income, expense: T.expense, surplus: T.surplus }]
        : p === "year"
        ? s.months.map((m) => ({ label: MONTHS[Number(m.month.slice(5)) - 1].slice(0, 1), title: monthLabel(m.month), income: m.income, expense: m.expense, surplus: m.surplus }))
        : s.years.map((y) => ({ label: y.year, title: y.year, income: y.income, expense: y.expense, surplus: y.surplus }));
      chartHandlers.bars = (frac) => {
        const i = Math.min(groups.length - 1, Math.floor(frac * groups.length));
        const g = groups[i];
        if (!g) return null;
        const w = (CH.w - CH.l - CH.r) / groups.length;
        return {
          frac: (i + 0.5) / groups.length,
          slot: { x: CH.l + i * w, w },
          html: `<b>${esc(g.title)}</b><br><i class="sw in"></i>${t("Einnahmen")} ${fmt0(g.income)}<br><i class="sw out"></i>${t("Ausgaben")} ${fmt0(g.expense)}<br>${t("Überschuss")} ${fmt0(g.surplus)}`,
        };
      };
      html += `<section class="card">
        <h2>${p === "month" ? t("Einnahmen und Ausgaben") : p === "year" ? t("Einnahmen und Ausgaben je Monat") : t("Einnahmen und Ausgaben je Jahr")}</h2>
        ${barChart({ id: "bars", groups: groups.map((g) => ({ label: g.label, values: [{ v: g.income, cls: "s-in" }, { v: g.expense, cls: "s-out" }] })), labels: t("Einnahmen und Ausgaben") })}
        <div class="legend"><span><i class="sw in"></i>${t("Einnahmen")}</span><span><i class="sw out"></i>${t("Ausgaben")}</span></div>
      </section>`;
    }

    // Aufschlüsselung
    const row = (label, cents, sub = false, cls = "") => `<div class="line-row ${sub ? "sub-row" : ""}"><span>${label}</span><span class="${cls}">${fmt(cents)}</span></div>`;
    html += `<section class="card">
      <h2>${t("Aufschlüsselung")}</h2>
      <div class="group">${row(t("Einkommen"), T.income, false, "pos")}${row(t("Regelmäßig"), T.income_regular, true, "pos-soft")}${row(t("Variabel"), T.income_variable, true, "pos-soft")}</div>
      <div class="group">${row(t("Ausgaben"), -T.expense, false, "neg")}${row(t("Fixkosten"), -T.fixed, true, "neg-soft")}${row(t("Variable Ausgaben"), -T.variable, true, "neg-soft")}${row(t("Große Ausgaben"), -T.large, true, "neg-soft")}</div>
      <div class="group">${row(t("Aufs Sparkonto"), T.saved_in)}${row(t("Vom Sparkonto geholt"), -T.saved_out, true)}</div>
      ${p === "all" && s.years.length ? `<div class="group">${s.years.map((y) => row(`${y.year} <small>${t("Überschuss")}</small>`, y.surplus, true, y.surplus >= 0 ? "pos" : "neg")).join("")}</div>` : ""}
    </section>`;

    // Angespart über die Zeit
    const end = p === "month" ? value : p === "year" ? (`${value}-12` < ctx.lastMonth ? `${value}-12` : ctx.lastMonth) : ctx.lastMonth;
    const cum = A.cumulative(ctx, end);
    const last = cum.at(-1) || { cumSurplus: 0, cumSavings: 0 };
    const pts = cum.map((c, i) => ({ x: i, y: c.cumSurplus }));
    chartHandlers.cum = (frac) => {
      const i = Math.round(frac * (cum.length - 1));
      const c = cum[i];
      if (!c) return null;
      return {
        frac: i / Math.max(1, cum.length - 1),
        html: `<b>${monthLabel(c.month)}</b><br>${t("angespart")}: ${fmt0(c.cumSurplus)}<br>${t("davon Sparkonto")}: ${fmt0(c.cumSavings)}<br>${t("im Monat")}: ${fmt0(c.surplus)}`,
      };
    };
    html += `<section class="card">
      <h2>${t("Angespart seit {month}", { month: monthLabel(ctx.firstMonth) })}</h2>
      <div class="kpi"><span class="big2 ${last.cumSurplus >= 0 ? "pos" : "neg"}">${fmt(last.cumSurplus)}</span>
        <span class="sub">${t("Überschuss aller Monate bis {month}, davon {amount} aufs Sparkonto gelegt", { month: monthLabel(end), amount: fmt(last.cumSavings) })}</span></div>
      ${pts.length > 1 ? lineChart({
        id: "cum",
        xs: pts.map((q) => q.x),
        series: [{ points: pts, cls: "s-main", area: true }],
        xLabel: () => {
          const idx = [0, Math.floor((cum.length - 1) / 2), cum.length - 1];
          return [...new Set(idx)].map((i) => ({ x: i, label: `${shortMonth(cum[i].month)} ${cum[i].month.slice(2, 4)}` }));
        },
        endLabel: { point: pts.at(-1), cls: "s-main", aria: `${t("angespart")} ${fmt(last.cumSurplus)}` },
      }) : ""}
    </section>`;

    html += expenseCard(s, T);
    return html;
  }

  // ------------------------------------------------------------------ Vermögen
  const ACC_TYPES = {
    giro: { label: t("Girokonto"), value: t("Kontostand"), icon: "bank" },
    savings: { label: t("Sparkonto"), value: t("Kontostand"), icon: "piggy" },
    depot: { label: t("Depot"), value: t("Depotwert"), icon: "trend" },
    loan: { label: t("Kredit"), value: t("Restschuld"), icon: "receipt" },
  };
  const dateDE = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(locale);
  const parseEuro = window.I18N.parseAmount;   // "1.234,56", "1,234.56", "39,95" -> Cent
  const decimal = window.I18N.decimal;         // Zahl mit dem Dezimalzeichen der Sprache
  const euroInput = (cents) => (cents == null ? "" : decimal(cents / 100, 2));

  function accountSub(a) {
    if (a.current == null) return t("Noch kein Wert eingetragen");
    if (a.type === "loan" && a.loan) {
      const l = a.loan;
      if (l.payoffMonth) return t("{amount} im Monat · schuldenfrei ca. {month}", { amount: fmt0(l.payment), month: `${shortMonth(l.payoffMonth)} ${l.payoffMonth.slice(0, 4)}` });
      return l.payment ? t("Rate deckt die Zinsen nicht") : t("Rate und Zins fehlen noch");
    }
    if (a.type === "depot" && a.depot) {
      const d = a.depot;
      return `${d.gain >= 0 ? "+" : ""}${fmt0(d.gain)} (${decimal(d.gainPct * 100, 1)} %) ${t("seit {date}", { date: dateDE(d.since) })}${d.stale ? ` · ${t("Wert aktualisieren")}` : ""}`;
    }
    if (a.type === "savings" && a.monthlyIn) return t("zuletzt {amount} im Monat", { amount: `${a.monthlyIn > 0 ? "+" : ""}${fmt0(a.monthlyIn)}` });
    // Vorgemerkte Ausgaben ohne Minus, wie in der Übersicht; Eingänge mit "+"
    const pending = a.pendingCents ? t("inkl. {amount} vorgemerkt", { amount: a.pendingCents < 0 ? fmt(-a.pendingCents) : `+${fmt(a.pendingCents)}` }) : "";
    if (a.estimated && a.lastValueDate) return t("fortgeschrieben seit {date}", { date: dateDE(a.lastValueDate) }) + (pending ? `, ${pending}` : "");
    if (pending) return `${t("von der Bank")}, ${pending}`;
    return a.bank ? t("von der Bank") : t("von Hand");
  }

  function viewWealth() {
    const w = A.wealth(state.ctx, state.accounts);
    if (!state.accounts.length) {
      return `<section class="card empty-card">
        <div class="bubble">${icon("piggy")}</div>
        <h2 style="margin-top:12px">${t("Dein Vermögen auf einen Blick")}</h2>
        <p class="note">${t("Lege Girokonto, Sparkonten, Depots und Kredite an. Was die Bank liefert, kommt automatisch. Depotwerte trägst du ab und zu selbst ein, Kredite rechnet die App mit dem Tilgungsplan weiter.")}</p>
        <button class="btn block" data-action="newaccount" style="margin-top:14px">${icon("plus")} ${t("Erstes Konto anlegen")}</button>
      </section>`;
    }
    const s = w.series.filter((p) => p.assets || p.debts);
    const first = s[0];
    const yearAgo = s.find((p) => p.month === addMonths(thisMonth, -12)) || first;
    const change = yearAgo ? w.net - yearAgo.net : 0;
    const pts = s.map((p, i) => ({ x: i, y: p.net }));
    chartHandlers.net = (frac) => {
      const i = Math.round(frac * (s.length - 1));
      const p = s[i];
      if (!p) return null;
      return { frac: i / Math.max(1, s.length - 1), html: `<b>${monthLabel(p.month)}</b><br>${t("Vermögen")} ${fmt0(p.assets)}<br>${t("Schulden")} ${fmt0(p.debts)}<br>${t("Netto")} ${fmt0(p.net)}` };
    };

    let html = `<section class="card hero">
      <div class="sub">${t("Nettovermögen")}</div>
      <div class="big ${w.net >= 0 ? "" : "neg"}">${fmt(w.net)}</div>
      <div class="sub">${t("Vermögen")} ${fmt(w.assets)}${w.debts ? ` · ${t("Schulden")} ${fmt(w.debts)}` : ""}</div>
      ${yearAgo && s.length > 1 ? `<div class="delta ${change >= 0 ? "good" : "bad"}" style="font-size:14px;margin-top:4px">${change >= 0 ? "▲" : "▼"} ${fmt0(Math.abs(change))} ${t("seit {date}", { date: monthLabel(yearAgo.month) })}</div>` : ""}
      ${pts.length > 1 ? lineChart({
        id: "net",
        xs: pts.map((p) => p.x),
        series: [{ points: pts, cls: "s-main", area: true }],
        xLabel: () => {
          const idx = [...new Set([0, Math.floor((s.length - 1) / 2), s.length - 1])];
          return idx.map((i) => ({ x: i, label: `${shortMonth(s[i].month)} ${s[i].month.slice(2, 4)}` }));
        },
        endLabel: { point: pts.at(-1), cls: "s-main", aria: `${t("Nettovermögen")} ${fmt(w.net)}` },
      }) : ""}
    </section>`;

    for (const g of w.groups) {
      html += `<section class="card acc-group">
        <h2>${t(g.title)}</h2>
        ${g.items.map((a) => `
          <button class="acc" data-account="${a.id}">
            <div class="bubble ${a.type === "loan" ? "none" : ""}">${icon(a.icon || ACC_TYPES[a.type].icon)}</div>
            <div class="mid"><div class="who">${esc(a.name)}${a.include_in_total ? "" : ` <span class="chip">${t("nicht mitgezählt")}</span>`}</div>
              <div class="what">${esc(accountSub(a))}</div>
              ${a.type === "loan" && a.loan?.progress != null ? `<div class="bar"><i style="width:${a.loan.progress * 100}%"></i></div>` : ""}</div>
            <div class="amt ${a.type === "loan" ? "neg" : ""}">${a.current == null ? "–" : (a.type === "loan" ? "−" : "") + fmt(a.current)}</div>
          </button>`).join("")}
        ${g.items.length > 1 ? `<div class="line-row group-total"><span>${t("Gesamt")}</span><span>${g.type === "loan" ? "−" : ""}${fmt(g.total)}</span></div>` : ""}
      </section>`;
    }
    html += `<button class="btn secondary block" data-action="newaccount">${icon("plus")} ${t("Konto hinzufügen")}</button>
      <p class="note" style="text-align:center">${t("Werte mit „fortgeschrieben“ rechnet die App aus deinen Umbuchungen weiter, bis du einen neuen Stand einträgst.")}</p>`;
    return html;
  }

  function accountFormFields(a = {}) {
    const type = a.type || "savings";
    return `
      <label class="field"><span>${t("Name")}</span><input type="text" id="acc-name" maxlength="60" autocomplete="off" value="${esc(a.name || "")}" placeholder="${t("z. B. Extra-Konto Rücklage")}"></label>
      ${type !== "giro" ? `<label class="field"><span>${t("Umbuchungen erkennen an")}</span>
        <input type="text" id="acc-match" maxlength="80" autocomplete="off" autocapitalize="none" value="${esc(a.match || "")}" placeholder="${t("IBAN oder Stichwort, z. B. Direkt-Depot")}">
        <small class="hint">${t("Steht in Empfänger, Verwendungszweck oder IBAN der Überweisung vom Girokonto.")} ${type === "loan" ? t("Die Raten werden dann als „Kredit“ einsortiert.") : t("Die Überweisungen zählen dann als Ersparnis.")}</small></label>` : ""}
      ${type === "loan" ? `
        <div class="field-row">
          <label class="field"><span>${t("Sollzins p. a. in %")}</span><input type="text" id="acc-rate" inputmode="decimal" value="${a.loan_rate_percent != null ? decimal(a.loan_rate_percent) : ""}" placeholder="${decimal(5.49, 2)}"></label>
          <label class="field"><span>${t("Monatsrate in €")}</span><input type="text" id="acc-pay" inputmode="decimal" value="${euroInput(a.loan_payment_cents)}" placeholder="${decimal(320, 2)}"></label>
        </div>
        <label class="field"><span>${t("Ursprünglicher Kreditbetrag in € (optional)")}</span><input type="text" id="acc-orig" inputmode="decimal" value="${euroInput(a.loan_original_cents)}" placeholder="${decimal(20000, 2)}"></label>` : ""}
      <div class="row"><div class="grow"><div>${t("Im Nettovermögen mitzählen")}</div><div class="hint">${t("Z. B. aus, wenn das Konto einem Kind gehört")}</div></div>
        <label class="switch"><input type="checkbox" id="acc-include" ${a.include_in_total === false ? "" : "checked"}><span></span></label></div>`;
  }

  function readAccountForm(sheet, type) {
    const data = {
      name: $("#acc-name", sheet).value.trim(),
      include_in_total: $("#acc-include", sheet).checked,
    };
    if ($("#acc-match", sheet)) data.match = $("#acc-match", sheet).value.trim();
    if (type === "loan") {
      const rate = parseEuro($("#acc-rate", sheet).value);
      if (rate != null) data.loan_rate_percent = rate / 100;
      const pay = parseEuro($("#acc-pay", sheet).value);
      if (pay != null) data.loan_payment_cents = pay;
      const orig = parseEuro($("#acc-orig", sheet).value);
      if (orig != null) data.loan_original_cents = orig;
    }
    return data;
  }

  function openNewAccountSheet() {
    let type = "savings";
    const sheet = openSheet(`<h3>${t("Konto hinzufügen")}</h3><div class="meta">${t("Deine Kontodaten bleiben in deiner eigenen Datenbank auf deinem Server.")}</div>
      <div class="seg type-seg" role="group">
        ${Object.entries(ACC_TYPES).map(([k, ty]) => `<button data-acctype="${k}" aria-pressed="${k === type}">${k === "savings" ? t("Sparen") : k === "giro" ? t("Giro") : ty.label}</button>`).join("")}
      </div>
      <div id="acc-form"></div>`);
    const draw = () => {
      $("#acc-form", sheet).innerHTML = accountFormFields({ type }) + `
        <label class="field" style="margin-top:12px"><span>${t("{what} heute in €", { what: ACC_TYPES[type].value })}</span>
          <input type="text" id="acc-value" inputmode="decimal" placeholder="${decimal(type === "loan" ? 17170.32 : 0, 2)}"></label>
        <button class="btn block" id="acc-save">${t("Anlegen")}</button>`;
      sheet.querySelectorAll("[data-acctype]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.acctype === type));
    };
    draw();
    sheet.addEventListener("click", async (e) => {
      const tb = e.target.closest("[data-acctype]");
      if (tb) { type = tb.dataset.acctype; return draw(); }
      if (e.target.closest("#acc-save")) {
        const data = { ...readAccountForm(sheet, type), type };
        if (!data.name) return $("#acc-name", sheet).focus();
        const v = parseEuro($("#acc-value", sheet).value);
        if (v != null) { data.value_cents = type === "loan" ? Math.abs(v) : v; data.value_date = A.isoOf(today); }
        try {
          const res = await API.createAccount(data);
          closeSheet();
          toast(t("„{name}“ angelegt", { name: data.name }) + (res.assigned ? ` · ${t("{n} Umbuchungen erkannt", { n: res.assigned })}` : ""));
          reload();
        } catch (err) { toast(err.message); }
      }
    });
  }

  function openAccountSheet(acc) {
    const w = A.wealth(state.ctx, [acc]).items[0];
    const ty = ACC_TYPES[acc.type];
    const values = [...acc.values].sort((a, b) => b.date.localeCompare(a.date));
    let details = "";
    if (w.loan) {
      const l = w.loan;
      details = `<div class="card" style="padding:4px 16px">
        ${l.progress != null ? `<div class="row"><div class="grow"><div>${t("Abbezahlt")}</div><div class="bar" style="margin-top:8px"><i style="width:${l.progress * 100}%"></i></div></div><b>${Math.round(l.progress * 100)} %</b></div>` : ""}
        <div class="row"><div class="grow">${t("Schuldenfrei")}</div><b>${l.payoffMonth ? `${monthLabel(l.payoffMonth)} <small class="hint">${tn(l.months, "in {n} Monat", "in {n} Monaten")}</small>` : "–"}</b></div>
        <div class="row"><div class="grow">${t("Zinsen bis dahin")}</div><b>${l.interestLeft != null ? fmt(l.interestLeft) : "–"}</b></div>
        <div class="row"><div class="grow">${t("Davon Zinsen in der nächsten Rate")}</div><b>${fmt(l.interestThisMonth)}</b></div>
      </div>`;
    } else if (w.depot) {
      const d = w.depot;
      details = `<div class="card" style="padding:4px 16px">
        <div class="row"><div class="grow">${t("Eingezahlt seit {date}", { date: dateDE(d.since) })}</div><b>${fmt(d.contributions)}</b></div>
        <div class="row"><div class="grow">${t("Wertentwicklung")}<div class="hint">${t("ohne deine Einzahlungen")}</div></div><b class="${d.gain >= 0 ? "pos" : "neg"}">${d.gain >= 0 ? "+" : ""}${fmt(d.gain)}</b></div>
      </div>`;
    }
    const sheet = openSheet(`
      <div class="meta" style="margin-bottom:2px">${ty.label}${acc.bank ? ` · ${t("von der Bank")}` : ""}</div>
      <h3>${esc(acc.name)}</h3>
      <div class="bigamt ${acc.type === "loan" ? "neg" : ""}">${w.current == null ? "–" : (acc.type === "loan" ? "−" : "") + fmt(w.current)}</div>
      <div class="meta">${w.current == null ? t("Noch kein Wert") : w.estimated ? t("fortgeschrieben, letzter eingetragener Stand {date}", { date: dateDE(w.lastValueDate) }) : t("Stand {date}", { date: dateDE(w.lastValueDate) })}</div>
      ${details}
      <div class="card">
        <h2>${t("{what} eintragen", { what: ty.value })}</h2>
        <div class="field-row">
          <label class="field"><span>${t("Betrag in €")}</span><input type="text" id="val-amount" inputmode="decimal" placeholder="${euroInput(w.current) || decimal(0, 2)}"></label>
          <label class="field"><span>${t("Stand vom")}</span><input type="date" id="val-date" value="${A.isoOf(today)}"></label>
        </div>
        <button class="btn block" id="val-save">${t("Speichern")}</button>
        ${values.length ? `<details><summary>${tn(values.length, "{n} eingetragener Stand", "{n} eingetragene Stände")}</summary>
          ${values.map((v) => `<div class="row"><div class="grow">${dateDE(v.date)}<div class="hint">${v.source === "bank" ? t("von der Bank") : t("von Hand")}</div></div>
            <b>${fmt(v.value_cents)}</b><button class="small-del" data-delval="${v.id}" aria-label="${t("Stand löschen")}">${icon("trash")}</button></div>`).join("")}</details>` : ""}
      </div>
      <div class="card"><h2>${t("Einstellungen")}</h2>${accountFormFields(acc)}
        <button class="btn secondary block" id="acc-update" style="margin-top:8px">${t("Änderungen speichern")}</button></div>
      <button class="btn danger block" id="acc-delete">${t("Konto entfernen")}</button>`);

    sheet.addEventListener("click", async (e) => {
      if (e.target.closest("#val-save")) {
        const v = parseEuro($("#val-amount", sheet).value);
        if (v == null) return $("#val-amount", sheet).focus();
        await API.addAccountValue(acc.id, { value_cents: acc.type === "loan" ? Math.abs(v) : v, date: $("#val-date", sheet).value || undefined });
        closeSheet();
        toast(t("{what} gespeichert", { what: ty.value }));
        return reload();
      }
      const dv = e.target.closest("[data-delval]");
      if (dv) {
        await API.deleteAccountValue(acc.id, Number(dv.dataset.delval));
        closeSheet();
        toast(t("Stand gelöscht"));
        return reload();
      }
      if (e.target.closest("#acc-update")) {
        const data = readAccountForm(sheet, acc.type);
        if (!data.name) return $("#acc-name", sheet).focus();
        const res = await API.updateAccount(acc.id, data);
        closeSheet();
        toast(t("Gespeichert") + (res.assigned ? ` · ${t("{n} Umbuchungen erkannt", { n: res.assigned })}` : ""));
        return reload();
      }
      if (e.target.closest("#acc-delete")) {
        return confirmSheet(t("„{name}“ entfernen?", { name: acc.name }), t("Das Konto und seine eingetragenen Stände werden gelöscht. Umsätze und Kategorien bleiben."), t("Entfernen"), async () => {
          await API.deleteAccount(acc.id);
          toast(t("Konto entfernt"));
          reload();
        });
      }
    });
  }

  // ------------------------------------------------------------------ Umsatz-Sheet
  // onBack: z. B. zurück zur Liste, aus der der Umsatz geöffnet wurde
  function openTxSheet(tx, onBack) {
    const kind = tx.amount_cents > 0 ? "income" : "expense";
    const curCat = catById(tx.category_id);
    let sheetKind = curCat?.is_savings ? kind : (curCat?.kind || kind);
    let remember = !tx.category_id;
    // Gleicher oder ähnlich geschriebener Empfänger, gleiche Richtung (wie ledger.counterparty_key)
    const cpKey = (s) => String(s || "").toLowerCase().replace(/[^a-zäöüß ]+/g, " ").split(/\s+/).filter(Boolean).join(" ");
    const key = cpKey(tx.counterparty);
    const similar = key ? state.transactions.filter((x) => x.id !== tx.id && (x.amount_cents > 0) === (tx.amount_cents > 0) && cpKey(x.counterparty) === key) : [];
    const similarDone = similar.filter((x) => x.category_id != null).length;
    let applySimilar = similar.length > 0;
    const info = state.ctx.recurring.get(A.recurringKey(tx));
    const pattern = A.norm(tx.counterparty);
    const showFixed = pattern && !curCat?.is_savings;

    const sheet = openSheet(`
      <div class="bigamt ${tx.amount_cents > 0 ? "pos" : ""}">${signed(tx.amount_cents)}</div>
      <h3>${esc(tx.counterparty || t("Unbekannt"))}</h3>
      <div class="meta">${esc(tx.purpose)}<br>${new Date(tx.booking_date + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}</div>
      ${tx.pending ? `<div class="pending-note">${icon("calendar")}<div><b>${t("Vorgemerkt")}</b><span>${t("Die Bank hat die Zahlung noch nicht gebucht. Sie zählt schon ins Budget; der Betrag kann sich bis zur Buchung noch ändern.")}</span></div></div>` : ""}

      <div class="card" style="padding:4px 16px">
        ${similar.length ? `<div class="row">
          <div class="grow"><div>${t("Alle {n} gleichen übernehmen", { n: similar.length + 1 })}</div>
            <div class="hint">${t("{n} weitere von „{name}“", { n: similar.length, name: esc(tx.counterparty) })}${similarDone ? `, ${t("davon {n} schon zugeordnet", { n: similarDone })}` : ""}</div></div>
          <label class="switch"><input type="checkbox" id="similar" checked><span></span></label>
        </div>` : ""}
        <div class="row">
          <div class="grow"><div>${t("Künftig immer so zuordnen")}</div><div class="hint">${t("Alle Zahlungen an „{name}“", { name: esc(tx.counterparty) })}</div></div>
          <label class="switch"><input type="checkbox" id="remember" ${remember ? "checked" : ""}><span></span></label>
        </div>
        ${showFixed ? `<div class="row">
          <div class="grow"><div>${kind === "income" ? t("Regelmäßige Einnahme") : t("Fixkosten")}</div>
          <div class="hint">${info?.overridden ? t("von dir festgelegt") : info?.auto ? t("automatisch erkannt") : t("nicht automatisch erkannt")}${info ? ` · ${tn(info.months.size, "{n} Monat gesehen", "{n} Monate gesehen")}` : ""}</div></div>
          <label class="switch"><input type="checkbox" id="fixed" ${info?.fixed ? "checked" : ""}><span></span></label>
        </div>` : ""}
        <div class="row">
          <div class="grow"><div>${t("Zählt für")}</div><div class="hint">${tx.budget_month_manual ? t("von Hand gesetzt") : t("automatisch")}</div></div>
          <button class="icon-btn" data-bm="-1" aria-label="${t("früherer Monat")}">${icon("chevronLeft")}</button>
          <b id="bm" style="min-width:76px;text-align:center">${shortMonth(tx.budget_month)} ${tx.budget_month.slice(0, 4)}</b>
          <button class="icon-btn" data-bm="1" aria-label="${t("späterer Monat")}">${icon("chevronRight")}</button>
        </div>
        ${tx.budget_month_manual ? `<div class="row"><button class="btn secondary" data-bm-auto style="width:100%">${t("Wieder automatisch")}</button></div>` : ""}
      </div>

      <div class="seg" role="group">
        <button data-kind="expense" aria-pressed="${sheetKind === "expense"}">${t("Ausgabe")}</button>
        <button data-kind="income" aria-pressed="${sheetKind === "income"}">${t("Einnahme")}</button>
      </div>
      <div class="grid" id="catgrid"></div>
      ${tx.category_id ? `<button class="btn secondary block" data-clear style="margin-top:14px">${t("Zuordnung entfernen")}</button>` : ""}
    `, { onBack });

    const drawGrid = () => {
      const cats = state.categories.filter((c) => c.kind === sheetKind || (c.is_savings && sheetKind === "income"));
      $("#catgrid", sheet).innerHTML = cats.map((c) => `
        <button class="cat" data-cat="${c.id}" aria-pressed="${c.id === tx.category_id}">${icon(c.icon)}<span>${esc(c.name)}</span></button>`).join("")
        + `<button class="cat add" data-newcat>${icon("plus")}<span>${t("Hinzufügen")}</span></button>`;
      sheet.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.kind === sheetKind));
    };
    drawGrid();

    const assign = async (catId) => {
      const res = await API.updateTransaction(tx.id, { set_category: true, category_id: catId, remember, apply_similar: applySimilar && !!catId });
      closeSheet();
      const name = catId ? catById(catId)?.name : null;
      let msg = name ? t("Zugeordnet: {name}", { name }) : t("Zuordnung entfernt");
      if (res.also_assigned) msg += ` · ${t("{n} weitere mit zugeordnet", { n: res.also_assigned })}`;
      toast(msg, res.undo_count ? { label: t("Rückgängig"), run: undoLast } : undefined);
      reload();
    };

    let bm = tx.budget_month;
    sheet.addEventListener("click", async (e) => {
      const kindBtn = e.target.closest("[data-kind]");
      if (kindBtn) { sheetKind = kindBtn.dataset.kind; drawGrid(); return; }
      const catBtn = e.target.closest("[data-cat]");
      if (catBtn) return assign(Number(catBtn.dataset.cat));
      if (e.target.closest("[data-newcat]")) return openCategorySheet(sheetKind, async (cat) => { await assign(cat.id); }, () => openTxSheet(tx, onBack));
      if (e.target.closest("[data-clear]")) return assign(null);
      const bmBtn = e.target.closest("[data-bm]");
      if (bmBtn) {
        bm = addMonths(bm, Number(bmBtn.dataset.bm));
        $("#bm", sheet).textContent = `${shortMonth(bm)} ${bm.slice(0, 4)}`;
        await API.updateTransaction(tx.id, { budget_month: bm });
        toast(t("Zählt jetzt für {month}", { month: monthLabel(bm) }));
        reload();
        return;
      }
      if (e.target.closest("[data-bm-auto]")) {
        await API.updateTransaction(tx.id, { budget_month_auto: true });
        closeSheet();
        toast(t("Monat wieder automatisch"));
        reload();
      }
    });
    $("#remember", sheet).addEventListener("change", (e) => { remember = e.target.checked; });
    $("#similar", sheet)?.addEventListener("change", (e) => { applySimilar = e.target.checked; });
    $("#fixed", sheet)?.addEventListener("change", async (e) => {
      await setFixed(pattern, e.target.checked, info);
      toast(e.target.checked
        ? t(kind === "income" ? "„{name}“ zählt jetzt als regelmäßig" : "„{name}“ zählt jetzt als Fixkosten", { name: tx.counterparty })
        : t("„{name}“ ist jetzt variabel", { name: tx.counterparty }));
      await reload();
    });
  }

  // Merkt sich die Korrektur nur, wenn sie von der Erkennung abweicht.
  async function setFixed(pattern, fixed, info) {
    if (info && info.auto === fixed) await API.deleteOverride(pattern);
    else await API.setOverride(pattern, fixed);
  }

  // ------------------------------------------------------------------ Kategorie anlegen
  function openCategorySheet(kind, onCreated, onBack) {
    let chosenIcon = "tag";
    let flag = false;
    const sheet = openSheet(`
      <h3>${t("Neue Kategorie")}</h3>
      <div class="meta">${kind === "income" ? t("Für Einnahmen") : t("Für Ausgaben")}</div>
      <label class="field"><span>${t("Name")}</span><input type="text" id="catname" maxlength="40" autocomplete="off" enterkeyhint="done" placeholder="${t("z. B. Sport")}"></label>
      <div class="field"><span>${t("Symbol")}</span><div class="icon-pick">${CATEGORY_ICON_CHOICES.map((i) => `<button data-icon="${i}" aria-pressed="${i === chosenIcon}" aria-label="${i}">${icon(i)}</button>`).join("")}</div></div>
      <div class="card" style="padding:4px 16px">
        <div class="row"><div class="grow">${kind === "income"
          ? `<div>${t("Zählt zum Folgemonat")}</div><div class="hint">${t("Wie beim Gehalt: Eingang am Monatsende gilt für den nächsten Monat")}</div>`
          : `<div>${t("Ist eine Ersparnis")}</div><div class="hint">${t("Z. B. Überweisung aufs Sparkonto. Zählt dann nicht als Ausgabe.")}</div>`}</div>
        <label class="switch"><input type="checkbox" id="catflag"><span></span></label></div>
      </div>
      <button class="btn block" id="catsave">${t("Anlegen")}</button>
    `, { onBack });
    sheet.addEventListener("click", async (e) => {
      const ib = e.target.closest("[data-icon]");
      if (ib) {
        chosenIcon = ib.dataset.icon;
        sheet.querySelectorAll("[data-icon]").forEach((b) => b.setAttribute("aria-pressed", b === ib));
      }
      if (e.target.closest("#catsave")) {
        const name = $("#catname", sheet).value.trim();
        if (!name) return $("#catname", sheet).focus();
        try {
          const cat = await API.createCategory({
            name, kind, icon: chosenIcon,
            shift_next_month: kind === "income" && flag,
            is_savings: kind === "expense" && flag,
          });
          closeSheet();
          toast(t("Kategorie „{name}“ angelegt", { name }));
          if (onCreated) await onCreated(cat); else await reload();
        } catch (err) { toast(err.message); }
      }
    });
    $("#catflag", sheet).addEventListener("change", (e) => { flag = e.target.checked; });
  }

  // ------------------------------------------------------------------ Einstellungen
  let rulesCache = [];
  async function viewSettingsAsync() {
    [rulesCache, updatesInfo] = await Promise.all([
      API.rules(), API.updates ? API.updates() : null, window.Auth?.loadPasskeys(),
    ]);
    if (state.view === "settings") render();
    // App mitten in einem Update geöffnet: weiter beobachten
    if (updatesInfo?.anfrage || updatesInfo?.status?.laeuft) watchUpdates();
  }

  // Unterseiten von „Mehr“: null (Hauptseite), "categories", "rules", "fixed"
  const SETTINGS_PAGES = {
    categories: () => t("Kategorien"),
    rules: () => t("Gelernte Regeln"),
    fixed: () => t("Fixkosten"),
  };
  function openSettingsPage(page) {
    state.settingsPage = page;
    window.scrollTo(0, 0);
    render();
  }

  function viewSettings() {
    if (state.settingsPage === "categories") return settingsCategories();
    if (state.settingsPage === "rules") return settingsRules();
    if (state.settingsPage === "fixed") return settingsFixed();
    const bank = state.bank;
    const settings = state.settings;
    const fixedSum = A.recurringList(state.ctx).filter((r) => r.kind === "expense" && r.fixed).reduce((s, r) => s + r.amount_cents, 0);
    const userRuleCount = rulesCache.filter((r) => r.source === "user").length;

    const bankText = {
      none: bank.setup ? t("Noch nicht eingerichtet") : t("Noch nicht verbunden"),
      active: t("Verbunden · gültig bis {date}", { date: bank.valid_until ? new Date(bank.valid_until.slice(0, 10) + "T12:00:00").toLocaleDateString(locale) : "?" }),
      expiring: tn(bank.days_left, "Läuft in {n} Tag ab", "Läuft in {n} Tagen ab"),
      expired: t("Freigabe abgelaufen"),
      error: t("Fehler beim Abruf"),
    }[bank.state] || bank.state;

    const navRow = (page, ic, label, value) => `
      <button class="navrow" data-settings-page="${page}">
        <div class="bubble">${icon(ic)}</div>
        <div class="grow">${label}</div>
        <span class="navrow-value">${value}</span>${icon("chevronRight")}
      </button>`;

    return `
      <section class="card">
        <h2>${t("Bank")}</h2>
        <div class="row">
          <div class="bubble ${bank.state === "active" ? "" : "none"}">${icon("bank")}</div>
          <div class="grow"><div><b>${bank.provider === "demo" ? t("Demo-Bank") : esc(bank.bank_name || t("Bank"))}</b></div><div class="hint">${esc(bankText)}</div>
          ${bank.last_sync ? `<div class="hint">${t("Zuletzt abgerufen: {date}", { date: new Date(bank.last_sync).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) })}</div>` : ""}</div>
        </div>
        <div class="btn-row">
          ${bank.state === "none" ? "" : `<button class="btn secondary" data-action="sync">${icon("refresh")} ${t("Jetzt abrufen")}</button>`}
          <button class="btn" data-action="connect" ${bank.setup ? "disabled" : ""}>${bank.state === "none" ? t("Verbinden") : t("Neu verbinden")}</button>
        </div>
        ${bank.setup ? setupHint(bank.setup) : ""}
      </section>
      ${aboutCard()}

      <section class="card">
        <h2>${t("Monat")}</h2>
        <div class="row">
          <div class="grow"><div>${t("Gehalt zählt zum Folgemonat ab dem")}</div><div class="hint">${t("Gilt für Kategorien mit „Folgemonat“. Kommt das Gehalt verspätet am Monatsanfang, bleibt es im Eingangsmonat.")}</div></div>
          <div class="stepper"><button data-shift="-1" aria-label="${t("früher")}">−</button><span>${ord(settings.shift_from_day)}</span><button data-shift="1" aria-label="${t("später")}">+</button></div>
        </div>
        <div class="row">
          <div class="grow"><div>${t("Große Ausgabe ab")}</div><div class="hint">${t("Einzelne Ausgaben ab diesem Betrag zählen nicht in die Prognose, weil sie selten sind.")}</div></div>
          <div class="stepper"><button data-large="-1" aria-label="${t("weniger")}">−</button><span style="min-width:62px">${fmt0(settings.large_expense_cents)}</span><button data-large="1" aria-label="${t("mehr")}">+</button></div>
        </div>
      </section>

      <section class="card nav-card">
        ${navRow("categories", "tag", t("Kategorien"), state.categories.length)}
        ${navRow("rules", "sparkle", t("Gelernte Regeln"), userRuleCount)}
        ${navRow("fixed", "calendar", t("Fixkosten"), t("{amount} im Monat", { amount: fmt0(fixedSum) }))}
      </section>
      ${window.Auth ? window.Auth.settingsHtml() : ""}
      ${updatesCard()}
      ${languageCard()}
      ${themeCard()}`;
  }

  // Mehr → Kategorien: Antippen öffnet die Kategorie (Ersparnis/Folgemonat, löschen)
  function settingsCategories() {
    const cats = state.categories.filter((c) => c.kind === state.settingsKind);
    return `
      <div class="seg" role="group">
        <button data-skind="expense" aria-pressed="${state.settingsKind === "expense"}">${t("Ausgaben")}</button>
        <button data-skind="income" aria-pressed="${state.settingsKind === "income"}">${t("Einnahmen")}</button>
      </div>
      <section class="card">
        ${cats.map((c) => `
          <button class="navrow" data-editcat="${c.id}">
            <div class="bubble">${icon(c.icon)}</div>
            <div class="grow">${esc(c.name)}</div>
            ${c.is_savings ? `<span class="chip">${t("Ersparnis")}</span>` : ""}
            ${c.kind === "income" && c.shift_next_month ? `<span class="chip">${t("Folgemonat")}</span>` : ""}
            ${icon("chevronRight")}
          </button>`).join("")}
      </section>
      <button class="btn secondary block" data-action="newcat">${icon("plus")} ${t("Kategorie hinzufügen")}</button>`;
  }

  function openCategoryEditSheet(cat) {
    const income = cat.kind === "income";
    const on = income ? !!cat.shift_next_month : !!cat.is_savings;
    const sheet = openSheet(`
      <div class="meta" style="margin-bottom:2px">${income ? t("Für Einnahmen") : t("Für Ausgaben")}</div>
      <h3 class="cat-title"><span class="bubble">${icon(cat.icon)}</span>${esc(cat.name)}</h3>
      <div class="card" style="padding:4px 16px;margin-top:12px">
        <div class="row"><div class="grow">${income
          ? `<div>${t("Zählt zum Folgemonat")}</div><div class="hint">${t("Wie beim Gehalt: Eingang am Monatsende gilt für den nächsten Monat")}</div>`
          : `<div>${t("Ist eine Ersparnis")}</div><div class="hint">${t("Z. B. Überweisung aufs Sparkonto. Zählt dann nicht als Ausgabe.")}</div>`}</div>
          <label class="switch"><input type="checkbox" id="catflag" ${on ? "checked" : ""}><span></span></label></div>
      </div>
      <button class="btn danger block" id="catdel">${t("Kategorie löschen")}</button>`);
    $("#catflag", sheet).addEventListener("change", async (e) => {
      const value = e.target.checked;
      await API.updateCategory(cat.id, income ? { shift_next_month: value } : { is_savings: value });
      if (!income) toast(value ? t("Zählt jetzt als Ersparnis") : t("Zählt jetzt als Ausgabe"));
      await reload();
    });
    $("#catdel", sheet).addEventListener("click", () => {
      confirmSheet(t("„{name}“ löschen?", { name: cat.name }), t("Zugeordnete Zahlungen landen wieder in „Zuordnen“. Regeln für diese Kategorie werden mit gelöscht."), t("Löschen"), async () => {
        await API.deleteCategory(cat.id);
        toast(t("Kategorie gelöscht"));
        await reload();
        viewSettingsAsync();
      });
    });
  }

  // Mehr → Gelernte Regeln
  function settingsRules() {
    const userRules = rulesCache.filter((r) => r.source === "user");
    const starterRules = rulesCache.filter((r) => r.source !== "user");
    return `
      <section class="card">
        ${userRules.length ? userRules.map(ruleRow).join("") : `<div class="hint">${t("Noch keine. Sie entstehen, wenn du eine Zahlung zuordnest und „Künftig immer so zuordnen“ an lässt.")}</div>`}
      </section>
      ${starterRules.length ? `<section class="card"><details><summary>${t("{n} Start-Regeln anzeigen", { n: starterRules.length })}</summary>${starterRules.map(ruleRow).join("")}</details></section>` : ""}`;
  }

  // Mehr → Fixkosten: erkannte Fixkosten und regelmäßige Einnahmen, korrigierbar
  function settingsFixed() {
    const rec = A.recurringList(state.ctx);
    const fixedExp = rec.filter((r) => r.kind === "expense" && r.fixed);
    const otherExp = rec.filter((r) => r.kind === "expense" && !r.fixed);
    const regInc = rec.filter((r) => r.kind === "income" && r.fixed);
    const fixedSum = fixedExp.reduce((s, r) => s + r.amount_cents, 0);
    const recRow = (r) => `
      <div class="row">
        <div class="grow"><div>${esc(r.name)}</div>
          <div class="hint">${fmt(r.amount_cents)} · ${t("meist um den {day}", { day: ord(r.day) })} · ${r.overridden ? t("von dir festgelegt") : t("erkannt")}</div></div>
        <label class="switch"><input type="checkbox" data-fixed="${esc(r.pattern)}" data-auto="${r.auto}" ${r.fixed ? "checked" : ""}><span></span></label>
      </div>`;
    return `
      <section class="card">
        <h2>${t("Fixkosten · {amount} im Monat", { amount: fmt(fixedSum) })}</h2>
        <p class="note" style="margin-top:0">${t("Erkannt werden Zahlungen, die in mindestens zwei Monaten mit fast gleichem Betrag vorkommen. Mit dem Schalter korrigierst du die Erkennung.")}</p>
        ${fixedExp.map(recRow).join("") || `<div class="hint">${t("Noch keine erkannt. Dafür braucht die App Umsätze aus mindestens zwei Monaten.")}</div>`}
        ${otherExp.length ? `<details><summary>${tn(otherExp.length, "{n} weiterer wiederkehrender Empfänger", "{n} weitere wiederkehrende Empfänger")}</summary>${otherExp.map(recRow).join("")}</details>` : ""}
      </section>
      ${regInc.length ? `<section class="card"><h2>${t("Regelmäßige Einnahmen")}</h2>${regInc.map(recRow).join("")}</section>` : ""}`;
  }

  // ------------------------------------------------------------------ Updates (nur mit UPDATES_IN_APP=1)
  // Die App stößt nur an; einspielen tut der Update-Dienst auf dem Pi (tools/pi/selbst-aktualisieren.sh).
  let updatesInfo = null;     // Antwort von /api/updates, null = Bereich ausgeblendet
  let updatesPoll = null;
  const UPDATE_RESULT = {
    aktualisiert: () => t("Aktualisiert"),
    aktuell: () => t("Schon auf dem neuesten Stand"),
    zurueckgenommen: () => t("Zurückgenommen: Der neue Stand ließ sich nicht starten, der vorherige läuft weiter."),
    teilweise: () => t("Nur teilweise: Bei einer weiteren Installation läuft noch der alte Stand."),
    kein_ff: () => t("Nicht übernommen: Die Versionsgeschichte auf GitHub wurde umgeschrieben. Bitte von Hand prüfen."),
    offline: () => t("GitHub war nicht erreichbar."),
  };
  const dateTime = (v) => {
    const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
    return isNaN(d) ? "" : d.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  };
  const commitLine = (c) => (c ? `${esc(c.titel)}<div class="hint">${esc(c.commit)} · ${dateTime(c.datum)}</div>` : "–");

  function updatesCard() {
    if (!updatesInfo) return "";
    const s = updatesInfo.status;
    const pending = updatesInfo.anfrage;
    let body;
    if (!s) {
      body = `<p class="note" style="margin-top:0">${t("Der Update-Dienst auf dem Pi ist noch nicht eingerichtet. Siehe tools/pi/updates-einrichten.sh.")}</p>`;
    } else {
      const busy = s.laeuft || pending === "aktualisieren";
      const checking = pending === "pruefen";
      const last = s.letztes;
      const lastBad = last && ["zurueckgenommen", "teilweise", "kein_ff", "offline"].includes(last.ergebnis);
      body = `
        <div class="row"><div class="grow"><div class="hint">${t("Installiert")}</div>${commitLine(s.installiert)}</div></div>
        ${updatesInfo.dienst_aktiv === false ? `<div class="setup-hint">${icon("help")}<div><b>${t("Update-Dienst meldet sich nicht")}</b>
          <span>${t("Letztes Lebenszeichen: {date}. Läuft der Pi und ist der Cron-Eintrag noch da?", { date: dateTime(s.lebenszeichen) })}</span></div></div>` : ""}
        ${busy ? `<div class="update-busy"><span class="spinner" aria-hidden="true"></span><div><b>${t("Wird aktualisiert …")}</b>
            <span>${t("Das dauert ein paar Minuten. Die App startet danach neu und lädt sich selbst neu.")}</span></div></div>`
          : s.verfuegbar ? `
            <div class="row"><div class="grow"><div class="update-new">${t("Neue Version verfügbar")}</div>${commitLine(s.verfuegbar)}</div></div>
            ${s.aenderungen?.length ? `<details><summary>${tn(s.aenderungen.length, "{n} Änderung anzeigen", "{n} Änderungen anzeigen")}</summary>
              ${s.aenderungen.map((c) => `<div class="row"><div class="grow">${commitLine(c)}</div></div>`).join("")}</details>` : ""}
            <button class="btn block" data-update="aktualisieren" style="margin-top:8px">${icon("refresh")} ${t("Jetzt aktualisieren")}</button>`
          : `
            <div class="row"><div class="grow"><div>${icon("check", "ic-s")} ${t("Aktuell")}</div>
              <div class="hint">${s.geprueft ? t("Zuletzt geprüft: {date}", { date: dateTime(s.geprueft) }) : t("Noch nicht geprüft")}</div></div></div>
            <button class="btn secondary block" data-update="pruefen" ${checking ? "disabled" : ""}>${checking ? `<span class="spinner" aria-hidden="true"></span> ${t("Wird geprüft …")}` : `${icon("refresh")} ${t("Jetzt prüfen")}`}</button>`}
        ${last ? `<div class="hint ${lastBad ? "update-bad" : ""}" style="margin-top:10px">${t("Letztes Ergebnis ({date}):", { date: dateTime(last.zeit) })}
          ${(UPDATE_RESULT[last.ergebnis] || (() => esc(last.ergebnis)))()}${last.commit ? ` (${esc(last.commit)})` : ""}</div>` : ""}
        <p class="note">${t("Der Pi schaut stündlich nach neuen Versionen, spielt sie aber nur ein, wenn du hier auf „Jetzt aktualisieren“ tippst.")}</p>`;
    }
    return `<section class="card"><h2>${t("Updates")}</h2>${body}</section>`;
  }

  // Fragt nach, bis der Dienst die Anfrage erledigt hat. Nach einem Update lädt die App neu.
  function watchUpdates() {
    clearInterval(updatesPoll);
    const before = updatesInfo?.status?.installiert?.commit;
    const started = Date.now();
    updatesPoll = setInterval(async () => {
      const info = await API.updates();   // während des Neustarts null -> weiter warten
      if (info) {
        updatesInfo = info;
        const now = info.status?.installiert?.commit;
        if (before && now && now !== before && !info.status.laeuft) {
          clearInterval(updatesPoll);
          toast(t("Aktualisiert – die App lädt neu"));
          setTimeout(() => location.reload(), 1200);
          return;
        }
        if (!info.anfrage && !info.status?.laeuft) clearInterval(updatesPoll);
        if (state.view === "settings") render();
      }
      if (Date.now() - started > 15 * 60 * 1000) clearInterval(updatesPoll);
    }, 3000);
  }

  async function updateAction(aktion) {
    try {
      updatesInfo = await API.updateAction(aktion);
      if (state.view === "settings") render();
      watchUpdates();
    } catch (err) { toast(err.message); }
  }

  // Sprache umschalten (Standard: Sprache des Geräts)
  function languageCard() {
    const cur = window.I18N.lang;
    return `<section class="card">
        <h2>${t("Sprache")}</h2>
        <div class="seg" role="group" aria-label="${t("Sprache")}">
          ${window.I18N.languages.map((l) => `<button data-lang="${l.code}" aria-pressed="${l.code === cur}" lang="${l.code}">${l.name}</button>`).join("")}
        </div>
      </section>`;
  }

  // Design: Automatisch (wie das Gerät), Hell, Dunkel – pro Gerät (web/theme.js)
  function themeCard() {
    if (!window.Theme) return "";
    const cur = window.Theme.get();
    const label = { auto: t("Automatisch"), light: t("Hell"), dark: t("Dunkel") };
    return `<section class="card">
        <h2>${t("Design")}</h2>
        <div class="seg" role="group" aria-label="${t("Design")}">
          ${window.Theme.choices.map((c) => `<button data-theme-choice="${c}" aria-pressed="${c === cur}">${label[c]}</button>`).join("")}
        </div>
        <p class="note">${t("Automatisch folgt der Einstellung des Geräts.")}</p>
      </section>`;
  }

  // Hinweis: Hobbyprojekt, keine Gewähr, keine Finanzberatung
  function aboutCard() {
    const server = state.serverVersion;
    const stale = server && server !== APP_VERSION;
    return `<section class="card about">
        <h2>${t("Über Münzwerk")}</h2>
        <div class="line-row"><span>${t("Version")}</span><span>${esc(APP_VERSION)}</span></div>
        ${stale ? `<p class="note warn-text">${t("Auf dem Pi läuft schon Version {v}. Schließe die App ganz und öffne sie neu.", { v: esc(server) })}</p>` : ""}
        <p class="note" style="margin-top:0">${t("Münzwerk ist ein privates Hobbyprojekt und Open Source (AGPL-3.0). Es gibt keine Gewähr, dass Beträge, Kategorien oder Prognosen stimmen, und nichts davon ist Finanzberatung. Münzwerk steht in keiner Verbindung zu deiner Bank oder zu Enable Banking.")}</p>
        <p class="note"><a href="https://github.com/Vaitage/muenzwerk" target="_blank" rel="noopener">github.com/Vaitage/muenzwerk</a></p>
      </section>`;
  }

  // Was fehlt, damit "Verbinden" geht (Server: bank.setup_problem)
  const SETUP_HINTS = {
    no_provider: t("Für diese Installation ist noch keine Bankanbindung eingerichtet. Wer Münzwerk betreibt, legt dafür eine eigene App bei Enable Banking an und trägt sie in der .env ein (BANK_PROVIDER=enablebanking). Danach den Container neu starten."),
    missing_app_id: t("In der .env fehlt ENABLEBANKING_APP_ID, die ID deiner App bei Enable Banking. Danach den Container neu starten."),
    missing_key: t("Der private Schlüssel von Enable Banking fehlt. Die .pem-Datei gehört nach data/enablebanking.pem (ENABLEBANKING_KEY_FILE in der .env). Danach den Container neu starten."),
  };
  function setupHint(reason) {
    const guide = window.I18N.lang === "de"
      ? "https://github.com/Vaitage/muenzwerk/blob/main/README.de.md#bank-verbinden-enable-banking"
      : "https://github.com/Vaitage/muenzwerk#connecting-your-bank-enable-banking";
    return `<div class="setup-hint">${icon("bank")}<div><b>${t("Bank noch nicht eingerichtet")}</b>
      <span>${SETUP_HINTS[reason] || SETUP_HINTS.no_provider}</span>
      <a href="${guide}" target="_blank" rel="noopener">${t("Anleitung öffnen")}</a></div></div>`;
  }

  function ruleRow(r) {
    return `<div class="row"><div class="grow"><div>${t("„{name}“", { name: esc(r.pattern) })}</div><div class="hint">→ ${esc(r.category)}</div></div>
      <button class="small-del" data-delrule="${r.id}" aria-label="${t("Regel löschen")}">${icon("trash")}</button></div>`;
  }

  // ------------------------------------------------------------------ Aktionen
  async function connectBank() {
    try {
      const { url } = await API.bankConnect();
      if (url) { location.href = url; return; }
      toast(t("Vorschau: Bankfreigabe erneuert"));
      reload();
    } catch (err) { toast(err.message); }
  }

  function navStats(dir) {
    const ctx = state.ctx;
    if (state.statsPeriod === "month") {
      const m = addMonths(state.statsMonth, dir);
      if (m >= ctx.firstMonth && m <= ctx.lastMonth) state.statsMonth = m;
    } else if (state.statsPeriod === "year") {
      const y = String(Number(state.statsYear) + dir);
      if (y >= ctx.firstMonth.slice(0, 4) && y <= ctx.lastMonth.slice(0, 4)) state.statsYear = y;
    }
    render();
  }

  document.addEventListener("click", async (e) => {
    if (e.target.closest(".sheet")) return;
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      state.view = tab.dataset.tab;
      state.settingsPage = null;   // „Mehr“ öffnet immer die Hauptseite
      window.scrollTo(0, 0);
      render();
      if (state.view === "settings") viewSettingsAsync();
      return;
    }

    const mb = e.target.closest("[data-month]");
    if (mb) { state.month = addMonths(state.month, Number(mb.dataset.month)); return render(); }

    const per = e.target.closest("[data-period]");
    if (per) { state.statsPeriod = per.dataset.period; return render(); }
    const sn = e.target.closest("[data-snav]");
    if (sn) return navStats(Number(sn.dataset.snav));

    const et = e.target.closest("[data-exptab]");
    if (et) { state.statsExpTab = et.dataset.exptab; return render(); }
    const sc = e.target.closest("[data-statcat]");
    if (sc) return openCategoryList(sc.dataset.statcat, sc.dataset.scope);
    const sf = e.target.closest("[data-statfix]");
    if (sf) return openFixedList(sf.dataset.statfix);

    const txBtn = e.target.closest("[data-tx]");
    if (txBtn) { const t = state.transactions.find((x) => String(x.id) === txBtn.dataset.tx); if (t) openTxSheet(t); return; }

    const act = e.target.closest("[data-action]")?.dataset.action;
    if (act === "goto-inbox") { state.view = "transactions"; state.txFilter = "open"; window.scrollTo(0, 0); return render(); }
    if (act === "goto-settings") { state.view = "settings"; state.settingsPage = null; render(); return viewSettingsAsync(); }

    const sp = e.target.closest("[data-settings-page]");
    if (sp) return openSettingsPage(sp.dataset.settingsPage || null);
    const ec = e.target.closest("[data-editcat]");
    if (ec) { const c = catById(Number(ec.dataset.editcat)); if (c) openCategoryEditSheet(c); return; }
    if (act === "connect") return connectBank();
    if (act === "undo") return undoLast();
    if (act === "newcat") return openCategorySheet(state.settingsKind);
    if (act === "sync") return runSync(true);

    const ub = e.target.closest("[data-update]");
    if (ub) {
      if (ub.dataset.update !== "aktualisieren") return updateAction(ub.dataset.update);
      return confirmSheet(t("Jetzt aktualisieren?"), t("Alle Installationen auf dem Pi bekommen den neuen Stand. Die App ist dabei ein paar Minuten nicht erreichbar."),
        t("Aktualisieren"), () => updateAction("aktualisieren"), "accent");
    }

    const lb = e.target.closest("[data-lang]");
    if (lb) { window.I18N.setLang(lb.dataset.lang); return; }
    const th = e.target.closest("[data-theme-choice]");
    if (th) { window.Theme.set(th.dataset.themeChoice); return render(); }

    if (act === "clear-search") {
      state.txQuery = "";
      render();
      return;
    }
    const sr = e.target.closest("[data-srange]");
    if (sr) { state.txRange = sr.dataset.srange; $("#tx-body").innerHTML = txBody(); return; }

    const tf = e.target.closest("[data-txfilter]");
    if (tf) { state.txFilter = tf.dataset.txfilter; return render(); }

    const accBtn = e.target.closest("[data-account]");
    if (accBtn) { const a = state.accounts.find((x) => x.id === Number(accBtn.dataset.account)); if (a) openAccountSheet(a); return; }
    if (act === "newaccount") return openNewAccountSheet();

    const sk = e.target.closest("[data-skind]");
    if (sk) { state.settingsKind = sk.dataset.skind; return render(); }

    const sh = e.target.closest("[data-shift]");
    if (sh) {
      const next = Math.min(28, Math.max(1, state.settings.shift_from_day + Number(sh.dataset.shift)));
      await API.updateSettings({ shift_from_day: next });
      return reload();
    }
    const lg = e.target.closest("[data-large]");
    if (lg) {
      const next = Math.min(500000, Math.max(5000, state.settings.large_expense_cents + Number(lg.dataset.large) * 5000));
      await API.updateSettings({ large_expense_cents: next });
      return reload();
    }

    const dr = e.target.closest("[data-delrule]");
    if (dr) { await API.deleteRule(Number(dr.dataset.delrule)); toast(t("Regel gelöscht")); return viewSettingsAsync(); }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id !== "tx-search") return;
    const hadQuery = !!state.txQuery.trim();
    state.txQuery = e.target.value;
    const hasQuery = !!state.txQuery.trim();
    $("#tx-body").innerHTML = txBody();
    if (hadQuery !== hasQuery) {
      renderTop();   // Monatsauswahl ein-/ausblenden
      const wrap = e.target.parentElement;
      const clear = $(".search-clear", wrap);
      if (hasQuery && !clear) wrap.insertAdjacentHTML("beforeend", `<button class="search-clear" data-action="clear-search" aria-label="${t("Suche leeren")}">✕</button>`);
      if (!hasQuery && clear) clear.remove();
    }
  });

  document.addEventListener("change", async (e) => {
    if (e.target.closest(".sheet")) return;
    const fx = e.target.closest("[data-fixed]");
    if (fx) {
      const pattern = fx.dataset.fixed;
      const auto = fx.dataset.auto === "true";
      await setFixed(pattern, fx.checked, { auto });
      await reload();
    }
  });

  // ------------------------------------------------------------------ Abruf mit Fortschritt
  // Der Server ruft in einem Schritt ab und kann keinen echten Prozentwert
  // melden. Deshalb: laufender Balken mit Schritt-Texten, die der üblichen
  // Reihenfolge folgen, und am Ende das echte Ergebnis.
  const SYNC_STEPS = [
    [0, t("Verbinde mit der Bank …")],
    [1500, t("Lade Umsätze …")],
    [4000, t("Lade Kontostände …")],
    [8000, t("Die Bank antwortet langsam, gleich fertig …")],
  ];
  let syncRunning = false;

  function syncBar() {
    let bar = $("#syncbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "syncbar";
      bar.className = "syncbar";
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      bar.innerHTML = `<div class="syncbar-track"><i></i></div><div class="syncbar-text"></div>`;
      document.body.append(bar);
    }
    return bar;
  }

  function setSyncButtons(running) {
    document.querySelectorAll('[data-action="sync"]').forEach((b) => {
      b.disabled = running;
      b.innerHTML = running ? `<span class="spinner" aria-hidden="true"></span> ${t("Lädt …")}` : `${icon("refresh")} ${t("Jetzt abrufen")}`;
    });
  }

  function syncResultText(r) {
    if (!r.ok) {
      if (r.reason === "expired") return t("Bankfreigabe abgelaufen – bitte unter „Mehr“ neu verbinden");
      if (r.reason === "not_connected") return t("Noch keine Bank verbunden");
      if (r.reason === "not_configured") return t("Bank noch nicht eingerichtet – siehe „Mehr“");
      return t("Abruf fehlgeschlagen – später noch einmal versuchen");
    }
    const parts = [];
    if (r.new) parts.push(tn(r.new, "{n} neuer Umsatz", "{n} neue Umsätze"));
    if (r.new_pending) parts.push(t("{n} vorgemerkt", { n: r.new_pending }));
    if (r.confirmed) parts.push(t("{n} jetzt gebucht", { n: r.confirmed }));
    if (!parts.length) return r.pending ? t("Alles aktuell · {n} noch vorgemerkt", { n: r.pending }) : t("Alles aktuell, keine neuen Umsätze");
    return parts.join(" · ") + (r.uncategorized ? ` · ${t("{n} zum Zuordnen", { n: r.uncategorized })}` : "");
  }

  async function runSync(manual) {
    if (syncRunning) return;
    syncRunning = true;
    const bar = syncBar();
    const text = $(".syncbar-text", bar);
    bar.className = `syncbar show running ${manual ? "" : "quiet"}`;
    setSyncButtons(true);
    const started = Date.now();
    const timers = manual ? SYNC_STEPS.map(([ms, msg]) => setTimeout(() => { text.textContent = msg; }, ms)) : [];
    let r;
    try {
      r = await API.bankSync();
    } catch (err) {
      r = { ok: false, reason: "error" };
    }
    // Kurz stehen lassen, damit man den Balken auch bei schneller Antwort sieht
    const wait = manual ? Math.max(0, 900 - (Date.now() - started)) : 0;
    await new Promise((res) => setTimeout(res, wait));
    timers.forEach(clearTimeout);
    syncRunning = false;
    setSyncButtons(false);
    const changed = r.ok && (r.new || r.new_pending || r.confirmed);
    if (manual || changed || !r.ok) {
      text.textContent = syncResultText(r);
      bar.className = `syncbar show done ${r.ok ? "ok" : "fail"}`;
      setTimeout(() => { bar.className = "syncbar"; }, r.ok ? 3500 : 6000);
    } else {
      bar.className = "syncbar";
    }
    await reload();
    if (state.view === "settings") viewSettingsAsync();
  }

  // ------------------------------------------------------------------ Start
  (async () => {
    // Erst nach der Anmeldung per Face ID Daten laden (fehlt in der Vorschau)
    if (window.Auth) {
      await window.Auth.ensure();
      window.Auth.onChange(() => { if (state.view === "settings") render(); });
    }
    await loadAll();
    const params = new URLSearchParams(location.search);
    if (params.has("verbunden")) {
      toast(t("Bank verbunden – Umsätze werden geladen"));
      history.replaceState(null, "", location.pathname);
    }
    render();
    // Beim Öffnen der App kurz nach neuen Umsätzen schauen (dezent, nur der Balken).
    if (state.bank.state !== "none") runSync(false);
  })();
})();
