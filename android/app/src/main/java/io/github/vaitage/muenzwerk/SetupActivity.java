package io.github.vaitage.muenzwerk;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import org.json.JSONObject;

import java.time.LocalDate;
import java.util.Locale;

/**
 * Einrichten: Adresse von Münzwerk + Widget-Schlüssel. Über den Link aus Münzwerk
 * (muenzwerk://setup?url=…&key=…) werden die Felder nur vorausgefüllt – gespeichert wird erst
 * nach Tippen auf „Speichern“, damit keine fremde Seite das Widget umleiten kann.
 */
public class SetupActivity extends Activity {

    private EditText url, key;
    private TextView status, fromLink;
    private Button save, open;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Store store;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_setup);
        store = new Store(this);
        url = findViewById(R.id.url);
        key = findViewById(R.id.key);
        status = findViewById(R.id.status);
        fromLink = findViewById(R.id.from_link);
        save = findViewById(R.id.save);
        open = findViewById(R.id.open);

        if (state == null) {
            if (store.url() != null) url.setText(store.url());
            if (store.key() != null) key.setText(store.key());
            if (store.url() != null && store.key() != null) status.setText(getString(R.string.setup_saved_url, host(store.url())));
        }
        fillFrom(getIntent());

        save.setOnClickListener(v -> saveAndTest());
        open.setOnClickListener(v -> {
            String u = store.url();
            if (u != null) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u + "/")));
        });
        open.setVisibility(store.url() != null ? View.VISIBLE : View.GONE);

        AppWidgetManager mgr = getSystemService(AppWidgetManager.class);
        Button pin = findViewById(R.id.pin);
        if (mgr != null && mgr.isRequestPinAppWidgetSupported()) {
            pin.setVisibility(View.VISIBLE);
            pin.setOnClickListener(v -> mgr.requestPinAppWidget(new ComponentName(this, MuenzwerkWidget.class), null, null));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        fillFrom(intent);
    }

    private void fillFrom(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"muenzwerk".equals(data.getScheme())) return;
        String u = data.getQueryParameter("url"), k = data.getQueryParameter("key");
        if (u != null) url.setText(u);
        if (k != null) key.setText(k);
        fromLink.setVisibility(View.VISIBLE);
        status.setText("");
    }

    private static String host(String u) {
        try { return Uri.parse(u).getHost(); } catch (Exception e) { return u; }
    }

    private void saveAndTest() {
        final String u = Api.normalizeUrl(url.getText().toString());
        final String k = key.getText().toString().trim();
        if (u == null) { status.setText(R.string.setup_bad_url); url.requestFocus(); return; }
        if (!k.startsWith("mw_") || k.length() < 12) { status.setText(R.string.setup_bad_key); key.requestFocus(); return; }
        url.setText(u);
        status.setText(R.string.setup_testing);
        save.setEnabled(false);
        new Thread(() -> {
            String msg;
            try {
                Api.Response r = Api.fetch(u, k, Loader.TIMEOUT_MS);
                if (r.status == 401) msg = getString(R.string.setup_rejected);
                else if (r.status != 200) msg = getString(R.string.setup_unreachable, "HTTP " + r.status);
                else {
                    Model m = Model.from(new JSONObject(r.body), LocalDate.now(), false);
                    store.saveLogin(u, k);
                    store.saveCache(r.body);
                    MuenzwerkWidget.refreshAll(this);
                    Locale locale = getResources().getConfiguration().getLocales().get(0);
                    msg = m.msg == Model.Msg.NONE ? getString(R.string.setup_ok, Fmt.euro(m.leftCents, locale)) : getString(R.string.setup_ok_nodata);
                }
            } catch (Exception e) {
                String why = e.getClass().getSimpleName();
                msg = getString(R.string.setup_unreachable, why);
            }
            final String text = msg;
            main.post(() -> {
                status.setText(text);
                save.setEnabled(true);
                fromLink.setVisibility(View.GONE);
                open.setVisibility(store.url() != null ? View.VISIBLE : View.GONE);
            });
        }, "muenzwerk-setup").start();
    }
}
