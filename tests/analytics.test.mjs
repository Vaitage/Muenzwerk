// Tests für web/analytics.js.  Aufruf:  node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const A = createRequire(import.meta.url)("../web/analytics.js");

const categories = [
  { id: 1, name: "Wohnen", kind: "expense", icon: "home" },
  { id: 2, name: "Lebensmittel", kind: "expense", icon: "basket" },
  { id: 3, name: "Sparen", kind: "expense", icon: "piggy", is_savings: true },
  { id: 4, name: "Gehalt", kind: "income", icon: "wallet", shift_next_month: true },
  { id: 5, name: "Technologie", kind: "expense", icon: "laptop" },
];

let n = 0;
const tx = (date, amount, who, cat, budget = date.slice(0, 7)) =>
  ({ id: `t${n++}`, booking_date: date, amount_cents: amount, counterparty: who, purpose: "", category_id: cat, budget_month: budget });

function sample() {
  const list = [];
  for (const m of ["2026-07", "2026-08", "2026-09", "2026-10"]) {
    list.push(tx(`${m}-01`, -85000, "Hausverwaltung", 1));
    list.push(tx(`${m}-02`, -20000, "Extra-Konto", 3));
    for (const d of ["05", "12", "19"]) list.push(tx(`${m}-${d}`, -3000, "REWE", 2));
  }
  // Gehalt am Monatsende, zählt für den Folgemonat
  for (const [d, b] of [["2026-06-30", "2026-07"], ["2026-07-31", "2026-08"], ["2026-08-31", "2026-09"], ["2026-09-30", "2026-10"]]) {
    list.push(tx(d, 285000, "Muster GmbH", 4, b));
  }
  list.push(tx("2026-09-10", -49900, "MediaMarkt", 5));
  return list;
}

const ctxFor = (today, extra = {}) =>
  A.createContext({ transactions: sample(), categories, settings: { large_expense_cents: 25000 }, today, ...extra });

test("Miete und Gehalt werden als regelmäßig erkannt, Einkäufe nicht", () => {
  const ctx = ctxFor("2026-10-14");
  assert.equal(ctx.recurring.get("expense|hausverwaltung").fixed, true);
  assert.equal(ctx.recurring.get("income|muster gmbh").fixed, true);
  assert.equal(ctx.recurring.get("expense|rewe").fixed, false);   // 3× pro Monat
  assert.equal(ctx.recurring.has("expense|extra-konto"), false); // Sparen zählt nicht
});

test("Korrektur von Hand schlägt die Erkennung", () => {
  const ctx = ctxFor("2026-10-14", { overrides: { hausverwaltung: false, rewe: true } });
  assert.equal(ctx.recurring.get("expense|hausverwaltung").fixed, false);
  assert.equal(ctx.recurring.get("expense|rewe").fixed, true);
});

test("Monatssummen trennen Fix, variabel, groß und Ersparnis", () => {
  const ctx = ctxFor("2026-10-14");
  const t = A.monthTotals("2026-09", ctx);
  assert.equal(t.income, 285000);
  assert.equal(t.fixed, 85000);
  assert.equal(t.variable, 9000);
  assert.equal(t.large, 49900);
  assert.equal(t.savings, 20000);
  assert.equal(t.surplus, 285000 - 85000 - 9000 - 49900);
  assert.equal(t.net, t.surplus - 20000);
});

