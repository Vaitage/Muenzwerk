// Münzwerk – Reiter „Übersicht“ (und Kategorie-/Fixkosten-Listen, die auch die Statistik nutzt).
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

// ------------------------------------------------------------------ Übersicht
// Eingeplante Sparraten ziehen „Übrig bis Monatsende“ und das Tagesbudget herunter (nur laufender Monat)
function withGoals(r) {
  const planned = r.status === "current" ? state.goalRep?.planned || 0 : 0;
  if (!planned) return { ...r, goalPlanned: 0 };
  return {
    ...r,
    goalPlanned: planned,
    budgetLeft: r.budgetLeft - planned,
    preview: r.preview.map((p, k) => ({ ...p, daily: p.daily - planned / Math.max(1, r.daysLeftIncl - k) })),
  };
}

function viewOverview() {
  const r = withGoals(A.monthReport(state.month, state.ctx));
  const T = r.totals;
  const open = openCount();
  let html = bankNotices();

  // Übrig im Monat, darunter Tagesbudget mit 3-Tage-Vorschau
  const heroLabel = r.status === "past" ? t("Übrig am Ende vom {month}", { month: monthName(r.month) }) : r.status === "future" ? t("Geplant übrig im {month}", { month: monthName(r.month) }) : t("Übrig bis Monatsende");
  const showDays = r.status === "current" && r.preview.length;
  // Balken: wie viel vom Geld dieses Monats (Einnahmen) noch frei ist; der Strich zeigt,
  // wie viel vom Monat noch übrig ist – liegt die Füllung rechts davon, reicht es gut.
  const pool = T.income;
  const freeShare = pool > 0 ? Math.max(0, Math.min(1, r.budgetLeft / pool)) : null;
  const dayShare = r.status === "current" ? r.daysLeftIncl / r.days : null;
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const bar = freeShare === null ? "" : `<div class="hero-bar" role="img" aria-label="${esc(t("{p} der Einnahmen dieses Monats noch frei", { p: Math.round(freeShare * 100) + " %" }))}">
      <div class="fill ${dayShare !== null && freeShare < dayShare ? "low" : ""}" style="width:${pct(freeShare)}"></div>
      ${dayShare !== null ? `<div class="mark" style="left:${pct(dayShare)}"></div>` : ""}
    </div>`;
  html += `<section class="card hero">
    <div class="sub">${heroLabel}</div>
    <div class="big ${r.budgetLeft >= 0 ? "pos" : "neg"}">${fmt(r.budgetLeft)}</div>
    ${showDays ? `<div class="per-day">${t("{amount}/Tag", { amount: fmt(r.preview[0].daily) })} · ${tn(r.daysLeftIncl, "noch {n} Tag", "noch {n} Tage")}</div>` : ""}
    ${bar}
    ${standHtml(r)}
    ${showDays ? `
      <div class="days3">
        ${r.preview.map((p, i) => {
          const d = new Date(p.iso + "T12:00:00");
          const name = i === 0 ? t("Heute") : `${WEEKDAYS[d.getDay()]} ${ord(d.getDate())}`;
          return `<div class="day3 ${i === 0 ? "now" : ""}">
            <div class="k">${name}</div>
            <div class="v ${p.daily >= 0 ? "" : "neg"}">${i === 0 ? fmt(p.daily) : fmt0(p.daily)}</div>
            ${p.due.map((x) => `<div class="due">${esc(x.name)} −${fmt0(x.amount_cents)}</div>`).join("")}
            ${p.incoming.map((x) => `<div class="due in">${esc(x.name)} +${fmt0(x.amount_cents)}</div>`).join("")}
          </div>`;
        }).join("")}
      </div>` : ""}
  </section>`;
  // Noch nicht zugeordnete Zahlungen: schmale Zeile unter der Kernzahl statt Hinweis darüber
  if (open) {
    html += `<button class="inbox-line" data-action="goto-inbox">${icon("inbox")}
      <span class="grow">${tn(open, "{n} Zahlung wartet auf eine Kategorie", "{n} Zahlungen warten auf eine Kategorie")}</span>${icon("chevronRight")}</button>`;
  }

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

  // Noch offen in diesem Monat; die vollständige Aufstellung steht in der Statistik
  const row = (label, cents, cls = "", sub = false) =>
    `<div class="line-row ${sub ? "sub-row" : ""}"><span>${label}</span><span class="${cls}">${fmt(cents)}</span></div>`;
  const hasOpen = r.openFixed.length || r.expectedIncome.length;
  html += `<section class="card">
    ${hasOpen ? `<h2>${t("Noch offen in diesem Monat")}</h2>` : ""}
    ${r.openFixed.length ? `<div class="group">
      ${row(`${icon("calendar", "ic-s")} ${t("Fixkosten")}`, -r.openFixedTotal, "neg")}
      ${r.openFixed.map((x) => row(`${esc(x.name)} <small>${x.overdue ? t("überfällig") : t("um den {day}", { day: ord(x.day) })}</small>`, -x.amount_cents, "neg-soft", true)).join("")}
    </div>` : ""}
    ${r.expectedIncome.length ? `<div class="group">
      ${row(`${icon("trend", "ic-s")} ${t("Erwartete Einnahmen")}`, r.expectedIncomeTotal, "pos")}
      ${r.expectedIncome.map((x) => row(`${esc(x.name)} <small>${t("um den {day}", { day: ord(x.day) })}</small>`, x.amount_cents, "", true)).join("")}
    </div>` : ""}
    <button class="navrow ${hasOpen ? "after-groups" : ""}" data-action="goto-stats">
      <div class="bubble">${icon("chart")}</div>
      <div class="grow">${t("Aufstellung ansehen")}</div>
      <span class="navrow-value ${T.surplus >= 0 ? "pos" : "neg"}">${t("Überschuss {amount}", { amount: fmt0(T.surplus) })}</span>${icon("chevronRight")}
    </button>
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
      </button>`).join("") : `<div class="hint">${t("Keine Fixkosten in diesem Zeitraum. Welche Zahlungen als Fixkosten zählen, stellst du unter Einstellungen → Fixkosten ein.")}</div>`}
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
