// Münzwerk – Tippen/Eingaben, Abruf mit Fortschritt und Start der App. Wird zuletzt geladen.
// Alle app*.js teilen sich einen Gültigkeitsbereich (klassische Skripte, kein Build):
// Was hier oben steht, sehen die anderen Dateien. Reihenfolge siehe index.html.
"use strict";

document.addEventListener("click", async (e) => {
  if (e.target.closest(".sheet")) return;
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    state.view = tab.dataset.tab;
    state.settingsPage = null;   // „Einstellungen“ öffnet immer die Hauptseite
    widgetNewKey = null;
    window.scrollTo(0, 0);
    render();
    if (state.view === "settings") viewSettingsAsync();
    return;
  }

  const mb = e.target.closest("[data-month]");
  if (mb) { state.month = addMonths(state.month, Number(mb.dataset.month)); return render(); }

  const per = e.target.closest("[data-period]");
  if (per) { state.statsPeriod = per.dataset.period; return render(); }
  const ssec = e.target.closest("[data-ssec]");
  if (ssec) {
    if (ssec.getAttribute("aria-pressed") === "true") return;
    state.statsSection = ssec.dataset.ssec;
    // Pille erst gleiten lassen, dann den Abschnitt neu zeichnen (ohne Bewegung: sofort)
    const nav = ssec.closest(".sec-tabs");
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (nav && !calm) {
      nav.classList.add("moving");
      nav.style.setProperty("--i", [...nav.querySelectorAll("[data-ssec]")].indexOf(ssec));
      nav.querySelectorAll("[data-ssec]").forEach((b) => b.setAttribute("aria-pressed", b === ssec));
      await new Promise((r) => setTimeout(r, 200));
    }
    return render();
  }
  const sn = e.target.closest("[data-snav]");
  if (sn) return navStats(Number(sn.dataset.snav));

  const hd = e.target.closest("[data-heatday]");
  if (hd) { state.heatDay = state.heatDay === hd.dataset.heatday ? null : hd.dataset.heatday; return render(); }
  const hmode = e.target.closest("[data-heatmode]");
  if (hmode) { state.heatMode = hmode.dataset.heatmode; return render(); }
  const et = e.target.closest("[data-exptab]");
  if (et) { state.statsExpTab = et.dataset.exptab; return render(); }
  const sc = e.target.closest("[data-statcat]");
  if (sc) return openCategoryList(sc.dataset.statcat, sc.dataset.scope);
  const pot = e.target.closest("[data-savpot]");
  if (pot) return openSavingsPot(Number(pot.dataset.savpot));
  const gb = e.target.closest("[data-goal]");
  if (gb) { const g = state.goals.find((x) => String(x.id) === gb.dataset.goal); if (g) openGoalSheet(g); return; }
  const sf = e.target.closest("[data-statfix]");
  if (sf) return openFixedList(sf.dataset.statfix);

  const txBtn = e.target.closest("[data-tx]");
  if (txBtn) { const t = state.transactions.find((x) => String(x.id) === txBtn.dataset.tx); if (t) openTxSheet(t); return; }

  const act = e.target.closest("[data-action]")?.dataset.action;
  if (act === "goto-stats") {
    state.view = "stats"; state.statsPeriod = "month"; state.statsMonth = state.month; state.statsSection = "over";
    window.scrollTo(0, 0); return render();
  }
  if (act === "setup") return openSetupWizard();
  if (act === "goto-review") {
    state.view = "stats"; state.statsPeriod = "month"; state.statsMonth = e.target.closest("[data-review-month]").dataset.reviewMonth;
    window.scrollTo(0, 0); return render();
  }
  if (act === "goto-stats-cats") {
    state.view = "stats"; state.statsPeriod = "month"; state.statsMonth = state.month; state.statsExpTab = "cat";
    state.statsSection = "cats";
    window.scrollTo(0, 0); return render();
  }
  if (act === "goto-inbox") { state.view = "transactions"; state.txFilter = "open"; window.scrollTo(0, 0); return render(); }
  if (act === "goto-settings") { state.view = "settings"; state.settingsPage = null; render(); return viewSettingsAsync(); }

  const sp = e.target.closest("[data-settings-page]");
  if (sp) return openSettingsPage(sp.dataset.settingsPage || null);
  const ec = e.target.closest("[data-editcat]");
  if (ec) { const c = catById(Number(ec.dataset.editcat)); if (c) openCategoryEditSheet(c); return; }
  if (act === "connect") return connectBank();
  if (act === "savings-check") return openSavingsChecks();
  if (act === "undo") return undoLast();
  if (act === "newcat") return openCategorySheet(state.settingsKind);
  if (act === "sync") return runSync(true);
  if (act?.startsWith("widget-")) return widgetAction(act);
  if (act?.startsWith("import-")) return importAction(act);
  if (act?.startsWith("push-")) return pushAction(act);

  const ub = e.target.closest("[data-update]");
  if (ub) {
    if (ub.dataset.update !== "aktualisieren") return updateAction(ub.dataset.update);
    return confirmSheet(t("Jetzt aktualisieren?"), t("Alle Installationen auf dem Pi bekommen den neuen Stand. Die App ist dabei ein paar Minuten nicht erreichbar."),
      t("Aktualisieren"), () => updateAction("aktualisieren"), "accent");
  }

  const lb = e.target.closest("[data-lang]");
  if (lb) { window.I18N.setLang(lb.dataset.lang); return; }
  const th = e.target.closest("[data-theme-choice]");
  if (th) { window.Theme.set(th.dataset.themeChoice); return render(); }

  if (act === "clear-search") {
    state.txQuery = "";
    render();
    return;
  }
  const sr = e.target.closest("[data-srange]");
  if (sr) { state.txRange = sr.dataset.srange; $("#tx-body").innerHTML = txBody(); return; }

  const tf = e.target.closest("[data-txfilter]");
  if (tf) { state.txFilter = tf.dataset.txfilter; return render(); }

  const accBtn = e.target.closest("[data-account]");
  if (accBtn) { const a = state.accounts.find((x) => x.id === Number(accBtn.dataset.account)); if (a) openAccountSheet(a); return; }
  if (act === "newaccount") return openNewAccountSheet();
  if (act === "newgoal") return openGoalSheet();

  const sk = e.target.closest("[data-skind]");
  if (sk) { state.settingsKind = sk.dataset.skind; return render(); }

  const sh = e.target.closest("[data-shift]");
  if (sh) {
    const next = Math.min(28, Math.max(1, state.settings.shift_from_day + Number(sh.dataset.shift)));
    await API.updateSettings({ shift_from_day: next });
    return reload();
  }
  const lg = e.target.closest("[data-large]");
  if (lg) {
    const next = Math.min(500000, Math.max(5000, state.settings.large_expense_cents + Number(lg.dataset.large) * 5000));
    await API.updateSettings({ large_expense_cents: next });
    return reload();
  }

  const rv = e.target.closest("[data-review]");
  if (rv) {
    const next = Math.min(7, Math.max(0, (state.settings.review_days ?? 3) + Number(rv.dataset.review)));
    await API.updateSettings({ review_days: next });
    return reload();
  }
  const dh = e.target.closest("[data-dismiss]");
  if (dh) {
    e.stopPropagation();
    const id = dh.dataset.dismiss;
    state.settings.dismissed_hints = [...(state.settings.dismissed_hints || []), id];
    render();
    try { await API.updateSettings({ dismiss_hint: id }); } catch (err) { toast(err.message); }
    return;
  }
  const hint = e.target.closest("[data-hint]");
  if (hint) return openHint(hint.dataset.hint);

  const dr = e.target.closest("[data-delrule]");
  if (dr) { await API.deleteRule(Number(dr.dataset.delrule)); toast(t("Regel gelöscht")); return viewSettingsAsync(); }
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "tx-search") return;
  const hadQuery = !!state.txQuery.trim();
  state.txQuery = e.target.value;
  const hasQuery = !!state.txQuery.trim();
  $("#tx-body").innerHTML = txBody();
  if (hadQuery !== hasQuery) {
    renderTop();   // Monatsauswahl ein-/ausblenden
    const wrap = e.target.parentElement;
    const clear = $(".search-clear", wrap);
    if (hasQuery && !clear) wrap.insertAdjacentHTML("beforeend", `<button class="search-clear" data-action="clear-search" aria-label="${t("Suche leeren")}">✕</button>`);
    if (!hasQuery && clear) clear.remove();
  }
});

