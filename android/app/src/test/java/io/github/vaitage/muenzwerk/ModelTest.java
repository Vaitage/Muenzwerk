package io.github.vaitage.muenzwerk;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

import java.time.LocalDate;

/** Gleiche Fälle wie tests/widget.test.mjs für das iPhone-Widget. */
public class ModelTest {

    static final LocalDate TODAY = LocalDate.of(2026, 10, 25);

    static JSONObject sample() throws Exception {
        return new JSONObject("{\"snapshot\":{\"month\":\"2026-10\",\"budget_left_cents\":-181100,"
                + "\"forecast_end_cents\":0,\"days_left\":7,\"pending_cents\":0,"
                + "\"days\":[{\"date\":\"2026-10-24\",\"daily_cents\":1000},{\"date\":\"2026-10-25\",\"daily_cents\":-25900},"
                + "{\"date\":\"2026-10-26\",\"daily_cents\":4200}],"
                + "\"next_fixed\":[{\"name\":\"Strom\",\"amount_cents\":6500,\"day\":20},{\"name\":\"Miete\",\"amount_cents\":85000,\"day\":28}],"
                + "\"computed_at\":\"2026-10-25T06:42:00+00:00\"},"
                + "\"bank\":{\"state\":\"ok\",\"days_left\":170,\"last_sync\":null,\"error\":false}}");
    }

    @Test public void zahlenAusDemStand() throws Exception {
        Model m = Model.from(sample(), TODAY, false);
        assertEquals(Model.Msg.NONE, m.msg);
        assertEquals(-181100, m.leftCents);
        assertFalse(m.stale);
        assertArrayEquals(new long[] {-25900, 4200}, m.dayCents);   // ab heute
        assertEquals(7, m.daysLeft);                                 // 25. bis 31. inkl. heute
        assertEquals("Miete", m.nextName);                           // Strom (20.) ist vorbei
        assertEquals(85000, m.nextCents);
        assertEquals(28, m.nextDay);
        assertEquals(Model.Warn.NONE, m.warn);
        assertEquals("2026-10-25T06:42:00+00:00", m.asOf);
        assertTrue(m.hasToday());
    }

    @Test public void alterStandIstVeraltet() throws Exception {
        Model m = Model.from(sample(), LocalDate.of(2026, 11, 2), true);
        assertTrue(m.stale);
        assertTrue(m.offline);
        assertFalse(m.hasToday());
        assertEquals(29, m.daysLeft);
    }

    @Test public void ohneStandMeldung() throws Exception {
        assertEquals(Model.Msg.NO_DATA, Model.from(new JSONObject("{\"snapshot\":null}"), TODAY, false).msg);
        assertEquals(Model.Msg.NO_DATA, Model.from(null, TODAY, false).msg);
    }

    @Test public void bankHinweise() throws Exception {
        JSONObject d = sample();
        d.getJSONObject("bank").put("state", "expiring").put("days_left", 9);
        Model m = Model.from(d, TODAY, false);
        assertEquals(Model.Warn.EXPIRING, m.warn);
        assertEquals(9, m.bankDaysLeft);
        d.getJSONObject("bank").put("state", "expired");
        assertEquals(Model.Warn.EXPIRED, Model.from(d, TODAY, false).warn);
        d.getJSONObject("bank").put("state", "ok").put("error", true);
        assertEquals(Model.Warn.FETCH_FAILED, Model.from(d, TODAY, false).warn);
    }

    @Test public void ohneZeitstempel() throws Exception {
        JSONObject d = sample();
        d.getJSONObject("snapshot").put("computed_at", JSONObject.NULL);
        assertNull(Model.from(d, TODAY, false).asOf);
    }
}
