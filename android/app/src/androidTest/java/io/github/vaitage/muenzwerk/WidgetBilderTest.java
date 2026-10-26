package io.github.vaitage.muenzwerk;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.LocaleList;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;

/**
 * Zeichnet das Widget wie der Startbildschirm (RemoteViews.apply) in verschiedenen Größen,
 * hell/dunkel und deutsch/englisch, prüft die Inhalte und legt Bilder unter files/bilder ab
 * (GitHub Actions holt sie mit run-as ab).
 */
@RunWith(AndroidJUnit4.class)
public class WidgetBilderTest {

    static JSONObject beispiel() throws Exception {
        LocalDate t = LocalDate.now();
        String now = OffsetDateTime.now(ZoneOffset.UTC).withSecond(0).withNano(0).toString();
        return new JSONObject("{\"snapshot\":{\"month\":\"" + t.toString().substring(0, 7) + "\",\"budget_left_cents\":123456,"
                + "\"forecast_end_cents\":0,\"days_left\":6,\"pending_cents\":0,"
                + "\"days\":[{\"date\":\"" + t + "\",\"daily_cents\":4210},{\"date\":\"" + t.plusDays(1) + "\",\"daily_cents\":4530},"
                + "{\"date\":\"" + t.plusDays(2) + "\",\"daily_cents\":4530}],"
                + "\"next_fixed\":[{\"name\":\"Miete\",\"amount_cents\":85000,\"day\":" + Math.min(28, t.lengthOfMonth()) + "}],"
                + "\"computed_at\":\"" + now + "\"},"
                + "\"bank\":{\"state\":\"ok\",\"days_left\":170,\"last_sync\":null,\"error\":false}}");
    }

    private Context ctx(boolean night, Locale locale) {
        Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Configuration c = new Configuration(base.getResources().getConfiguration());
        c.uiMode = (c.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
        c.setLocales(new LocaleList(locale));
        return base.createConfigurationContext(c);
    }

    private View render(Context c, Model m, int wDp, int hDp, String name) throws Exception {
        final View[] out = new View[1];
        final Exception[] err = new Exception[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try {
                RemoteViews rv = Renderer.build(c, m, wDp, hDp);
                FrameLayout parent = new FrameLayout(c);
                View v = rv.apply(c, parent);
                float d = c.getResources().getDisplayMetrics().density;
                int w = Math.round(wDp * d), h = Math.round(hDp * d), pad = Math.round(16 * d);
                v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
                v.layout(0, 0, w, h);
                Bitmap bmp = Bitmap.createBitmap(w + 2 * pad, h + 2 * pad, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bmp);
                boolean night = (c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
                canvas.drawColor(night ? Color.rgb(48, 52, 70) : Color.rgb(196, 205, 226));   // „Hintergrundbild“
                canvas.translate(pad, pad);
                v.draw(canvas);
                File dir = new File(c.getFilesDir(), "bilder");
                dir.mkdirs();
                try (FileOutputStream f = new FileOutputStream(new File(dir, name + ".png"))) {
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, f);
                }
                out[0] = v;
            } catch (Exception e) {
                err[0] = e;
            }
        });
        if (err[0] != null) throw err[0];
        return out[0];
    }

    private static String text(View root, int id) {
        View v = root.findViewById(id);
        if (!(v instanceof TextView)) return null;
        // sichtbar nur, wenn auch alle Eltern sichtbar sind
        for (View p = v; p != null; p = p == root ? null : (View) p.getParent()) {
            if (p.getVisibility() != View.VISIBLE) return null;
        }
        return v.getVisibility() != View.VISIBLE ? null : ((TextView) v).getText().toString().replace('\u00a0', ' ').replace('\u202f', ' ');
    }

    /** Für Fehlermeldungen: Kette von der Ansicht bis zur Wurzel mit Sichtbarkeit. */
    private static String chain(View root, int id) {
        StringBuilder b = new StringBuilder();
        for (View p = root.findViewById(id); p != null; p = p == root ? null : (View) p.getParent()) {
            String name;
            try { name = p.getId() == View.NO_ID ? "?" : p.getResources().getResourceEntryName(p.getId()); } catch (Exception e) { name = "#" + p.getId(); }
            b.append(name).append('=').append(p.getVisibility()).append(p == root ? "(root)" : "").append(" > ");
        }
        return b.toString();
    }

    @Test
    public void bilderUndInhalt() throws Exception {
        Model m = Model.from(beispiel(), LocalDate.now(), false);
        for (boolean night : new boolean[] {false, true}) {
            for (Locale loc : new Locale[] {Locale.GERMANY, Locale.UK}) {
                Context c = ctx(night, loc);
                String suffix = (night ? "dunkel" : "hell") + "-" + loc.getLanguage();
                View klein = render(c, m, 170, 170, "klein-" + suffix);
                View breit = render(c, m, 340, 170, "breit-" + suffix);
                View flach = render(c, m, 340, 84, "flach-" + suffix);
                View hoch = render(c, m, 340, 230, "breit-hoch-" + suffix);
                if (loc == Locale.GERMANY) {
                    assertEquals("1.235 €", text(klein, R.id.amount));
                    assertEquals("Heute 42 €", text(klein, R.id.today));
                    assertNull(chain(klein, R.id.d0_value), text(klein, R.id.d0_value));                 // klein: keine Tageskacheln
                    assertEquals("42 €", text(breit, R.id.d0_value));
                    assertEquals("45 €", text(breit, R.id.d1_value));
                    assertTrue(text(breit, R.id.next).startsWith("Als Nächstes: Miete −850 € am "));
                    assertTrue(text(breit, R.id.footer_text).startsWith("Stand "));
                    assertEquals("Übrig · noch " + m.daysLeft + (m.daysLeft == 1 ? " Tag" : " Tage"), text(breit, R.id.days_left));
                    assertNull(text(breit, R.id.label));                    // breit + niedrig: steht oben rechts
                    assertEquals("Übrig bis Monatsende", text(hoch, R.id.label));
                    assertEquals("Heute 42 €", text(flach, R.id.days_left)); // flach: Tagesbudget oben rechts
                    assertNull(text(flach, R.id.today));
                } else {
                    assertEquals("€1,235", text(klein, R.id.amount));
                    assertEquals("Today €42", text(klein, R.id.today));
                }
            }
        }
        // Meldungen und Minus
        Context c = ctx(false, Locale.GERMANY);
        View msg = render(c, Model.message(Model.Msg.NO_KEY), 170, 170, "meldung-hell-de");
        assertEquals(c.getString(R.string.msg_no_key), text(msg, R.id.message));
        assertNull(text(msg, R.id.amount));
        JSONObject minus = beispiel();
        minus.getJSONObject("snapshot").put("budget_left_cents", -181100);
        minus.getJSONObject("bank").put("state", "expiring").put("days_left", 9);
        Model mm = Model.from(minus, LocalDate.now(), true);
        View neg = render(ctx(true, Locale.GERMANY), mm, 340, 170, "minus-dunkel-de");
        assertEquals("-1.811 €", text(neg, R.id.amount));
        assertEquals("Bankfreigabe: 9 Tage", text(neg, R.id.warning));
        assertTrue(text(neg, R.id.footer_text).startsWith("Offline · Stand "));
        assertNull(text(neg, R.id.next));    // kein Platz: Bankhinweis geht vor
        render(ctx(false, Locale.GERMANY), mm, 170, 170, "minus-klein-hell-de");
    }
}