document.addEventListener("change", async (e) => {
  const pa = e.target.closest("[data-push-amount]");
  if (pa) {
    try { pushInfo = await API.pushSettings({ show_amount: pa.checked }); } catch (err) { toast(err.message); pa.checked = !pa.checked; }
    return;
  }
  const imp = e.target.closest("[data-import-file]");
  if (imp) return importFile(imp);
  if (e.target.closest(".sheet")) return;
  const fx = e.target.closest("[data-fixed]");
  if (fx) {
    const pattern = fx.dataset.fixed;
    const auto = fx.dataset.auto === "true";
    await setFixed(pattern, fx.checked, { auto });
    await reload();
  }
});

// ------------------------------------------------------------------ Abruf mit Fortschritt
// Der Server ruft in einem Schritt ab und kann keinen echten Prozentwert
// melden. Deshalb: laufender Balken mit Schritt-Texten, die der üblichen
// Reihenfolge folgen, und am Ende das echte Ergebnis.
const SYNC_STEPS = [
  [0, t("Verbinde mit der Bank …")],
  [1500, t("Lade Umsätze …")],
  [4000, t("Lade Kontostände …")],
  [8000, t("Die Bank antwortet langsam, gleich fertig …")],
];
let syncRunning = false;

function syncBar() {
  let bar = $("#syncbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "syncbar";
    bar.className = "syncbar";
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.innerHTML = `<div class="syncbar-track"><i></i></div><div class="syncbar-text"></div>`;
    document.body.append(bar);
  }
  return bar;
}

