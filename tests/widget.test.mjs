// iPhone-Widget (web/scriptable-widget.js) mit nachgebautem Scriptable ausführen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runWidget, texts } from "./scriptable-mock.mjs";

const NOW = "2026-10-19T09:30:00";
const DATA = {
  snapshot: {
    month: "2026-10", budget_left_cents: 82061, forecast_end_cents: 59013, days_left: 13, pending_cents: 0,
    days: [{ date: "2026-10-19", daily_cents: 6312 }, { date: "2026-10-20", daily_cents: 6700 }, { date: "2026-10-21", daily_cents: -500 }],
    next_fixed: [{ name: "Fitnessstudio", amount_cents: 3300, day: 21 }],
    computed_at: "2026-10-19T07:05:00+00:00",
  },
  bank: { state: "active", days_left: 120, last_sync: null },
};

test("mittel: Übrig, drei Tage, nächste Fixkosten, Stand", async () => {
  const { widget, requests } = await runWidget({ response: { status: 200, body: DATA }, now: NOW });
  const all = texts(widget).join(" | ");
  assert.match(all, /Übrig bis Monatsende/);
  assert.match(all, /820,61|821/);
  assert.match(all, /Heute \| 63/);
  assert.match(all, /Morgen \| 67/);
  assert.match(all, /Übermorgen \| -5|Übermorgen \| −5/);
  assert.match(all, /Fitnessstudio −33 € am 21\./);
  assert.match(all, /Stand /);
  assert.equal(requests[0].url, "https://pi.example.ts.net/api/widget/data");
  assert.equal(requests[0].headers.Authorization, "Bearer mw_test");
  assert.equal(widget.url, "https://pi.example.ts.net");
});

test("klein und Sperrbildschirm", async () => {
  const small = texts((await runWidget({ family: "small", response: { status: 200, body: DATA }, now: NOW })).widget);
  assert.ok(small.some((t) => /^Heute 63/.test(t)));
  const inline = texts((await runWidget({ family: "accessoryInline", response: { status: 200, body: DATA }, now: NOW })).widget);
  assert.equal(inline.length, 1);
  assert.match(inline[0], /^Heute 63/);
  const rect = texts((await runWidget({ family: "accessoryRectangular", response: { status: 200, body: DATA }, now: NOW })).widget);
  assert.deepEqual(rect.length, 3);
});

test("Englisch", async () => {
  const all = texts((await runWidget({ language: "en", response: { status: 200, body: DATA }, now: NOW })).widget).join(" | ");
  assert.match(all, /Left until month end/);
  assert.match(all, /Today \| €63/);
});

test("alter Stand: nicht mehr heute -> Hinweis statt falscher Tageszahl", async () => {
  const all = texts((await runWidget({ response: { status: 200, body: DATA }, now: "2026-10-25T09:00:00" })).widget).join(" | ");
  assert.match(all, /Münzwerk öffnen für neue Zahlen/);
  assert.doesNotMatch(all, /Heute/);
});

test("offline: letzter Stand aus dem Zwischenspeicher", async () => {
  const first = await runWidget({ response: { status: 200, body: DATA }, now: NOW });
  const cache = JSON.parse([...first.files.values()][0]);
  const all = texts((await runWidget({ response: "fail", cache, now: NOW })).widget).join(" | ");
  assert.match(all, /offline · Stand/);
  assert.match(all, /820,61|821/);
  const none = texts((await runWidget({ response: "fail", now: NOW })).widget).join(" ");
  assert.match(none, /Tailscale/);
});

test("Schlüssel: fehlt, ungültig, wird beim Start in der App abgefragt", async () => {
  const noKey = texts((await runWidget({ key: null, response: { status: 200, body: DATA }, now: NOW })).widget).join(" ");
  assert.match(noKey, /Widget-Schlüssel eingeben/);

  const bad = await runWidget({ inWidget: false, response: { status: 401, body: { detail: "x" } }, now: NOW });
  assert.match(texts(bad.widget).join(" "), /ungültig/);
  assert.equal(bad.keychain.size, 0);   // wird beim nächsten Start neu gefragt

  const asked = await runWidget({ inWidget: false, key: null, alertInput: " mw_neu ", response: { status: 200, body: DATA }, now: NOW });
  assert.equal(asked.keychain.get("muenzwerk-widget-key"), "mw_neu");
  assert.equal(asked.requests[0].headers.Authorization, "Bearer mw_neu");
});

test("ohne Schnappschuss und mit ablaufender Bankfreigabe", async () => {
  const empty = texts((await runWidget({ response: { status: 200, body: { snapshot: null, bank: {} } }, now: NOW })).widget).join(" ");
  assert.match(empty, /Noch keine Zahlen/);
  const warn = { ...DATA, bank: { state: "expiring", days_left: 5 } };
  const all = texts((await runWidget({ response: { status: 200, body: warn }, now: NOW })).widget).join(" | ");
  assert.match(all, /Bankfreigabe: 5 Tage/);
});

test("fehlgeschlagener Bankabruf wird angezeigt", async () => {
  const all = texts((await runWidget({ response: { status: 200, body: { ...DATA, bank: { state: "active", error: true } } }, now: NOW })).widget).join(" | ");
  assert.match(all, /Letzter Bankabruf fehlgeschlagen/);
});
