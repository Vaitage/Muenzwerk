// Münzwerk – Einstellungen → „Umsätze nachtragen“: CSV-Datei aus dem Online-Banking (app/csvimport.py).
// Ablauf: Datei wählen → Vorschau (nichts gespeichert) → Übernehmen. Doppelte erkennt der Server.
"use strict";

let importInfo = null;      // GET /api/import/csv: {count, from, to}; null = Vorschau ohne Server
let importPreview = null;   // Antwort der Vorschau
let importText = null;      // Inhalt der gewählten Datei (nur bis zum Übernehmen im Speicher)
let importFileName = "";
let importBusy = false;

const MAX_IMPORT_BYTES = 8_000_000;
const importDay = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "–");

function importNavValue() {
  return importInfo?.count ? tn(importInfo.count, "{n} Buchung", "{n} Buchungen") : t("CSV-Datei");
}

function settingsImport() {
  const steps = [
    t("Öffne das Online-Banking im Browser (in der Banking-App gibt es den Export meist nicht) und wähle das Girokonto."),
    t("Lass dir die Umsätze ab dem gewünschten Datum anzeigen, z. B. ab 1. Januar, und tippe auf „Export“ → „CSV“."),
    t("Wähle die Datei hier aus. Münzwerk zeigt erst eine Vorschau – gespeichert wird erst beim Übernehmen."),
  ];
  const p = importPreview;
  const info = importInfo;
  let html = `
    <section class="card">
      <h2>${t("Ältere Umsätze nachtragen")}</h2>
      <p class="note" style="margin-top:0">${t("Über die Bankanbindung kommen meist nur die letzten Monate. Ältere Buchungen trägst du mit einer CSV-Datei aus dem Online-Banking nach – Münzwerk erkennt, was schon da ist, und ordnet die neuen Buchungen mit deinen Regeln zu.")}</p>
      <ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <label class="btn ${p ? "secondary" : ""} file-btn">
        <input type="file" accept=".csv,text/csv,text/plain" data-import-file>
        ${icon("inbox")}<span>${p ? t("Andere Datei wählen") : t("CSV-Datei wählen")}</span>
      </label>
    </section>`;

  if (importBusy && !p) html += `<section class="card"><div class="hint">${t("Lese die Datei …")}</div></section>`;

  if (p) {
    const nothing = p.new === 0;
    html += `
      <section class="card import-preview" aria-live="polite">
        <h2>${t("Vorschau")}</h2>
        <div class="hint">${esc(importFileName)}</div>
        <div class="import-range">${importDay(p.from)} – ${importDay(p.to)}</div>
        <div class="import-stats">
          <div><b>${p.new}</b><span>${t("neu")}</span></div>
          <div><b>${p.duplicates}</b><span>${t("schon da")}</span></div>
          <div><b class="pos">${fmt0(p.income_cents)}</b><span>${t("Einnahmen neu")}</span></div>
          <div><b class="neg">${fmt0(-p.expense_cents)}</b><span>${t("Ausgaben neu")}</span></div>
        </div>
        ${p.errors ? `<p class="note warn-text">${tn(p.errors, "{n} Zeile konnte nicht gelesen werden und wird übersprungen.", "{n} Zeilen konnten nicht gelesen werden und werden übersprungen.")}</p>` : ""}
        ${p.overlap_count ? `
          <p class="note warn-text">${tn(p.overlap_count,
            "{n} neue Buchung liegt in der Zeit, die die Bank schon liefert (ab {date}). Bitte kurz prüfen, ob sie wirklich fehlt:",
            "{n} neue Buchungen liegen in der Zeit, die die Bank schon liefert (ab {date}). Bitte kurz prüfen, ob sie wirklich fehlen:",
            { date: importDay(p.first_bank) })}</p>
          <ul class="import-overlap">${p.overlap.map((o) => `<li><span>${importDay(o.date)} · ${esc(o.counterparty || t("ohne Empfänger"))}</span><b class="${o.amount_cents < 0 ? "neg" : "pos"}">${fmt(o.amount_cents)}</b></li>`).join("")}
            ${p.overlap_count > p.overlap.length ? `<li class="hint">${t("… und {n} weitere", { n: p.overlap_count - p.overlap.length })}</li>` : ""}</ul>` : ""}
        <div class="btn-row">
          <button class="btn" data-action="import-run" ${nothing || importBusy ? "disabled" : ""}>${nothing ? t("Nichts Neues") : importBusy ? t("Übernehme …") : tn(p.new, "{n} Buchung übernehmen", "{n} Buchungen übernehmen")}</button>
          <button class="btn secondary" data-action="import-cancel">${t("Abbrechen")}</button>
        </div>
      </section>`;
  }

  if (info?.count) {
    html += `
      <section class="card">
        <h2>${t("Schon importiert")}</h2>
        <div class="row"><div class="grow">
          <div>${tn(info.count, "{n} Buchung aus CSV-Dateien", "{n} Buchungen aus CSV-Dateien")}</div>
          <div class="hint">${importDay(info.from)} – ${importDay(info.to)}</div>
        </div></div>
        <p class="note">${t("Etwas falsch gelaufen? Entfernt nur die importierten Buchungen – alles von der Bank bleibt.")}</p>
        <div class="btn-row"><button class="btn secondary danger-text" data-action="import-remove">${t("Importierte Buchungen entfernen")}</button></div>
      </section>`;
  }
  return html;
}

async function importFile(input) {
  const file = input.files && input.files[0];
  input.value = "";              // dieselbe Datei später noch einmal wählbar
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) return toast(t("Die Datei ist zu groß."));
  importBusy = true; importPreview = null; render();
  try {
    const buf = await file.arrayBuffer();
    // Die ING liefert je nach Alter der Seite UTF-8 oder Windows-1252 (Umlaute!)
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch { text = new TextDecoder("windows-1252").decode(buf); }
    importPreview = await API.importPreview(text);
    importText = text;
    importFileName = file.name;
  } catch (err) {
    importPreview = null; importText = null;
    toast(err.message);
  }
  importBusy = false;
  render();
  // Vorschau steht unter der Anleitung – hinscrollen
  const card = $(".import-preview");
  if (card) card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

async function importAction(act) {
  if (act === "import-cancel") { importPreview = null; importText = null; return render(); }
  if (act === "import-run") {
    if (!importText || importBusy) return;
    importBusy = true; render();
    try {
      const r = await API.importCsv(importText);
      importPreview = null; importText = null;
      importInfo = await API.importStatus();
      toast(r.uncategorized
        ? t("{n} Buchungen übernommen – {open} warten unter Umsätze → Zuordnen.", { n: r.imported, open: r.uncategorized })
        : t("{n} Buchungen übernommen und zugeordnet.", { n: r.imported }));
      importBusy = false;
      return reload();
    } catch (err) { toast(err.message); }
    importBusy = false;
    return render();
  }
  if (act === "import-remove") {
    return confirmSheet(t("Importierte Buchungen entfernen?"),
      t("Alle Buchungen aus CSV-Dateien werden gelöscht, auch ihre Zuordnungen. Buchungen von der Bank bleiben."),
      t("Entfernen"), async () => {
        try {
          const r = await API.importRemove();
          importInfo = await API.importStatus();
          toast(tn(r.removed, "{n} Buchung entfernt", "{n} Buchungen entfernt"));
          await reload();
        } catch (err) { toast(err.message); render(); }
      });
  }
}
