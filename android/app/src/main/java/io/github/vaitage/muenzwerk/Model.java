package io.github.vaitage.muenzwerk;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;

/**
 * Was das Widget zeigt – aus der Antwort von GET /api/widget/data und dem heutigen Datum.
 * Gleiche Regeln wie buildModel() im iPhone-Widget (web/scriptable-widget.js).
 * Reines Java (plus org.json), damit es ohne Gerät getestet werden kann.
 */
public final class Model {

    /** Statt Zahlen eine Meldung. */
    public enum Msg { NONE, NO_KEY, BAD_KEY, NO_DATA, UNREACHABLE }

    /** Hinweis zur Bankanbindung. */
    public enum Warn { NONE, EXPIRED, EXPIRING, FETCH_FAILED }

    public Msg msg = Msg.NONE;
    public long leftCents;
    /** Resttage inklusive heute, wie „noch n Tage“ in der App. */
    public int daysLeft;
    /** Tagesbudget heute, morgen, übermorgen (so viele, wie der Stand hergibt). */
    public long[] dayCents = new long[0];
    /** Stand von einem anderen Tag oder Monat – dann nur „Übrig“ und der Hinweis, Münzwerk zu öffnen. */
    public boolean stale;
    public String nextName;
    public long nextCents;
    public int nextDay;
    public String asOf;
    public boolean offline;
    public Warn warn = Warn.NONE;
    public int bankDaysLeft;

    public static Model message(Msg msg) {
        Model m = new Model();
        m.msg = msg;
        return m;
    }

    public boolean hasToday() {
        return !stale && dayCents.length > 0;
    }

    public static Model from(JSONObject data, LocalDate today, boolean offline) {
        JSONObject snap = data == null ? null : data.optJSONObject("snapshot");
        if (snap == null) return message(Msg.NO_DATA);

        Model m = new Model();
        m.offline = offline;
        m.leftCents = snap.optLong("budget_left_cents");
        m.asOf = snap.isNull("computed_at") ? null : snap.optString("computed_at");

        String iso = today.toString();
        JSONArray days = snap.optJSONArray("days");
        int idx = -1;
        if (days != null) {
            for (int i = 0; i < days.length(); i++) {
                JSONObject d = days.optJSONObject(i);
                if (d != null && iso.equals(d.optString("date"))) { idx = i; break; }
            }
        }
        if (idx >= 0) {
            int n = Math.min(3, days.length() - idx);
            m.dayCents = new long[n];
            for (int i = 0; i < n; i++) m.dayCents[i] = days.optJSONObject(idx + i).optLong("daily_cents");
        }
        m.stale = idx < 0 || !iso.substring(0, 7).equals(snap.optString("month"));
        m.daysLeft = today.lengthOfMonth() - today.getDayOfMonth() + 1;

        JSONArray fixed = snap.optJSONArray("next_fixed");
        if (fixed != null) {
            for (int i = 0; i < fixed.length(); i++) {
                JSONObject f = fixed.optJSONObject(i);
                if (f != null && f.optInt("day") >= today.getDayOfMonth()) {
                    m.nextName = f.optString("name");
                    m.nextCents = f.optLong("amount_cents");
                    m.nextDay = f.optInt("day");
                    break;
                }
            }
        }

        JSONObject bank = data.optJSONObject("bank");
        if (bank != null) {
            String state = bank.optString("state");
            if ("expired".equals(state)) m.warn = Warn.EXPIRED;
            else if ("expiring".equals(state)) { m.warn = Warn.EXPIRING; m.bankDaysLeft = bank.optInt("days_left"); }
            else if (bank.optBoolean("error")) m.warn = Warn.FETCH_FAILED;
        }
        return m;
    }
}
