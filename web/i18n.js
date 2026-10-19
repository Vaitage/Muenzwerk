// Sprachen der Oberfläche. Der deutsche Text ist zugleich der Schlüssel:
//   t("Speichern")                      -> "Save" (Englisch) oder "Speichern"
//   t("seit {date}", { date: "…" })     -> Platzhalter in geschweiften Klammern
//   tn(n, "{n} Umsatz", "{n} Umsätze")  -> Einzahl/Mehrzahl
// Fehlt eine Übersetzung, bleibt der deutsche Text stehen.
// Neue Texte: unten in EN ergänzen (tests/i18n.test.mjs prüft, dass keiner fehlt).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const EN = {
    // --- Allgemein
    "Heute": "Today",
    "Gestern": "Yesterday",
    "Morgen": "Tomorrow",
    "Übermorgen": "In 2 days",
    "Zurück": "Back",
    "Abbrechen": "Cancel",
    "Speichern": "Save",
    "Gespeichert": "Saved",
    "Löschen": "Delete",
    "Entfernen": "Remove",
    "Anlegen": "Create",
    "Hinzufügen": "Add",
    "Name": "Name",
    "Symbol": "Icon",
    "Filter": "Filter",
    "Alle": "All",
    "Alles": "All",
    "Monat": "Month",
    "Jahr": "Year",
    "Zeitraum": "Period",
    "zurück": "previous",
    "vor": "next",
    "früher": "earlier",
    "später": "later",
    "weniger": "less",
    "mehr": "more",
    "Gesamt": "Total",
    "Unbekannt": "Unknown",
    "Verlauf": "History",
    "Balkendiagramm": "Bar chart",
    "Konnte nicht anzeigen: {msg}": "Could not display: {msg}",
    "„{name}“": "“{name}”",
    "{name} löschen": "Delete {name}",
    "{day} {month}": "{day} {month}",

    // --- Bereiche
    "Übersicht": "Overview",
    "Umsätze": "Transactions",
    "Statistik": "Statistics",
    "Vermögen": "Wealth",
    "Mehr": "More",
    "Einstellungen": "Settings",
    "Vormonat": "Previous month",
    "Folgemonat": "Next month",

    // --- Bank
    "Bank": "Bank",
    "Demo-Bank": "Demo bank",
    "Bank noch nicht verbunden": "Bank not connected yet",
    "Tippe hier, um dein Konto zu verknüpfen.": "Tap here to link your account.",
    "Bankfreigabe abgelaufen": "Bank access expired",
    "Einmal bei der Bank bestätigen, dann geht's weiter.": "Confirm once with your bank to continue.",
    "Bankfreigabe läuft in {n} Tag ab": "Bank access expires in {n} day",
    "Bankfreigabe läuft in {n} Tagen ab": "Bank access expires in {n} days",
    "Jetzt kurz erneuern, damit nichts fehlt.": "Renew it now so nothing goes missing.",
    "Noch nicht verbunden": "Not connected yet",
    "Verbunden · gültig bis {date}": "Connected · valid until {date}",
    "Läuft in {n} Tag ab": "Expires in {n} day",
    "Läuft in {n} Tagen ab": "Expires in {n} days",
    "Freigabe abgelaufen": "Access expired",
    "Fehler beim Abruf": "Error while fetching",
    "Zuletzt abgerufen: {date}": "Last fetched: {date}",
    "Jetzt abrufen": "Fetch now",
    "Lädt …": "Loading …",
    "Verbinden": "Connect",
    "Neu verbinden": "Reconnect",
    "Vorschau: Bankfreigabe erneuert": "Preview: bank access renewed",

    // --- Updates (nur mit UPDATES_IN_APP=1)
    "Updates": "Updates",
    "Aktualisiert": "Updated",
    "Schon auf dem neuesten Stand": "Already up to date",
    "Zurückgenommen: Der neue Stand ließ sich nicht starten, der vorherige läuft weiter.": "Rolled back: the new version didn't start, the previous one keeps running.",
    "Nur teilweise: Bei einer weiteren Installation läuft noch der alte Stand.": "Partly: another installation is still running the old version.",
    "Nicht übernommen: Die Versionsgeschichte auf GitHub wurde umgeschrieben. Bitte von Hand prüfen.": "Not applied: the history on GitHub was rewritten. Please check by hand.",
    "GitHub war nicht erreichbar.": "GitHub could not be reached.",
    "Der Update-Dienst auf dem Pi ist noch nicht eingerichtet. Siehe tools/pi/updates-einrichten.sh.": "The update service on the Pi isn't set up yet. See tools/pi/updates-einrichten.sh.",
    "Installiert": "Installed",
    "Update-Dienst meldet sich nicht": "Update service not responding",
    "Letztes Lebenszeichen: {date}. Läuft der Pi und ist der Cron-Eintrag noch da?": "Last seen: {date}. Is the Pi running and is the cron entry still there?",
    "Wird aktualisiert …": "Updating …",
    "Das dauert ein paar Minuten. Die App startet danach neu und lädt sich selbst neu.": "This takes a few minutes. The app restarts afterwards and reloads by itself.",
    "Neue Version verfügbar": "New version available",
    "{n} Änderung anzeigen": "Show {n} change",
    "{n} Änderungen anzeigen": "Show {n} changes",
    "Jetzt aktualisieren": "Update now",
    "Aktuell": "Up to date",
    "Zuletzt geprüft: {date}": "Last checked: {date}",
    "Noch nicht geprüft": "Not checked yet",
    "Wird geprüft …": "Checking …",
    "Jetzt prüfen": "Check now",
    "Letztes Ergebnis ({date}):": "Last result ({date}):",
    "Der Pi schaut stündlich nach neuen Versionen, spielt sie aber nur ein, wenn du hier auf „Jetzt aktualisieren“ tippst.": "The Pi checks for new versions every hour but only installs them when you tap “Update now” here.",
    "Aktualisiert – die App lädt neu": "Updated – the app is reloading",
    "Jetzt aktualisieren?": "Update now?",
    "Alle Installationen auf dem Pi bekommen den neuen Stand. Die App ist dabei ein paar Minuten nicht erreichbar.": "All installations on the Pi get the new version. The app is unavailable for a few minutes.",
    "Aktualisieren": "Update",
    "Bank noch nicht eingerichtet": "Bank not set up yet",
    "Noch nicht eingerichtet": "Not set up yet",
    "Tippe hier für die nächsten Schritte.": "Tap here for the next steps.",
    "Anleitung öffnen": "Open the guide",
    "Bank noch nicht eingerichtet – siehe „Mehr“": "Bank not set up yet – see “More”",
    "Für diese Installation ist noch keine Bankanbindung eingerichtet. Wer Münzwerk betreibt, legt dafür eine eigene App bei Enable Banking an und trägt sie in der .env ein (BANK_PROVIDER=enablebanking). Danach den Container neu starten.": "No bank connection has been set up for this installation yet. Whoever runs Münzwerk creates their own application at Enable Banking and enters it in the .env file (BANK_PROVIDER=enablebanking). Then restart the container.",
    "In der .env fehlt ENABLEBANKING_APP_ID, die ID deiner App bei Enable Banking. Danach den Container neu starten.": "ENABLEBANKING_APP_ID, the ID of your Enable Banking application, is missing in the .env file. Then restart the container.",
    "Der private Schlüssel von Enable Banking fehlt. Die .pem-Datei gehört nach data/enablebanking.pem (ENABLEBANKING_KEY_FILE in der .env). Danach den Container neu starten.": "The Enable Banking private key is missing. The .pem file belongs in data/enablebanking.pem (ENABLEBANKING_KEY_FILE in the .env file). Then restart the container.",
    "Für diese Installation ist noch keine Bank eingerichtet.": "No bank has been set up for this installation yet.",
    "ENABLEBANKING_APP_ID fehlt in der .env.": "ENABLEBANKING_APP_ID is missing in the .env file.",
    "Der Schlüssel von Enable Banking fehlt (ENABLEBANKING_KEY_FILE).": "The Enable Banking key is missing (ENABLEBANKING_KEY_FILE).",
    "Bank verbunden – Umsätze werden geladen": "Bank connected – loading transactions",
    "Verbinde mit der Bank …": "Connecting to the bank …",
    "Lade Umsätze …": "Loading transactions …",
    "Lade Kontostände …": "Loading balances …",
    "Die Bank antwortet langsam, gleich fertig …": "The bank is slow to answer, almost done …",
    "Bankfreigabe abgelaufen – bitte unter „Mehr“ neu verbinden": "Bank access expired – please reconnect under “More”",
    "Noch keine Bank verbunden": "No bank connected yet",
    "Abruf fehlgeschlagen – später noch einmal versuchen": "Fetching failed – please try again later",
    "{n} neuer Umsatz": "{n} new transaction",
    "{n} neue Umsätze": "{n} new transactions",
    "{n} vorgemerkt": "{n} pending",
    "{n} jetzt gebucht": "{n} now booked",
    "Alles aktuell · {n} noch vorgemerkt": "All up to date · {n} still pending",
    "Alles aktuell, keine neuen Umsätze": "All up to date, no new transactions",
    "{n} zum Zuordnen": "{n} to categorize",

    // --- Übersicht
    "{n} Zahlung wartet auf eine Kategorie": "{n} payment is waiting for a category",
    "{n} Zahlungen warten auf eine Kategorie": "{n} payments are waiting for a category",
    "Einmal zuordnen – ähnliche erkennt die App dann selbst.": "Categorize once – the app recognizes similar ones by itself.",
    "Übrig am Ende vom {month}": "Left at the end of {month}",
    "Geplant übrig im {month}": "Planned to be left in {month}",
    "Übrig bis Monatsende": "Left until the end of the month",
    "{amount} offene Fixkosten schon abgezogen": "{amount} of upcoming fixed costs already deducted",
    "{amount} zur Seite gelegt": "{amount} put aside",
    "{amount} vom Sparkonto geholt": "{amount} taken from savings",
    "inkl. {amount} vorgemerkt": "incl. {amount} pending",
    "Pro Tag verfügbar": "Available per day",
    "noch {n} Tag": "{n} day left",
    "noch {n} Tage": "{n} days left",
    "Wenn du weiter ausgibst wie bisher, etwa {amount} am Tag für Variables.": "If you keep spending as before, about {amount} a day on variable costs.",
    "Stand": "Balance",
    "Prognose": "Forecast",
    "bisher": "so far",
    "Verlauf im Monat": "Over the month",
    "Prognose Monatsende": "Forecast for month end",
    "am Monatsende auf dem Konto geblieben": "left in the account at month end",
    "bleiben voraussichtlich übrig": "expected to be left",
    "Aufstellung": "Breakdown",
    "Aufschlüsselung": "Breakdown",
    "Einkommen": "Income",
    "Regelmäßig": "Regular",
    "Variabel": "Variable",
    "Ausgaben": "Expenses",
    "Fixkosten": "Fixed costs",
    "Variable Ausgaben": "Variable expenses",
    "Große Ausgaben": "Large expenses",
    "ab {amount}": "from {amount}",
    "Ersparnisse": "Savings",
    "Noch offene Fixkosten": "Upcoming fixed costs",
    "überfällig": "overdue",
    "um den {day}": "around the {day}",
    "Erwartete Einnahmen": "Expected income",
    "Überschuss": "Surplus",
    "Ausgaben nach Kategorie": "Expenses by category",
    "Keine Ausgaben in diesem Zeitraum.": "No expenses in this period.",

    // --- Umsätze
    "vorgemerkt": "pending",
    "Vorgemerkt": "Pending",
    "offen": "open",
    "fix": "fixed",
    "groß": "large",
    "zählt für {month}": "counts for {month}",
    "Nicht zugeordnet": "Uncategorized",
    "Kategorie": "Category",
    "Suchen, z. B. Amazon oder 39,95": "Search, e.g. Amazon or 39.95",
    "Umsätze durchsuchen": "Search transactions",
    "Suche leeren": "Clear search",
    "Zeitraum der Suche": "Search period",
    "diesen Monat": "this month",
    "dieses Jahr": "this year",
    "insgesamt": "overall",
    "Keine Umsätze zu „{q}“ {range}.": "No transactions for “{q}” {range}.",
    "„{q}“ {range}": "“{q}” {range}",
    "ausgegeben in {n} Buchung": "spent in {n} transaction",
    "ausgegeben in {n} Buchungen": "spent in {n} transactions",
    "{n} Buchung": "{n} transaction",
    "{n} Buchungen": "{n} transactions",
    "Ø {amount} pro Monat": "avg. {amount} per month",
    "Eingenommen": "Received",
    "Gespart": "Saved",
    "Zuordnen": "Categorize",
    "Rückgängig": "Undo",
    "Rückgängig gemacht": "Undone",
    "Rückgängig: {n} Umsätze wie vorher": "Undone: {n} transactions restored",
    "Alles zugeordnet": "Everything categorized",
    "Neue unbekannte Zahlungen tauchen hier auf.": "New unknown payments will show up here.",
    "Diese Zahlungen konnte die App nicht selbst einsortieren. Tippe eine an und wähle die Kategorie.": "The app couldn't sort these payments by itself. Tap one and choose a category.",
    "Keine Umsätze in diesem Monat.": "No transactions this month.",
    "Keine Umsätze.": "No transactions.",
    "{n} Umsatz": "{n} transaction",
    "{n} Umsätze": "{n} transactions",

    // --- Umsatz-Fenster
    "Die Bank hat die Zahlung noch nicht gebucht. Sie zählt schon ins Budget; der Betrag kann sich bis zur Buchung noch ändern.": "The bank hasn't booked this payment yet. It already counts towards your budget; the amount may still change until it is booked.",
    "Alle {n} gleichen übernehmen": "Apply to all {n} matching",
    "{n} weitere von „{name}“": "{n} more from “{name}”",
    "davon {n} schon zugeordnet": "{n} of them already categorized",
    "Künftig immer so zuordnen": "Always categorize like this",
    "Alle Zahlungen an „{name}“": "All payments to “{name}”",
    "Regelmäßige Einnahme": "Regular income",
    "von dir festgelegt": "set by you",
    "automatisch erkannt": "detected automatically",
    "nicht automatisch erkannt": "not detected automatically",
    "{n} Monat gesehen": "seen in {n} month",
    "{n} Monate gesehen": "seen in {n} months",
    "Zählt für": "Counts for",
    "von Hand gesetzt": "set manually",
    "automatisch": "automatic",
    "früherer Monat": "earlier month",
    "späterer Monat": "later month",
    "Wieder automatisch": "Back to automatic",
    "Ausgabe": "Expense",
    "Einnahme": "Income",
    "Zuordnung entfernen": "Remove category",
    "Zugeordnet: {name}": "Categorized: {name}",
    "Zuordnung entfernt": "Category removed",
    "{n} weitere mit zugeordnet": "{n} more categorized too",
    "Zählt jetzt für {month}": "Now counts for {month}",
    "Monat wieder automatisch": "Month set back to automatic",
    "„{name}“ zählt jetzt als regelmäßig": "“{name}” now counts as regular",
    "„{name}“ zählt jetzt als Fixkosten": "“{name}” now counts as a fixed cost",
    "„{name}“ ist jetzt variabel": "“{name}” is now variable",

    // --- Kategorien
    "Kategorien": "Categories",
    "Neue Kategorie": "New category",
    "Für Einnahmen": "For income",
    "Für Ausgaben": "For expenses",
    "z. B. Sport": "e.g. Sports",
    "Zählt zum Folgemonat": "Counts for next month",
    "Wie beim Gehalt: Eingang am Monatsende gilt für den nächsten Monat": "Like a salary: money arriving at the end of the month counts for the next month",
    "Ist eine Ersparnis": "Is savings",
    "Z. B. Überweisung aufs Sparkonto. Zählt dann nicht als Ausgabe.": "E.g. a transfer to your savings account. It then doesn't count as an expense.",
    "Kategorie „{name}“ angelegt": "Category “{name}” created",
    "Kategorie hinzufügen": "Add category",
    "Ersparnis": "Savings",
    "Zählt jetzt als Ersparnis": "Now counts as savings",
    "Zählt jetzt als Ausgabe": "Now counts as an expense",
    "„{name}“ löschen?": "Delete “{name}”?",
    "Zugeordnete Zahlungen landen wieder in „Zuordnen“. Regeln für diese Kategorie werden mit gelöscht.": "Payments in this category go back to “Categorize”. Rules for this category are deleted as well.",
    "Kategorie gelöscht": "Category deleted",
    "Kategorie löschen": "Delete category",
    "{amount} im Monat": "{amount} per month",

    // --- Statistik
    "Gesamter Zeitraum": "Entire period",
    "Ausgaben aufteilen": "Split expenses",
    "Fixkosten gesamt": "Total fixed costs",
    "Keine Fixkosten in diesem Zeitraum. Welche Zahlungen als Fixkosten zählen, stellst du unter Mehr → Fixkosten ein.": "No fixed costs in this period. You can choose which payments count as fixed costs under More → Fixed costs.",
    "wie davor": "same as before",
    "zum Vormonat": "vs. previous month",
    "Monatsschnitt zum Vorjahr": "monthly avg. vs. previous year",
    "Einnahmen": "Income",
    "Einnahmen und Ausgaben": "Income and expenses",
    "Einnahmen und Ausgaben je Monat": "Income and expenses per month",
    "Einnahmen und Ausgaben je Jahr": "Income and expenses per year",
    "Aufs Sparkonto": "To savings",
    "Vom Sparkonto geholt": "Taken from savings",
    "angespart": "saved up",
    "davon Sparkonto": "of which in savings",
    "im Monat": "in the month",
    "Angespart seit {month}": "Saved up since {month}",
    "Überschuss aller Monate bis {month}, davon {amount} aufs Sparkonto gelegt": "Surplus of all months up to {month}, of which {amount} went to savings",

    // --- Vermögen
    "Girokonto": "Current account",
    "Giro": "Current",
    "Sparkonto": "Savings account",
    "Sparen": "Savings",
    "Investieren": "Investments",
    "Depot": "Brokerage",
    "Kredit": "Loan",
    "Kontostand": "Balance",
    "Depotwert": "Portfolio value",
    "Restschuld": "Remaining debt",
    "Noch kein Wert eingetragen": "No value entered yet",
    "Noch kein Wert": "No value yet",
    "{amount} im Monat · schuldenfrei ca. {month}": "{amount} per month · debt-free around {month}",
    "Rate deckt die Zinsen nicht": "Payment doesn't cover the interest",
    "Rate und Zins fehlen noch": "Payment and interest rate still missing",
    "seit {date}": "since {date}",
    "Wert aktualisieren": "update value",
    "zuletzt {amount} im Monat": "recently {amount} per month",
    "fortgeschrieben seit {date}": "projected since {date}",
    "von der Bank": "from the bank",
    "von Hand": "entered manually",
    "Dein Vermögen auf einen Blick": "Your wealth at a glance",
    "Lege Girokonto, Sparkonten, Depots und Kredite an. Was die Bank liefert, kommt automatisch. Depotwerte trägst du ab und zu selbst ein, Kredite rechnet die App mit dem Tilgungsplan weiter.": "Add your current account, savings accounts, brokerage accounts and loans. Whatever the bank provides comes in automatically. You enter portfolio values yourself now and then; loans are projected using the repayment plan.",
    "Erstes Konto anlegen": "Add your first account",
    "Schulden": "Debts",
    "Netto": "Net",
    "Nettovermögen": "Net worth",
    "nicht mitgezählt": "not counted",
    "Konto hinzufügen": "Add account",
    "Werte mit „fortgeschrieben“ rechnet die App aus deinen Umbuchungen weiter, bis du einen neuen Stand einträgst.": "Values marked “projected” are calculated from your transfers until you enter a new balance.",
    "z. B. Extra-Konto Rücklage": "e.g. Rainy day fund",
    "Umbuchungen erkennen an": "Recognize transfers by",
    "IBAN oder Stichwort, z. B. Direkt-Depot": "IBAN or keyword, e.g. Brokerage",
    "Steht in Empfänger, Verwendungszweck oder IBAN der Überweisung vom Girokonto.": "Appears in the payee, reference or IBAN of the transfer from your current account.",
    "Die Raten werden dann als „Kredit“ einsortiert.": "The payments are then categorized as “Loan”.",
    "Die Überweisungen zählen dann als Ersparnis.": "The transfers then count as savings.",
    "Sollzins p. a. in %": "Interest rate p.a. in %",
    "Monatsrate in €": "Monthly payment in €",
    "Ursprünglicher Kreditbetrag in € (optional)": "Original loan amount in € (optional)",
    "Im Nettovermögen mitzählen": "Count towards net worth",
    "Z. B. aus, wenn das Konto einem Kind gehört": "E.g. turn off if the account belongs to a child",
    "Deine Kontodaten bleiben in deiner eigenen Datenbank auf deinem Server.": "Your account data stays in your own database on your own server.",
    "{what} heute in €": "{what} today in €",
    "„{name}“ angelegt": "“{name}” created",
    "{n} Umbuchungen erkannt": "{n} transfers recognized",
    "Abbezahlt": "Paid off",
    "Schuldenfrei": "Debt-free",
    "in {n} Monat": "in {n} month",
    "in {n} Monaten": "in {n} months",
    "Zinsen bis dahin": "Interest until then",
    "Davon Zinsen in der nächsten Rate": "Interest in the next payment",
    "Eingezahlt seit {date}": "Paid in since {date}",
    "Wertentwicklung": "Performance",
    "ohne deine Einzahlungen": "excluding your contributions",
    "fortgeschrieben, letzter eingetragener Stand {date}": "projected, last entered value {date}",
    "Stand {date}": "As of {date}",
    "{what} eintragen": "Enter {what}",
    "Betrag in €": "Amount in €",
    "Stand vom": "As of",
    "{n} eingetragener Stand": "{n} entered value",
    "{n} eingetragene Stände": "{n} entered values",
    "Stand löschen": "Delete value",
    "Änderungen speichern": "Save changes",
    "Konto entfernen": "Remove account",
    "{what} gespeichert": "{what} saved",
    "Stand gelöscht": "Value deleted",
    "„{name}“ entfernen?": "Remove “{name}”?",
    "Das Konto und seine eingetragenen Stände werden gelöscht. Umsätze und Kategorien bleiben.": "The account and its entered values will be deleted. Transactions and categories stay.",
    "Konto entfernt": "Account removed",

    // --- Einstellungen
    "meist um den {day}": "usually around the {day}",
    "erkannt": "detected",
    "Fixkosten · {amount} im Monat": "Fixed costs · {amount} per month",
    "Erkannt werden Zahlungen, die in mindestens zwei Monaten mit fast gleichem Betrag vorkommen. Mit dem Schalter korrigierst du die Erkennung.": "Payments that occur in at least two months with almost the same amount are detected. Use the switch to correct the detection.",
    "Noch keine erkannt. Dafür braucht die App Umsätze aus mindestens zwei Monaten.": "None detected yet. The app needs transactions from at least two months.",
    "{n} weiterer wiederkehrender Empfänger": "{n} more recurring payee",
    "{n} weitere wiederkehrende Empfänger": "{n} more recurring payees",
    "Regelmäßige Einnahmen": "Regular income",
    "Gehalt zählt zum Folgemonat ab dem": "Salary counts for next month from the",
    "Gilt für Kategorien mit „Folgemonat“. Kommt das Gehalt verspätet am Monatsanfang, bleibt es im Eingangsmonat.": "Applies to categories marked “Next month”. If the salary arrives late at the start of a month, it stays in that month.",
    "Große Ausgabe ab": "Large expense from",
    "Einzelne Ausgaben ab diesem Betrag zählen nicht in die Prognose, weil sie selten sind.": "Single expenses from this amount are left out of the forecast because they are rare.",
    "Gelernte Regeln": "Learned rules",
    "Noch keine. Sie entstehen, wenn du eine Zahlung zuordnest und „Künftig immer so zuordnen“ an lässt.": "None yet. They are created when you categorize a payment and leave “Always categorize like this” switched on.",
    "{n} Start-Regeln anzeigen": "Show {n} starter rules",
    "Regel löschen": "Delete rule",
    "Regel gelöscht": "Rule deleted",
    "Sprache": "Language",
    "Über Münzwerk": "About Münzwerk",
    "Ersparnisse anzeigen": "Show savings",
    "Gleicher Empfänger und Zweck wie eine Ersparnis, zählt hier aber nicht als Ersparnis": "Same payee and purpose as a saving, but not counted as saving here",
    "Klingt nach Sparen, zählt aber als Ausgabe": "Sounds like saving, but counts as spending",
    "Kartenzahlung in einem Spartopf – eher ein Einkauf?": "Card payment in a savings pot – rather a purchase?",
    "Noch keine Ersparnisse. Ordne Überweisungen aufs Sparkonto oder ins Depot einer Spar-Kategorie zu (z. B. „Sparen“), dann siehst du hier, wohin dein Geld geht.": "No savings yet. Assign transfers to your savings account or brokerage to a savings category (e.g. “Savings”) and you'll see here where your money goes.",
    "Diesen Monat": "This month",
    "Insgesamt seit {date}": "Total since {date}",
    "Ø pro Monat": "Avg. per month",
    "diesen Monat {amount}": "this month {amount}",
    "{n} Buchung prüfen": "Check {n} transaction",
    "{n} Buchungen prüfen": "Check {n} transactions",
    "Sieht nach Sparen aus oder sitzt im falschen Topf": "Looks like saving or sits in the wrong pot",
    "Gezählt werden die Überweisungen vom Girokonto, ohne Zinsen und Kursgewinne. Antippen zeigt die Buchungen; dort lässt sich jede neu zuordnen.": "Counts the transfers from your current account, without interest or price gains. Tap to see the transactions; each one can be reassigned there.",
    "Spartopf, alle Monate": "Savings pot, all months",
    "Ersparnisse prüfen": "Check savings",
    "Antippen und richtig zuordnen. Passt alles, einfach so lassen.": "Tap to assign correctly. If everything fits, just leave it.",
    "Alles in Ordnung.": "All good.",
    "Design": "Appearance",
    "Automatisch": "Automatic",
    "Hell": "Light",
    "Dunkel": "Dark",
    "Automatisch folgt der Einstellung des Geräts.": "Automatic follows your device setting.",
    "Version": "Version",
    "Auf dem Pi läuft schon Version {v}. Schließe die App ganz und öffne sie neu.": "The Pi already runs version {v}. Close the app completely and open it again.",
    "Münzwerk ist ein privates Hobbyprojekt und Open Source (AGPL-3.0). Es gibt keine Gewähr, dass Beträge, Kategorien oder Prognosen stimmen, und nichts davon ist Finanzberatung. Münzwerk steht in keiner Verbindung zu deiner Bank oder zu Enable Banking.": "Münzwerk is a private hobby project and open source (AGPL-3.0). There is no guarantee that amounts, categories or forecasts are correct, and none of it is financial advice. Münzwerk is not affiliated with your bank or with Enable Banking.",

    // --- Anmeldung (auth.js)
    "Lege einmalig einen Passkey an. Danach öffnest du die App mit Face ID oder Fingerabdruck.": "Create a passkey once. After that you open the app with Face ID or your fingerprint.",
    "Mit Face ID oder Fingerabdruck entsperren.": "Unlock with Face ID or your fingerprint.",
    "Passkey einrichten": "Set up passkey",
    "Entsperren": "Unlock",
    "Dieser Browser kann keine Passkeys. Bitte Safari (iPhone) oder Chrome (Android) verwenden.": "This browser doesn't support passkeys. Please use Safari (iPhone) or Chrome (Android).",
    "Wegen Inaktivität gesperrt.": "Locked due to inactivity.",
    "angelegt {date}": "created {date}",
    "zuletzt {date}": "last used {date}",
    "Passkey löschen": "Delete passkey",
    "Anmeldung": "Sign-in",
    "Die App sperrt sich nach 15 Minuten ohne Benutzung und öffnet sich mit Face ID oder Fingerabdruck.": "The app locks after 15 minutes without use and opens with Face ID or your fingerprint.",
    "Keine Passkeys geladen.": "No passkeys loaded.",
    "Passkey hinzufügen": "Add passkey",
    "Jetzt sperren": "Lock now",
    "Name für den Passkey (z. B. „iPad“):": "Name for the passkey (e.g. “iPad”):",
    "Diesen Passkey löschen? Mit dem Gerät kann man sich dann nicht mehr anmelden, und alle anderen Geräte werden abgemeldet.": "Delete this passkey? You will no longer be able to sign in with that device, and all other devices will be signed out.",
    "Einrichtungscode": "Setup code",
    "Steht im Log der App auf dem Server: docker logs haushaltsbuch": "It's in the app's log on the server: docker logs haushaltsbuch",
    "Bitte den Einrichtungscode eingeben.": "Please enter the setup code.",
    "Andere Geräte abmelden": "Sign out other devices",
    "Alle anderen Geräte abmelden? Dort ist danach wieder Face ID oder Fingerabdruck nötig.": "Sign out all other devices? They will need Face ID or a fingerprint again.",
    "{n} Sitzung beendet.": "{n} session ended.",
    "{n} Sitzungen beendet.": "{n} sessions ended.",
    "Android-Handy": "Android phone",
    "Windows-PC": "Windows PC",
    "Gerät": "Device",
    "Fehler {status}": "Error {status}",

    // --- Meldungen vom Server (app/*.py)
    "Anmeldung nötig.": "Sign-in required.",
    "Anfrage abgelehnt.": "Request rejected.",
    "Diese Kategorie gibt es schon.": "This category already exists.",
    "Nichts mehr rückgängig zu machen.": "Nothing left to undo.",
    "Die Bank ist noch nicht eingerichtet.": "The bank hasn't been set up yet.",
    "Ungültige Rückmeldung der Bank.": "Invalid response from the bank.",
    "Zeit abgelaufen, bitte noch einmal versuchen.": "Time's up, please try again.",
    "Weitere Passkeys nur nach der Anmeldung.": "Additional passkeys only after signing in.",
    "Noch kein Passkey eingerichtet.": "No passkey set up yet.",
    "Dieser Passkey ist hier nicht bekannt.": "This passkey is not known here.",
    "Anmeldung fehlgeschlagen.": "Sign-in failed.",
    "Der letzte Passkey kann nicht gelöscht werden.": "The last passkey can't be deleted.",
    "Passkey konnte nicht geprüft werden": "Passkey could not be verified",
    "Einrichtungscode falsch.": "Wrong setup code.",

    // --- Standardkategorien (app/defaults.py), für die Vorschau
    "Allgemein": "General",
    "Restaurant": "Eating out",
    "Wohnen": "Housing",
    "Versicherung": "Insurance",
    "Gesundheit": "Health",
    "Bekleidung": "Clothing",
    "Bildung": "Education",
    "Geschenke": "Gifts",
    "Haustier": "Pets",
    "Kinder": "Kids",
    "Lebensmittel": "Groceries",
    "Mobilität": "Transport",
    "Nebenkosten": "Utilities",
    "Reisen": "Travel",
    "Steuern": "Taxes",
    "Technologie": "Tech",
    "Unterhaltung": "Entertainment",
    "Gehalt": "Salary",
    "Nebeneinkünfte": "Side income",
    "Erstattungen": "Refunds",
    "Zinsen & Dividenden": "Interest & dividends",
    "Geschenke erhalten": "Gifts received",
    "Sonstige Einnahmen": "Other income",
    // Abruf-Protokoll unter „Mehr → Bank“
    "{n} gebucht": "{n} booked",
    "neueste Buchung {date}": "newest booking {date}",
    "Letzter Abruf: {text}": "Last fetch: {text}",
    "Ab {date}": "From {date}",
    "Status von der Bank: {raw}": "Status from the bank: {raw}",
    "Vorgemerkte extra abgefragt: {result}": "Pending requested separately: {result}",
    "Letzter Fehler: {msg}": "Last error: {msg}",
    // iPhone-Widget
    "iPhone-Widget": "iPhone widget",
    "Aktiv": "On",
    "Aus": "Off",
    "Kopieren ging nicht – bitte von Hand markieren.": "Couldn't copy – please select it by hand.",
    "Installiere die kostenlose App „Scriptable“ aus dem App Store.": "Install the free app “Scriptable” from the App Store.",
    "Tippe unten auf „Skript kopieren“. Öffne Scriptable, tippe auf +, füge das Skript ein und nenne es „Münzwerk“.": "Tap “Copy script” below. Open Scriptable, tap +, paste the script and name it “Münzwerk”.",
    "Erzeuge hier einen Widget-Schlüssel und kopiere ihn. Starte das Skript einmal in Scriptable (▶) und füge den Schlüssel ein.": "Create a widget key here and copy it. Run the script once in Scriptable (▶) and paste the key.",
    "Halte auf dem Homescreen eine freie Stelle gedrückt, tippe auf „Bearbeiten → Widget hinzufügen“, wähle Scriptable (klein oder mittel) und im Widget als Script „Münzwerk“.": "Long-press an empty spot on the home screen, tap “Edit → Add Widget”, choose Scriptable (small or medium) and pick “Münzwerk” as the script in the widget.",
    "Zahlen auf dem Homescreen": "Numbers on your home screen",
    "Das Widget zeigt, was bis Monatsende übrig ist, das Tagesbudget für heute, morgen und übermorgen und die nächsten Fixkosten. Mehr nicht: keine Umsätze, keine Kontodaten.": "The widget shows what's left until month end, the daily budget for today, tomorrow and the day after, and the next fixed costs. Nothing else: no transactions, no account details.",
    "Die Zahlen rechnet Münzwerk, wenn du die App öffnest. Das Widget zeigt diesen Stand; wann es sich neu lädt, entscheidet iOS. Tailscale muss auf dem iPhone an sein.": "Münzwerk calculates the numbers when you open the app. The widget shows that state; iOS decides when it refreshes. Tailscale must be on on the iPhone.",
    "Widget-Schlüssel": "Widget key",
    "Aktiv seit {date}": "Active since {date}",
    "Kein Schlüssel – das Widget hat keinen Zugriff.": "No key – the widget has no access.",
    "Zahlen zuletzt übertragen: {date}": "Numbers last sent: {date}",
    "Noch keine Zahlen übertragen.": "No numbers sent yet.",
    "Wird nur jetzt angezeigt. Kopiere ihn gleich in Scriptable.": "Shown only now. Copy it into Scriptable right away.",
    "Schlüssel kopieren": "Copy key",
    "Der Schlüssel darf nur diese Zahlen lesen, sonst nichts. Ein neuer Schlüssel macht den alten sofort ungültig.": "The key can only read these numbers, nothing else. A new key makes the old one invalid immediately.",
    "Neuer Schlüssel": "New key",
    "Schlüssel erzeugen": "Create key",
    "Sperren": "Revoke",
    "So richtest du es ein": "How to set it up",
    "Skript kopieren": "Copy script",
    "Scriptable öffnen": "Open Scriptable",
    "Skript konnte nicht geladen werden.": "Couldn't load the script.",
    "Skript kopiert": "Script copied",
    "Schlüssel kopiert": "Key copied",
    "Neuen Schlüssel erzeugen?": "Create a new key?",
    "Der alte Schlüssel hört sofort auf zu gelten. Im Widget musst du danach den neuen eingeben.": "The old key stops working immediately. You'll need to enter the new one in the widget.",
    "Neu erzeugen": "Create new",
    "Widget-Schlüssel sperren?": "Revoke widget key?",
    "Das Widget kann danach keine Zahlen mehr laden.": "The widget won't be able to load numbers afterwards.",
    "Schlüssel gesperrt": "Key revoked",
  };

  const LANGUAGES = [
    { code: "de", name: "Deutsch", locale: "de-DE" },
    { code: "en", name: "English", locale: "en-GB" },
  ];
  const MONTHS = {
    de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  };
  const WEEKDAYS = {
    de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  };
  const STORE_KEY = "kontor-lang";

  // Gewählte Sprache, sonst die des Geräts (Deutsch nur bei deutschem Gerät)
  function detect() {
    try {
      const saved = root.localStorage && root.localStorage.getItem(STORE_KEY);
      if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
    } catch {}
    const nav = root.navigator;
    const prefs = (nav && (nav.languages || [nav.language])) || [];
    for (const p of prefs) {
      const code = String(p || "").slice(0, 2).toLowerCase();
      if (LANGUAGES.some((l) => l.code === code)) return code;
    }
    return "en";
  }

  // Node (Tests) wählt die Sprache selbst über make("en")
  return make(typeof module === "object" && module.exports ? "de" : detect());

  function make(lang) {
    const locale = LANGUAGES.find((l) => l.code === lang).locale;

    function fill(s, vars) {
      return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
    }
    function t(de, vars) {
      return fill(lang === "en" && EN[de] != null ? EN[de] : de, vars);
    }
    function tn(n, one, other, vars) {
      return t(n === 1 ? one : other, { ...vars, n });
    }

    // Ordnungszahl für Tage: "15." bzw. "15th"
    function ord(n) {
      if (lang !== "en") return `${n}.`;
      const v = n % 100;
      const s = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
      return `${n}${s}`;
    }

    const DEC = lang === "en" ? "." : ",";
    // Zahl mit dem Dezimalzeichen der Sprache, ohne Tausenderpunkte (für Eingabefelder)
    function decimal(v, digits) {
      const s = digits == null ? String(v) : Number(v).toFixed(digits);
      return s.replace(".", DEC);
    }

    // Betrag aus einem Eingabefeld -> Cent. Versteht "1.234,56", "1,234.56", "39,95", "39.95".
    function parseAmount(text) {
      let s = String(text || "").replace(/[€\s']/g, "");
      if (!s) return null;
      const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
      if (comma >= 0 && dot >= 0) {
        // Das letzte Zeichen von beiden trennt die Nachkommastellen
        s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
      } else if (comma >= 0) {
        // Nur Komma: "39,95" ist dezimal, "1,234" im Englischen ein Tausender
        s = /,\d{3}$/.test(s) && lang === "en" ? s.replace(/,/g, "") : s.replace(/,/g, ".");
      } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s) && lang !== "en") {
        s = s.replace(/\./g, "");   // "20.000" im Deutschen
      }
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    }

    function setLang(code) {
      try { root.localStorage.setItem(STORE_KEY, code); } catch {}
      root.location.reload();
    }

    if (root.document && root.document.documentElement) root.document.documentElement.lang = lang;

    return {
      EN, lang, locale, t, tn, ord, decimal, parseAmount, setLang, fill, make,
      languages: LANGUAGES, months: MONTHS[lang], weekdays: WEEKDAYS[lang],
    };
  }
});