test("Laufender Monat: Budget, Tagesbudget und Prognose", () => {
  // Am 1.10. ist die Miete noch nicht da -> offene Fixkosten
  const all = sample()
    .filter((t) => t.booking_date <= "2026-10-14")   // nichts aus der Zukunft
    .filter((t) => !(t.booking_date >= "2026-10-01" && t.counterparty === "Hausverwaltung"));
  const ctx = A.createContext({ transactions: all, categories, settings: {}, today: "2026-10-14" });
  const r = A.monthReport("2026-10", ctx);
  assert.equal(r.status, "current");
  assert.equal(r.openFixed.length, 1);
  assert.equal(r.openFixed[0].amount_cents, 85000);
  assert.equal(r.openFixed[0].overdue, true);

  const net = 285000 - 20000 - 6000; // Gehalt − Sparen − zwei Einkäufe bisher
  assert.equal(r.totals.net, net);
  assert.equal(r.budgetLeft, net - 85000);
  assert.equal(r.daysLeftIncl, 18);   // 14. bis 31.
  assert.ok(Math.abs(r.dailyBudget - (net - 85000) / 18) < 1e-9);
  assert.equal(r.preview.length, 3);
  assert.ok(r.forecastEnd < r.budgetLeft);   // es wird noch etwas ausgegeben
  // Der Verlauf endet genau bei der Prognose
  assert.equal(r.series.forecast.at(-1).value, r.forecastEnd);
});

test("Vergangener Monat hat keine Prognose und keine offenen Posten", () => {
  const ctx = ctxFor("2026-10-14");
  const r = A.monthReport("2026-08", ctx);
  assert.equal(r.status, "past");
  assert.equal(r.openFixed.length, 0);
  assert.equal(r.forecastEnd, r.totals.net);
  assert.equal(r.series.forecast.length, 0);
});

test("Jahresstatistik und angesparter Überschuss", () => {
  const ctx = ctxFor("2026-10-14");
  const s = A.stats("year", "2026", ctx);
  assert.equal(s.monthsWithData, 4);
  assert.equal(s.totals.income, 4 * 285000);
  const cum = A.cumulative(ctx);
  assert.equal(cum.at(-1).cumSurplus, s.totals.surplus);
  assert.equal(cum.at(-1).cumSavings, 4 * 20000);
});

// ------------------------------------------------------------ Vermögen
const wtx = (date, amount, who, purpose = "", iban = "") =>
  ({ id: `w${n++}`, booking_date: date, amount_cents: amount, counterparty: who, purpose, counterparty_iban: iban, category_id: null, budget_month: date.slice(0, 7) });

test("Sparkonto rechnet mit Umbuchungen vor und zurück", () => {
  const txs = [
    wtx("2026-08-02", -20000, "Ich", "Dauerauftrag", "DE00 1111 2222 3333 4444 01"),
    wtx("2026-09-02", -20000, "Ich", "Dauerauftrag", "DE00111122223333444401"),
    wtx("2026-10-02", -20000, "Ich", "Dauerauftrag", "DE00111122223333444401"),
  ];
  const acc = { type: "savings", match: "de00111122223333444401", values: [{ date: "2026-09-15", value_cents: 100000 }] };
  assert.equal(A.accountValueAt(acc, "2026-10-14", txs).value, 120000);
  assert.equal(A.accountValueAt(acc, "2026-08-01", txs).value, 60000);
  assert.equal(A.accountValueAt(acc, "2026-09-15", txs).estimated, false);
});

test("Kredit: Tilgungsplan vor und zurück, Ende absehbar", () => {
  const acc = { type: "loan", loan_rate_percent: 6, loan_payment_cents: 50000, loan_original_cents: 2000000, values: [{ date: "2026-10-01", value_cents: 1000000 }] };
  const next = A.accountValueAt(acc, "2026-11-01", []).value;
  assert.equal(next, Math.round(1000000 * 1.005 - 50000));
  const back = A.accountValueAt(acc, "2026-09-01", []).value;
  assert.equal(A.accountValueAt({ ...acc, values: [{ date: "2026-09-01", value_cents: back }] }, "2026-10-01", []).value, 1000000);
  const info = A.loanInfo(acc, 1000000, "2026-10-14");
  assert.ok(info.months > 20 && info.months < 23);
  assert.equal(info.progress, 0.5);
});

