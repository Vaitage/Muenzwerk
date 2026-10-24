// Münzwerk – Einrichtungs-Assistent für die Bank (Enable Banking), Schritt für Schritt in einem Fenster.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

// ------------------------------------------------------------------ Assistent „Bank einrichten“
// Schritte: 1 Überblick · 2 App bei Enable Banking anlegen · 3 App-ID + Schlüssel (mit Prüfung)
//           4 Bank wählen und verbinden. Server: app/setup.py (/api/setup).
const EB_PANEL = "https://enablebanking.com/cp/applications";
const SETUP_COUNTRIES = ["DE", "AT", "NL", "BE", "LU", "FR", "ES", "IT", "PT", "IE", "FI", "SE", "NO", "DK", "PL", "EE", "LV", "LT"];
const wiz = { step: 1, status: null, result: null, banks: null, banksError: null, query: "", country: "DE", bank: "", busy: false, sheet: null };

async function openSetupWizard(step = 1) {
  Object.assign(wiz, { step, result: null, banks: null, banksError: null, query: "", busy: false });
  wiz.sheet = openSheet(`<div id="wiz" class="wiz"></div>`, { onBack: () => (wiz.step > 1 ? wizGo(wiz.step - 1) : closeSheet()) });
  wiz.sheet.addEventListener("click", wizClick);
  wiz.sheet.addEventListener("input", wizInput);
  wiz.sheet.addEventListener("change", wizChange);
  await wizLoad();
}

async function wizLoad() {
  try { wiz.status = await API.setupStatus(); } catch (err) { wiz.status = { error: err.message }; }
  wiz.country = wiz.status.country || "DE";
  wiz.bank = wiz.status.bank || "";
  wizRender();
}

function wizGo(step) {
  wiz.step = step;
  if (step === 4 && !wiz.banks) wizLoadBanks();
  wizRender();
  wiz.sheet?.scrollTo?.(0, 0);
}

const copyRow = (label, value, key) => `
  <div class="copy-row"><div class="grow"><span class="hint">${label}</span><code>${esc(value)}</code></div>
    <button class="btn secondary" data-wiz-copy="${key}">${t("Kopieren")}</button></div>`;

function wizProgress() {
  return `<div class="wiz-progress" aria-label="${t("Schritt {n} von {total}", { n: wiz.step, total: 4 })}">
    ${[1, 2, 3, 4].map((i) => `<i class="${i < wiz.step ? "done" : i === wiz.step ? "now" : ""}"></i>`).join("")}
  </div><div class="hint wiz-count">${t("Schritt {n} von {total}", { n: wiz.step, total: 4 })}</div>`;
}

