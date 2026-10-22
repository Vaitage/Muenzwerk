// Nur für die Vorschau (demo.html): bildet die Server-Schnittstelle komplett
// im Browser nach, mit erfundenen Umsätzen. Nichts wird gespeichert.
window.API = (() => {
  const D = window.DEMO_DATA; // vom Build-Skript eingefügt
  let nextCat = 1000, nextRule = 1000;
  // Standardkategorien in der Sprache der Oberfläche (die Demo-Datenbank ist deutsch)
  const cats = D.categories.map((c) => ({ ...c, name: I18N.t(c.name) }));
  const rules = D.rules.map((r) => ({ ...r }));
  const settings = { shift_from_day: 15, large_expense_cents: 25000 };
  const overrides = new Map();
  let nextAcc = 100, nextVal = 1000;
  const accounts = (D.accounts || []).map((a) => ({ ...a, values: a.values.map((v) => ({ ...v })) }));
  const ibanKey = (x) => String(x || "").replace(/\s+/g, "").toLowerCase();
  const matchKey = (x) => (/^[a-z]{2}\d{2}[a-z0-9]{11,}$/i.test(ibanKey(x)) ? ibanKey(x) : norm(x));
  const txs = [];
  const today = new Date();
  // Ein Beispiel-Sparziel: vor zwei Monaten angelegt, fällig in sieben Monaten
  const monthOf = (d, add) => { const x = new Date(d.getFullYear(), d.getMonth() + add, 15); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`; };
  let nextGoal = 2;
  const goals = [{ id: 1, name: I18N.t("Urlaub"), icon: "plane", target_cents: 240000, target_month: monthOf(today, 7),
    monthly_cents: null, start_month: monthOf(today, -2), start_cents: 0, archived: false }];
  const validUntil = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const bank = { provider: "demo", valid_until: validUntil, last_sync: new Date().toISOString() };

  const norm = (s) => String(s || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  const nextMonth = (m) => { let [y, mo] = m.split("-").map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${String(mo).padStart(2, "0")}`; };
  const cat = (id) => cats.find((c) => c.id === id);
  const budgetMonth = (t) => {
    const c = cat(t.category_id);
    const day = Number(t.booking_date.slice(8, 10));
    return c && c.shift_next_month && day >= settings.shift_from_day ? nextMonth(t.booking_date.slice(0, 7)) : t.booking_date.slice(0, 7);
  };
  const sortedRules = () => rules.map((r) => ({ ...r, kind: cat(r.category_id)?.kind, sav: !!cat(r.category_id)?.is_savings, p: norm(r.pattern) }))
    .filter((r) => r.kind).sort((a, b) => b.p.length - a.p.length || b.id - a.id);
  const match = (t, rs) => {
    const kind = t.amount_cents > 0 ? "income" : "expense";
    const hay = `${norm(`${t.counterparty} ${t.purpose}`)} ${ibanKey(t.counterparty_iban)}`;
    return rs.find((r) => (r.kind === kind || r.sav) && r.p && hay.includes(r.p));
  };
  const recompute = () => txs.forEach((t) => { if (!t.budget_month_manual) t.budget_month = budgetMonth(t); });

  const rs0 = sortedRules();
  for (const raw of D.transactions) {
    const r = match(raw, rs0);
    const t = { ...raw, category_id: r ? r.category_id : null, budget_month_manual: false, categorized_by: r ? "rule" : null };
    t.budget_month = budgetMonth(t);
    txs.push(t);
  }

  const view = (t) => {
    const c = cat(t.category_id);
    return { ...t, category: c?.name ?? null, category_icon: c?.icon ?? null, category_kind: c?.kind ?? null, shifted: t.budget_month !== t.booking_date.slice(0, 7) };
  };
  const ok = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));

  return {
    categories: () => ok([...cats].sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort)),
    createCategory: (d) => {
      if (cats.some((c) => c.name === d.name && c.kind === d.kind)) return Promise.reject(new Error(I18N.t("Diese Kategorie gibt es schon.")));
      const c = { id: nextCat++, name: d.name, kind: d.kind, icon: d.icon, sort: 999, shift_next_month: !!d.shift_next_month, is_savings: !!d.is_savings };
      cats.push(c); return ok(c);
    },
    updateCategory: (id, d) => { Object.assign(cat(id), d); recompute(); return ok(cat(id)); },
    deleteCategory: (id) => {
      cats.splice(cats.findIndex((c) => c.id === id), 1);
      txs.forEach((t) => { if (t.category_id === id) t.category_id = null; });
      for (let i = rules.length - 1; i >= 0; i--) if (rules[i].category_id === id) rules.splice(i, 1);
      recompute(); return ok(null);
    },
    overrides: () => ok([...overrides].map(([pattern, is_fixed]) => ({ pattern, is_fixed }))),
    setOverride: (pattern, is_fixed) => { overrides.set(norm(pattern), is_fixed); return ok({ ok: true }); },
    deleteOverride: (pattern) => { overrides.delete(norm(pattern)); return ok(null); },
    rules: () => ok(rules.map((r) => ({ ...r, category: cat(r.category_id)?.name, kind: cat(r.category_id)?.kind }))
      .sort((a, b) => (a.source === "user" ? -1 : 1) - (b.source === "user" ? -1 : 1) || a.pattern.localeCompare(b.pattern))),
    deleteRule: (id) => { rules.splice(rules.findIndex((r) => r.id === id), 1); return ok(null); },
    transactions: ({ month, uncategorized } = {}) => ok(txs
      .filter((t) => (!month || t.budget_month === month) && (!uncategorized || t.category_id == null))
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date)).map(view)),
    updateTransaction: (id, d) => {
      const t = txs.find((x) => x.id === id);
      let also = 0;
      if (d.set_category) {
        t.category_id = d.category_id; t.categorized_by = d.category_id ? "user" : null;
        const p = norm(t.counterparty);
        if (d.remember && d.category_id && p) {
          if (!rules.some((r) => r.pattern === p && r.category_id === d.category_id))
            rules.push({ id: nextRule++, pattern: p, category_id: d.category_id, source: "user" });
          const rs = sortedRules();
          txs.forEach((o) => { if (o !== t && o.category_id == null) { const r = match(o, rs); if (r) { o.category_id = r.category_id; also++; } } });
        }
        recompute();
      }
      if (d.budget_month_auto) { t.budget_month_manual = false; recompute(); }
      else if (d.budget_month) { t.budget_month = d.budget_month; t.budget_month_manual = true; }
      return ok({ ...view(t), also_assigned: also });
    },
    settings: () => ok(settings),
    updateSettings: (d) => { Object.assign(settings, d); recompute(); return ok(settings); },
    accounts: () => ok(accounts),
    createAccount: (d) => {
      const icons = { giro: "bank", savings: "piggy", depot: "trend", loan: "receipt" };
      const a = {
        id: nextAcc++, name: d.name, type: d.type, icon: icons[d.type], match: matchKey(d.match || ""), bank: false,
        include_in_total: d.include_in_total !== false, loan_rate_percent: d.loan_rate_percent ?? null,
        loan_payment_cents: d.loan_payment_cents ?? null, loan_original_cents: d.loan_original_cents ?? null, values: [],
      };
      if (d.value_cents != null) a.values.push({ id: nextVal++, date: d.value_date, value_cents: d.value_cents, source: "manual" });
      accounts.push(a);
      return ok({ ...a, assigned: 0 });
    },
    updateAccount: (id, d) => {
      const a = accounts.find((x) => x.id === id);
      Object.assign(a, d);
      if (d.match != null) a.match = matchKey(d.match);
      return ok({ ...a, assigned: 0 });
    },
    deleteAccount: (id) => { accounts.splice(accounts.findIndex((x) => x.id === id), 1); return ok(null); },
    addAccountValue: (id, d) => {
      const a = accounts.find((x) => x.id === id);
      const date = d.date || new Date().toISOString().slice(0, 10);
      const ex = a.values.find((v) => v.date === date);
      if (ex) ex.value_cents = d.value_cents; else a.values.push({ id: nextVal++, date, value_cents: d.value_cents, source: "manual" });
      return ok({ ok: true });
    },
    deleteAccountValue: (id, vid) => { const a = accounts.find((x) => x.id === id); a.values = a.values.filter((v) => v.id !== vid); return ok(null); },
    goals: () => ok(goals.map((g) => ({ ...g }))),
    createGoal: (d) => { const g = { monthly_cents: null, target_month: null, start_cents: 0, icon: "piggy", ...d, id: nextGoal++, archived: false }; goals.push(g); return ok({ ...g }); },
    updateGoal: (id, d) => {
      const g = goals.find((x) => x.id === id);
      const { clear_target_month: clear, ...rest } = d;
      Object.assign(g, rest);
      if (clear) g.target_month = null;
      if (g.target_month) g.monthly_cents = null;
      return ok({ ...g });
    },
    deleteGoal: (id) => { goals.splice(goals.findIndex((x) => x.id === id), 1); return ok(null); },
    bankStatus: () => {
      const days = Math.round((new Date(bank.valid_until + "T12:00:00") - today) / 86400000);
      return ok({ state: days <= 7 ? "expiring" : "active", days_left: days, valid_until: bank.valid_until, last_sync: bank.last_sync, provider: "demo" });
    },
    bankConnect: () => { bank.valid_until = validUntil; return ok({ url: null }); },
    bankSync: () => new Promise((res) => setTimeout(() => {   // simulierte Wartezeit wie bei der Bank
      bank.last_sync = new Date().toISOString();
      res({ ok: true, new: 0, categorized: 0, uncategorized: 0, confirmed: 0, new_pending: 0, pending: txs.filter((t) => t.pending).length });
    }, 2200)),
  };
})();
