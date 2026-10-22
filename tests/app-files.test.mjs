// Die App ist auf mehrere Dateien verteilt (web/app*.js), die sich einen Gültigkeitsbereich
// teilen. Prüft: Reihenfolge in index.html = Liste im Demo-Build, keine doppelten Namen,
// und keine Namen, die eingebaute Browser-Namen überschreiben würden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const html = readFileSync("web/index.html", "utf8");
const inHtml = [...html.matchAll(/<script src="(app[^"]*\.js)"><\/script>/g)].map((m) => m[1]);
const onDisk = readdirSync("web").filter((f) => /^app(-.+)?\.js$/.test(f));

test("alle App-Dateien stehen in index.html, app.js zuerst, app-start.js zuletzt", () => {
  assert.deepEqual([...inHtml].sort(), [...onDisk].sort());
  assert.equal(inHtml[0], "app.js");
  assert.equal(inHtml.at(-1), "app-start.js");
  const demo = readFileSync("tools/build_demo.py", "utf8").match(/APP_FILES = \[([^\]]+)\]/)[1];
  assert.deepEqual([...demo.matchAll(/"([^"]+)"/g)].map((m) => m[1]), inHtml);
});

test("keine doppelten oder heiklen Namen auf oberster Ebene", () => {
  const seen = new Map();
  // Namen, die im Browser schon fest belegt sind (Auswahl der häufigen Fallen)
  const RESERVED = new Set(["name", "status", "top", "parent", "self", "window", "document", "location", "history",
    "open", "close", "print", "stop", "find", "focus", "blur", "scroll", "event", "length", "origin", "frames",
    "navigator", "screen", "alert", "confirm", "prompt", "fetch", "length", "closed", "opener", "external"]);
  for (const f of inHtml) {
    const src = readFileSync("web/" + f, "utf8");
    for (const m of src.matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm)) {
      const n = m[1] || m[2];
      assert.ok(!RESERVED.has(n), `${f}: "${n}" ist im Browser schon belegt`);
      assert.ok(!seen.has(n), `${f}: "${n}" gibt es schon in ${seen.get(n)}`);
      seen.set(n, f);
    }
    // const { a, b } = … auf oberster Ebene
    for (const m of src.matchAll(/^const\s+\{([^}]+)\}/gm)) {
      for (const n of m[1].split(",").map((s) => s.trim().split(":").at(-1).trim())) {
        assert.ok(!seen.has(n), `${f}: "${n}" doppelt`);
        seen.set(n, f);
      }
    }
  }
  assert.ok(seen.size > 100);
});
