// Münzwerk – Reiter „Statistik“ mit Heatmap.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

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

  // Abschnitte statt einer langen Seite; den Kalender gibt es nur für Monat und Jahr
  const sections = [["over", "chart", t("Überblick")], ...(p !== "all" ? [["cal", "calendar", t("Kalender")]] : []), ["cats", "pie", t("Kategorien")]];
  const sec = sections.some(([k]) => k === state.statsSection) ? state.statsSection : "over";
  html += `<nav class="sec-tabs" aria-label="${t("Bereich der Statistik")}" style="--n:${sections.length};--i:${sections.findIndex(([k]) => k === sec)}">
      <span class="sec-pill" aria-hidden="true"></span>
      ${sections.map(([k, ic, name]) => `<button data-ssec="${k}" aria-pressed="${k === sec}">${icon(ic)}<span>${name}</span></button>`).join("")}
    </nav>`;
  if (sec === "cal") return html + `<div class="sec-body">${heatCard(p, value)}</div>`;
  if (sec === "cats") return html + `<div class="sec-body">${expenseCard(s, T)}</div>`;
  html += `<div class="sec-body">`;

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
  const kpi = (ic, name, cents, prev, goodUp, cls = "", link = false) => `
    <div class="kpi-row">
      <div class="bubble">${icon(ic)}</div>
      <div class="grow"><div>${name}</div>${cmp(cents, prev, goodUp)}${p !== "month" && s.monthsWithData > 1 ? `<div class="hint">${t("Ø {amount} pro Monat", { amount: fmt0(cents / s.monthsWithData) })}</div>` : ""}</div>
      <div class="val ${cls}">${fmt(cents)}</div>${link ? icon("chevronRight", "kpi-chev") : ""}
    </div>`;
  html += `<section class="card">
    <button class="kpi-link" data-statincome="all" aria-label="${t("Einkommen im Einzelnen anzeigen")}">${kpi("wallet", t("Einkommen"), T.income, P.income, true, "pos", true)}</button>
    ${kpi("basket", t("Ausgaben"), T.expense, P.expense, false, "neg")}
    <button class="kpi-link" data-tab="wealth" aria-label="${t("Ersparnisse anzeigen")}">${kpi("piggy", t("Ersparnisse"), T.savings, P.savings, true, "", true)}</button>
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
  const incomeRow = (kind, label, cents, sub, cls) => `<button class="line-row line-link ${sub ? "sub-row" : ""}" data-statincome="${kind}"><span>${label}</span><span class="${cls}">${fmt(cents)}${icon("chevronRight", "kpi-chev")}</span></button>`;
  html += `<section class="card">
    <h2>${t("Aufschlüsselung")}</h2>
    <div class="group">${incomeRow("all", t("Einkommen"), T.income, false, "pos")}${incomeRow("income_regular", t("Regelmäßig"), T.income_regular, true, "pos-soft")}${incomeRow("income_variable", t("Variabel"), T.income_variable, true, "pos-soft")}</div>
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

  return html + `</div>`;
}

