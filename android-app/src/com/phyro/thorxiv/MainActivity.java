package com.phyro.thorxiv;

import android.app.Activity;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.util.DisplayMetrics;
import android.view.Display;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Companion do FFXIV na tela inferior do AYN Thor.
 * 1) Move a própria janela para a segunda tela (presentation display).
 * 2) Se houver bridge salvo e vivo, abre a PWA direto; senão mostra a tela de descoberta.
 */
public class MainActivity extends Activity {

    static final String PREFS = "thorxiv";
    static final String KEY_LAST = "lastUrl";
    static final String PICKER = "file:///android_asset/picker.html";

    private WebView web;
    private Discovery discovery;
    private final Handler main = new Handler(android.os.Looper.getMainLooper());
    private android.content.SharedPreferences prefs;
    private volatile String activeUrl = null;
    private boolean probing = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (!relocateToSecondScreen()) return; // atividade reiniciada na tela de baixo

        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        discovery = new Discovery(this);

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return false;
            }

            @Override
            public void onReceivedError(WebView v, android.webkit.WebResourceRequest r,
                                        android.webkit.WebResourceError e) {
                if (r.isForMainFrame() && activeUrl != null) {
                    main.post(() -> {
                        Toast.makeText(MainActivity.this, "bridge perdido", Toast.LENGTH_SHORT).show();
                        showPicker();
                    });
                }
            }
        });
        web.addJavascriptInterface(new NativeApi(), "ThorNative");
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        discovery.startNsd();
        String last = prefs.getString(KEY_LAST, "");
        if (!last.isEmpty()) {
            discovery.testAlive(last, alive -> {
                if (alive) main.post(() -> openEndpoint(last));
                else main.post(this::loadInitialPicker);
            });
        } else {
            loadInitialPicker();
        }
    }

    private void loadInitialPicker() {
        web.loadUrl(PICKER);
        main.postDelayed(() -> {
            if (activeUrl == null) discovery.scan(0);
        }, 300);
    }

    /** Retorna false quando a atividade vai se reiniciar na segunda tela (finish já chamado). */
    private boolean relocateToSecondScreen() {
        boolean asked = getIntent().hasExtra("on-secondary");
        Display[] pres = ((DisplayManager) getSystemService(Context.DISPLAY_SERVICE))
                .getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        if (pres == null || pres.length == 0) return true; // sem segunda tela: roda normal
        long id = pres[0].getDisplayId();
        if (getDisplay().getDisplayId() == id) return true;
        if (asked) return true; // já tentou, não entra em loop
        android.app.ActivityOptions opts = android.app.ActivityOptions.makeBasic();
        opts.setLaunchDisplayId((int) id);
        startActivity(getIntent().putExtra("on-secondary", true), opts.toBundle());
        finish();
        return false;
    }

    private void showPicker() {
        activeUrl = null;
        web.loadUrl(PICKER);
    }

    private void openEndpoint(String url) {
        activeUrl = url;
        prefs.edit().putString(KEY_LAST, url).apply();
        web.loadUrl(url);
        startProbing();
    }

    private void startProbing() {
        if (probing) return;
        probing = true;
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (activeUrl == null) { probing = false; return; }
                discovery.testAlive(activeUrl, alive -> {
                    if (!alive) main.post(() -> showPicker());
                    else main.postDelayed(this, 4000);
                });
            }
        }, 4000);
    }

    @Override
    protected void onDestroy() {
        discovery.stop();
        super.onDestroy();
    }

    /** Objetos expostos ao picker.html. */
    private class NativeApi {

        @android.webkit.JavascriptInterface
        public String getState() {
            return discovery.stateJson();
        }

        @android.webkit.JavascriptInterface
        public void scan() {
            discovery.scan(0);
        }

        @android.webkit.JavascriptInterface
        public void open(String url) {
            main.post(() -> openEndpoint(url));
        }

        @android.webkit.JavascriptInterface
        public void openDemo() {
            main.post(() -> {
                activeUrl = "demo";
                web.loadUrl("file:///android_asset/companion/index.html?demo=1");
            });
        }
    }
}
