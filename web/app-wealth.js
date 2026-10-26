// Münzwerk – Reiter „Vermögen“: Konten, Sparziele, Ersparnisse.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

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
    const p = a.loanPayment;
    const paid = p ? (p.paid ? ` · ${t("{month}-Rate abgebucht ✓", { month: shortMonth(p.month) })}`
      : p.late ? ` · ${t("{month}-Rate noch nicht abgebucht", { month: shortMonth(p.month) })}` : "") : "";
    if (l.payoffMonth) return t("{amount} im Monat · schuldenfrei ca. {month}", { amount: fmt0(l.payment), month: `${shortMonth(l.payoffMonth)} ${l.payoffMonth.slice(0, 4)}` }) + paid;
    return l.payment ? t("Rate deckt die Zinsen nicht") : t("Rate und Zins fehlen noch");
  }
  if (a.type === "depot" && a.depot) {
    const d = a.depot;
    return `${d.gain >= 0 ? "+" : ""}${fmt0(d.gain)} (${decimal(d.gainPct * 100, 1)} %) ${t("seit {date}", { date: dateDE(d.since) })}`;
  }
  if (a.type === "savings") {
    const parts = [];
    if (a.monthlyIn) parts.push(t("zuletzt {amount} im Monat", { amount: `${a.monthlyIn > 0 ? "+" : ""}${fmt0(a.monthlyIn)}` }));
    if (a.interest >= 100) parts.push(t("inkl. ca. {amount} Zinsen", { amount: fmt0(a.interest) }));
    if (parts.length) return parts.join(" · ");
  }
  // Vorgemerkte Ausgaben ohne Minus, wie in der Übersicht; Eingänge mit "+"
  const pending = a.pendingCents ? t("inkl. {amount} vorgemerkt", { amount: a.pendingCents < 0 ? fmt(-a.pendingCents) : `+${fmt(a.pendingCents)}` }) : "";
  if (a.estimated && a.lastValueDate) return t("fortgeschrieben seit {date}", { date: dateDE(a.lastValueDate) }) + (pending ? `, ${pending}` : "");
  if (pending) return `${t("von der Bank")}, ${pending}`;
  return a.bank ? t("von der Bank") : t("von Hand");
}

// Ersparnisse: wohin das Geld geht (aus den Überweisungen, ohne Kontostände)
const CHECK_TEXT = {
  like_other: () => t("Gleicher Empfänger und Zweck wie eine Ersparnis, zählt hier aber nicht als Ersparnis"),
  words: () => t("Klingt nach Sparen, zählt aber als Ausgabe"),
  card: () => t("Kartenzahlung in einem Spartopf – eher ein Einkauf?"),
};
// ------------------------------------------------------------------ Sparziele (Vermögen)
// Das Geld bleibt auf dem Girokonto: die Rate ist im Tagesbudget eingeplant, fürs Ziel zählt,
// was am Monatsende übrig bleibt (höchstens die Rate). Rechnung: A.goalsReport.
const GOAL_ICONS = ["piggy", "plane", "home", "car", "gift", "shield", "heart", "laptop", "graduation", "paw", "shirt", "coins"];

function goalStatus(g) {
  const gl = g.goal;
  if (g.status === "reached") return { cls: "ok", text: t("erreicht im {month}", { month: monthLabel(g.reached) }) };
  if (!gl.target_month) return g.reach ? { cls: "", text: t("erreicht ca. {month}", { month: monthLabel(g.reach) }) } : { cls: "late", text: t("nicht absehbar") };
  if (g.status === "ok") return { cls: "ok", text: t("im Plan") };
  if (g.reach == null) return { cls: "late", text: t("nicht absehbar") };
  return { cls: g.status === "tight" ? "tight" : "late", text: tn(g.lateBy, "{n} Monat zu spät", "{n} Monate zu spät") };
}