test("Depot: Wertentwicklung ohne Einzahlungen, Nettovermögen", () => {
  const txs = [wtx("2026-09-03", -15000, "ING-DiBa AG", "Sparplan Direkt-Depot"), wtx("2026-10-01", 100000, "Gehalt", "")];
  const depot = { id: 1, type: "depot", match: "direkt-depot", include_in_total: true, values: [{ date: "2026-08-31", value_cents: 1000000 }, { date: "2026-10-10", value_cents: 1060000 }] };
  const loan = { id: 2, type: "loan", include_in_total: true, loan_rate_percent: 0, loan_payment_cents: 0, values: [{ date: "2026-10-01", value_cents: 300000 }] };
  const giro = { id: 3, type: "giro", match: "", include_in_total: true, values: [{ date: "2026-10-14", value_cents: 200000 }] };
  const ctx = A.createContext({ transactions: txs, categories: [], today: "2026-10-14" });
  const w = A.wealth(ctx, [depot, loan, giro]);
  const d = w.items.find((x) => x.id === 1);
  assert.equal(d.depot.gain, 1060000 - 1000000 - 15000);
  assert.equal(w.net, 1060000 + 200000 - 300000);
  assert.equal(w.series.at(-1).net, w.net);
});


test("Suche: Empfänger, Betrag und Summen", () => {
  const ctx = ctxFor("2026-10-14");
  const r = A.searchTransactions(ctx, "rewe", "all");
  assert.equal(r.count, 12);
  assert.equal(r.expense, 12 * 3000);
  assert.equal(A.searchTransactions(ctx, "rewe", "month").count, 3);
  assert.equal(A.searchTransactions(ctx, "499.00", "all").count, 1);   // Betrag mit Punkt
  assert.equal(A.searchTransactions(ctx, "technologie", "year").count, 1); // Kategoriename
  assert.equal(A.searchTransactions(ctx, "rewe 2026-09", "all").count, 3); // mehrere Wörter
  assert.equal(A.searchTransactions(ctx, "  ", "all"), null);
});

test("Girokonto: fällige Vormerkungen werden vom gebuchten Stand abgezogen", () => {
  const acc = { type: "giro", values: [{ date: "2026-10-18", value_cents: 146424 }] };
  const txs = [
    { ...tx("2026-10-16", -2200, "Friseur", null), pending: true },   // Kartenzahlung, schon reserviert
    { ...tx("2026-10-18", -6282, "Karte", null), pending: true },
    { ...tx("2026-10-19", -3610, "Lastschrift", null), pending: true }, // erst morgen fällig
    tx("2026-10-17", -999, "gebucht, schon im Stand", null),
  ];
  const heute = A.accountValueAt(acc, "2026-10-18", txs);
  assert.equal(heute.value, 137942);
  assert.equal(heute.pendingCents, -8482);
  assert.equal(A.accountValueAt(acc, "2026-10-19", txs).value, 137942 - 3610);
  // Andere Konten bleiben unberührt
  assert.equal(A.accountValueAt({ type: "savings", values: acc.values, match: "x" }, "2026-10-18", txs).value, 146424);
});

test("Ersparnisse: je Spartopf, dieser Monat und insgesamt, dazu Prüfhinweise", () => {
  const cats = [...categories, { id: 6, name: "Sparen-Kleingeld", kind: "expense", icon: "piggy", is_savings: true }, { id: 7, name: "Kredit", kind: "expense", icon: "bank" }];
  const txs = [
    { ...tx("2026-09-01", -15000, "Mustermann", 3), purpose: "Sparplan Monatliche Einzahlung" },
    { ...tx("2026-10-01", -15000, "Mustermann", 3), purpose: "Sparplan Monatliche Einzahlung" },
    { ...tx("2026-10-01", -15000, "Mustermann", 7), purpose: "Sparplan Monatliche Einzahlung" },   // gleich wie die Ersparnis, aber Kredit
    { ...tx("2026-10-15", -50000, "Mustermann", 7), purpose: "Bank AG 12345 Rate" },              // echte Kreditrate: kein Hinweis
    { ...tx("2026-10-03", -40, "Kleingeld Plus - Sparen", 6), purpose: "Überweisung / Aus Kauf 9,60- bei REWE" },
    { ...tx("2026-09-12", -27, "Kleingeld Plus - Sparen", 6), purpose: "Überweisung / Aus Kauf 3,73- bei Kiosk" },
    { ...tx("2026-10-05", -2399, "Beispiel Markt", 6), purpose: "Kaufumsatz VISA Card EUR 23,99" },  // Einkauf im Spartopf
    { ...tx("2026-10-06", -10000, "Beispiel Bank", 1), purpose: "Tagesgeld Einzahlung" },            // klingt nach Sparen
  ];
  const ctx = A.createContext({ transactions: txs, categories: cats, overrides: {}, settings: { shift_from_day: 15, large_expense_cents: 25000 }, today: "2026-10-18" });
  const s = A.savingsOverview(ctx);
  const sparen = s.pots.find((p) => p.name === "Sparen");
  assert.equal(sparen.total, 30000);
  assert.equal(sparen.thisMonth, 15000);
  assert.equal(sparen.recipients[0].name, "Mustermann");
  const klein = s.pots.find((p) => p.name === "Sparen-Kleingeld");
  assert.equal(klein.count, 3);
  assert.equal(s.thisMonth, 15000 + 40 + 2399);
  const reasons = Object.fromEntries(s.checks.map((c) => [c.tx.counterparty + " " + c.tx.amount_cents, c.reason]));
  assert.deepEqual(reasons, {
    "Mustermann -15000": "like_other",
    "Beispiel Markt -2399": "card",
    "Beispiel Bank -10000": "words",
  });
});