function wizRender() {
  const box = wiz.sheet?.querySelector("#wiz");
  if (!box) return;
  const s = wiz.status || {};
  if (s.error) { box.innerHTML = `<h3>${t("Bank einrichten")}</h3><p class="warn-text">${esc(s.error)}</p>`; return; }
  const base = (s.redirect_url || "").replace(/\/api\/bank\/callback$/, "");
  let html = wizProgress();

  if (wiz.step === 1) {
    html += `<h3>${t("Bank einrichten")}</h3>
      <p class="note" style="margin-top:0">${t("Münzwerk holt deine Umsätze über Enable Banking, einen zugelassenen Dienst für den Kontozugriff nach PSD2. Für dein eigenes Konto ist das kostenlos. Dauert etwa 15 Minuten.")}</p>
      <div class="wiz-list">
        <div><span class="wiz-num">1</span><div><b>${t("Kostenloses Konto bei Enable Banking")}</b><span>${t("und dort eine „App“ für Münzwerk anlegen – wir sagen dir genau, was wohin gehört.")}</span></div></div>
        <div><span class="wiz-num">2</span><div><b>${t("App-ID und Schlüssel hier eintragen")}</b><span>${t("Münzwerk prüft sofort, ob alles passt.")}</span></div></div>
        <div><span class="wiz-num">3</span><div><b>${t("Bank wählen und verbinden")}</b><span>${t("Anmeldung wie im Online-Banking, direkt bei deiner Bank.")}</span></div></div>
      </div>
      <p class="hint">${t("Am besten am Computer oder Tablet: Dort lässt sich die App bei Enable Banking leichter anlegen. Münzwerk kannst du dafür auch im Browser öffnen.")}</p>
      ${!s.public_url_ok ? `<p class="note warn-text">${t("Achtung: In der .env auf dem Server fehlt PUBLIC_URL mit https://… Ohne sie kann die Bank nach der Anmeldung nicht zurück zu Münzwerk.")}</p>` : ""}
      ${s.problem ? "" : `<p class="note pos">${icon("check", "ic-s")} ${t("Enable Banking ist schon eingerichtet. Du kannst die Angaben hier ändern oder direkt die Bank wählen.")}</p>`}
      <div class="btn-row">
        <button class="btn" data-wiz-go="2">${t("Los geht's")}</button>
        ${s.problem ? "" : `<button class="btn secondary" data-wiz-go="4">${t("Bank wählen")}</button>`}
      </div>`;
  }

  if (wiz.step === 2) {
    html += `<h3>${t("App bei Enable Banking anlegen")}</h3>
      <ol class="steps wiz-steps">
        <li>${t("Öffne das Control Panel von Enable Banking und registriere dich (kostenlos, mit E-Mail).")}
          <div class="btn-row"><a class="btn secondary" href="${EB_PANEL}" target="_blank" rel="noopener">${t("Enable Banking öffnen")} ↗</a></div></li>
        <li>${t("Unter „Applications“ auf „Add a new application“ tippen. Bei „Environment“ „Production“ wählen.")}</li>
        <li>${t("Name: z. B. „Münzwerk“. Bei „Allowed redirect URLs“ genau diese Adresse eintragen:")}
          ${copyRow(t("Redirect-URL"), s.redirect_url || "", "redirect")}</li>
        <li>${t("„Privacy URL“ und „Terms URL“ sind Pflichtfelder – trag einfach deine Münzwerk-Adresse ein:")}
          ${copyRow(t("Adresse"), base, "base")}</li>
        <li>${t("Beim Schlüssel „Generate in the browser“ wählen. Die .pem-Datei wird heruntergeladen – gut aufheben, du brauchst sie gleich.")}</li>
        <li>${t("Nach dem Anlegen „Activate by linking accounts“ wählen und dich bei deiner Bank anmelden. So schaltet Enable Banking die App für dein eigenes Konto frei („Restricted“ ist richtig so).")}</li>
      </ol>
      <div class="btn-row"><button class="btn" data-wiz-go="3">${t("Erledigt, weiter")}</button></div>`;
  }

  if (wiz.step === 3) {
    const r = wiz.result;
    html += `<h3>${t("App-ID und Schlüssel")}</h3>
      <p class="note" style="margin-top:0">${t("Die App-ID steht bei Enable Banking neben dem Namen deiner App, z. B. „8823dfc8-b56a-…“.")}</p>
      <label class="field"><span>${t("App-ID")}</span>
        <input type="text" id="wiz-appid" value="${esc(wiz.appId ?? (s.app_id && !s.problem ? s.app_id : ""))}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label class="field"><span>${t("Schlüsseldatei (.pem)")}</span>
        <input type="file" id="wiz-pem" accept=".pem,application/x-pem-file,application/x-x509-ca-cert,text/plain">
        <small class="hint">${wiz.pemName ? `${icon("check", "ic-s")} ${esc(wiz.pemName)}` : s.key_present && !s.problem ? t("Ein Schlüssel ist schon gespeichert. Nur auswählen, wenn du ihn ersetzen willst.") : t("Die Datei, die Enable Banking heruntergeladen hat.")}</small></label>
      <p class="hint">${icon("shield", "ic-s")} ${t("Der Schlüssel wird verschlüsselt übertragen und nur auf deinem Server gespeichert, lesbar nur für Münzwerk.")}</p>
      ${r ? wizResult(r) : ""}
      ${(() => {
        const canGo = (r && r.ok) || (!s.problem && !wiz.pemText);
        return `<div class="btn-row">
          <button class="btn ${canGo ? "secondary" : ""}" data-wiz-save ${wiz.busy ? "disabled" : ""}>${wiz.busy ? t("Prüfe …") : r && r.ok ? t("Nochmal prüfen") : t("Speichern und prüfen")}</button>
          ${canGo ? `<button class="btn" data-wiz-go="4">${t("Weiter")}</button>` : ""}
        </div>`;
      })()}`;
  }

  if (wiz.step === 4) {
    const q = wiz.query.trim().toLowerCase();
    const list = (wiz.banks || []).filter((b) => !q || b.name.toLowerCase().includes(q));
    const regions = (() => { try { return new Intl.DisplayNames([locale], { type: "region" }); } catch { return null; } })();
    html += `<h3>${t("Bank wählen")}</h3>
      <div class="field-row">
        <label class="field"><span>${t("Land")}</span>
          <select id="wiz-country">${SETUP_COUNTRIES.map((c) => `<option value="${c}" ${c === wiz.country ? "selected" : ""}>${esc(regions ? regions.of(c) : c)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("Suchen")}</span>
          <input type="text" id="wiz-q" value="${esc(wiz.query)}" placeholder="${t("z. B. ING")}" autocomplete="off"></label>
      </div>
      <div class="bank-list" role="listbox" aria-label="${t("Banken")}">
        ${wiz.banksError ? `<p class="warn-text">${esc(wiz.banksError)}</p>`
          : !wiz.banks ? `<p class="hint">${t("Lade Banken …")}</p>`
          : list.length ? list.slice(0, 60).map((b) => `<button class="bank-opt" role="option" aria-selected="${b.name === wiz.bank}" data-wiz-bank="${esc(b.name)}">${icon("bank")}<span>${esc(b.name)}</span>${b.name === wiz.bank ? icon("check") : ""}</button>`).join("")
          : `<p class="hint">${t("Keine Bank gefunden.")}</p>`}
      </div>
      <p class="hint">${t("Beim Verbinden meldest du dich direkt bei deiner Bank an und bestätigst den Zugriff (meist 180 Tage). Münzwerk sieht dein Passwort nie.")}</p>
      <div class="btn-row"><button class="btn" data-wiz-connect ${wiz.bank ? "" : "disabled"}>${wiz.bank ? t("Mit {bank} verbinden", { bank: esc(wiz.bank) }) : t("Bank auswählen")}</button></div>
      <p class="hint">${t("Danach: Münzwerk zum Home-Bildschirm hinzufügen und unter Einstellungen die Mitteilung „Gehalt ist da“ erlauben.")}</p>`;
  }
  box.innerHTML = html;
}

function wizResult(r) {
  if (!r.ok) return `<div class="wiz-result bad">${icon("help")}<div><b>${t("Hat noch nicht geklappt")}</b><span>${esc(r.message || "")}</span></div></div>`;
  return `<div class="wiz-result good">${icon("check")}<div><b>${t("Verbindung zu Enable Banking klappt")}</b>
      <span>${t("App „{name}“ gefunden.", { name: esc(r.name || "?") })}${r.environment && r.environment !== "PRODUCTION" ? ` ${t("Achtung: Das ist keine „Production“-App – echte Konten gehen damit nicht.")}` : ""}</span></div></div>
    ${r.redirect_ok ? "" : `<div class="wiz-result warn">${icon("help")}<div><b>${t("Redirect-URL fehlt bei Enable Banking")}</b>
      <span>${t("Trag diese Adresse bei deiner App unter „Allowed redirect URLs“ ein, sonst kommt die Bank nach der Anmeldung nicht zurück:")}</span>
      ${copyRow(t("Redirect-URL"), r.redirect_url, "redirect")}</div></div>`}`;
}

async function wizLoadBanks() {
  wiz.banks = null; wiz.banksError = null; wizRender();
  try { wiz.banks = await API.setupBanks(wiz.country); }
  catch (err) { wiz.banksError = err.message; }
  wizRender();
}

async function wizClick(e) {
  const go = e.target.closest("[data-wiz-go]");
  if (go) return wizGo(Number(go.dataset.wizGo));
  const cp = e.target.closest("[data-wiz-copy]");
  if (cp) {
    const s = wiz.status || {};
    const text = cp.dataset.wizCopy === "redirect" ? (wiz.result?.redirect_url || s.redirect_url) : (s.redirect_url || "").replace(/\/api\/bank\/callback$/, "");
    return copyText(text, t("Kopiert"));
  }
  if (e.target.closest("[data-wiz-save]")) {
    const appId = (wiz.sheet.querySelector("#wiz-appid")?.value || "").trim();
    wiz.appId = appId;
    if (!wiz.pemText && !(wiz.status.key_present && !wiz.status.problem)) { toast(t("Bitte die .pem-Datei auswählen.")); return; }
    wiz.busy = true; wizRender();
    try {
      wiz.result = wiz.pemText ? await API.setupSave({ app_id: appId, key_pem: wiz.pemText }) : await API.setupTest();
      if (wiz.result.ok) { wiz.pemText = null; wiz.pemName = null; }
    } catch (err) { wiz.result = { ok: false, message: err.message }; }
    wiz.busy = false;
    try { wiz.status = await API.setupStatus(); } catch { /* bleibt */ }
    wizRender();
    reload();
    return;
  }
  const b = e.target.closest("[data-wiz-bank]");
  if (b) { wiz.bank = b.dataset.wizBank; return wizRender(); }
  if (e.target.closest("[data-wiz-connect]")) {
    try {
      await API.setupBank({ bank: wiz.bank, country: wiz.country });
      closeSheet();
      await connectBank();
    } catch (err) { toast(err.message); }
  }
}

function wizInput(e) {
  if (e.target.id === "wiz-q") {
    wiz.query = e.target.value;
    const pos = e.target.selectionStart;
    wizRender();
    const q = wiz.sheet.querySelector("#wiz-q");
    q.focus(); q.setSelectionRange(pos, pos);
  }
  if (e.target.id === "wiz-appid") wiz.appId = e.target.value;
}

function wizChange(e) {
  if (e.target.id === "wiz-country") { wiz.country = e.target.value; wiz.bank = ""; return wizLoadBanks(); }
  if (e.target.id === "wiz-pem") {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20000) { toast(t("Die Datei ist zu groß für einen Schlüssel.")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (!text.includes("PRIVATE KEY")) { toast(t("Das ist keine Schlüsseldatei von Enable Banking.")); return; }
      wiz.pemText = text; wiz.pemName = file.name;
      wiz.appId = wiz.sheet.querySelector("#wiz-appid")?.value || wiz.appId;
      // Enable Banking nennt die Datei nach der App-ID – dann gleich eintragen
      const m = file.name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (m && !wiz.appId) wiz.appId = m[0];
      wizRender();
    };
    reader.readAsText(file);
  }
}
