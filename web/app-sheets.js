// Münzwerk – Fenster für einen Umsatz und zum Anlegen einer Kategorie.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

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
    <div class="cur-cat">
      <div class="bubble ${curCat ? "" : "none"}">${icon(curCat ? curCat.icon : "inbox")}</div>
      <div><span class="hint">${t("Kategorie")}</span><b>${curCat ? esc(curCat.name) : t("Noch keine – unten auswählen")}</b></div>
    </div>
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
