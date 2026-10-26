// Verbindung zum Server. Die Vorschau (demo.html) ersetzt dieses Objekt durch
// eine Variante, die komplett im Browser läuft.
window.API = (() => {
  // Meldungen des Servers sind deutsch; "Text: Einzelheit" übersetzt den Text-Teil.
  function translateDetail(detail) {
    if (typeof detail !== "string") return null;
    const i = detail.indexOf(": ");
    return i > 0 && !I18N.EN[detail] ? `${I18N.t(detail.slice(0, i))}: ${detail.slice(i + 2)}` : I18N.t(detail);
  }
  async function req(method, path, body) {
    const res = await fetch(path, {
      method,
      // Der eigene Header schützt vor Anfragen, die fremde Webseiten auslösen wollen.
      headers: body ? { "Content-Type": "application/json", "X-Haushaltsbuch": "1" } : { "X-Haushaltsbuch": "1" },
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // Sitzung abgelaufen: Sperrbildschirm zeigen (auth.js)
      if (res.status === 401 && window.Auth) window.Auth.lost();
      let msg = I18N.t("Fehler {status}", { status: res.status });
      try { msg = translateDetail((await res.json()).detail) || msg; } catch { /* Antwort ohne JSON: Standardtext */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const q = (params) => {
    const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== false)).toString();
    return s ? `?${s}` : "";
  };
  return {
    categories: () => req("GET", "/api/categories"),
    createCategory: (data) => req("POST", "/api/categories", data),
    updateCategory: (id, data) => req("PATCH", `/api/categories/${id}`, data),
    deleteCategory: (id) => req("DELETE", `/api/categories/${id}`),
    overrides: () => req("GET", "/api/recurring-overrides"),
    setOverride: (pattern, is_fixed) => req("PUT", "/api/recurring-overrides", { pattern, is_fixed }),
    deleteOverride: (pattern) => req("DELETE", `/api/recurring-overrides${q({ pattern })}`),
    accounts: () => req("GET", "/api/accounts"),
    createAccount: (data) => req("POST", "/api/accounts", data),
    updateAccount: (id, data) => req("PATCH", `/api/accounts/${id}`, data),
    deleteAccount: (id) => req("DELETE", `/api/accounts/${id}`),
    addAccountValue: (id, data) => req("POST", `/api/accounts/${id}/values`, data),
    deleteAccountValue: (id, valueId) => req("DELETE", `/api/accounts/${id}/values/${valueId}`),
    rules: () => req("GET", "/api/rules"),
    deleteRule: (id) => req("DELETE", `/api/rules/${id}`),
    transactions: (params = {}) => req("GET", `/api/transactions${q(params)}`),
    updateTransaction: (id, data) => req("PATCH", `/api/transactions/${encodeURIComponent(id)}`, data),
    settings: () => req("GET", "/api/settings"),
    updateSettings: (data) => req("PATCH", "/api/settings", data),
    bankStatus: () => req("GET", "/api/bank/status"),
    bankConnect: () => req("POST", "/api/bank/connect"),
    bankSync: (manual) => req("POST", `/api/bank/sync${manual ? "?manual=1" : ""}`),
    undoStatus: () => req("GET", "/api/undo"),
    undo: () => req("POST", "/api/undo"),
    // Bereich „Updates“ – nur wenn die Installation das erlaubt (404 -> null = ausgeblendet).
    // Andere Fehler verschwinden nicht still, sondern kommen als {error} zurück.
    updates: () => req("GET", "/api/updates").catch((e) => (e.status === 404 ? null : { error: e.message })),
    version: () => req("GET", "/api/version").catch((e) => { console.warn("Version nicht abrufbar:", e.message); return null; }),
    updateAction: (aktion) => req("POST", "/api/updates", { aktion }),
    // Einrichtungs-Assistent für die Bank (app/setup.py)
    setupStatus: () => req("GET", "/api/setup"),
    setupSave: (data) => req("POST", "/api/setup/enablebanking", data),
    setupTest: () => req("POST", "/api/setup/test"),
    setupBanks: (country) => req("GET", `/api/setup/banks${q({ country })}`),
    setupBank: (data) => req("PUT", "/api/setup/bank", data),
    // Mitteilungen (app/push.py)
    pushStatus: () => req("GET", "/api/push"),
    pushSubscribe: (sub) => req("POST", "/api/push/subscribe", sub),
    pushUnsubscribe: (endpoint) => req("POST", "/api/push/unsubscribe", { endpoint }),
    pushSettings: (data) => req("PATCH", "/api/push/settings", data),
    pushTest: () => req("POST", "/api/push/test"),
    // Sparziele (app/goals.py)
    goals: () => req("GET", "/api/goals"),
    createGoal: (data) => req("POST", "/api/goals", data),
    updateGoal: (id, data) => req("PATCH", `/api/goals/${id}`, data),
    deleteGoal: (id) => req("DELETE", `/api/goals/${id}`),
    // Umsätze aus CSV nachtragen (app/csvimport.py)
    importStatus: () => req("GET", "/api/import/csv"),
    importPreview: (csv) => req("POST", "/api/import/csv/preview", { csv }),
    importCsv: (csv) => req("POST", "/api/import/csv", { csv }),
    importRemove: () => req("DELETE", "/api/import/csv"),
    // iPhone-Widget (app/widget.py)
    widgetKey: () => req("GET", "/api/widget/key"),
    widgetNewKey: () => req("POST", "/api/widget/key"),
    widgetRevoke: () => req("DELETE", "/api/widget/key"),
    widgetSnapshot: (data) => req("PUT", "/api/widget/snapshot", data),
  };
})();