test("Ersparnisse: ein einzelner Ausreißer im Spartopf meldet nicht alle ähnlichen Umsätze", () => {
  const txs = [
    { ...tx("2026-10-02", -500, "Bäckerei Beispiel", 3), purpose: "Kaufumsatz VISA Card" },   // falsch im Spartopf
    { ...tx("2026-10-03", -500, "Bäckerei Beispiel", 2), purpose: "Kaufumsatz VISA Card" },
    { ...tx("2026-10-04", -500, "Bäckerei Beispiel", 2), purpose: "Kaufumsatz VISA Card" },
  ];
  const ctx = A.createContext({ transactions: txs, categories, overrides: {}, settings: { shift_from_day: 15, large_expense_cents: 25000 }, today: "2026-10-18" });
  const checks = A.savingsOverview(ctx).checks;
  assert.equal(checks.length, 1);
  assert.equal(checks[0].reason, "card");
});

test("Heatmap: nur variable Ausgaben nach Buchungstag, Stufen und Wochenanfang", () => {
  const ctx = ctxFor("2026-10-14");
  const h = A.heatMonth(ctx, "2026-09");
  assert.equal(h.days.length, 30);
  assert.equal(h.offset, 1);                                   // 1.9.2026 ist ein Dienstag
  const byDay = Object.fromEntries(h.days.map((d) => [d.day, d]));
  assert.equal(byDay[5].cents, 3000);                          // REWE
  assert.equal(byDay[1].cents, 0);                             // Miete ist Fixkosten
  assert.equal(byDay[2].cents, 0);                             // Sparen zählt nie
  assert.equal(byDay[10].cents, 0);                            // MediaMarkt ist eine große Ausgabe
  assert.ok(byDay[5].level >= 1 && byDay[1].level === 0);
  const all = A.heatMonth(ctx, "2026-09", "all");
  assert.equal(all.days[0].cents, 85000);                      // mit allen Ausgaben zählt die Miete
  assert.equal(all.days[9].cents, 49900);
  assert.equal(all.days[1].cents, 0);
  const oct = A.heatMonth(ctx, "2026-10");
  assert.equal(oct.days.find((d) => d.day === 20).future, true);
});

test("Heatmap Jahr: Wochentag-Schnitt nur über Tage mit Daten", () => {
  const ctx = ctxFor("2026-10-14");
  const y = A.heatYear(ctx, "2026");
  assert.equal(y.days.length, 365);
  assert.equal(y.offset, 3);                                    // 1.1.2026 ist ein Donnerstag
  const total = y.weekdays.reduce((s, w) => s + w.avg, 0);
  assert.ok(total > 0);
  assert.ok(y.top.avg >= Math.max(...y.weekdays.map((w) => w.avg)));
});
