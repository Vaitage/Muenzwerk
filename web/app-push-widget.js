// Münzwerk – Einstellungen: Mitteilungen (Web Push) und iPhone-Widget.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

// ------------------------------------------------------------------ Mitteilungen (Web Push, app/push.py)
// iOS kann Mitteilungen nur für Web-Apps auf dem Homescreen (ab 16.4). Die Erlaubnis muss
// direkt beim Tippen angefragt werden; iOS fragt nur ein einziges Mal.
let pushInfo = null;        // Antwort von /api/push (null = ausgeblendet, z. B. Vorschau)
let pushLocal = { supported: false, subscribed: false };

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

async function pushLocalState() {
  if (!pushSupported()) return { supported: false, subscribed: false };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return { supported: true, subscribed: !!sub, endpoint: sub?.endpoint };
  } catch { return { supported: true, subscribed: false }; }
}

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function pushCard() {
  if (!pushInfo) return "";
  let body;
  if (pushInfo.error) {
    body = `<p class="note warn-text" style="margin-top:0">${t("Status konnte nicht geladen werden: {msg}", { msg: esc(pushInfo.error) })}</p>`;
  } else if (!pushLocal.supported) {
    body = `<p class="note" style="margin-top:0">${isIOS() && !isStandalone()
      ? t("Mitteilungen gehen nur in der App vom Homescreen (iOS 16.4 oder neuer). Öffne Münzwerk über das Symbol auf dem Homescreen.")
      : t("Dieser Browser kann keine Mitteilungen empfangen.")}</p>`;
  } else if (Notification.permission === "denied") {
    body = `<p class="note warn-text" style="margin-top:0">${t("Mitteilungen sind für Münzwerk abgelehnt. Auf dem iPhone: Symbol vom Homescreen löschen, Münzwerk neu hinzufügen und dann erlauben.")}</p>`;
  } else if (!pushLocal.subscribed) {
    body = `<p class="note" style="margin-top:0">${t("Bekomme eine Mitteilung, sobald dein Gehalt gebucht ist – auch wenn Münzwerk zu ist.")}</p>
      <div class="btn-row"><button class="btn" data-action="push-enable">${t("Mitteilungen erlauben")}</button></div>`;
  } else {
    const problems = [];
    if (!pushInfo.contact_ok) problems.push(t("Apple stellt nur zu, wenn der Pi eine echte Absenderadresse hat. Trag in der .env auf dem Pi PUBLIC_URL (https://…) oder PUSH_CONTACT=mailto:deine@adresse ein."));
    if (pushInfo.last_error) problems.push(t("Letzter Fehler beim Senden: {msg}", { msg: esc(pushInfo.last_error) }));
    body = `${problems.map((p) => `<p class="note warn-text" style="margin-top:0">${p}</p>`).join("")}
      <div class="row"><div class="grow"><div>${t("Gehalt ist da")}</div>
        <div class="hint">${pushInfo.sync_times
          ? t("Kommt beim nächsten Abruf nach der Buchung (um {times} Uhr).", { times: esc(pushInfo.sync_times.split(",").map((x) => x.trim()).join(", ")) })
          : t("Kommt beim nächsten Abruf nach der Buchung, z. B. wenn du Münzwerk öffnest.")}</div></div>${icon("check")}</div>
      <div class="row"><div class="grow"><div>${t("Betrag in der Mitteilung zeigen")}</div>
        <div class="hint">${t("Aus: nur „Gehalt ist da“ auf dem Sperrbildschirm")}</div></div>
        <label class="switch"><input type="checkbox" data-push-amount ${pushInfo.show_amount ? "checked" : ""}><span></span></label></div>
      <div class="btn-row">
        <button class="btn secondary" data-action="push-test">${t("Test-Mitteilung")}</button>
        <button class="btn secondary danger-text" data-action="push-disable">${t("Ausschalten")}</button>
      </div>`;
  }
  return `<section class="card"><h2>${t("Mitteilungen")}</h2>${body}</section>`;
}

async function pushAction(act) {
  if (act === "push-enable") {
    // Erste Aktion direkt im Tippen, sonst zeigt iOS keine Nachfrage
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast(t("Mitteilungen nicht erlaubt")); return render(); }
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(pushInfo.public_key) });
      const j = sub.toJSON();
      await API.pushSubscribe({ endpoint: j.endpoint, keys: j.keys });
      toast(t("Mitteilungen sind an"));
    } catch (err) { toast(t("Mitteilungen konnten nicht eingerichtet werden: {msg}", { msg: err.message })); }
  }
  if (act === "push-test") {
    try {
      // Anmeldung des Geräts erneut an den Pi schicken (falls sie dort fehlt oder sich geändert hat)
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) { const j = sub.toJSON(); await API.pushSubscribe({ endpoint: j.endpoint, keys: j.keys }); }
      await API.pushTest();
      toast(t("Test-Mitteilung gesendet"));
    } catch (err) { toast(err.message); }
    pushInfo = await API.pushStatus().catch((e) => ({ error: e.message }));
    return render();
  }
  if (act === "push-disable") {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) { await API.pushUnsubscribe(sub.endpoint); await sub.unsubscribe(); }
      toast(t("Mitteilungen sind aus"));
    } catch (err) { toast(err.message); }
  }
  pushLocal = await pushLocalState();
  try { pushInfo = await API.pushStatus(); } catch { /* bleibt beim alten Stand */ }
  if (state.view === "settings") render();
}

