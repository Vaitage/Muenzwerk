// Auswertungen: Fixkosten-Erkennung, Monatsbudget, Prognose und Statistik.
//
// Reine Rechenfunktionen ohne Bildschirm-Code. Sie laufen im Browser (App und
// Vorschau) und lassen sich mit Node testen (tests/analytics.test.mjs).
//
// Begriffe (alle Beträge in Cent):
//   Einnahmen    = regelmäßige + variable Einnahmen (ohne Spar-Umbuchungen)
//   Ausgaben     = Fixkosten + variable Ausgaben + große Ausgaben (ohne Sparen)
//   Ersparnisse  = aufs Sparkonto gelegt minus wieder abgehoben
//   Überschuss   = Einnahmen − Ausgaben  (das, was man im Monat "behalten" hat)
//   Übrig        = Überschuss − Ersparnisse − noch offene Fixkosten
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Analytics = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Ab wann eine Zahlung als "regelmäßig" gilt.
  const RECURRING = {
    minMonths: 2,          // in mindestens 2 verschiedenen Monaten
    maxPerMonth: 2,        // höchstens 2× pro Monat (sonst eher Einkauf)
    maxAmountRatio: 1.3,   // Beträge schwanken höchstens um 30 %
  };
  const PACE_PRIOR_DAYS = 10;  // wie stark die Vormonate die Prognose stützen

  // ------------------------------------------------------------ Hilfen
  const norm = (s) => String(s || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  // Übersetzung, falls i18n.js geladen ist (im Browser); in den Tests bleibt es deutsch
  const tr = (s) => (typeof self !== "undefined" && self.I18N ? self.I18N.t(s) : s);
  const pad = (n) => String(n).padStart(2, "0");
  const addMonths = (m, n) => {
    let [y, mo] = m.split("-").map(Number);
    mo += n;
    while (mo > 12) { mo -= 12; y++; }
    while (mo < 1) { mo += 12; y--; }
    return `${y}-${pad(mo)}`;
  };
  const daysIn = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).getDate(); };
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  };
  const monthRange = (from, to) => {
    const out = [];
    for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
    return out;
  };

  // ------------------------------------------------------------ Kontext
  // Bündelt alles, was die Auswertungen brauchen. Einmal pro Datenstand bauen.
  function createContext({ transactions, categories, overrides = {}, settings = {}, today = new Date() }) {
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const ctx = {
      transactions,
      catMap,
      overrides,
      large: settings.large_expense_cents ?? 25000,
      todayIso: typeof today === "string" ? today : isoOf(today),
    };
    ctx.currentMonth = ctx.todayIso.slice(0, 7);
    ctx.todayDay = Number(ctx.todayIso.slice(8, 10));
    ctx.isSavings = (t) => !!catMap.get(t.category_id)?.is_savings;
    ctx.recurring = detectRecurring(ctx);
    ctx.classOf = (t) => classify(t, ctx);
    ctx.byMonth = new Map();
    for (const t of transactions) {
      if (!ctx.byMonth.has(t.budget_month)) ctx.byMonth.set(t.budget_month, []);
      ctx.byMonth.get(t.budget_month).push(t);
    }
    const months = [...ctx.byMonth.keys()].sort();
    ctx.firstMonth = months[0] || ctx.currentMonth;
    ctx.lastMonth = months.length && months[months.length - 1] > ctx.currentMonth ? months[months.length - 1] : ctx.currentMonth;
    return ctx;
  }

  // ------------------------------------------------------------ Fixkosten-Erkennung
  function recurringKey(t) {
    return `${t.amount_cents > 0 ? "income" : "expense"}|${norm(t.counterparty)}`;
  }

  function detectRecurring(ctx) {
    const groups = new Map();
    for (const t of ctx.transactions) {
      // Vorgemerkte zählen nicht mit: Betrag kann sich noch ändern
      if (ctx.isSavings(t) || t.pending) continue;
      const pattern = norm(t.counterparty);
      if (!pattern) continue;
      const key = recurringKey(t);
      if (!groups.has(key)) groups.set(key, { key, pattern, kind: t.amount_cents > 0 ? "income" : "expense", items: [] });
      groups.get(key).items.push(t);
    }
    const result = new Map();
    for (const g of groups.values()) {
      const perMonth = new Map();
      for (const t of g.items) perMonth.set(t.budget_month, (perMonth.get(t.budget_month) || 0) + 1);
      const amounts = g.items.map((t) => Math.abs(t.amount_cents));
      const ratio = Math.max(...amounts) / Math.max(1, Math.min(...amounts));
      const auto = perMonth.size >= RECURRING.minMonths
        && Math.max(...perMonth.values()) <= RECURRING.maxPerMonth
        && ratio <= RECURRING.maxAmountRatio;
      const override = ctx.overrides[g.pattern];
      const latest = g.items.reduce((a, b) => (a.booking_date >= b.booking_date ? a : b));
      result.set(g.key, {
        key: g.key,
        pattern: g.pattern,
        kind: g.kind,
        name: latest.counterparty,
        category_id: latest.category_id,
        auto,
        overridden: override !== undefined,
        fixed: override !== undefined ? override : auto,
        amount_cents: Math.abs(latest.amount_cents),
        day: median(g.items.map((t) => Number(t.booking_date.slice(8, 10)))),
        months: new Set(perMonth.keys()),
        lastMonth: [...perMonth.keys()].sort().pop(),
        count: g.items.length,
      });
    }
    return result;
  }

  function classify(t, ctx) {
    if (ctx.isSavings(t)) return "savings";
    const info = ctx.recurring.get(recurringKey(t));
    if (t.amount_cents > 0) return info?.fixed ? "income_regular" : "income_variable";
    if (info?.fixed) return "fixed";
    return -t.amount_cents >= ctx.large ? "large" : "variable";
  }

  // ------------------------------------------------------------ Summen
  function emptyTotals() {
    return {
      income_regular: 0, income_variable: 0, income: 0,
      fixed: 0, variable: 0, large: 0, expense: 0,
      savings: 0, saved_in: 0, saved_out: 0,
      surplus: 0, net: 0, count: 0,
    };
  }

  function addTotals(a, b) {
    const out = emptyTotals();
    for (const k of Object.keys(out)) out[k] = a[k] + b[k];
    return out;
  }

  // Summen für eine Liste von Umsätzen (Ausgaben als positive Beträge).
  function totalsFor(list, ctx) {
    const s = emptyTotals();
    for (const t of list) {
      const a = t.amount_cents;
      switch (ctx.classOf(t)) {
        case "savings":
          if (a < 0) s.saved_in += -a; else s.saved_out += a;
          break;
        case "income_regular": s.income_regular += a; break;
        case "income_variable": s.income_variable += a; break;
        case "fixed": s.fixed += -a; break;
        case "large": s.large += -a; break;
        default: s.variable += -a;
      }
      s.count++;
    }
    s.income = s.income_regular + s.income_variable;
    s.expense = s.fixed + s.variable + s.large;
    s.savings = s.saved_in - s.saved_out;
    s.surplus = s.income - s.expense;
    s.net = s.surplus - s.savings;
    return s;
  }

  const monthTotals = (m, ctx) => totalsFor(ctx.byMonth.get(m) || [], ctx);

  function byCategory(list, ctx) {
    const groups = new Map();
    for (const t of list) {
      if (t.amount_cents >= 0 || ctx.isSavings(t)) continue;
      const k = t.category_id ?? "none";
      const c = ctx.catMap.get(t.category_id);
      if (!groups.has(k)) groups.set(k, { id: t.category_id ?? null, name: c?.name ?? tr("Nicht zugeordnet"), icon: c?.icon ?? "help", total: 0, count: 0 });
      const g = groups.get(k);
      g.total += -t.amount_cents;
      g.count++;
    }
    return [...groups.values()].sort((a, b) => b.total - a.total);
  }

  // ------------------------------------------------------------ Monatsbericht
  function monthReport(m, ctx) {
    const list = ctx.byMonth.get(m) || [];
    const totals = totalsFor(list, ctx);
    const D = daysIn(m);
    const status = m < ctx.currentMonth ? "past" : m === ctx.currentMonth ? "current" : "future";
    const elapsed = status === "past" ? D : status === "current" ? ctx.todayDay : 0;

    // Noch nicht gebuchte Fixkosten und regelmäßige Einnahmen.
    const openFixed = [];
    const expectedIncome = [];
    if (status !== "past") {
      const recent = new Set([addMonths(m, -1), addMonths(m, -2)]);
      for (const info of ctx.recurring.values()) {
        if (!info.fixed || info.months.has(m)) continue;
        if (![...info.months].some((x) => recent.has(x))) continue;
        let day = Math.min(info.day, D);
        const overdue = status === "current" && day < ctx.todayDay;
        if (overdue) day = ctx.todayDay;
        const item = { name: info.name, pattern: info.pattern, amount_cents: info.amount_cents, day, overdue, category_id: info.category_id };
        (info.kind === "expense" ? openFixed : expectedIncome).push(item);
      }
      openFixed.sort((a, b) => a.day - b.day);
      expectedIncome.sort((a, b) => a.day - b.day);
    }
    const openFixedTotal = openFixed.reduce((s, x) => s + x.amount_cents, 0);
    const expectedIncomeTotal = expectedIncome.reduce((s, x) => s + x.amount_cents, 0);

    // Tempo der variablen Ausgaben: aktueller Monat, gestützt durch die Vormonate.
    const histMonths = [1, 2, 3].map((k) => addMonths(m, -k)).filter((x) => ctx.byMonth.has(x) && x < ctx.currentMonth);
    let histSpend = 0, histDays = 0;
    for (const hm of histMonths) { histSpend += monthTotals(hm, ctx).variable; histDays += daysIn(hm); }
    const histDaily = histDays ? histSpend / histDays : 0;
    let pace;
    if (status === "past") pace = totals.variable / D;
    else if (elapsed === 0) pace = histDaily;
    else if (!histDays) pace = totals.variable / elapsed;
    else pace = (totals.variable + histDaily * PACE_PRIOR_DAYS) / (elapsed + PACE_PRIOR_DAYS);

    const budgetLeft = totals.net - openFixedTotal;
    const remaining = D - elapsed;                       // Tage nach heute
    const daysLeftIncl = status === "current" ? D - ctx.todayDay + 1 : status === "future" ? D : 0;
    const dailyBudget = daysLeftIncl > 0 ? budgetLeft / daysLeftIncl : null;
    const forecastEnd = status === "past" ? totals.net : Math.round(budgetLeft + expectedIncomeTotal - pace * remaining);

    // Vorschau: Tagesbudget heute, morgen, übermorgen – wenn du so weiter ausgibst wie bisher.
    const preview = [];
    if (status === "current") {
      for (let k = 0; k < 3 && ctx.todayDay + k <= D; k++) {
        const day = ctx.todayDay + k;
        const income = expectedIncome.filter((x) => x.day > ctx.todayDay && x.day <= day).reduce((s, x) => s + x.amount_cents, 0);
        preview.push({
          day,
          iso: `${m}-${pad(day)}`,
          daily: (budgetLeft + income - pace * k) / (daysLeftIncl - k),
          due: openFixed.filter((x) => x.day === day),
          incoming: expectedIncome.filter((x) => x.day === day),
        });
      }
    }

    // Verlauf im Monat (was auf dem Konto übrig ist) und Prognose bis Monatsende.
    const dayIndex = (t) => {
      const bm = t.booking_date.slice(0, 7);
      if (bm === m) return Number(t.booking_date.slice(8, 10));
      return bm < m ? 1 : D;   // z. B. Gehalt vom Vormonat zählt ab Tag 1
    };
    const daily = new Array(D + 1).fill(0);
    for (const t of list) daily[dayIndex(t)] += t.amount_cents;   // Kontostand-Wirkung
    const actual = [];
    let run = 0;
    for (let d = 1; d <= elapsed; d++) { run += daily[d]; actual.push({ day: d, value: run }); }
    const forecast = [];
    if (status !== "past") {
      // Startpunkt: heute (oder Tag 1 eines künftigen Monats mit allem schon Gebuchten)
      const start = Math.max(elapsed, 1);
      let v = elapsed ? run : totals.net;
      for (const x of openFixed) if (x.day <= start) v -= x.amount_cents;
      for (const x of expectedIncome) if (x.day <= start) v += x.amount_cents;
      if (!elapsed) v -= pace;
      forecast.push({ day: start, value: Math.round(v) });
      for (let d = start + 1; d <= D; d++) {
        v -= pace;
        for (const x of openFixed) if (x.day === d) v -= x.amount_cents;
        for (const x of expectedIncome) if (x.day === d) v += x.amount_cents;
        forecast.push({ day: d, value: Math.round(v) });
      }
    }

    return {
      month: m, status, days: D, elapsed, daysLeftIncl,
      totals, openFixed, openFixedTotal, expectedIncome, expectedIncomeTotal,
      pace, budgetLeft, dailyBudget, forecastEnd, preview,
      series: { actual, forecast },
      byCategory: byCategory(list, ctx),
    };
  }

  // ------------------------------------------------------------ Statistik
  function periodList(period, value, ctx) {
    if (period === "month") return [value];
    if (period === "year") return monthRange(`${value}-01`, `${value}-12`).filter((m) => m <= ctx.lastMonth);
    return monthRange(ctx.firstMonth, ctx.lastMonth);
  }

  function stats(period, value, ctx) {
    const months = periodList(period, value, ctx);
    const rows = months.map((m) => ({ month: m, ...monthTotals(m, ctx) }));
    const withData = rows.filter((r) => r.count > 0);
    const totals = rows.reduce((a, r) => addTotals(a, r), emptyTotals());
    const list = months.flatMap((m) => ctx.byMonth.get(m) || []);
    const n = Math.max(1, withData.length);
    const average = {};
    for (const k of ["income", "expense", "fixed", "variable", "large", "savings", "surplus"]) average[k] = totals[k] / n;

    // Vergleich mit dem vorigen Zeitraum
    let previous = null, previousMonths = 0;
    if (period === "month") { previous = monthTotals(addMonths(value, -1), ctx); previousMonths = 1; }
    if (period === "year") {
      const prevRows = periodList("year", String(Number(value) - 1), ctx).map((m) => monthTotals(m, ctx));
      previous = prevRows.reduce((a, r) => addTotals(a, r), emptyTotals());
      previousMonths = prevRows.filter((r) => r.count > 0).length;
      if (!previousMonths) previous = null;
    }

    // Jahre (für "Alles")
    const years = [];
    if (period === "all") {
      const byYear = new Map();
      for (const r of rows) {
        const y = r.month.slice(0, 4);
        byYear.set(y, addTotals(byYear.get(y) || emptyTotals(), r));
      }
      for (const [year, t] of byYear) years.push({ year, ...t });
    }

    return { period, value, months: rows, monthsWithData: withData.length, totals, average, previous, previousMonths, years, byCategory: byCategory(list, ctx) };
  }

  // Angesparter Überschuss über die ganze Zeit (Monat für Monat aufaddiert).
  // ------------------------------------------------------------ Ersparnisse
  // Wohin das Geld geht: je Spartopf (= Spar-Kategorie) dieser Monat, insgesamt
  // und der Monatsschnitt, dazu Hinweise auf Buchungen, die wohl falsch sitzen.
  // Grundlage sind nur die Überweisungen, die die App sieht (keine Kontostände).
  const counterpartyKey = (s) => String(s || "").toLowerCase().replace(/[^a-zäöüß ]+/g, " ").split(/\s+/).filter(Boolean).join(" ");
  const SAVINGS_WORDS = /spar(plan|en|konto|rate)|invest|depot|\betf\b|tagesgeld|extra-?konto|festgeld|bauspar|wertpapier|vermögenswirksam/i;
  const CARD_PAYMENT = /kaufumsatz|visa card|girocard|mastercard|kartenzahlung/i;

  function savingsOverview(ctx) {
    const booked = ctx.transactions.filter((t) => !t.pending);
    const saved = booked.filter((t) => ctx.isSavings(t));
    const pots = new Map();
    for (const t of saved) {
      const c = ctx.catMap.get(t.category_id);
      if (!pots.has(c.id)) pots.set(c.id, { id: c.id, name: c.name, icon: c.icon, thisMonth: 0, total: 0, count: 0, months: new Set(), recipients: new Map() });
      const p = pots.get(c.id);
      const v = -t.amount_cents;   // Einzahlen positiv, Abheben negativ
      p.total += v;
      p.count++;
      p.months.add(t.budget_month);
      if (t.budget_month === ctx.currentMonth) p.thisMonth += v;
      // Wer bekommt das Geld? Empfänger, bei Überweisungen an sich selbst lieber der Zweck
      const who = t.counterparty || "?";
      const r = p.recipients.get(who) || { name: who, purpose: t.purpose || "", total: 0, count: 0 };
      r.total += v;
      r.count++;
      p.recipients.set(who, r);
    }
    const months = Math.max(1, monthRange(ctx.firstMonth, ctx.currentMonth).length);
    const list = [...pots.values()].map((p) => ({
      ...p, months: p.months.size, avg: Math.round(p.total / months),
      recipients: [...p.recipients.values()].sort((a, b) => b.total - a.total),
    })).sort((a, b) => b.total - a.total);

    // Prüfen: (1) klingt nach Sparen, zählt aber als Ausgabe
    //         (2) gleicher Empfänger und Zweck wie eine Ersparnis, aber anders zugeordnet
    //         (3) Kartenzahlung in einer Spar-Kategorie (eher ein Einkauf)
    // Muster, die mindestens zweimal als Ersparnis vorkommen (kein Einkauf) – ein
    // einzelner Ausreißer im Spartopf soll nicht alle ähnlichen Umsätze melden
    const keyOf = (t) => `${counterpartyKey(t.counterparty)}|${counterpartyKey(t.purpose).split(" ").slice(0, 3).join(" ")}`;
    const keyCount = new Map();
    for (const t of saved) if (!CARD_PAYMENT.test(t.purpose || "")) keyCount.set(keyOf(t), (keyCount.get(keyOf(t)) || 0) + 1);
    const savedKeys = new Set([...keyCount].filter(([, n]) => n >= 2).map(([k]) => k));
    const checks = [];
    for (const t of booked) {
      if (ctx.isSavings(t)) {
        if (t.amount_cents < 0 && CARD_PAYMENT.test(t.purpose || "") && !SAVINGS_WORDS.test(t.counterparty || "")) checks.push({ tx: t, reason: "card" });
        continue;
      }
      if (t.amount_cents >= 0) continue;
      if (savedKeys.has(keyOf(t))) checks.push({ tx: t, reason: "like_other" });
      else if (SAVINGS_WORDS.test(`${t.counterparty} ${t.purpose}`)) checks.push({ tx: t, reason: "words" });
    }
    checks.sort((a, b) => b.tx.booking_date.localeCompare(a.tx.booking_date));

    return {
      pots: list,
      thisMonth: list.reduce((s, p) => s + p.thisMonth, 0),
      total: list.reduce((s, p) => s + p.total, 0),
      avg: Math.round(list.reduce((s, p) => s + p.total, 0) / months),
      since: ctx.firstMonth,
      checks,
    };
  }

  function cumulative(ctx, upto = ctx.lastMonth) {
    let surplus = 0, savings = 0;
    return monthRange(ctx.firstMonth, upto).map((m) => {
      const t = monthTotals(m, ctx);
      surplus += t.surplus;
      savings += t.savings;
      return { month: m, surplus: t.surplus, cumSurplus: surplus, cumSavings: savings };
    });
  }

  function recurringList(ctx) {
    return [...ctx.recurring.values()]
      .filter((r) => r.fixed || r.auto || r.overridden || r.months.size >= 2)
      .sort((a, b) => Number(b.fixed) - Number(a.fixed) || b.amount_cents - a.amount_cents);
  }

  // ------------------------------------------------------------ Suche
  // Sucht in Empfänger, Verwendungszweck, Kategorie, IBAN und Betrag.
  // Mehrere Wörter müssen alle vorkommen ("amazon 2026" findet nur Treffer mit beidem).
  const amountText = (cents) => (Math.abs(cents) / 100).toFixed(2).replace(".", ",");

  function searchTransactions(ctx, query, range = "all") {
    // Beträge vereinheitlichen: "39.95" und "1.234,56" werden wie "39,95" bzw. "1234,56" gesucht.
    const fixAmount = (t) => (/^\d+\.\d{1,2}$/.test(t) ? t.replace(".", ",") : /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "") : t);
    const terms = norm(query).split(" ").map((t) => fixAmount(t.replace(/€/g, ""))).filter(Boolean);
    if (!terms.length) return null;
    let months;
    if (range === "month") months = [ctx.currentMonth];
    else if (range === "year") months = monthRange(`${ctx.currentMonth.slice(0, 4)}-01`, ctx.currentMonth);
    else months = monthRange(ctx.firstMonth, ctx.currentMonth);
    const inRange = new Set(months);
    const list = ctx.transactions.filter((t) => {
      if (!inRange.has(t.budget_month)) return false;
      const cat = ctx.catMap.get(t.category_id);
      const hay = `${haystack(t)} ${norm(cat?.name || tr("Nicht zugeordnet"))} ${amountText(t.amount_cents)} ${t.booking_date}`;
      return terms.every((term) => hay.includes(term));
    }).sort((a, b) => b.booking_date.localeCompare(a.booking_date));
    let expense = 0, income = 0, saved = 0;
    for (const t of list) {
      if (ctx.isSavings(t)) saved -= t.amount_cents;
      else if (t.amount_cents < 0) expense -= t.amount_cents;
      else income += t.amount_cents;
    }
    return { list, count: list.length, expense, income, saved, months: months.length, perMonth: expense / Math.max(1, months.length) };
  }

  // ------------------------------------------------------------ Vermögen
  // Konten: Girokonto, Sparkonten, Depots, Kredite. Jedes Konto hat Stichtagswerte
  // (von Hand oder von der Bank). Dazwischen und davor rechnet die App mit den
  // Umbuchungen vom Girokonto weiter, Kredite mit dem Tilgungsplan.
  const ibanKey = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const haystack = (t) => `${norm(`${t.counterparty} ${t.purpose}`)} ${ibanKey(t.counterparty_iban)}`;
  const monthIdx = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  const monthEnd = (m, todayIso) => { const e = `${m}-${pad(daysIn(m))}`; return e > todayIso ? todayIso : e; };

  // Umsätze des Girokontos, die zu diesem Konto gehören.
  function linkedTransfers(acc, transactions) {
    if (acc.type === "giro") return transactions;
    if (!acc.match) return [];
    return transactions.filter((t) => haystack(t).includes(acc.match));
  }
  // Was ein Umsatz für das Konto bedeutet: aufs Sparkonto überwiesen = mehr drauf.
  const flowOf = (acc, t) => (acc.type === "giro" ? t.amount_cents : -t.amount_cents);

  function loanStep(bal, acc, months) {
    const r = (acc.loan_rate_percent || 0) / 100 / 12;
    const pay = acc.loan_payment_cents || 0;
    let b = bal;
    if (months > 0) for (let i = 0; i < months; i++) b = Math.max(0, b * (1 + r) - pay);
    else for (let i = 0; i < -months; i++) b = (b + pay) / (1 + r);
    return Math.round(b);
  }

  function accountValueAt(acc, iso, transactions) {
    const values = [...(acc.values || [])].sort((a, b) => a.date.localeCompare(b.date));
    if (!values.length) return null;
    let snap = null;
    for (const v of values) if (v.date <= iso) snap = v;
    const exact = snap && snap.date === iso;
    if (!snap) snap = values[0];
    if (acc.type === "loan") return { value: loanStep(snap.value_cents, acc, monthIdx(iso) - monthIdx(snap.date)), estimated: !exact, snapDate: snap.date };
    let v = snap.value_cents;
    // Vorgemerkte Umsätze stecken nicht im gebuchten Stand der Bank. Beim
    // Girokonto zählen die fälligen trotzdem mit – so wie in der Banking-App.
    const linked = linkedTransfers(acc, transactions).filter((t) => !t.pending);
    let pendingCents = 0;
    if (acc.type === "giro" && iso >= snap.date) {
      for (const t of transactions) if (t.pending && t.booking_date <= iso) pendingCents += t.amount_cents;
      v += pendingCents;
    }
    if (iso >= snap.date) {
      for (const t of linked) if (t.booking_date > snap.date && t.booking_date <= iso) v += flowOf(acc, t);
    } else {
      for (const t of linked) if (t.booking_date > iso && t.booking_date <= snap.date) v -= flowOf(acc, t);
      // Ein Sparkonto oder Depot kann nicht ins Minus gehen: dann gab es das Konto noch nicht.
      if (acc.type !== "giro" && v < 0) v = 0;
    }
    return { value: v, estimated: !exact, snapDate: snap.date, pendingCents };
  }

  function loanInfo(acc, balance, todayIso) {
    const r = (acc.loan_rate_percent || 0) / 100 / 12;
    const pay = acc.loan_payment_cents || 0;
    const out = { balance, payment: pay, months: null, payoffMonth: null, interestLeft: null, progress: null, interestThisMonth: Math.round(balance * r) };
    if (acc.loan_original_cents) out.progress = Math.max(0, Math.min(1, 1 - balance / acc.loan_original_cents));
    if (!pay || pay <= balance * r) return out;   // Rate deckt die Zinsen nicht
    let b = balance, n = 0, interest = 0;
    while (b > 0 && n < 600) { const i = b * r; interest += i; b = b + i - pay; n++; }
    out.months = n;
    out.payoffMonth = addMonths(todayIso.slice(0, 7), n);
    out.interestLeft = Math.round(interest);
    return out;
  }

  function wealth(ctx, accounts) {
    const tx = ctx.transactions;
    const today = ctx.todayIso;
    const items = accounts.map((acc) => {
      const cur = accountValueAt(acc, today, tx);
      const item = { ...acc, current: cur ? cur.value : null, estimated: cur ? cur.estimated : false, pendingCents: cur?.pendingCents || 0 };
      const values = [...(acc.values || [])].sort((a, b) => a.date.localeCompare(b.date));
      item.lastValueDate = values.length ? values[values.length - 1].date : null;
      const linked = linkedTransfers(acc, tx);
      if (acc.type === "depot" && values.length && cur) {
        const first = values[0];
        const contributions = linked.filter((t) => t.booking_date > first.date && t.booking_date <= today).reduce((s, t) => s + flowOf(acc, t), 0);
        // Wertentwicklung: nur die Bewertungen zählen, Einzahlungen werden herausgerechnet
        const last = values[values.length - 1];
        const contribToLast = linked.filter((t) => t.booking_date > first.date && t.booking_date <= last.date).reduce((s, t) => s + flowOf(acc, t), 0);
        const base = first.value_cents + contribToLast;
        item.depot = {
          since: first.date,
          contributions,
          gain: last.value_cents - base,
          gainPct: base ? (last.value_cents - base) / base : 0,
          stale: monthIdx(today) - monthIdx(last.date) >= 2 || (Date.parse(today) - Date.parse(last.date)) / 86400000 > 45,
        };
      }
      if (acc.type === "savings" || acc.type === "depot") {
        const from = `${addMonths(today.slice(0, 7), -3)}-01`;
        item.monthlyIn = linked.filter((t) => t.booking_date >= from && t.booking_date < `${today.slice(0, 7)}-01`).reduce((s, t) => s + flowOf(acc, t), 0) / 3;
      }
      if (acc.type === "loan" && cur) item.loan = loanInfo(acc, cur.value, today);
      return item;
    });

    const counted = items.filter((a) => a.include_in_total && a.current != null);
    const assets = counted.filter((a) => a.type !== "loan").reduce((s, a) => s + a.current, 0);
    const debts = counted.filter((a) => a.type === "loan").reduce((s, a) => s + a.current, 0);

    const series = [];
    const included = accounts.filter((a) => a.include_in_total && (a.values || []).length);
    for (const m of monthRange(ctx.firstMonth, ctx.currentMonth)) {
      const iso = monthEnd(m, today);
      let a = 0, d = 0;
      for (const acc of included) {
        const v = accountValueAt(acc, iso, tx);
        if (!v) continue;
        if (acc.type === "loan") d += v.value; else a += v.value;
      }
      series.push({ month: m, date: iso, assets: a, debts: d, net: a - d });
    }

    const groups = [
      { type: "giro", title: "Girokonto" },
      { type: "savings", title: "Sparen" },
      { type: "depot", title: "Investieren" },
      { type: "loan", title: "Kredit" },
    ].map((g) => {
      const list = items.filter((a) => a.type === g.type);
      return { ...g, items: list, total: list.reduce((s, a) => s + (a.current || 0), 0) };
    }).filter((g) => g.items.length);

    return { items, groups, assets, debts, net: assets - debts, series };
  }

  // ------------------------------------------------------------ Sparziele
  // Das Geld bleibt auf dem Girokonto. Je Monat gibt es eine Rate, die im Budget eingeplant wird.
  // Fürs Ziel zählt, was am Monatsende übrig bleibt (Überschuss), höchstens aber die Rate.
  // Reicht der Überschuss nicht für alle Raten, wird er im Verhältnis der Raten verteilt;
  // ein Minus-Monat zieht im selben Verhältnis wieder ab (nie unter 0).
  const monthsBetween = (a, b) => (Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7))) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));

  function goalRate(s, m) {
    const g = s.goal;
    if (s.reached || m < g.start_month) return 0;
    const rest = g.target_cents - s.saved;
    if (rest <= 0) return 0;
    if (g.target_month) return Math.ceil(rest / Math.max(1, monthsBetween(m, g.target_month) + 1));
    return Math.min(rest, g.monthly_cents || 0);
  }

  function distribute(rates, surplus) {
    const total = rates.reduce((a, b) => a + b, 0);
    if (!total) return rates.map(() => 0);
    if (surplus >= total) return rates.slice();
    return rates.map((r) => Math.round((r * surplus) / total));
  }

  function step(states, m, surplus, record) {
    const rates = states.map((s) => goalRate(s, m));
    const credits = distribute(rates, surplus);
    states.forEach((s, i) => {
      if (m < s.goal.start_month || s.reached) return;
      const before = s.saved;
      s.saved = Math.max(0, s.saved + credits[i]);
      // was tatsächlich dazukam bzw. wegging (ein Minus-Monat kann das Ziel nicht unter 0 drücken)
      if (record) s.history.push({ month: m, rate: rates[i], credit: s.saved - before });
      if (s.saved >= s.goal.target_cents) s.reached = m;
    });
    return { rates, credits };
  }

  function goalsReport(ctx, goals) {
    const active = (goals || []).filter((g) => !g.archived);
    const cur = ctx.currentMonth;
    const states = active.map((g) => ({ goal: g, saved: g.start_cents || 0, history: [], reached: null }));
    if (!states.length) return { goals: [], planned: 0 };

    // Abgeschlossene Monate: tatsächlicher Überschuss
    const first = active.map((g) => g.start_month).sort()[0];
    for (let m = first; m < cur; m = addMonths(m, 1)) step(states, m, monthTotals(m, ctx).surplus, true);

    // Laufender Monat: Rate ist eingeplant; was voraussichtlich dazukommt, sagt die Prognose der Übersicht
    const report = monthReport(cur, ctx);
    const ratesNow = states.map((s) => goalRate(s, cur));
    const expectedNow = distribute(ratesNow, report.forecastEnd);

    // Prognose: Schnitt der letzten 3 abgeschlossenen Monate mit Umsätzen
    const past = [];
    for (let m = addMonths(cur, -1); past.length < 3 && m >= ctx.firstMonth; m = addMonths(m, -1)) past.push(monthTotals(m, ctx).surplus);
    const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : report.forecastEnd;
    const sim = states.map((s, i) => ({ goal: s.goal, saved: Math.max(0, s.saved + (s.reached ? 0 : expectedNow[i])), history: [], reached: s.reached }));
    sim.forEach((s) => { if (!s.reached && s.saved >= s.goal.target_cents) s.reached = cur; });
    if (avg > 0) for (let m = addMonths(cur, 1), n = 0; n < 240 && sim.some((s) => !s.reached); m = addMonths(m, 1), n++) step(sim, m, avg, false);

    const result = states.map((s, i) => {
      const g = s.goal;
      const rate = ratesNow[i];
      const reach = sim[i].reached;
      let status = null, lateBy = 0, needNext = null, planned = null;
      if (s.reached) status = "reached";
      else if (g.target_month) {
        lateBy = reach ? Math.max(0, monthsBetween(g.target_month, reach)) : null;
        status = reach == null ? "late" : lateBy === 0 ? "ok" : lateBy === 1 ? "tight" : "late";
        const left = monthsBetween(cur, g.target_month);           // Monate nach dem laufenden
        const rest = g.target_cents - s.saved - Math.max(0, expectedNow[i]);
        needNext = left > 0 ? Math.max(0, Math.ceil(rest / left)) : null;
        const total = monthsBetween(g.start_month, g.target_month) + 1;
        const done = Math.min(total, Math.max(0, monthsBetween(g.start_month, cur)));
        planned = Math.round((g.start_cents || 0) + (g.target_cents - (g.start_cents || 0)) * (done / total));
      }
      return {
        goal: g, saved: s.saved, reached: s.reached, rate, perDay: rate / daysIn(cur),
        expectedNow: expectedNow[i], reach, status, lateBy, needNext, planned,
        history: s.history.slice(-3),
      };
    });
    return { goals: result, planned: ratesNow.reduce((a, b) => a + b, 0), avgSurplus: avg };
  }

  // ------------------------------------------------------------ Heatmap: Ausgaben je Tag
  // mode "variable": nur variable Ausgaben (ohne Fixkosten, große Ausgaben, Sparen);
  // mode "all": alle Ausgaben außer Sparen. Zählt nach Buchungstag, Vorgemerktes zählt mit.
  function spendDays(ctx, mode = "variable") {
    const days = new Map();
    for (const t of ctx.transactions) {
      if (t.amount_cents >= 0) continue;
      const cls = ctx.classOf(t);
      if (cls === "savings" || (mode === "variable" && cls !== "variable")) continue;
      const iso = t.booking_date.slice(0, 10);
      if (!days.has(iso)) days.set(iso, { cents: 0, items: [] });
      const d = days.get(iso);
      d.cents -= t.amount_cents;
      d.items.push(t);
    }
    return days;
  }

  // Stufen 1–4 nach den eigenen Werten der letzten 365 Tage (Viertel der Tage mit Ausgaben),
  // damit auch ruhige Monate Unterschiede zeigen. 0 = keine Ausgabe.
  function heatLevels(days, todayIso) {
    const from = isoOf(new Date(new Date(todayIso + "T12:00:00").getTime() - 365 * 86400000));
    const vals = [...days.entries()].filter(([iso, d]) => iso > from && iso <= todayIso && d.cents > 0)
      .map(([, d]) => d.cents).sort((a, b) => a - b);
    const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0);
    const cuts = [q(0.25), q(0.5), q(0.75)];
    return (cents) => (cents <= 0 ? 0 : cents <= cuts[0] ? 1 : cents <= cuts[1] ? 2 : cents <= cuts[2] ? 3 : 4);
  }

  function heatMonth(ctx, month, mode = "variable") {
    const days = spendDays(ctx, mode);
    const level = heatLevels(days, ctx.todayIso);
    const n = daysIn(month);
    const list = [];
    for (let d = 1; d <= n; d++) {
      const iso = `${month}-${pad(d)}`;
      const e = days.get(iso) || { cents: 0, items: [] };
      list.push({ iso, day: d, cents: e.cents, items: e.items, level: level(e.cents), future: iso > ctx.todayIso });
    }
    const first = new Date(month + "-01T12:00:00").getDay();       // 0 = Sonntag
    return { month, offset: (first + 6) % 7, days: list, total: list.reduce((s, x) => s + x.cents, 0) };
  }

  function heatYear(ctx, year, mode = "variable") {
    const days = spendDays(ctx, mode);
    const level = heatLevels(days, ctx.todayIso);
    const list = [];
    const sums = new Array(7).fill(0), counts = new Array(7).fill(0);   // Mo = 0
    for (let dt = new Date(`${year}-01-01T12:00:00`); dt.getFullYear() === Number(year); dt.setDate(dt.getDate() + 1)) {
      const iso = isoOf(dt);
      const e = days.get(iso);
      const cents = e ? e.cents : 0;
      const wd = (dt.getDay() + 6) % 7;
      const future = iso > ctx.todayIso;
      // Für den Wochentag-Schnitt nur Tage, für die es schon Umsätze gibt
      if (!future && iso.slice(0, 7) >= ctx.firstMonth) { sums[wd] += cents; counts[wd]++; }
      list.push({ iso, wd, cents, level: level(cents), future });
    }
    const weekdays = sums.map((s, i) => ({ wd: i, avg: counts[i] ? s / counts[i] : 0 }));
    const max = weekdays.reduce((a, b) => (b.avg > a.avg ? b : a), weekdays[0]);
    return { year: String(year), offset: (new Date(`${year}-01-01T12:00:00`).getDay() + 6) % 7, days: list, weekdays, top: max };
  }

  return {
    RECURRING, norm, addMonths, daysIn, isoOf, ibanKey, spendDays, heatMonth, heatYear, goalsReport,
    createContext, classify, recurringKey, totalsFor, monthTotals, monthReport, stats, cumulative, recurringList,
    savingsOverview, counterpartyKey,
    linkedTransfers, accountValueAt, loanInfo, wealth, searchTransactions,
  };
});
