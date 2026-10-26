package io.github.vaitage.muenzwerk;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;

/** Baut die Ansicht des Widgets aus dem Modell – passend zur Größe. */
final class Renderer {
    private Renderer() {}

    /** Ab dieser Breite zeigt das Widget drei Tage und die nächsten Fixkosten. */
    static final int WIDE_DP = 250;
    /** Unter dieser Höhe nur Übrig und heute (z. B. 4×1). */
    static final int COMPACT_DP = 100;
    /** Breit und mindestens so hoch: auch die Zeile „Übrig bis Monatsende“. */
    static final int TALL_DP = 200;

    static final int[] DAY_BOX = {R.id.d0, R.id.d1, R.id.d2};
    static final int[] DAY_LABEL = {R.id.d0_label, R.id.d1_label, R.id.d2_label};
    static final int[] DAY_VALUE = {R.id.d0_value, R.id.d1_value, R.id.d2_value};

    /** Größe aus den Angaben des Startbildschirms (dp). Hochformat: kleinste Breite, größte Höhe. */
    static int[] size(Bundle opts) {
        if (opts == null) return new int[] {170, 170};
        int w = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 170);
        int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 170);
        return new int[] {w == 0 ? 170 : w, h == 0 ? 170 : h};
    }

    static RemoteViews build(Context ctx, Model m, int widthDp, int heightDp) {
        Locale locale = ctx.getResources().getConfiguration().getLocales().get(0);
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        boolean wide = widthDp >= WIDE_DP;
        boolean compact = heightDp < COMPACT_DP;
        Store store = new Store(ctx);

        // Antippen öffnet Münzwerk (bei fehlender Einrichtung die Einrichtung)
        rv.setOnClickPendingIntent(android.R.id.background, m.msg == Model.Msg.NO_KEY || m.msg == Model.Msg.BAD_KEY || store.url() == null
                ? setupIntent(ctx) : openIntent(ctx, store.url()));
        rv.setOnClickPendingIntent(R.id.footer, refreshIntent(ctx));

        if (m.msg != Model.Msg.NONE) {
            show(rv, false, R.id.label, R.id.amount, R.id.today, R.id.days, R.id.next, R.id.warning, R.id.days_left);
            show(rv, true, R.id.message);
            rv.setTextViewText(R.id.message, ctx.getString(messageText(m.msg)));
            show(rv, m.msg == Model.Msg.UNREACHABLE || m.msg == Model.Msg.NO_DATA, R.id.footer);
            rv.setTextViewText(R.id.footer_text, "");
            return rv;
        }
        show(rv, false, R.id.message);

        // Oben rechts: Resttage – breit und niedrig zusammen mit „Übrig“, ganz flach das Tagesbudget
        String daysLeft = ctx.getResources().getQuantityString(R.plurals.days_left, m.daysLeft, m.daysLeft);
        boolean shortLabel = wide && heightDp < TALL_DP;
        String right = m.stale ? "" : daysLeft;
        if (compact && m.hasToday()) right = ctx.getString(R.string.today_amount, Fmt.euro(m.dayCents[0], locale));
        else if (shortLabel && !m.stale) right = ctx.getString(R.string.left_short, daysLeft);
        rv.setTextViewText(R.id.days_left, right);
        show(rv, !compact && !shortLabel, R.id.label);

        rv.setTextViewText(R.id.amount, Fmt.euro(m.leftCents, locale));
        color(rv, ctx, R.id.amount, m.leftCents >= 0 ? R.color.mw_pos : R.color.mw_neg);
        rv.setContentDescription(R.id.amount, ctx.getString(R.string.left) + ": " + Fmt.euro(m.leftCents, locale));

        boolean showDays = wide && !compact && m.hasToday();
        show(rv, showDays, R.id.days);
        show(rv, !showDays && !compact && m.hasToday(), R.id.today);
        if (m.hasToday()) {
            rv.setTextViewText(R.id.today, ctx.getString(R.string.today_amount, Fmt.euro(m.dayCents[0], locale)));
            color(rv, ctx, R.id.today, m.dayCents[0] >= 0 ? R.color.mw_text : R.color.mw_neg);
        }
        if (showDays) {
            for (int i = 0; i < 3; i++) {
                boolean has = i < m.dayCents.length;
                show(rv, has, DAY_BOX[i]);
                if (!has) continue;
                rv.setTextViewText(DAY_VALUE[i], Fmt.euro(m.dayCents[i], locale));
                color(rv, ctx, DAY_VALUE[i], m.dayCents[i] >= 0 ? R.color.mw_text : R.color.mw_neg);
            }
        }

        // Hinweis zur Bank geht vor; breit und niedrig ist nur Platz für eine der beiden Zeilen
        String warn = warningText(ctx, m);
        show(rv, warn != null && !compact, R.id.warning);
        if (warn != null) rv.setTextViewText(R.id.warning, warn);
        boolean showNext = wide && !compact && !m.stale && m.nextName != null && (warn == null || heightDp >= TALL_DP);
        show(rv, showNext, R.id.next);
        if (showNext) {
            rv.setTextViewText(R.id.next, ctx.getString(R.string.next, m.nextName, Fmt.euro(m.nextCents, locale), Fmt.day(m.nextDay, locale)));
        }


        String foot;
        if (m.stale) foot = ctx.getString(R.string.stale);
        else {
            String t = Fmt.clock(m.asOf, ZoneId.systemDefault(), LocalDate.now(), locale);
            foot = t.isEmpty() ? "" : ctx.getString(m.offline ? R.string.offline_as_of : R.string.as_of, t);
        }
        rv.setTextViewText(R.id.footer_text, foot);
        color(rv, ctx, R.id.footer_text, m.stale || m.offline ? R.color.mw_warn : R.color.mw_muted);
        show(rv, !compact, R.id.footer);
        return rv;
    }

    static int messageText(Model.Msg msg) {
        switch (msg) {
            case NO_KEY: return R.string.msg_no_key;
            case BAD_KEY: return R.string.msg_bad_key;
            case UNREACHABLE: return R.string.msg_unreachable;
            default: return R.string.msg_no_data;
        }
    }

    static String warningText(Context ctx, Model m) {
        switch (m.warn) {
            case EXPIRED: return ctx.getString(R.string.warn_expired);
            case EXPIRING: return ctx.getString(R.string.warn_expiring, m.bankDaysLeft);
            case FETCH_FAILED: return ctx.getString(R.string.warn_failed);
            default: return null;
        }
    }

    private static void show(RemoteViews rv, boolean visible, int... ids) {
        for (int id : ids) rv.setViewVisibility(id, visible ? View.VISIBLE : View.GONE);
    }

    /** Farbe als Ressource: ab Android 12 löst der Startbildschirm sie selbst auf (hell/dunkel wechselt mit). */
    private static void color(RemoteViews rv, Context ctx, int id, int colorRes) {
        if (Build.VERSION.SDK_INT >= 31) rv.setColorStateList(id, "setTextColor", colorRes);
        else rv.setTextColor(id, ctx.getColor(colorRes));
    }

    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    static PendingIntent openIntent(Context ctx, String url) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url + "/"));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, 1, i, FLAGS);
    }

    static PendingIntent setupIntent(Context ctx) {
        Intent i = new Intent(ctx, SetupActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, 2, i, FLAGS);
    }

    static PendingIntent refreshIntent(Context ctx) {
        Intent i = new Intent(ctx, MuenzwerkWidget.class).setAction(MuenzwerkWidget.ACTION_REFRESH);
        i.setComponent(new ComponentName(ctx, MuenzwerkWidget.class));
        return PendingIntent.getBroadcast(ctx, 3, i, FLAGS);
    }
}
