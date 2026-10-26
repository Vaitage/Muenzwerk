package io.github.vaitage.muenzwerk;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Holt die Widget-Zahlen. Nur java.net, damit es auch ohne Gerät getestet werden kann. */
public final class Api {
    private Api() {}

    public static final class Response {
        public final int status;
        public final String body;
        Response(int status, String body) { this.status = status; this.body = body; }
    }

    /** Adresse aufräumen: Leerzeichen und Schrägstriche am Ende weg, „https://“ ergänzen. Null = ungültig. */
    public static String normalizeUrl(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (s.isEmpty()) return null;
        if (!s.contains("://")) s = "https://" + s;
        String lower = s.toLowerCase(Locale.ROOT);
        // Der Schlüssel geht im Klartext mit – nur verschlüsselt (localhost nur für Tests)
        if (!lower.startsWith("https://") && !lower.startsWith("http://127.0.0.1") && !lower.startsWith("http://localhost")) return null;
        try {
            URL u = new URL(s);
            if (u.getHost() == null || u.getHost().isEmpty()) return null;
            if (u.getQuery() != null || u.getRef() != null) return null;
        } catch (IOException e) {
            return null;
        }
        return s;
    }

    public static Response fetch(String baseUrl, String key, int timeoutMs) throws IOException {
        URL url = new URL(baseUrl + "/api/widget/data");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        try {
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
            c.setInstanceFollowRedirects(false);   // Schlüssel nie an eine andere Adresse weiterreichen
            c.setUseCaches(false);
            c.setRequestProperty("Authorization", "Bearer " + key);
            c.setRequestProperty("Accept", "application/json");
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Response(status, in == null ? "" : read(in, 256 * 1024));
        } finally {
            c.disconnect();
        }
    }

    private static String read(InputStream in, int limit) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > limit) throw new IOException("Antwort zu groß");
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
