package io.github.vaitage.muenzwerk;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Adresse, Widget-Schlüssel und letzter Stand. Liegt im privaten Speicher der App
 * (andere Apps kommen nicht heran; Sicherung in die Cloud ist abgeschaltet).
 */
final class Store {
    private static final String FILE = "muenzwerk";
    private final SharedPreferences p;

    Store(Context ctx) {
        p = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    String url() { return p.getString("url", null); }
    String key() { return p.getString("key", null); }
    String cache() { return p.getString("cache", null); }

    void saveLogin(String url, String key) {
        // neue Adresse oder neuer Schlüssel: alten Stand nicht weiter zeigen
        p.edit().putString("url", url).putString("key", key).remove("cache").apply();
    }

    void saveCache(String json) { p.edit().putString("cache", json).apply(); }

    void clearKey() { p.edit().remove("key").remove("cache").apply(); }
}