function goalRow(g) {
  const gl = g.goal;
  const pct = (c) => Math.max(0, Math.min(100, (c / gl.target_cents) * 100));
  const st = goalStatus(g);
  const lines = [];
  if (g.rate > 0) lines.push([t("Diesen Monat eingeplant"), t("{amount} · {day} pro Tag", { amount: fmt0(g.rate), day: fmt(Math.round(g.perDay)) })]);
  if (g.status !== "reached") {
    lines.push([t("Kommt diesen Monat voraussichtlich dazu"), `<span class="${g.expectedNow >= 0 ? "pos" : "neg"}">${signed(g.expectedNow)}</span>`]);
    lines.push([t("Wenn du weiter so ausgibst"), g.reach ? t("erreicht {month}", { month: monthLabel(g.reach) }) : t("nicht absehbar")]);
    if (gl.target_month && g.status !== "ok" && g.needNext) {
      lines.push([t("Für {month} nötig ab {next}", { month: monthLabel(gl.target_month), next: monthName(addMonths(thisMonth, 1)) }), t("{amount} pro Monat", { amount: fmt0(g.needNext) })]);
    }
  }
  const months = [...g.history.map((h) => ({ label: shortMonth(h.month), cents: h.credit, run: false })),
    ...(g.status === "reached" ? [] : [{ label: t("{month} (läuft)", { month: shortMonth(thisMonth) }), cents: g.expectedNow, run: true }])];
  return `<div class="goal">
    <button class="goal-head" data-goal="${gl.id}" aria-label="${t("Sparziel bearbeiten: {name}", { name: esc(gl.name) })}">
      <div class="bubble">${icon(gl.icon)}</div>
      <div class="grow"><b>${esc(gl.name)}</b><div class="hint">${gl.target_month ? t("bis {month}", { month: monthLabel(gl.target_month) }) : t("{amount} pro Monat", { amount: fmt0(gl.monthly_cents) })} · ${t("bleibt auf dem Girokonto")}</div></div>
      <b class="goal-sum">${fmt0(g.saved)} / ${fmt0(gl.target_cents)}</b>
    </button>
    <div class="pbar" role="img" aria-label="${t("{saved} von {target} gespart", { saved: fmt0(g.saved), target: fmt0(gl.target_cents) })}">
      <i style="width:${pct(g.saved)}%"></i>
      ${g.expectedNow > 0 && g.status !== "reached" ? `<u style="left:${pct(g.saved)}%;width:${pct(g.saved + g.expectedNow) - pct(g.saved)}%"></u>` : ""}
      ${g.planned != null && g.status !== "reached" ? `<b style="left:${pct(g.planned)}%"></b>` : ""}
    </div>
    <div class="goal-meta"><span>${g.planned != null && g.status !== "reached" ? t("Strich = laut Plan bis jetzt {amount}", { amount: fmt0(g.planned) }) : ""}</span><span class="goal-st ${st.cls}">${st.text}</span></div>
    ${lines.length ? `<div class="goal-box">${lines.map(([a, b]) => `<div class="line-row"><span>${a}</span><span>${b}</span></div>`).join("")}</div>` : ""}
    ${months.length ? `<div class="goal-months">${months.map((m) => `<div>${esc(m.label)}<b class="${m.run ? "" : m.cents > 0 ? "pos" : m.cents < 0 ? "neg" : ""}">${m.run ? "~" : ""}${signed(m.cents).replace(/,\d\d(?=\s?€)/, "")}</b></div>`).join("")}</div>` : ""}
  </div>`;
}

function goalsCard() {
  if (!API.goals) return "";
  const rep = state.goalRep || { goals: [] };
  // Kontrolle: Liegt auf dem Girokonto weniger, als fürs Ziel gezählt ist?
  let check = "";
  const saved = rep.goals.reduce((s, g) => s + g.saved, 0);
  const giro = A.wealth(state.ctx, state.accounts).items.find((a) => a.type === "giro" && a.current != null);
  if (giro && saved > 0 && giro.current < saved) {
    check = `<div class="setup-hint">${icon("help")}<div><b>${t("Weniger auf dem Konto als gespart")}</b>
      <span>${t("Auf dem Girokonto liegen {balance}, für Sparziele gezählt sind {saved}. Überweisungen auf ein Sparkonto sind auch gespart – dann passt es trotzdem.", { balance: fmt(giro.current), saved: fmt(saved) })}</span></div></div>`;
  }
  return `<section class="card goals">
    <h2>${t("Sparziele")}</h2>
    ${rep.goals.length ? rep.goals.map(goalRow).join("") : emptyState("piggy", t("Noch kein Sparziel"), t("Lege ein Ziel mit Betrag und Datum an. Münzwerk plant die Rate in deinem Tagesbudget ein; das Geld bleibt auf dem Girokonto."))}
    ${check}
    <button class="btn secondary block" data-action="newgoal">${icon("plus")} ${t("Sparziel anlegen")}</button>
  </section>`;
}

