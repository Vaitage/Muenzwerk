package io.github.vaitage.muenzwerk;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/**
 * Das Widget. Android ruft onUpdate etwa alle 30 Minuten (updatePeriodMillis); Antippen der Uhrzeit
 * lädt sofort neu. Geladen wird im Hintergrund (goAsync), höchstens ein paar Sekunden.
 */
public class MuenzwerkWidget extends AppWidgetProvider {

    static final String ACTION_REFRESH = "io.github.vaitage.muenzwerk.REFRESH";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        refresh(ctx, mgr, ids);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle opts) {
        // Größe geändert: mit dem letzten Stand neu zeichnen, ohne Netz
        int[] s = Renderer.size(opts);
        mgr.updateAppWidget(id, Renderer.build(ctx, Loader.cached(ctx), s[0], s[1]));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            refresh(ctx, mgr, mgr.getAppWidgetIds(new ComponentName(ctx, MuenzwerkWidget.class)));
            return;
        }
        super.onReceive(ctx, intent);
    }

    private void refresh(Context ctx, AppWidgetManager mgr, int[] ids) {
        if (ids == null || ids.length == 0) return;
        final PendingResult pending = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                Model m = Loader.load(app);
                for (int id : ids) {
                    int[] s = Renderer.size(mgr.getAppWidgetOptions(id));
                    mgr.updateAppWidget(id, Renderer.build(app, m, s[0], s[1]));
                }
            } finally {
                pending.finish();
            }
        }, "muenzwerk-widget").start();
    }

    /** Alle Widgets neu laden (nach dem Einrichten). */
    static void refreshAll(Context ctx) {
        Intent i = new Intent(ctx, MuenzwerkWidget.class).setAction(ACTION_REFRESH);
        ctx.sendBroadcast(i);
    }
}
