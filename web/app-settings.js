// Münzwerk – Reiter „Einstellungen“: Unterseiten, Updates, Sprache, Design, Bank.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

// ------------------------------------------------------------------ Einstellungen
let rulesCache = [];
async function viewSettingsAsync() {
  [rulesCache, updatesInfo, widgetInfo, pushInfo] = await Promise.all([
    API.rules(), API.updates ? API.updates() : null,
    API.widgetKey ? API.widgetKey().catch((e) => ({ active: false, error: e.message })) : null,
    API.pushStatus ? API.pushStatus().catch((e) => ({ error: e.message })) : null,
    window.Auth?.loadPasskeys(),
  ]);
  pushLocal = await pushLocalState();
  if (state.view === "settings") render();
  // App mitten in einem Update geöffnet: weiter beobachten
  if (updatesInfo?.anfrage || updatesInfo?.status?.laeuft) watchUpdates();
}

// Unterseiten von „Einstellungen“: null (Hauptseite), "categories", "rules", "fixed", "widget"
const SETTINGS_PAGES = {
  categories: () => t("Kategorien"),
  rules: () => t("Gelernte Regeln"),
  fixed: () => t("Fixkosten"),
  widget: () => t("iPhone-Widget"),
};
function openSettingsPage(page) {
  if (page !== "widget") widgetNewKey = null;   // Schlüssel nicht länger als nötig zeigen
  state.settingsPage = page;
  window.scrollTo(0, 0);
  render();
}

function viewSettings() {
  if (state.settingsPage === "categories") return settingsCategories();
  if (state.settingsPage === "rules") return settingsRules();
  if (state.settingsPage === "fixed") return settingsFixed();
  if (state.settingsPage === "widget") return settingsWidget();
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
        ${bank.last_sync ? `<div class="hint">${t("Zuletzt abgerufen: {date}", { date: new Date(bank.last_sync).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) })}</div>` : ""}
        ${fetchInfoHtml(bank)}</div>
      </div>
      ${bank.state === "none" ? `<div class="btn-row">
        <button class="btn" data-action="connect" ${bank.setup ? "disabled" : ""}>${t("Verbinden")}</button>
      </div>` : ["expired", "expiring"].includes(bank.state) ? `<div class="btn-row">
        <button class="btn secondary" data-action="sync">${icon("refresh")} ${t("Jetzt abrufen")}</button>
        <button class="btn" data-action="connect" ${bank.setup ? "disabled" : ""}>${t("Neu verbinden")}</button>
      </div>` : `<div class="btn-row">
        <button class="btn" data-action="sync">${icon("refresh")} ${t("Jetzt abrufen")}</button>
      </div>
      <button class="btn-text" data-action="connect" ${bank.setup ? "disabled" : ""}>${t("Neu verbinden")}</button>`}
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
      ${navRow("rules", "sparkle", t("Gelernte Regeln"), userRuleCount || t("noch keine"))}
      ${navRow("fixed", "calendar", t("Fixkosten"), t("{amount} im Monat", { amount: fmt0(fixedSum) }))}
      ${widgetInfo ? navRow("widget", "phone", t("iPhone-Widget"), widgetInfo.error ? t("Fehler") : widgetInfo.active ? t("Aktiv") : t("Aus")) : ""}
    </section>
    ${window.Auth ? window.Auth.settingsHtml() : ""}
    ${pushCard()}
    ${updatesCard()}
    ${languageCard()}
    ${themeCard()}`;
}

// Einstellungen → Kategorien: Antippen öffnet die Kategorie (Ersparnis/Folgemonat, löschen)
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

// Einstellungen → Gelernte Regeln
function settingsRules() {
  const userRules = rulesCache.filter((r) => r.source === "user");
  const starterRules = rulesCache.filter((r) => r.source !== "user");
  return `
    <section class="card">
      ${userRules.length ? userRules.map(ruleRow).join("") : emptyState("sparkle", t("Noch keine gelernten Regeln"), t("Sie entstehen, wenn du eine Zahlung zuordnest und „Künftig immer so zuordnen“ an lässt. Danach sortiert Münzwerk Zahlungen an diesen Empfänger selbst ein."))}
    </section>
    ${starterRules.length ? `<section class="card"><details><summary>${t("{n} Start-Regeln anzeigen", { n: starterRules.length })}</summary>${starterRules.map(ruleRow).join("")}</details></section>` : ""}`;
}

// Einstellungen → Fixkosten: erkannte Fixkosten und regelmäßige Einnahmen, korrigierbar
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
      ${fixedExp.map(recRow).join("") || emptyState("calendar", t("Noch keine Fixkosten erkannt"), t("Dafür braucht die App Umsätze aus mindestens zwei Monaten. Du kannst eine Zahlung auch selbst als Fixkosten markieren: Umsatz antippen → Schalter „Fixkosten“."))}
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
  if (updatesInfo.error) {
    return `<section class="card"><h2>${t("Updates")}</h2><p class="note warn-text" style="margin-top:0">${t("Update-Status konnte nicht geladen werden: {msg}", { msg: esc(updatesInfo.error) })}</p></section>`;
  }
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
    const info = await API.updates();   // während des Neustarts null/Fehler -> weiter warten
    if (info && !info.error) {
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

// Was die Bank beim letzten Abruf geliefert hat (Fehlersuche: fehlen Umsätze?)
function fetchInfoHtml(bank) {
  const f = bank.last_fetch;
  let html = "";
  if (f) {
    const parts = [tn(f.booked, "{n} gebucht", "{n} gebucht"), tn(f.pending, "{n} vorgemerkt", "{n} vorgemerkt")];
    if (f.newest) parts.push(t("neueste Buchung {date}", { date: new Date(f.newest + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" }) }));
    const raw = Object.entries(f.counts || {}).map(([k, v]) => `${k} ${v}`).join(", ");
    html += `<details class="fetch-info"><summary>${t("Letzter Abruf: {text}", { text: esc(parts.join(" · ")) })}</summary>
      <div class="hint">${t("Ab {date}", { date: esc(f.since || "?") })} · ${t("Status von der Bank: {raw}", { raw: esc(raw || "–") })}</div>
      <div class="hint">${t("Vorgemerkte extra abgefragt: {result}", { result: esc(f.pending_query || "–") })}</div></details>`;
  }
  if (bank.last_error) html += `<div class="hint warn-text">${t("Letzter Fehler: {msg}", { msg: esc(String(bank.last_error).slice(0, 200)) })}</div>`;
  return html;
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
