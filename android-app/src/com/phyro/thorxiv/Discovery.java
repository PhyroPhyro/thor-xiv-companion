package com.phyro.thorxiv;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import java.net.Inet4Address;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Descoberta do bridge ThorXivBridge na LAN:
 *  - mDNS (NsdManager) browse _thorxiv._tcp (quando o plugin anuncia);
 *  - varredura TCP /24 na porta configurada, em paralelo, com timeout curto.
 */
public class Discovery {

    public static final class Host {
        public final String ip;
        public final int port;
        public final String name;
        public volatile boolean alive;

        Host(String ip, int port, String name) {
            this.ip = ip;
            this.port = port;
            this.name = name;
        }

        public String url() {
            return "http://" + ip + ":" + port;
        }
    }

    private static final String SERVICE_TYPE = "_thorxiv._tcp.";
    private static final int DEFAULT_PORT = 11436;
    private static final int SCAN_TIMEOUT_MS = 350;
    private static final int SCAN_THREADS = 48;

    private final Context ctx;
    private final List<Host> hosts = Collections.synchronizedList(new ArrayList<>());
    private final ExecutorService pool = Executors.newFixedThreadPool(SCAN_THREADS);
    private final AtomicInteger scanning = new AtomicInteger(0);
    private NsdManager nsd;
    private NsdManager.DiscoveryListener nsdListener;

    public Discovery(Context ctx) {
        this.ctx = ctx;
    }

    public int configuredPort() {
        return ctx.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
                .getInt("port", DEFAULT_PORT);
    }

    // ---------- mDNS ----------

    public void startNsd() {
        try {
            nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
            nsdListener = new NsdManager.DiscoveryListener() {
                @Override
                public void onStartDiscoveryFailed(String s, int i) { }

                @Override
                public void onStopDiscoveryFailed(String s, int i) { }

                @Override
                public void onDiscoveryStarted(String s) { }

                @Override
                public void onDiscoveryStopped(String s) { }

                @Override
                public void onServiceFound(NsdServiceInfo info) {
                    nsd.resolveService(info, new NsdManager.ResolveListener() {
                        @Override
                        public void onResolveFailed(NsdServiceInfo i2, int e) { }

                        @Override
                        public void onServiceResolved(NsdServiceInfo i2) {
                            String host = i2.getHost() != null ? i2.getHost().getHostAddress() : null;
                            if (host != null) addHost(host, i2.getPort(), i2.getServiceName(), true);
                        }
                    });
                }

                @Override
                public void onServiceLost(NsdServiceInfo info) { }
            };
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, nsdListener);
        } catch (Exception e) {
            // sem mDNS: a varredura cobre
        }
    }

    // ---------- scan /24 ----------

    public void scan(int ignored) {
        Set<String> subnets = localSubnets();
        if (subnets.isEmpty()) {
            subnets.add(guessSubnetFromPrefs());
        }
        int port = configuredPort();
        List<String> targets = new ArrayList<>();
        for (String base : subnets) {
            for (int i = 1; i <= 254; i++) targets.add(base + i);
        }
        scanning.incrementAndGet();
        AtomicInteger pending = new AtomicInteger(targets.size());
        for (String ip : targets) {
            pool.execute(() -> {
                boolean alive = probe(ip, port);
                if (alive) addHost(ip, port, "", true);
                if (pending.decrementAndGet() == 0) scanning.decrementAndGet();
            });
        }
    }

    private Set<String> localSubnets() {
        Set<String> out = new LinkedHashSet<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (ia.getAddress() instanceof Inet4Address) {
                        String a = ia.getAddress().getHostAddress(); // w.x.y.z
                        if (a.startsWith("169.254.")) continue;
                        int dot = a.lastIndexOf('.');
                        out.add(a.substring(0, dot + 1));
                    }
                }
            }
        } catch (Exception e) { /* vazio */ }
        return out;
    }

    private String guessSubnetFromPrefs() {
        String last = ctx.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
                .getString(MainActivity.KEY_LAST, "");
        int h1 = last.indexOf("//");
        int h2 = last.indexOf(':', h1 + 2);
        if (h1 >= 0 && h2 > h1) {
            String host = last.substring(h1 + 2, h2);
            int dot = host.lastIndexOf('.');
            if (dot > 0) return host.substring(0, dot + 1);
        }
        return "192.168.15.";
    }

    private static boolean probe(String ip, int port) {
        try (Socket s = new Socket()) {
            s.connect(new java.net.InetSocketAddress(ip, port), SCAN_TIMEOUT_MS);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public void testAlive(String url, AliveCallback cb) {
        String host = extractHost(url);
        int port = extractPort(url);
        if (host == null) {
            cb.onResult(false);
            return;
        }
        pool.execute(() -> cb.onResult(probe(host, port)));
    }

    public interface AliveCallback {
        void onResult(boolean alive);
    }

    static String extractHost(String url) {
        try {
            String s = url.replaceFirst("^https?://", "");
            int slash = s.indexOf('/');
            if (slash >= 0) s = s.substring(0, slash);
            int colon = s.indexOf(':');
            return colon > 0 ? s.substring(0, colon) : s;
        } catch (Exception e) {
            return null;
        }
    }

    static int extractPort(String url) {
        try {
            String s = url.replaceFirst("^https?://", "");
            int colon = s.indexOf(':');
            if (colon < 0) return 80;
            String p = s.substring(colon + 1);
            int slash = p.indexOf('/');
            if (slash >= 0) p = p.substring(0, slash);
            return Integer.parseInt(p.trim());
        } catch (Exception e) {
            return 80;
        }
    }

    private void addHost(String ip, int port, String name, boolean alive) {
        synchronized (hosts) {
            for (Host h : hosts) {
                if (h.ip.equals(ip) && h.port == port) {
                    h.alive = alive;
                    return;
                }
            }
            hosts.add(new Host(ip, port, name == null ? "" : name));
            hosts.get(hosts.size() - 1).alive = alive;
        }
    }

    public String stateJson() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"scanning\":").append(scanning.get() > 0 ? "true" : "false");
        sb.append(",\"port\":").append(configuredPort());
        sb.append(",\"hosts\":[");
        synchronized (hosts) {
            for (int i = 0; i < hosts.size(); i++) {
                Host h = hosts.get(i);
                if (i > 0) sb.append(',');
                sb.append("{\"url\":\"").append(h.url()).append("\"");
                sb.append(",\"name\":\"").append(esc(h.name)).append("\"");
                sb.append(",\"alive\":").append(h.alive ? "true" : "false");
                sb.append('}');
            }
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public void stop() {
        try {
            if (nsd != null && nsdListener != null) nsd.stopServiceDiscovery(nsdListener);
        } catch (Exception e) { /* noop */ }
        pool.shutdownNow();
    }
}