function openGoalSheet(goal) {
  const g = goal || {};
  let chosenIcon = g.icon || "piggy";
  let dated = goal ? !!g.target_month : true;
  let startNext = false;
  const sheet = openSheet(`
    <h3>${goal ? t("Sparziel bearbeiten") : t("Sparziel anlegen")}</h3>
    <div class="meta">${t("Das Geld bleibt auf dem Girokonto. Die Rate wird jeden Monat in deinem Tagesbudget eingeplant.")}</div>
    <label class="field"><span>${t("Name")}</span><input type="text" id="g-name" maxlength="60" autocomplete="off" value="${esc(g.name || "")}" placeholder="${t("z. B. Urlaub")}"></label>
    <div class="field"><span>${t("Symbol")}</span><div class="icon-pick">${GOAL_ICONS.map((i) => `<button data-icon="${i}" aria-pressed="${i === chosenIcon}" aria-label="${i}">${icon(i)}</button>`).join("")}</div></div>
    <label class="field"><span>${t("Zielbetrag in €")}</span><input type="text" id="g-target" inputmode="decimal" value="${euroInput(g.target_cents)}" placeholder="${decimal(2400, 2)}"></label>
    <div class="seg" role="group" aria-label="${t("Bis wann")}">
      <button data-gdated="1" aria-pressed="${dated}">${t("Bis zu einem Datum")}</button>
      <button data-gdated="0" aria-pressed="${!dated}">${t("Feste Monatsrate")}</button>
    </div>
    <label class="field" id="g-month-f" ${dated ? "" : "hidden"}><span>${t("Bis wann (Monat)")}</span><input type="month" id="g-month" value="${esc(g.target_month || addMonths(thisMonth, 6))}" min="${thisMonth}"></label>
    <label class="field" id="g-rate-f" ${dated ? "hidden" : ""}><span>${t("Rate pro Monat in €")}</span><input type="text" id="g-rate" inputmode="decimal" value="${euroInput(g.monthly_cents)}" placeholder="${decimal(200, 2)}"></label>
    <label class="field"><span>${t("Schon vorhanden in €")}</span><input type="text" id="g-start" inputmode="decimal" value="${euroInput(g.start_cents || 0)}">
      <small class="hint">${t("Was schon auf dem Konto liegt und fürs Ziel zählen soll.")}</small></label>
    ${goal ? "" : `<div class="seg" role="group" aria-label="${t("Ab wann")}">
      <button data-gnext="0" aria-pressed="true">${t("Ab diesem Monat")}</button>
      <button data-gnext="1" aria-pressed="false">${t("Ab nächstem Monat")}</button>
    </div>`}
    <button class="btn block" id="g-save">${goal ? t("Speichern") : t("Anlegen")}</button>
    ${goal ? `<div class="btn-row"><button class="btn secondary" id="g-archive">${t("Archivieren")}</button><button class="btn secondary danger-text" id="g-delete">${t("Löschen")}</button></div>` : ""}
  `);
  sheet.addEventListener("click", async (e) => {
    const ib = e.target.closest("[data-icon]");
    if (ib) { chosenIcon = ib.dataset.icon; sheet.querySelectorAll("[data-icon]").forEach((b) => b.setAttribute("aria-pressed", b === ib)); return; }
    const db = e.target.closest("[data-gdated]");
    if (db) {
      dated = db.dataset.gdated === "1";
      sheet.querySelectorAll("[data-gdated]").forEach((b) => b.setAttribute("aria-pressed", b === db));
      $("#g-month-f", sheet).hidden = !dated; $("#g-rate-f", sheet).hidden = dated;
      return;
    }
    const nb = e.target.closest("[data-gnext]");
    if (nb) { startNext = nb.dataset.gnext === "1"; sheet.querySelectorAll("[data-gnext]").forEach((b) => b.setAttribute("aria-pressed", b === nb)); return; }
    if (e.target.closest("#g-archive")) {
      try { await API.updateGoal(goal.id, { archived: true }); closeSheet(); toast(t("Sparziel archiviert")); await reload(); } catch (err) { toast(err.message); }
      return;
    }
    if (e.target.closest("#g-delete")) {
      return confirmSheet(t("Sparziel löschen?"), t("Das Ziel verschwindet. Deine Umsätze bleiben, wie sie sind."), t("Löschen"), async () => {
        try { await API.deleteGoal(goal.id); toast(t("Sparziel gelöscht")); await reload(); } catch (err) { toast(err.message); }
      });
    }
    if (!e.target.closest("#g-save")) return;
    const name = $("#g-name", sheet).value.trim();
    const target = parseEuro($("#g-target", sheet).value);
    const month = $("#g-month", sheet).value;
    const rate = parseEuro($("#g-rate", sheet).value);
    const start = parseEuro($("#g-start", sheet).value) || 0;
    if (!name) return $("#g-name", sheet).focus();
    if (!target || target <= 0) { toast(t("Bitte einen Zielbetrag eingeben.")); return $("#g-target", sheet).focus(); }
    if (dated && !/^\d{4}-\d{2}$/.test(month)) { toast(t("Bitte einen Monat wählen.")); return $("#g-month", sheet).focus(); }
    if (!dated && (!rate || rate <= 0)) { toast(t("Bitte eine Monatsrate eingeben.")); return $("#g-rate", sheet).focus(); }
    const data = { name, icon: chosenIcon, target_cents: target, start_cents: Math.max(0, start) };
    if (dated) data.target_month = month; else { data.monthly_cents = rate; if (goal) data.clear_target_month = true; }
    try {
      if (goal) await API.updateGoal(goal.id, data);
      else await API.createGoal({ ...data, start_month: startNext ? addMonths(thisMonth, 1) : thisMonth });
      closeSheet();
      toast(goal ? t("Sparziel gespeichert") : t("Sparziel „{name}“ angelegt", { name }));
      await reload();
    } catch (err) { toast(err.message); }
  });
}

