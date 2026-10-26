package io.github.vaitage.muenzwerk;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class ApiTest {
    private ServerSocket server;
    private String base;
    private volatile String seenAuth;

    /** Winziger HTTP-Server (com.sun.net.httpserver gibt es in Android-Tests nicht). */
    @Before public void start() throws Exception {
        server = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        base = "http://127.0.0.1:" + server.getLocalPort();
        Thread t = new Thread(() -> {
            while (!server.isClosed()) {
                try (Socket s = server.accept()) {
                    BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                    String first = in.readLine();
                    String auth = null, line;
                    while ((line = in.readLine()) != null && !line.isEmpty()) {
                        if (line.toLowerCase().startsWith("authorization:")) auth = line.substring(14).trim();
                    }
                    seenAuth = auth;
                    String resp;
                    if (first != null && first.startsWith("GET /umleitung/")) {
                        resp = "HTTP/1.1 302 Found\r\nLocation: https://example.org/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    } else {
                        boolean ok = "Bearer mw_richtig_123".equals(auth);
                        String body = ok ? "{\"snapshot\":null}" : "{\"detail\":\"Widget-Schlüssel ungültig.\"}";
                        byte[] b = body.getBytes(StandardCharsets.UTF_8);
                        resp = "HTTP/1.1 " + (ok ? "200 OK" : "401 Unauthorized") + "\r\nContent-Type: application/json\r\nContent-Length: "
                                + b.length + "\r\nConnection: close\r\n\r\n" + body;
                    }
                    OutputStream out = s.getOutputStream();
                    out.write(resp.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                } catch (Exception e) {
                    // Server wird beendet
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    @After public void stop() throws Exception { server.close(); }

    @Test public void schicktSchluesselAlsBearer() throws Exception {
        Api.Response r = Api.fetch(base, "mw_richtig_123", 3000);
        assertEquals(200, r.status);
        assertEquals("{\"snapshot\":null}", r.body);
        assertEquals("Bearer mw_richtig_123", seenAuth);
    }

    @Test public void falscherSchluessel401() throws Exception {
        assertEquals(401, Api.fetch(base, "mw_falsch_123", 3000).status);
    }

    @Test public void folgtKeinerUmleitung() throws Exception {
        assertEquals(302, Api.fetch(base + "/umleitung", "mw_richtig_123", 3000).status);
    }

    @Test public void adresseAufraeumen() {
        assertEquals("https://mw.example.ts.net", Api.normalizeUrl(" mw.example.ts.net/ "));
        assertEquals("https://mw.example.ts.net:8443", Api.normalizeUrl("https://mw.example.ts.net:8443//"));
        assertNull(Api.normalizeUrl("http://mw.example.ts.net"));          // kein Klartext
        assertNull(Api.normalizeUrl("https://mw.example.ts.net/?x=1"));
        assertNull(Api.normalizeUrl(""));
        assertNull(Api.normalizeUrl(null));
        assertEquals("http://127.0.0.1:8000", Api.normalizeUrl("http://127.0.0.1:8000"));
    }
}