// ------------------------------------------------------------------ iPhone-Widget (App „Scriptable“)
let widgetInfo = null;      // Antwort von /api/widget/key, null = ausgeblendet (Vorschau)
let widgetNewKey = null;    // frisch erzeugter Schlüssel – nur bis zum Verlassen der Seite sichtbar
let widgetScript = null;    // Skript mit eingesetzter Adresse, vorab geladen (iOS kopiert nur direkt beim Tippen)

async function loadWidgetScript() {
  if (widgetScript) return;
  try {
    const res = await fetch("scriptable-widget.js", { credentials: "same-origin" });
    if (res.ok) widgetScript = (await res.text()).replace("__MUENZWERK_URL__", location.origin);
  } catch {}
}

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { toast(t("Kopieren ging nicht – bitte von Hand markieren.")); }
}

function settingsWidget() {
  loadWidgetScript();
  const w = widgetInfo || { active: false };
  const steps = [
    t("Installiere die kostenlose App „Scriptable“ aus dem App Store."),
    t("Tippe unten auf „Skript kopieren“. Öffne Scriptable, tippe auf +, füge das Skript ein und nenne es „Münzwerk“."),
    t("Erzeuge hier einen Widget-Schlüssel und kopiere ihn. Starte das Skript einmal in Scriptable (▶) und füge den Schlüssel ein."),
    t("Halte auf dem Homescreen eine freie Stelle gedrückt, tippe auf „Bearbeiten → Widget hinzufügen“, wähle Scriptable (klein oder mittel) und im Widget als Script „Münzwerk“."),
  ];
  return `
    <section class="card">
      <h2>${t("Zahlen auf dem Homescreen")}</h2>
      <p class="note" style="margin-top:0">${t("Das Widget zeigt, was bis Monatsende übrig ist, das Tagesbudget für heute, morgen und übermorgen und die nächsten Fixkosten. Mehr nicht: keine Umsätze, keine Kontodaten.")}</p>
      <p class="note">${t("Die Zahlen rechnet Münzwerk, wenn du die App öffnest. Das Widget zeigt diesen Stand; wann es sich neu lädt, entscheidet iOS. Tailscale muss auf dem iPhone an sein.")}</p>
    </section>

    <section class="card">
      <h2>${t("Widget-Schlüssel")}</h2>
      <div class="row"><div class="grow">
        <div>${w.error ? `<span class="warn-text">${t("Status konnte nicht geladen werden: {msg}", { msg: esc(w.error) })}</span>` : w.active ? t("Aktiv seit {date}", { date: dateTime(w.created) }) : t("Kein Schlüssel – das Widget hat keinen Zugriff.")}</div>
        ${w.active ? `<div class="hint">${w.snapshot_at ? t("Zahlen zuletzt übertragen: {date}", { date: dateTime(w.snapshot_at) }) : t("Noch keine Zahlen übertragen.")}</div>` : ""}
      </div></div>
      ${widgetNewKey ? `
        <div class="key-box"><code>${esc(widgetNewKey)}</code></div>
        <p class="note warn-text" style="margin-top:6px">${t("Wird nur jetzt angezeigt. Kopiere ihn gleich in Scriptable.")}</p>
        <div class="btn-row"><button class="btn" data-action="widget-copy-key">${t("Schlüssel kopieren")}</button></div>` : ""}
      <p class="note">${t("Der Schlüssel darf nur diese Zahlen lesen, sonst nichts. Ein neuer Schlüssel macht den alten sofort ungültig.")}</p>
      <div class="btn-row">
        <button class="btn ${widgetNewKey ? "secondary" : ""}" data-action="widget-new">${w.active ? t("Neuer Schlüssel") : t("Schlüssel erzeugen")}</button>
        ${w.active ? `<button class="btn secondary danger-text" data-action="widget-revoke">${t("Sperren")}</button>` : ""}
      </div>
    </section>

    <section class="card">
      <h2>${t("So richtest du es ein")}</h2>
      <ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <div class="btn-row">
        <button class="btn secondary" data-action="widget-copy-script">${t("Skript kopieren")}</button>
        <a class="btn secondary" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener">${t("Scriptable öffnen")}</a>
      </div>
    </section>`;
}

async function widgetAction(act) {
  if (act === "widget-copy-script") {
    if (!widgetScript) { await loadWidgetScript(); if (!widgetScript) return toast(t("Skript konnte nicht geladen werden.")); }
    return copyText(widgetScript, t("Skript kopiert"));
  }
  if (act === "widget-copy-key") return copyText(widgetNewKey, t("Schlüssel kopiert"));
  const create = async () => {
    try {
      const r = await API.widgetNewKey();
      widgetNewKey = r.key;
      await sendWidgetSnapshot();          // gleich die ersten Zahlen bereitstellen
      widgetInfo = await API.widgetKey();
    } catch (err) { toast(err.message); }
    render();
  };
  if (act === "widget-new") {
    if (!widgetInfo?.active) return create();
    return confirmSheet(t("Neuen Schlüssel erzeugen?"), t("Der alte Schlüssel hört sofort auf zu gelten. Im Widget musst du danach den neuen eingeben."), t("Neu erzeugen"), create, "accent");
  }
  if (act === "widget-revoke") {
    return confirmSheet(t("Widget-Schlüssel sperren?"), t("Das Widget kann danach keine Zahlen mehr laden."), t("Sperren"), async () => {
      try { await API.widgetRevoke(); widgetInfo = { active: false }; widgetNewKey = null; toast(t("Schlüssel gesperrt")); }
      catch (err) { toast(err.message); }
      render();
    });
  }
}
