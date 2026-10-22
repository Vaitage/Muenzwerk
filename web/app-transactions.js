// Münzwerk – Reiter „Umsätze“.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

// ------------------------------------------------------------------ Umsätze
function txRow(tx) {
  const cat = tx.category_id ? catById(tx.category_id) : null;
  const sug = cat ? null : suggestionFor(tx);
  const cls = state.ctx.classOf(tx);
  const chips = [];
  if (tx.pending) chips.push(`<span class="chip muted">${t("vorgemerkt")}</span>`);
  if (!cat) chips.push(`<span class="chip warn">${t("offen")}</span>`);
  if (cls === "fixed") chips.push(`<span class="chip">${t("fix")}</span>`);
  if (cls === "large") chips.push(`<span class="chip">${t("groß")}</span>`);
  if (tx.budget_month !== tx.booking_date.slice(0, 7)) chips.push(`<span class="chip">${t("zählt für {month}", { month: shortMonth(tx.budget_month) })}</span>`);
  return `
    <button class="tx ${tx.pending ? "pending" : ""}" data-tx="${esc(tx.id)}">
      <div class="bubble ${hueCls(cat)}">${icon(cat ? cat.icon : "help")}</div>
      <div class="mid">
        <div class="who">${esc(tx.counterparty || t("Unbekannt"))}</div>
        <div class="what">${cat ? esc(cat.name) : sug ? `<span class="sug-hint" title="${esc(t("Vorschlag"))}">${icon("sparkle", "ic-s")}${esc(sug.cat.name)}?</span>` : esc(t("Nicht zugeordnet"))}${chips.join("")}</div>
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
    <div class="list">${items.map(swipeRow).join("")}</div>`).join("");
}

// ------------------------------------------------------------------ Wischen in der Umsatzliste
// Nach links wischen zeigt Schnell-Aktionen: Vorschlag übernehmen (offene Zahlung) und
// Fixkosten an/aus. Alles geht weiterhin auch über das Umsatz-Fenster.
function swipeActions(tx) {
  const acts = [];
  const cat = tx.category_id ? catById(tx.category_id) : null;
  const sug = cat ? null : suggestionFor(tx);
  if (sug) acts.push(`<button class="swipe-act ok" data-swipe-cat="${sug.cat.id}" data-swipe-tx="${esc(tx.id)}">${icon("check")}<span>${esc(sug.cat.name)}</span></button>`);
  const pattern = A.norm(tx.counterparty);
  if (pattern && tx.amount_cents < 0 && !cat?.is_savings && !tx.pending) {
    const fixed = state.ctx.classOf(tx) === "fixed";
    acts.push(`<button class="swipe-act" data-swipe-fix="${fixed ? "0" : "1"}" data-swipe-tx="${esc(tx.id)}">${icon("calendar")}<span>${fixed ? t("Nicht fix") : t("Fixkosten")}</span></button>`);
  }
  return acts;
}

function swipeRow(tx) {
  const acts = swipeActions(tx);
  if (!acts.length) return txRow(tx);
  return `<div class="swipe" style="--acts:${acts.length}"><div class="swipe-acts">${acts.join("")}</div>${txRow(tx)}</div>`;
}

const SWIPE_W = 88;                 // Breite einer Aktion
let swipeOpen = null;               // gerade offene Zeile (.swipe)
let swipeDrag = null;

function closeSwipe(except) {
  if (swipeOpen && swipeOpen !== except) {
    swipeOpen.classList.remove("open");
    swipeOpen.querySelector(".tx").style.transform = "";
    swipeOpen = null;
  }
}

document.addEventListener("touchstart", (e) => {
  const row = e.target.closest(".swipe");
  if (!row || e.target.closest(".swipe-act")) { if (!e.target.closest(".swipe-act")) closeSwipe(); return; }
  closeSwipe(row);
  const t0 = e.touches[0];
  swipeDrag = { row, x: t0.clientX, y: t0.clientY, dx: 0, horiz: null, base: row.classList.contains("open") ? -SWIPE_W * Number(getComputedStyle(row).getPropertyValue("--acts")) : 0 };
}, { passive: true });

document.addEventListener("touchmove", (e) => {
  const d = swipeDrag;
  if (!d) return;
  const t0 = e.touches[0];
  const dx = t0.clientX - d.x, dy = t0.clientY - d.y;
  if (d.horiz === null && Math.abs(dx) + Math.abs(dy) > 8) d.horiz = Math.abs(dx) > Math.abs(dy);
  if (!d.horiz) return;
  const max = SWIPE_W * Number(getComputedStyle(d.row).getPropertyValue("--acts"));
  d.dx = Math.max(-max, Math.min(0, d.base + dx));
  d.row.classList.add("dragging");
  d.row.querySelector(".tx").style.transform = `translateX(${d.dx}px)`;
}, { passive: true });

document.addEventListener("touchend", () => {
  const d = swipeDrag;
  swipeDrag = null;
  if (!d || !d.horiz) return;
  const max = SWIPE_W * Number(getComputedStyle(d.row).getPropertyValue("--acts"));
  d.row.classList.remove("dragging");
  const open = d.dx < -max / 3;
  d.row.classList.toggle("open", open);
  d.row.querySelector(".tx").style.transform = open ? `translateX(${-max}px)` : "";
  swipeOpen = open ? d.row : null;
  d.row.dataset.justSwiped = "1";                 // der folgende Klick öffnet nicht das Fenster
  setTimeout(() => delete d.row.dataset.justSwiped, 350);
});

// Vor dem allgemeinen Klick-Handler: Aktionen ausführen, offene Zeile erst schließen
document.addEventListener("click", async (e) => {
  const act = e.target.closest(".swipe-act");
  const row = e.target.closest(".swipe");
  if (!act) {
    if (row && (row.dataset.justSwiped || row.classList.contains("open"))) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (!row.dataset.justSwiped) closeSwipe();
    }
    return;
  }
  e.stopImmediatePropagation(); e.preventDefault();
  const tx = state.transactions.find((x) => String(x.id) === act.dataset.swipeTx);
  closeSwipe();
  if (!tx) return;
  try {
    if (act.dataset.swipeCat) {
      // wie im Umsatz-Fenster: gleiche Empfänger mit, künftig immer so
      const res = await API.updateTransaction(tx.id, { set_category: true, category_id: Number(act.dataset.swipeCat), remember: true, apply_similar: true });
      let msg = t("Zugeordnet: {name}", { name: catById(Number(act.dataset.swipeCat))?.name || "" });
      if (res.also_assigned) msg += ` · ${t("{n} weitere mit zugeordnet", { n: res.also_assigned })}`;
      toast(msg, res.undo_count ? { label: t("Rückgängig"), run: undoLast } : undefined);
    } else if (act.dataset.swipeFix) {
      const fixed = act.dataset.swipeFix === "1";
      await setFixed(A.norm(tx.counterparty), fixed, state.ctx.recurring.get(A.recurringKey(tx)));
      toast(fixed ? t("Als Fixkosten markiert") : t("Nicht mehr als Fixkosten"));
    }
  } catch (err) { toast(err.message); }
  reload();
}, true);

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
