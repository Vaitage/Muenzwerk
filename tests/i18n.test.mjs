// Prüft die Übersetzungen: Jeder Text, der in der Oberfläche über t()/tn()
// läuft, hat eine englische Fassung mit denselben Platzhaltern.
// Aufruf: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const I18N = require("../web/i18n.js");
const EN = I18N.make("en");
const FILES = ["web/app.js", "web/auth.js", "web/api.js", "web/analytics.js", "tools/demo-api.js"];
const NOT_TEXT = new Set(["income", "expense", "month", "year", "all"]);

// Alle Zeichenketten in "…" innerhalb von t(…), tn(…), tr(…) und I18N.t(…)
function keysIn(src) {
  const keys = new Set();
  const re = /(?:\bI18N\.t|\btn|\bt|\btr)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex, inStr = null, start = 0, nested = 0;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (inStr) {
        if (c === "\\") { i++; continue; }
        if (c === inStr) {
          if (inStr === '"' && nested === 0) keys.add(src.slice(start, i));
          inStr = null;
        }
        continue;
      }
      if (c === '"' || c === "`") { inStr = c; start = i + 1; continue; }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "{") nested++;
      else if (c === "}") nested--;
    }
  }
  return [...keys].filter((k) => k && !NOT_TEXT.has(k));
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("jeder Text hat eine englische Übersetzung", () => {
  const missing = [];
  for (const file of FILES) {
    for (const key of keysIn(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))) {
      if (!(key in EN.EN)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("Übersetzungen haben dieselben Platzhalter", () => {
  const wrong = Object.entries(EN.EN).filter(([de, en]) => placeholders(de).join() !== placeholders(en).join());
  assert.deepEqual(wrong, []);
});

test("Server-Meldungen sind übersetzt", () => {
  const missing = [];
  for (const file of ["app/main.py", "app/auth.py"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/HTTPException\(\d+, f?"([^"]+)"|"detail": "([^"]+)"/g)) {
      const text = (m[1] || m[2]).split(": ")[0];
      if (!(text in EN.EN)) missing.push(text);
    }
  }
  assert.deepEqual(missing, []);
});

test("Platzhalter, Einzahl/Mehrzahl und Ordnungszahlen", () => {
  assert.equal(EN.t("seit {date}", { date: "1 May" }), "since 1 May");
  assert.equal(EN.tn(1, "{n} Umsatz", "{n} Umsätze"), "1 transaction");
  assert.equal(EN.tn(3, "{n} Umsatz", "{n} Umsätze"), "3 transactions");
  assert.equal(I18N.tn(3, "{n} Umsatz", "{n} Umsätze"), "3 Umsätze");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(EN.ord), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  assert.equal(I18N.ord(15), "15.");
  assert.equal(EN.t("Gibt es nicht"), "Gibt es nicht");   // ohne Übersetzung bleibt der Text
});

test("Beträge eingeben in beiden Sprachen", () => {
  const de = I18N, en = EN;
  assert.equal(de.parseAmount("1.234,56"), 123456);
  assert.equal(de.parseAmount("39,95 €"), 3995);
  assert.equal(de.parseAmount("20.000"), 2000000);
  assert.equal(de.parseAmount("-17,5"), -1750);
  assert.equal(en.parseAmount("1,234.56"), 123456);
  assert.equal(en.parseAmount("39.95"), 3995);
  assert.equal(en.parseAmount("39,95"), 3995);
  assert.equal(en.parseAmount("20,000"), 2000000);
  assert.equal(en.parseAmount(""), null);
  assert.equal(en.parseAmount("abc"), null);
  assert.equal(de.decimal(5.49, 2), "5,49");
  assert.equal(en.decimal(5.49, 2), "5.49");
});
