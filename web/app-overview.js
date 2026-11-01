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
    preview: A.fillPreview(r.preview, r.budgetLeft - planned, r.daysLeftIncl),
    // Prognose und Verlauf zeigen dasselbe „frei“ wie die Kernzahl
    forecastEnd: r.forecastEnd - planned,
    forecastLow: r.forecastLow - planned,
    forecastHigh: r.forecastHigh - planned,
    series: {
      actual: r.series.actual.map((p) => ({ ...p, value: p.value - planned })),
      forecast: r.series.forecast.map((p) => ({ ...p, value: p.value - planned, lo: p.lo - planned, hi: p.hi - planned })),
      typical: r.series.typical.map((p) => ({ ...p, value: p.value - planned })),
    },
  };
}

function viewOverview() {
  const r = withGoals(A.monthReport(state.month, state.ctx));
  const T = r.totals;
  const open = openCount();
  let html = bankNotices();
  if (r.status === "current") html += reviewCard();

  // Übrig im Monat, darunter Tagesbudget mit 3-Tage-Vorschau
  const heroLabel = r.status === "past" ? t("Übrig am Ende vom {month}", { month: monthName(r.month) }) : r.status === "future" ? t("Geplant übrig im {month}", { month: monthName(r.month) }) : t("Übrig bis Monatsende");
  const showDays = r.status === "current" && r.preview.length;
  html += `<section class="card hero">
    <div class="sub">${heroLabel}</div>
    <div class="big ${r.budgetLeft >= 0 ? "pos" : "neg"}" data-count="${r.budgetLeft}" data-count-key="left:${r.month}">${fmt(r.budgetLeft)}</div>
    ${showDays ? `<div class="per-day">${t("{amount}/Tag", { amount: fmt(r.preview[0].daily) })} · ${tn(r.daysLeftIncl, "noch {n} Tag", "noch {n} Tage")}</div>` : ""}
    ${flowBars(r)}
    ${standHtml(r)}
    ${showDays ? `
      <div class="days3">
        ${r.preview.map((p, i) => {
          const d = new Date(p.iso + "T12:00:00");
          const name = i === 0 ? t("Heute") : `${WEEKDAYS[d.getDay()]} ${ord(d.getDate())}`;
          return `<div class="day3 ${i === 0 ? "now" : ""}">
            <div class="k">${name}</div>
            <div class="v ${p.available >= 0 ? "" : "neg"}">${i === 0 ? fmt(p.available) : fmt0(p.available)}</div>
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

  if (r.status === "current") html += anomalyCards();

  html += forecastCard(r);

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

  html += topCategories(r.byCategory, T.expense);
  return html;
}

// Einnahmen und Ausgaben des Monats als zwei Balken: Ausgaben nach Kategorie (größte FLOW_TOP einzeln,
// der Rest grau), Gespartes, noch offene Fixkosten und eingeplante Sparrate schraffiert. Was rechts
// frei bleibt, ist genau „Übrig bis Monatsende“. Maßstab: das Größere von Einnahmen und Ausgaben.
// Darunter je Teil ein Symbol mit Betrag (ohne Namen); Antippen zeigt die Buchungen.
const FLOW_TOP = 4;
const num0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
function flowBars(r) {
  const T = r.totals;
  const cats = r.byCategory.filter((c) => c.total > 0);
  const parts = cats.slice(0, FLOW_TOP).map((c) => ({ cat: c, total: c.total, cls: c.id ? hueCls(c) : "none", icon: c.icon, name: c.name }));
  const rest = cats.slice(FLOW_TOP).reduce((s, c) => s + c.total, 0);
  if (rest > 0) parts.push({ kind: "rest", total: rest, cls: "rest", icon: "more", name: t("Weitere Kategorien") });
  if (T.savings > 0) parts.push({ kind: "save", total: T.savings, cls: "hue6", icon: "piggy", name: t("Gespart") });
  const pending = r.openFixedTotal + (r.goalPlanned || 0);
  if (pending > 0) parts.push({ kind: "open", total: pending, cls: "open", icon: "clock", name: t("Noch offen") });
  const spent = parts.reduce((s, p) => s + p.total, 0);
  const scale = Math.max(T.income, spent);
  if (scale <= 0) return "";
  const w = (x) => ((x / scale) * 100).toFixed(2) + "%";
  const label = (p) => `${p.name}: ${fmt0(p.total)}`;
  const chip = (p) => {
    const inner = `<span class="bubble ${p.cls}">${icon(p.icon)}</span><span class="amt">${num0.format(Math.round(p.total / 100))}</span>`;
    if (p.cat) return `<button class="flow-chip" data-statcat="${p.cat.id ?? "none"}" data-scope="overview" aria-label="${esc(label(p))}">${inner}</button>`;
    if (p.kind === "rest") return `<button class="flow-chip rest" data-action="goto-stats-cats" aria-label="${esc(label(p))}">${inner}</button>`;
    return `<div class="flow-chip ${p.kind}" role="img" aria-label="${esc(label(p))}">${inner}</div>`;
  };
  return `<div class="flow">
    <div class="flow-head"><span>${t("Einnahmen")}</span><b class="pos">${fmt0(T.income)}</b></div>
    <div class="flow-track" role="img" aria-label="${esc(`${t("Einnahmen")}: ${fmt0(T.income)}`)}"><i class="income" style="width:${w(T.income)}"></i></div>
    <div class="flow-head"><span>${t("Ausgaben")}${pending > 0 ? ` <small>· ${t("davon {amount} noch offen", { amount: fmt0(pending) })}</small>` : ""}</span><b>${fmt0(spent)}</b></div>
    <div class="flow-track" role="img" aria-label="${esc(`${t("Ausgaben")}: ${parts.map(label).join(", ")}`)}">
      ${parts.map((p) => `<i class="${p.cls}" style="width:${w(p.total)}"></i>`).join("")}
    </div>
    <div class="flow-chips">${parts.map(chip).join("")}</div>
  </div>`;
}

// ------------------------------------------------------------------ Prognose
// Linie = was bis Monatsende frei ist (wie die Kernzahl): grün im Plus, rot im Minus, darunter ein Schimmer
// in derselben Farbe bis zur Null-Linie. Gestrichelt die Prognose mit Spanne (Fächer), gepunktet „so läuft es
// sonst“ (Median der Vormonate), Symbole auf der Achse = noch offene Fixkosten an ihrem Tag.
const signed0 = (c) => (Math.round(c / 100) > 0 ? "+" : "") + fmt0(c);
const OUTLOOK = {
  ok: { label: "Im Plan", icon: "check" },
  tight: { label: "Knapp", icon: "alert" },
  minus: { label: "Im Minus", icon: "alert" },
  early: { label: "Noch früh", icon: "clock" },
};

function forecastCard(r) {
  const past = r.status === "past";
  const pts = (arr) => arr.map((p) => ({ x: p.day, y: p.value }));
  const actual = pts(r.series.actual), fc = pts(r.series.forecast), typ = pts(r.series.typical);
  const band = r.series.forecast.map((p) => ({ x: p.day, lo: p.lo, hi: p.hi }));
  const endPoint = fc.length ? fc.at(-1) : actual.at(-1);
  const lastDay = r.daysLeftIncl ? r.days : null;
  chartHandlers.month = (frac) => {
    const day = Math.round(1 + frac * (r.days - 1));
    const a = actual.find((p) => p.x === day);
    const f = r.series.forecast.find((p) => p.day === day);
    if (!a && !f) return null;
    const range = !a && f.hi > f.lo ? ` <small>(${fmt0(f.lo)} – ${fmt0(f.hi)})</small>` : "";
    return {
      frac: (day - 1) / Math.max(1, r.days - 1),
      html: `<b>${t("{day} {month}", { day: ord(day), month: shortMonth(r.month) })}</b><br>${a ? t("frei") : t("Prognose")}: ${fmt0(a ? a.y : f.value)}${range}`,
    };
  };

  const o = OUTLOOK[r.outlook];
  const pill = o ? `<span class="outlook ${r.outlook}">${icon(o.icon)}${t(o.label)}</span>` : "";
  const rangeLine = !past && r.forecastHigh > r.forecastLow
    ? `<div class="fc-range">${t("wahrscheinlich zwischen {lo} und {hi}", { lo: `<b>${signed0(r.forecastLow)}</b>`, hi: `<b>${signed0(r.forecastHigh)}</b>` })}</div>` : "";

  // Ein Satz in Klartext
  let say = "";
  if (r.status === "current" && r.daysLeftIncl > 1) {
    const vars = { day: ord(lastDay), daily: fmt0(r.remainingDaily), amount: `<b>${fmt0(Math.abs(r.forecastEnd))}</b>` };
    if (r.outlook === "minus") {
      const remDays = r.days - r.elapsed;
      const max = (r.budgetLeft + r.expectedIncomeTotal) / Math.max(1, remDays);
      say = t("Bei etwa {daily}/Tag fehlen dir bis zum {day} rund {amount}.", vars)
        + (max > 100 ? " " + t("Mit höchstens {max}/Tag kommst du ohne Minus hin.", { max: `<b>${fmt0(max)}</b>` }) : "");
    } else if (r.outlook === "early") say = t("Wenn du ausgibst wie sonst, bleiben dir rund {amount}.", vars);
    else say = t("Gibst du bis zum {day} weiter etwa {daily}/Tag aus, bleiben dir rund {amount}.", vars);
    if (r.openFixed.length) say += " " + t("Noch offene Fixkosten sind schon eingerechnet.");
  } else if (r.status === "future") {
    say = t("Wenn du ausgibst wie sonst, bleiben dir rund {amount}.", { amount: `<b>${fmt0(Math.abs(r.forecastEnd))}</b>` });
  }

  // Was die Prognose gelernt hat
  let learn = "";
  if (!past) {
    if (r.learnedMonths >= 3) {
      const share = r.firstHalfShare;
      const rhythm = share == null ? "" : share > 0.58 ? t("In der ersten Monatshälfte gibst du meist mehr aus als danach.")
        : share < 0.42 ? t("In der zweiten Monatshälfte gibst du meist mehr aus.") : t("Deine Ausgaben verteilen sich recht gleichmäßig über den Monat.");
      learn = `${t("Gelernt aus {n} Monaten:", { n: r.learnedMonths })} ${rhythm}`
        + (r.status === "current" ? " " + t("Dieser Monat zählt schon zu {p} %.", { p: Math.round(r.weight * 100) }) : "");
    } else if (r.status === "current") {
      learn = t("Noch zu wenige Vormonate zum Lernen – gerechnet wird mit deinen Ausgaben in diesem Monat.");
    }
  }

  const xs = Array.from({ length: r.days }, (_, i) => i + 1);
  const markers = past ? [] : r.openFixed.map((x) => ({ x: x.day, icon: catById(x.category_id)?.icon || "calendar", label: x.name }));
  const chart = endPoint ? forecastChart({
    id: "month", xs, actual, fc, band, typ,
    today: r.status === "current" ? r.elapsed : null,
    markers,
    aria: past ? `${t("Am Monatsende frei")}: ${fmt0(r.forecastEnd)}`
      : `${t("Prognose")} ${fmt0(r.forecastEnd)}${r.forecastHigh > r.forecastLow ? `, ${fmt0(r.forecastLow)} – ${fmt0(r.forecastHigh)}` : ""}`,
  }) : "";

  return `<section class="card fc-card">
    <div class="fc-head"><h2>${past ? t("Verlauf im Monat") : t("Prognose Monatsende")}</h2>${pill}</div>
    <div class="fc-big"><span class="big2 ${r.forecastEnd >= 0 ? "pos" : "neg"}">${signed0(r.forecastEnd)}</span>
      <span class="sub">${past ? t("am Monatsende übrig geblieben") : t("voraussichtlich")}</span></div>
    ${rangeLine}
    ${chart}
    ${!past && fc.length ? `<div class="legend fc-legend">
      ${actual.length ? `<span><i class="sw fc-sw-line"></i>${t("bisher")}</span>` : ""}
      <span><i class="sw fc-sw-band"></i>${t("Prognose mit Spanne")}</span>
      ${typ.length ? `<span><i class="sw fc-sw-typ"></i>${t("so läuft es sonst")}</span>` : ""}
    </div>` : ""}
    ${say ? `<p class="fc-say">${say}</p>` : ""}
    ${learn ? `<p class="fc-learn">${icon("sparkle")}<span>${esc(learn)}</span></p>` : ""}
  </section>`;
}

function forecastChart({ id, xs, actual, fc, band, typ, today, markers, aria }) {
  const all = [0, ...actual.map((p) => p.y), ...fc.map((p) => p.y), ...band.flatMap((p) => [p.lo, p.hi]), ...typ.map((p) => p.y)];
  let min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.12 || 10000;
  min -= pad; max += pad;
  const [x0, x1] = [xs[0], xs[xs.length - 1]];
  const X = (x) => CH.l + ((x - x0) / Math.max(1, x1 - x0)) * (CH.w - CH.l - CH.r);
  const Y = (y) => CH.t + (1 - (y - min) / (max - min)) * (CH.h - CH.t - CH.b);
  const top = CH.t, bot = CH.h - CH.b, y0 = Y(0);
  const z = ((y0 - top) / (bot - top)).toFixed(4);   // Lage der Null-Linie im Verlauf
  const line = (ps) => ps.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const grid = niceTicks(min, max).map((v) => `<line x1="${CH.l}" x2="${CH.w - CH.r}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? "zero" : "grid"}"/>
    <text x="${CH.w - CH.r}" y="${Y(v) - 3}" class="ytick" text-anchor="end">${esc(fmt0(v))}</text>`).join("");
  const labelDays = [...new Set([1, today, xs.length].filter(Boolean))];
  const xt = labelDays.map((d) => `<text x="${X(d)}" y="${CH.h - 4}" class="xtick" text-anchor="${d === 1 ? "start" : d === xs.length ? "end" : "middle"}">${esc(ord(d))}</text>`).join("");
  const sg = `fc-s-${id}`, ag = `fc-a-${id}`;
  const defs = `<defs>
    <linearGradient id="${sg}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${top}" y2="${bot}">
      <stop offset="${z}" class="fc-pos"/><stop offset="${z}" class="fc-neg"/></linearGradient>
    <linearGradient id="${ag}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${top}" y2="${bot}">
      <stop offset="0" class="fc-pos" stop-opacity="0.26"/><stop offset="${z}" class="fc-pos" stop-opacity="0.03"/>
      <stop offset="${z}" class="fc-neg" stop-opacity="0.03"/><stop offset="1" class="fc-neg" stop-opacity="0.26"/></linearGradient>
  </defs>`;
  const area = actual.length > 1
    ? `<path d="${line(actual)}L${X(actual.at(-1).x)},${y0}L${X(actual[0].x)},${y0}Z" fill="url(#${ag})"/>` : "";
  const fan = band.length > 1
    ? `<path d="${band.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.hi).toFixed(1)}`).join("")}${band.slice().reverse().map((p) => `L${X(p.x).toFixed(1)},${Y(p.lo).toFixed(1)}`).join("")}Z" fill="url(#${ag})" class="fc-fan"/>` : "";
  const typLine = typ.length > 1 ? `<path d="${line(typ)}" class="fc-typ"/>` : "";
  const act = actual.length > 1 ? `<path d="${line(actual)}" class="fc-line" stroke="url(#${sg})"/>` : "";
  const fut = fc.length > 1 ? `<path d="${line(fc)}" class="fc-line fc-dash" stroke="url(#${sg})"/>` : "";
  const now = today && actual.length ? `<line x1="${X(today)}" x2="${X(today)}" y1="${top}" y2="${bot}" class="fc-today"/>
    <circle cx="${X(actual.at(-1).x)}" cy="${Y(actual.at(-1).y)}" r="4.5" class="fc-now ${actual.at(-1).y >= 0 ? "pos" : "neg"}"/>` : "";
  const end = fc.length ? fc.at(-1) : actual.at(-1);
  const endDot = end ? `<circle cx="${X(end.x)}" cy="${Y(end.y)}" r="4" class="fc-end ${end.y >= 0 ? "pos" : "neg"}"/>` : "";
  // Fixkosten dicht beieinander: nur ein Symbol je ~16 px, die übrigen stehen im Tooltip daneben
  const kept = [];
  for (const m of [...markers].sort((a, b) => a.x - b.x)) {
    const last = kept.at(-1);
    if (last && X(m.x) - X(last.x) < 16) last.label += `, ${m.label}`;
    else kept.push({ ...m });
  }
  const marks = kept.map((m) => `<g class="fc-mark"><title>${esc(m.label)}</title>
    <circle cx="${X(m.x)}" cy="${bot}" r="8"/>
    <svg class="fc-ic" x="${X(m.x) - 5.5}" y="${bot - 5.5}" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${window.ICONS[m.icon] || window.ICONS.calendar}</svg></g>`).join("");
  return `<div class="chart fc-chart" data-chart="${id}">
    <svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="${esc(aria)}">
      ${defs}${grid}${xt}${area}${fan}${typLine}${act}${fut}${now}${endDot}${marks}
      <line class="cross" y1="${top}" y2="${bot}" x1="0" x2="0" visibility="hidden"/>
      <rect class="hit" x="0" y="0" width="${CH.w}" height="${CH.h}"/>
    </svg><div class="tip" hidden></div></div>`;
}

// ------------------------------------------------------------------ Rückblick und Auffälligkeiten
const dismissed = (id) => (state.settings.dismissed_hints || []).includes(id);
const closeBtn = (id) => `<button class="hint-close" data-dismiss="${esc(id)}" aria-label="${t("Ausblenden")}">✕</button>`;

// Zum Monatsanfang: Rückblick auf den Vormonat (so viele Tage wie eingestellt, wegklickbar)
function reviewCard() {
  const days = state.settings.review_days ?? 3;
  if (!days || state.ctx.todayDay > days) return "";
  const rv = A.monthReview(state.ctx);
  if (!rv || dismissed(`review:${rv.month}`)) return "";
  const goals = (state.goalRep?.goals || []).filter((g) => !g.reached || g.saved);
  const line = (label, value, cls = "") => `<div class="line-row"><span>${label}</span><span class="${cls}">${value}</span></div>`;
  return `<section class="card review">
    <div class="review-head"><h2>${icon("sparkle", "ic-s")} ${t("Rückblick {month}", { month: monthName(rv.month) })}</h2>${closeBtn(`review:${rv.month}`)}</div>
    <div class="review-big ${rv.left >= 0 ? "pos" : "neg"}">${rv.left >= 0 ? "+" : ""}${fmt(rv.left)}</div>
    <div class="hint" style="text-align:center;margin-bottom:8px">${rv.left >= 0 ? t("übrig geblieben") : t("mehr ausgegeben als eingenommen")}</div>
    ${line(t("Ausgaben"), `${fmt(rv.expense)}${rv.expenseChange !== null ? ` <small class="${rv.expenseChange > 0 ? "neg" : "pos"}">${rv.expenseChange > 0 ? "▲" : "▼"} ${Math.abs(rv.expenseChange)} %</small>` : ""}`)}
    ${rv.saved > 0 ? line(t("Aufs Sparkonto"), fmt(rv.saved)) : ""}
    ${rv.biggest ? line(t("Größte Ausgabe"), `<span class="ell">${esc(rv.biggest.counterparty || t("Unbekannt"))}</span> · ${fmt0(-rv.biggest.amount_cents)}`) : ""}
    ${rv.top ? line(t("Meiste Ausgaben"), `<span class="ell">${esc(rv.top.name)}</span> · ${fmt0(rv.top.total)}`) : ""}
    ${goals.map((g) => line(esc(g.goal.name), `${fmt0(g.saved)} / ${fmt0(g.goal.target_cents)}`)).join("")}
    <button class="navrow after-groups" data-action="goto-review" data-review-month="${rv.month}">
      <div class="bubble">${icon("chart")}</div><div class="grow">${t("Ganzen Monat ansehen")}</div>${icon("chevronRight")}
    </button>
  </section>`;
}

function anomalyText(h) {
  if (h.kind === "category") {
    const c = catById(h.categoryId);
    return {
      title: t("{name} höher als sonst", { name: c ? c.name : t("Kategorie") }),
      text: t("{now} bis heute – sonst um diese Zeit etwa {usual}", { now: fmt0(h.current), usual: fmt0(h.usual) })
        + (h.percent !== null ? ` (+${h.percent} %)` : ""),
      cat: c,
    };
  }
  return {
    title: t("Doppelt abgebucht?"),
    text: t("{amount} an {name}, zweimal innerhalb von {days} Tagen", { amount: fmt(h.amount), name: h.counterparty, days: 3 }),
  };
}

function anomalyCards() {
  const list = A.anomalies(state.ctx).filter((h) => !dismissed(h.id)).slice(0, 3);
  return list.map((h) => {
    const x = anomalyText(h);
    return `<div class="hint-card">
      <button class="hint-main" data-hint="${esc(h.id)}">
        <div class="bubble ${x.cat ? hueCls(x.cat) : "warnb"}">${icon(x.cat ? x.cat.icon : "receipt")}</div>
        <div class="grow"><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div>
      </button>
      ${closeBtn(h.id)}
    </div>`;
  }).join("");
}

// Antippen einer Auffälligkeit: die betroffenen Buchungen zeigen
function openHint(id) {
  const h = A.anomalies(state.ctx).find((x) => x.id === id);
  if (!h) return;
  const x = anomalyText(h);
  const list = h.kind === "category"
    ? (state.ctx.byMonth.get(state.ctx.currentMonth) || []).filter((tx) => tx.category_id === h.categoryId && tx.amount_cents < 0)
    : state.transactions.filter((tx) => h.ids.includes(tx.id));
  openTxListSheet(x.title, x.text, sortTx(list), () => openHint(id));
}

// Übersicht: nur die drei größten Kategorien als Kacheln; alle stehen in der Statistik
function topCategories(list, total) {
  const top = list.filter((c) => c.id).slice(0, 3);
  if (!top.length) return "";
  return `<section class="card">
    <h2>${t("Größte Ausgaben")}</h2>
    <div class="top3">
      ${top.map((c) => `<button class="top3-tile ${hueCls(c)}" data-statcat="${c.id}" data-scope="overview">
        <div class="bubble ${hueCls(c)}">${icon(c.icon)}</div>
        <div class="top3-name">${esc(c.name)}</div>
        <div class="top3-amt">${fmt0(c.total)}</div>
        <div class="bar"><i style="width:${Math.round((c.total / Math.max(1, total)) * 100)}%"></i></div>
        <div class="hint">${Math.round((c.total / Math.max(1, total)) * 100)} %</div>
      </button>`).join("")}
    </div>
    <button class="navrow after-groups" data-action="goto-stats-cats">
      <div class="bubble">${icon("pie")}</div>
      <div class="grow">${t("Alle Kategorien")}</div>${icon("chevronRight")}
    </button>
  </section>`;
}

// scope: aus welchem Zeitraum die Liste beim Antippen kommt ("stats" oder "overview")
function categoryCard(list, total, title, { scope = "overview", head = "" } = {}) {
  const max = Math.max(1, ...list.map((c) => c.total));
  return `<section class="card" id="cat-card-${scope}">
    <h2>${title}</h2>${head}
    ${list.length ? list.map((c) => `
      <button class="catrow ${c.id ? hueCls(c) : ""}" data-statcat="${c.id ?? "none"}" data-scope="${scope}">
        <div class="bubble ${c.id ? hueCls(c) : "none"}">${icon(c.icon)}</div>
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
      <button class="catrow ${g.cat ? hueCls(g.cat) : ""}" data-statfix="${esc(g.key)}">
        <div class="bubble ${g.cat ? hueCls(g.cat) : ""}">${icon(g.cat?.icon || "receipt")}</div>
        <div class="name"><div>${esc(g.name)} <small class="hint">${g.count}×</small></div><div class="bar"><i style="width:${(g.total / max) * 100}%"></i></div></div>
        <div class="amt">${fmt(g.total)}<small>${Math.round((g.total / Math.max(1, T.expense)) * 100)} %</small></div>
      </button>`).join("") : `<div class="hint">${t("Keine Fixkosten in diesem Zeitraum. Welche Zahlungen als Fixkosten zählen, stellst du unter Einstellungen → Fixkosten ein.")}</div>`}
  </section>`;
}

// Liste von Umsätzen in einem Fenster; Antippen öffnet den Umsatz, "Zurück" kommt hierher zurück
function openTxListSheet(title, sub, list, reopen, top = "") {
  const sorted = sortTx(list);
  const total = sorted.reduce((sum, t) => sum + t.amount_cents, 0);
  const sheet = openSheet(`
    <h3>${esc(title)}</h3>
    <div class="meta">${esc(sub)} · ${tn(sorted.length, "{n} Umsatz", "{n} Umsätze")} · ${signed(total)}</div>
    ${top}
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

// Statistik: alle Eingänge des Zeitraums (kind: "all" | "income_regular" | "income_variable"),
// oben je Kategorie zusammengefasst, darunter jede einzelne Buchung
function openIncomeList(kind) {
  const isIncome = (c) => (kind === "all" ? c === "income_regular" || c === "income_variable" : c === kind);
  const list = statsPeriodList().filter((t) => t.amount_cents > 0 && isIncome(state.ctx.classOf(t)));
  const byCat = new Map();
  for (const t of list) byCat.set(t.category_id ?? null, (byCat.get(t.category_id ?? null) || 0) + t.amount_cents);
  const rows = [...byCat].sort((a, b) => b[1] - a[1]).map(([id, cents]) =>
    `<div class="line-row"><span>${esc(id == null ? t("Nicht zugeordnet") : catById(id)?.name || t("Kategorie"))}</span><span class="pos">${fmt(cents)}</span></div>`).join("");
  const title = kind === "income_regular" ? t("Regelmäßiges Einkommen") : kind === "income_variable" ? t("Variables Einkommen") : t("Einkommen");
  const top = byCat.size > 1 ? `<div class="income-split">${rows}</div>` : "";
  openTxListSheet(title, statsPeriodLabel(), list, () => openIncomeList(kind), top);
}

function openFixedList(key) {
  const list = statsPeriodList().filter((t) => t.amount_cents < 0 && state.ctx.classOf(t) === "fixed" && A.recurringKey(t) === key);
  openTxListSheet(list[0]?.counterparty || t("Fixkosten"), `${t("Fixkosten")} · ${statsPeriodLabel()}`, list, () => openFixedList(key));
}
