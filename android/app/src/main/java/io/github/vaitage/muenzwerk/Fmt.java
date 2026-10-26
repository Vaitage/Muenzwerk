package io.github.vaitage.muenzwerk;

import java.text.NumberFormat;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Currency;
import java.util.Locale;

/** Beträge und Uhrzeiten in der Sprache des Telefons. Reines Java, testbar ohne Gerät. */
public final class Fmt {
    private Fmt() {}

    /** Ganze Euro: „1.811 €“ (de) bzw. „€1,811“ (en). */
    public static String euro(long cents, Locale locale) {
        NumberFormat f = NumberFormat.getCurrencyInstance(locale);
        f.setCurrency(Currency.getInstance("EUR"));
        f.setMinimumFractionDigits(0);
        f.setMaximumFractionDigits(0);
        // „−0 €“ vermeiden
        long rounded = Math.round(cents / 100.0);
        return f.format(rounded == 0 ? 0 : rounded);
    }

    /** „08:42“ für heute, sonst „25. Okt. 08:42“. */
    public static String clock(String iso, ZoneId zone, LocalDate today, Locale locale) {
        if (iso == null || iso.isEmpty()) return "";
        ZonedDateTime t;
        try {
            t = OffsetDateTime.parse(iso).atZoneSameInstant(zone);
        } catch (Exception e) {
            try {
                t = LocalDateTime.parse(iso).atZone(zone);
            } catch (Exception e2) {
                return "";
            }
        }
        String time = t.format(DateTimeFormatter.ofPattern("HH:mm", locale));
        if (t.toLocalDate().equals(today)) return time;
        String day = t.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale));
        // „25.10.2026“ wäre zu lang – Jahr weglassen, wenn es das aktuelle ist
        if (t.getYear() == today.getYear()) day = t.format(DateTimeFormatter.ofPattern(isGerman(locale) ? "d. MMM" : "d MMM", locale));
        return day + " " + time;
    }

    /** Tag im Monat für „am 1.“ bzw. „on the 1st“. */
    public static String day(int d, Locale locale) {
        if (isGerman(locale) || !"en".equals(locale.getLanguage())) return String.valueOf(d);
        int m100 = d % 100, m10 = d % 10;
        String suffix = (m100 >= 11 && m100 <= 13) ? "th" : m10 == 1 ? "st" : m10 == 2 ? "nd" : m10 == 3 ? "rd" : "th";
        return d + suffix;
    }

    public static boolean isGerman(Locale locale) {
        return "de".equals(locale.getLanguage());
    }
}