// ------------------------------------------------------------------ Heatmap (Statistik)
// Monat: Kalender, jeder Tag so kräftig, wie viel an dem Tag ausgegeben wurde; Antippen zeigt die Buchungen.
// Jahr: jeder Tag ein Punkt, darunter der Schnitt je Wochentag.
function heatCard(p, value) {
  const mode = state.heatMode;
  const wdNames = [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAYS[i]);
  const modeSeg = `<div class="seg seg-sm" role="group" aria-label="${t("Welche Ausgaben")}">
      <button data-heatmode="variable" aria-pressed="${mode === "variable"}">${t("Variable Ausgaben")}</button>
      <button data-heatmode="all" aria-pressed="${mode === "all"}">${t("Alle Ausgaben")}</button>
    </div>`;
  const legend = `<div class="heat-legend" aria-hidden="true">${t("weniger")} ${[0, 1, 2, 3, 4].map((l) => `<i class="hl${l}"></i>`).join("")} ${t("mehr")}</div>`;
  if (p === "month") {
    const h = A.heatMonth(state.ctx, value, mode);
    const sel = h.days.find((d) => d.iso === state.heatDay);
    const dayLabel = (d) => new Date(d.iso + "T12:00:00").toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
    // Kennzahlen zum Monat (nur vergangene Tage inkl. heute)
    const past = h.days.filter((d) => !d.future);
    const top = past.reduce((a, d) => (!a || d.cents > a.cents ? d : a), null);
    const free = past.filter((d) => !d.cents).length;
    const facts = past.length ? `<div class="heat-facts">
        <div><span>${t("Ø pro Tag")}</span><b>${fmt0(h.total / past.length)}</b><small>${t("bis heute")}</small></div>
        <div><span>${t("Teuerster Tag")}</span><b>${top && top.cents ? fmt0(top.cents) : "–"}</b><small>${top && top.cents ? `${WEEKDAYS[new Date(top.iso + "T12:00:00").getDay()]} ${ord(top.day)}` : "&nbsp;"}</small></div>
        <div><span>${t("Ausgabenfrei")}</span><b>${free}</b><small>${tn(free, "Tag", "Tage")} ${t("von {n}", { n: past.length })}</small></div>
      </div>` : "";
    return `<section class="card heat">
      <h2>${t("Ausgaben nach Tag")}</h2>
      ${modeSeg}
      <div class="hm-grid">
        ${wdNames.map((w) => `<div class="hm-dow" aria-hidden="true">${w}</div>`).join("")}
        ${"<div></div>".repeat(h.offset)}
        ${h.days.map((d) => d.future
          ? `<div class="hm fut" aria-hidden="true">${d.day}</div>`
          : `<button class="hm hl${d.level} ${sel === d ? "sel" : ""}" data-heatday="${d.iso}" aria-pressed="${sel === d}"
              aria-label="${esc(dayLabel(d))}: ${fmt(d.cents)}">${d.day}</button>`).join("")}
      </div>
      ${legend}
      ${facts}
      ${sel ? `<div class="heat-day">
        <div class="line-row"><span>${esc(dayLabel(sel))}</span><span>${fmt(sel.cents)}</span></div>
        ${sel.items.length ? `<div class="list">${[...sel.items].sort((a, b) => a.amount_cents - b.amount_cents).map(txRow).join("")}</div>`
          : `<div class="hint">${t("An diesem Tag keine Ausgaben.")}</div>`}
      </div>` : `<p class="note">${t("Tippe auf einen Tag, um seine Ausgaben zu sehen.")}</p>`}
    </section>`;
  }
  const y = A.heatYear(state.ctx, value, mode);
  const weeks = [];
  const cells = [...Array(y.offset).fill(null), ...y.days];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const maxAvg = Math.max(1, ...y.weekdays.map((w) => w.avg));
  return `<section class="card heat">
    <h2>${t("Ausgaben nach Tag")}</h2>
    ${modeSeg}
    <div class="hy" aria-hidden="true">${weeks.map((w) => `<div class="hy-wk">${w.map((d) => `<i class="${d ? (d.future ? "fut" : `hl${d.level}`) : "pad"}"></i>`).join("")}</div>`).join("")}</div>
    ${legend}
    <div class="hy-wd">${y.weekdays.map((w, i) => `<div><div class="hy-bar"><i style="height:${Math.round((w.avg / maxAvg) * 100)}%"></i></div>
      ${wdNames[i]}<b>${fmt0(w.avg)}</b></div>`).join("")}</div>
    <p class="note">${y.top.avg > 0 ? t("Durchschnitt je Wochentag · {day} ist dein teuerster Tag.", { day: [t("Montag"), t("Dienstag"), t("Mittwoch"), t("Donnerstag"), t("Freitag"), t("Samstag"), t("Sonntag")][y.top.wd] }) : t("Noch keine Ausgaben in diesem Jahr.")}</p>
  </section>`;
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