function savingsCard() {
  const s = A.savingsOverview(state.ctx);
  if (!s.pots.length && !s.checks.length) {
    return `<section class="card"><h2>${t("Ersparnisse")}</h2>
      <p class="note" style="margin-top:0">${t("Noch keine Ersparnisse. Ordne Überweisungen aufs Sparkonto oder ins Depot einer Spar-Kategorie zu (z. B. „Sparen“), dann siehst du hier, wohin dein Geld geht.")}</p></section>`;
  }
  const max = Math.max(1, ...s.pots.map((p) => Math.abs(p.total)));
  return `<section class="card savings">
    <h2>${t("Ersparnisse")}</h2>
    <div class="savings-sum">
      <div><span class="sub">${t("Diesen Monat")}</span><b>${fmt(s.thisMonth)}</b></div>
      <div><span class="sub">${t("Insgesamt seit {date}", { date: monthLabel(s.since) })}</span><b>${fmt(s.total)}</b></div>
      <div><span class="sub">${t("Ø pro Monat")}</span><b>${fmt0(s.avg)}</b></div>
    </div>
    ${s.pots.map((p) => `
      <button class="catrow" data-savpot="${p.id}">
        <div class="bubble">${icon(p.icon)}</div>
        <div class="name"><div>${esc(p.name)} <small class="hint">${p.count}×</small></div>
          <div class="hint">${esc(p.recipients.slice(0, 2).map((r) => r.name).join(", "))}</div>
          <div class="bar"><i style="width:${(Math.abs(p.total) / max) * 100}%"></i></div></div>
        <div class="amt">${fmt(p.total)}<small>${t("diesen Monat {amount}", { amount: fmt0(p.thisMonth) })}</small></div>
      </button>`).join("")}
    ${s.checks.length ? `<button class="notice warn" data-action="savings-check">${icon("help")}<div><b>${tn(s.checks.length, "{n} Buchung prüfen", "{n} Buchungen prüfen")}</b><span>${t("Sieht nach Sparen aus oder sitzt im falschen Topf")}</span></div></button>` : ""}
    <p class="note">${t("Gezählt werden die Überweisungen vom Girokonto, ohne Zinsen und Kursgewinne. Antippen zeigt die Buchungen; dort lässt sich jede neu zuordnen.")}</p>
  </section>`;
}

