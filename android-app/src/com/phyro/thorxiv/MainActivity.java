package com.phyro.thorxiv;

import android.app.Activity;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
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

            @Override
            public void onPageFinished(WebView v, String url) {
                // picker precisa de foco de teclado (digita IP); páginas do companheiro não.
                if (PICKER.equals(url)) setInputFocusable(true);
                else setInputFocusable(false);
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
        setInputFocusable(true); // picker precisa digitar endereço
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
        setInputFocusable(true);
    }

    private void openEndpoint(String url) {
        activeUrl = url;
        prefs.edit().putString(KEY_LAST, url).apply();
        web.loadUrl(url);
        setInputFocusable(false); // companheiro não rouba foco do jogo (tela de cima)
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

    /**
     * Janela da tela de baixo com ou sem foco de input.
     * true (picker/chat): recebe foco para abrir o IME. false (companheiro): a janela não rouba
     * foco do jogo na tela de cima; gamepad/teclado seguem para o FFXIV. Touch continua funcionando.
     */
    private void setInputFocusable(boolean on) {
        runOnUiThread(() -> {
            if (on) {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
            } else {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
            }
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        int source = event.getSource();
        // SOURCE_KEYBOARD=0x1, SOURCE_JOYSTICK=0x10, SOURCE_GAMEPAD=0x20 (ausentes deste android.jar)
        boolean fromController = (source & (0x1 | 0x10 | 0x20)) != 0;
        // KEYCODE_BUTTON_A..Z existem neste jar (BUTTON_T não); gaps entre elas nunca ocorrem de fato
        boolean isGamepadKey = (keyCode >= KeyEvent.KEYCODE_BUTTON_A && keyCode <= KeyEvent.KEYCODE_BUTTON_Z)
                || keyCode == KeyEvent.KEYCODE_DPAD_CENTER;
        boolean isCompanion = activeUrl != null && !PICKER.equals(activeUrl);
        if (fromController && isGamepadKey
                && keyCode != KeyEvent.KEYCODE_BACK
                && keyCode != KeyEvent.KEYCODE_VOLUME_UP
                && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN
                && isCompanion) {
            return true; // consome a tecla: o jogo de cima fica com o controle; UI do Thor opera por touch
        }
        return super.onKeyDown(keyCode, event);
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
                setInputFocusable(false); // fallback demo também é companheiro
            });
        }

        @android.webkit.JavascriptInterface
        public void requestTextFocus() {
            runOnUiThread(() -> setInputFocusable(true));
        }

        @android.webkit.JavascriptInterface
        public void releaseTextFocus() {
            runOnUiThread(() -> {
                // esconde o IME antes de soltar o foco da janela
                InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                imm.hideSoftInputFromWindow(web.getWindowToken(), 0);
                setInputFocusable(false);
            });
        }
    }
}
