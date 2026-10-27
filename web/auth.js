// Anmeldung per Passkey (iPhone: Face ID, Android: Fingerabdruck o. ä.). Die Vorschau (demo.html)
// lädt diese Datei nicht; app.js kommt dann ohne Anmeldung aus.
window.Auth = (() => {
  "use strict";
  // Einrichtungscode aus dem Link bzw. QR-Code der Installation (…/?code=ABCD-EFGH) übernehmen
  // und gleich aus der Adresszeile entfernen
  const params = new URLSearchParams(location.search);
  const linkCode = (params.get("code") || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 12);
  if (params.has("code")) {
    params.delete("code");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash);
  }
  const $ = (sel) => document.querySelector(sel);
  const { t, tn, locale } = window.I18N;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // --- base64url <-> ArrayBuffer (WebAuthn arbeitet mit Binärdaten)
  const toBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)).buffer;
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Haushaltsbuch": "1" },
      credentials: "same-origin",
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail ? t(data.detail) : t("Fehler {status}", { status: res.status }));
    return data;
  }

  async function createPasskey(name, setupCode = "") {
    const o = await post("/api/auth/register/options", setupCode ? { setup_code: setupCode } : {});
    const cred = await navigator.credentials.create({ publicKey: {
      ...o,
      challenge: toBuf(o.challenge),
      user: { ...o.user, id: toBuf(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
    } });
    await post("/api/auth/register/verify", { name, setup_code: setupCode, credential: {
      id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      response: {
        clientDataJSON: toB64(cred.response.clientDataJSON),
        attestationObject: toB64(cred.response.attestationObject),
        transports: cred.response.getTransports ? cred.response.getTransports() : [],
      },
    } });
  }

  async function usePasskey() {
    const o = await post("/api/auth/login/options");
    const cred = await navigator.credentials.get({ publicKey: {
      ...o,
      challenge: toBuf(o.challenge),
      allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
    } });
    await post("/api/auth/login/verify", { credential: {
      id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
      response: {
        clientDataJSON: toB64(cred.response.clientDataJSON),
        authenticatorData: toB64(cred.response.authenticatorData),
        signature: toB64(cred.response.signature),
        userHandle: cred.response.userHandle ? toB64(cred.response.userHandle) : null,
      },
    } });
  }

  // Name für den ersten Passkey, damit man ihn in den Einstellungen wiedererkennt
  const deviceName = () => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad|Macintosh.*Mobile/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return t("Android-Handy");
    if (/Windows/.test(ua)) return t("Windows-PC");
    if (/Mac OS/.test(ua)) return "Mac";
    return t("Gerät");
  };

  // Abbruch durch den Nutzer (Face ID / Fingerabdruck weggewischt) ist kein Fehler
  const cancelled = (err) => err && (err.name === "NotAllowedError" || err.name === "AbortError");

  // --- Sperrbildschirm
  let unlock = null;   // resolve-Funktion, solange gesperrt

  function lockScreen(status, message = "") {
    document.body.classList.add("locked");
    const first = !status.has_passkey;
    $("#top").innerHTML = "";
    $("#main").innerHTML = `
      <section class="lock">
        <div class="lock-logo turn-in" aria-hidden="true">${window.logoMark ? window.logoMark() : ""}</div>
        <h1>Münzwerk</h1>
        <p>${first
          ? t("Lege einmalig einen Passkey an. Danach öffnest du die App mit Face ID oder Fingerabdruck.")
          : t("Mit Face ID oder Fingerabdruck entsperren.")}</p>
        ${first ? `
        <label class="field lock-code"><span>${t("Einrichtungscode")}</span>
          <input type="text" id="auth-code" inputmode="text" autocapitalize="characters" autocomplete="one-time-code"
            spellcheck="false" maxlength="12" placeholder="ABCD-EFGH" value="${esc(linkCode)}"></label>
        <p class="lock-hint">${linkCode ? t("Code aus dem QR-Code übernommen.") : t("Zeigt die Installation am Ende an (auch als QR-Code). Später: docker exec haushaltsbuch python -m app.auth code")}</p>` : ""}
        <button class="btn block" id="auth-go">${first ? t("Passkey einrichten") : t("Entsperren")}</button>
        <p class="lock-msg" id="auth-msg" role="alert">${esc(message)}</p>
      </section>`;
    $("#auth-go").addEventListener("click", async () => {
      const btn = $("#auth-go");
      btn.disabled = true;
      $("#auth-msg").textContent = "";
      try {
        if (first) {
          const code = $("#auth-code").value.trim();
          if (!code) {
            btn.disabled = false;
            $("#auth-code").focus();
            $("#auth-msg").textContent = t("Bitte den Einrichtungscode eingeben.");
            return;
          }
          await createPasskey(deviceName(), code);
        } else await usePasskey();
        await turnGear();
        document.body.classList.remove("locked");
        const done = unlock;
        unlock = null;
        if (done) done(); else location.reload();
      } catch (err) {
        btn.disabled = false;
        if (!cancelled(err)) $("#auth-msg").textContent = err.message || String(err);
      }
    });
  }

  // Entsperrt: der Riffelrand dreht ein Stück weiter (wie ein Tresorrad), dann geht es los.
  async function turnGear() {
    const logo = $(".lock-logo");
    if (!logo || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    logo.classList.remove("turn-in");
    logo.classList.add("turn-open");
    await new Promise((r) => setTimeout(r, 520));
  }

  async function status() {
    const res = await fetch("/api/auth/status", { credentials: "same-origin" });
    return res.json();
  }

  // Wartet, bis die App Daten laden darf
  async function ensure() {
    const st = await status();
    if (!st.required || st.logged_in) return;
    if (!window.PublicKeyCredential) {
      lockScreen(st, t("Dieser Browser kann keine Passkeys. Bitte Safari (iPhone) oder Chrome (Android) verwenden."));
      return new Promise(() => {});
    }
    return new Promise((resolve) => { unlock = resolve; lockScreen(st); });
  }

  // Sitzung abgelaufen, während die App offen war (api.js meldet 401)
  let lostShown = false;
  async function lost() {
    if (lostShown || document.body.classList.contains("locked")) return;
    lostShown = true;
    lockScreen(await status(), t("Wegen Inaktivität gesperrt."));
  }

  // --- Einstellungen: Abschnitt "Anmeldung"
  let passkeys = [];
  let refresh = () => {};

  async function loadPasskeys() {
    try {
      const res = await fetch("/api/auth/passkeys", { credentials: "same-origin" });
      passkeys = res.ok ? await res.json() : [];
    } catch { passkeys = []; }
  }

  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale) : "");

  function settingsHtml() {
    const rows = passkeys.map((p) => `
      <div class="row">
        <div class="grow"><div>${esc(p.name)}</div>
          <div class="hint">${t("angelegt {date}", { date: day(p.created) })}${p.last_used ? ` · ${t("zuletzt {date}", { date: day(p.last_used) })}` : ""}</div></div>
        ${passkeys.length > 1 ? `<button class="small-del" data-auth-del="${esc(p.id)}" aria-label="${t("Passkey löschen")}">${window.icon ? window.icon("trash") : "✕"}</button>` : ""}
      </div>`).join("");
    return `
      <section class="card">
        <h2>${t("Anmeldung")}</h2>
        <p class="note" style="margin-top:0">${t("Die App sperrt sich nach 15 Minuten ohne Benutzung und öffnet sich mit Face ID oder Fingerabdruck.")}</p>
        ${rows || `<div class="hint">${t("Keine Passkeys geladen.")}</div>`}
        <div class="btn-row">
          <button class="btn secondary" data-auth="add">${t("Passkey hinzufügen")}</button>
          <button class="btn secondary" data-auth="logout">${t("Jetzt sperren")}</button>
        </div>
        <button class="btn secondary block" data-auth="others" style="margin-top:8px">${t("Andere Geräte abmelden")}</button>
      </section>`;
  }

  document.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-auth]")?.dataset.auth;
    const del = e.target.closest("[data-auth-del]")?.dataset.authDel;
    try {
      if (act === "logout") {
        await post("/api/auth/logout");
        location.reload();
      } else if (act === "others") {
        if (!confirm(t("Alle anderen Geräte abmelden? Dort ist danach wieder Face ID oder Fingerabdruck nötig."))) return;
        const res = await post("/api/auth/logout-others");
        alert(tn(res.ended, "{n} Sitzung beendet.", "{n} Sitzungen beendet."));
      } else if (act === "add") {
        const name = prompt(t("Name für den Passkey (z. B. „iPad“):"), "iPad");
        if (name === null) return;
        await createPasskey(name);
        await loadPasskeys();
        refresh();
      } else if (del) {
        if (!confirm(t("Diesen Passkey löschen? Mit dem Gerät kann man sich dann nicht mehr anmelden, und alle anderen Geräte werden abgemeldet."))) return;
        const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(del)}`, {
          method: "DELETE", headers: { "X-Haushaltsbuch": "1" }, credentials: "same-origin",
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))).detail;
          throw new Error(detail ? t(detail) : t("Fehler {status}", { status: res.status }));
        }
        await loadPasskeys();
        refresh();
      }
    } catch (err) {
      if (!cancelled(err)) alert(err.message || String(err));
    }
  });

  return {
    ensure, lost, loadPasskeys, settingsHtml,
    onChange: (fn) => { refresh = fn; },
  };
})();