function setSyncButtons(running) {
  document.querySelectorAll('[data-action="sync"]').forEach((b) => {
    b.disabled = running;
    b.innerHTML = running ? `<span class="spinner" aria-hidden="true"></span> ${t("Lädt …")}` : `${icon("refresh")} ${t("Jetzt abrufen")}`;
  });
}

function syncResultText(r) {
  if (!r.ok) {
    if (r.reason === "expired") return t("Bankfreigabe abgelaufen – bitte unter „Einstellungen“ neu verbinden");
    if (r.reason === "not_connected") return t("Noch keine Bank verbunden");
    if (r.reason === "not_configured") return t("Bank noch nicht eingerichtet – siehe „Einstellungen“");
    return t("Abruf fehlgeschlagen – später noch einmal versuchen");
  }
  const parts = [];
  if (r.new) parts.push(tn(r.new, "{n} neuer Umsatz", "{n} neue Umsätze"));
  if (r.new_pending) parts.push(t("{n} vorgemerkt", { n: r.new_pending }));
  if (r.confirmed) parts.push(t("{n} jetzt gebucht", { n: r.confirmed }));
  if (!parts.length) return r.pending ? t("Alles aktuell · {n} noch vorgemerkt", { n: r.pending }) : t("Alles aktuell, keine neuen Umsätze");
  return parts.join(" · ") + (r.uncategorized ? ` · ${t("{n} zum Zuordnen", { n: r.uncategorized })}` : "");
}

async function runSync(manual) {
  if (syncRunning) return;
  syncRunning = true;
  const bar = syncBar();
  const text = $(".syncbar-text", bar);
  bar.className = `syncbar show running ${manual ? "" : "quiet"}`;
  setSyncButtons(true);
  const started = Date.now();
  const timers = manual ? SYNC_STEPS.map(([ms, msg]) => setTimeout(() => { text.textContent = msg; }, ms)) : [];
  let r;
  try {
    r = await API.bankSync(manual);
  } catch (err) {
    r = { ok: false, reason: "error" };
  }
  // Kurz stehen lassen, damit man den Balken auch bei schneller Antwort sieht
  const wait = manual ? Math.max(0, 900 - (Date.now() - started)) : 0;
  await new Promise((res) => setTimeout(res, wait));
  timers.forEach(clearTimeout);
  syncRunning = false;
  setSyncButtons(false);
  const changed = r.ok && (r.new || r.new_pending || r.confirmed);
  if (manual || changed || !r.ok) {
    text.textContent = syncResultText(r);
    bar.className = `syncbar show done ${r.ok ? "ok" : "fail"}`;
    setTimeout(() => { bar.className = "syncbar"; }, r.ok ? 3500 : 6000);
  } else {
    bar.className = "syncbar";
  }
  await reload();
  if (state.view === "settings") viewSettingsAsync();
}

// ------------------------------------------------------------------ Start
(async () => {
  // Erst nach der Anmeldung per Face ID Daten laden (fehlt in der Vorschau)
  if (window.Auth) {
    await window.Auth.ensure();
    window.Auth.onChange(() => { if (state.view === "settings") render(); });
  }
  await loadAll();
  const params = new URLSearchParams(location.search);
  if (params.has("verbunden")) {
    toast(t("Bank verbunden – Umsätze werden geladen"));
    history.replaceState(null, "", location.pathname);
  }
  render();
  // Beim Öffnen der App kurz nach neuen Umsätzen schauen (dezent, nur der Balken).
  if (state.bank.state !== "none") runSync(false);
})();
