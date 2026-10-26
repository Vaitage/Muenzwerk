package io.github.vaitage.muenzwerk;

import android.content.Context;

import org.json.JSONObject;

import java.time.LocalDate;

/** Lädt die Zahlen (im Hintergrund aufrufen) und fällt bei Netzproblemen auf den letzten Stand zurück. */
final class Loader {
    private Loader() {}

    static final int TIMEOUT_MS = 8000;

    static Model load(Context ctx) {
        Store s = new Store(ctx);
        String url = s.url(), key = s.key();
        if (url == null || key == null) return Model.message(Model.Msg.NO_KEY);
        try {
            Api.Response r = Api.fetch(url, key, TIMEOUT_MS);
            if (r.status == 401) return Model.message(Model.Msg.BAD_KEY);
            if (r.status != 200) throw new Exception("HTTP " + r.status);
            JSONObject data = new JSONObject(r.body);
            s.saveCache(r.body);
            return Model.from(data, LocalDate.now(), false);
        } catch (Exception e) {
            return fromCache(s, true);
        }
    }

    /** Nur der gespeicherte Stand, ohne Netz (z. B. wenn das Widget seine Größe ändert). */
    static Model cached(Context ctx) {
        Store s = new Store(ctx);
        if (s.url() == null || s.key() == null) return Model.message(Model.Msg.NO_KEY);
        return fromCache(s, false);
    }

    private static Model fromCache(Store s, boolean offline) {
        String c = s.cache();
        if (c == null) return Model.message(offline ? Model.Msg.UNREACHABLE : Model.Msg.NO_DATA);
        try {
            return Model.from(new JSONObject(c), LocalDate.now(), offline);
        } catch (Exception e) {
            return Model.message(Model.Msg.NO_DATA);
        }
    }
}
