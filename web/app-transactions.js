// Münzwerk – Reiter „Umsätze“.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

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
  if (!list.length) {
    const b = state.bank;
    return seg + emptyState("list", t("Keine Umsätze in diesem Monat"),
      b.state === "none" ? t("Verbinde deine Bank, dann erscheinen die Umsätze hier.") : t("Neue Umsätze kommen beim nächsten Abruf."),
      b.state === "none" ? { label: t("Bank verbinden"), action: "goto-settings" } : { label: t("Jetzt abrufen"), action: "sync" });
  }
  return seg + groupedList(list);
}