function openSavingsPot(id) {
  const cat = catById(id);
  const list = state.transactions.filter((tx) => tx.category_id === id && !tx.pending);
  openTxListSheet(cat?.name || t("Ersparnisse"), t("Spartopf, alle Monate"), list, () => openSavingsPot(id));
}

function openSavingsChecks() {
  const s = A.savingsOverview(state.ctx);
  const sheet = openSheet(`
    <h3>${t("Ersparnisse prüfen")}</h3>
    <div class="meta">${t("Antippen und richtig zuordnen. Passt alles, einfach so lassen.")}</div>
    ${s.checks.length ? s.checks.map((c) => `<div class="check-reason">${esc(CHECK_TEXT[c.reason]())}</div><div class="list">${txRow(c.tx)}</div>`).join("") : `<div class="hint">${t("Alles in Ordnung.")}</div>`}`);
  sheet.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tx]");
    if (!b) return;
    const tx = state.transactions.find((x) => String(x.id) === b.dataset.tx);
    if (tx) openTxSheet(tx, openSavingsChecks);
  });
}

function viewWealth() {
  const w = A.wealth(state.ctx, state.accounts);
  if (!state.accounts.length) {
    return `<section class="card empty-card">
      <div class="bubble">${icon("piggy")}</div>
      <h2 style="margin-top:12px">${t("Dein Vermögen auf einen Blick")}</h2>
      <p class="note">${t("Lege Girokonto, Sparkonten, Depots und Kredite an. Was die Bank liefert, kommt automatisch. Depotwerte trägst du ab und zu selbst ein, Kredite rechnet die App mit dem Tilgungsplan weiter.")}</p>
      <button class="btn block" data-action="newaccount" style="margin-top:14px">${icon("plus")} ${t("Erstes Konto anlegen")}</button>
    </section>${goalsCard()}${savingsCard()}`;
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

  let html = "";
  html += `<section class="card hero">
    <div class="sub">${t("Nettovermögen")}</div>
    <div class="big ${w.net >= 0 ? "" : "neg"}" data-count="${w.net}" data-count-key="net">${fmt(w.net)}</div>
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
  html += goalsCard() + savingsCard();

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
    ${type === "savings" ? `
      <label class="field"><span>${t("Zins p. a. in % (optional)")}</span><input type="text" id="acc-rate" inputmode="decimal" value="${a.loan_rate_percent ? decimal(a.loan_rate_percent) : ""}" placeholder="${decimal(2, 2)}">
        <small class="hint">${t("Dann rechnet Münzwerk die Zinsen seit dem letzten eingetragenen Stand grob mit dazu.")}</small></label>` : ""}
    <div class="row"><div class="grow"><div>${t("Im Nettovermögen mitzählen")}</div><div class="hint">${t("Z. B. aus, wenn das Konto einem Kind gehört")}</div></div>
      <label class="switch"><input type="checkbox" id="acc-include" ${a.include_in_total === false ? "" : "checked"}><span></span></label></div>`;
}

function readAccountForm(sheet, type) {
  const data = {
    name: $("#acc-name", sheet).value.trim(),
    include_in_total: $("#acc-include", sheet).checked,
  };
  if ($("#acc-match", sheet)) data.match = $("#acc-match", sheet).value.trim();
  if (type === "savings") {
    const rate = parseEuro($("#acc-rate", sheet).value);
    data.loan_rate_percent = rate != null ? rate / 100 : 0;   // leer = keine Zinsen
  }
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
