package io.github.vaitage.muenzwerk;

import static org.junit.Assert.*;

import org.junit.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;

public class FmtTest {
    static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

    static String plain(String s) { return s.replace('\u00a0', ' ').replace('\u202f', ' '); }

    @Test public void euroDeutsch() {
        assertEquals("-1.811 €", plain(Fmt.euro(-181100, Locale.GERMANY)));
        assertEquals("59 €", plain(Fmt.euro(5949, Locale.GERMANY)));
        assertEquals("0 €", plain(Fmt.euro(-20, Locale.GERMANY)));   // kein „-0 €“
    }

    @Test public void euroEnglisch() {
        assertEquals("€1,811", plain(Fmt.euro(181100, Locale.UK)));
    }

    @Test public void uhrzeitHeuteUndFrueher() {
        LocalDate today = LocalDate.of(2026, 10, 25);
        assertEquals("07:42", Fmt.clock("2026-10-25T06:42:00+00:00", BERLIN, today, Locale.GERMANY));  // Winterzeit
        assertEquals("24. Okt. 08:42", Fmt.clock("2026-10-24T06:42:00+00:00", BERLIN, today, Locale.GERMANY));
        assertEquals("", Fmt.clock("Quatsch", BERLIN, today, Locale.GERMANY));
        assertEquals("", Fmt.clock(null, BERLIN, today, Locale.GERMANY));
    }

    @Test public void tageszahl() {
        assertEquals("1st", Fmt.day(1, Locale.UK));
        assertEquals("12th", Fmt.day(12, Locale.UK));
        assertEquals("23rd", Fmt.day(23, Locale.UK));
        assertEquals("28", Fmt.day(28, Locale.GERMANY));
    }
}
