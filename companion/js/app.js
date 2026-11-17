// Controle: conexão WebSocket, abas, settings, demo.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  // canal de erro p/ logcat via ThorNative (APK) — exceções nunca ficam mudas no Thor
  window.jserr = function (tag, e) {
    var m = tag + ": " + (e && (e.stack || e.message) ? (e.stack || e.message) : String(e));
    if (window.ThorNative && window.ThorNative.log) { try { window.ThorNative.log(m); } catch (x) { /* noop */ } }
    if (window.console && console.warn) console.warn(m);
  };
  window.addEventListener("error", function (ev) { window.jserr("window.onerror", ev.error || ev.message); });
  window.addEventListener("unhandledrejection", function (ev) { window.jserr("unhandledrejection", ev.reason); });


  const settings = {
    wsUrl: localStorage.getItem("wsUrl") || "",   // vazio = mesma origem
    demo: localStorage.getItem("demo") === "1",
  };
  // força demo via query string (usado pelo APK quando o PC está offline)
  if (typeof location !== "undefined" && /[?&]demo\b/.test(location.search)) {
    settings.demo = true;
    try { localStorage.setItem("demo", "1"); } catch (e) { /* noop */ }
  }

  // T2/M7 split: estado salvo aplica no boot, antes de WS/timers
  if (window.__txSplit) window.__txSplit.apply(localStorage.getItem("split.v1") === "1");

  let ws = null;
  let demoTimer = null;
  let backoff = 1000;
  let wantLive = true;

  function currentWsUrl() {
    if (settings.wsUrl) return settings.wsUrl;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + "/ws";
  }

  function connect() {
    if (!wantLive) return;
    try { ws && ws.close(); } catch (e) { /* noop */ }
    const url = currentWsUrl();
    ws = new WebSocket(url);
    ws.onopen = () => { backoff = 1000; window.UI.setMode("live"); };
    ws.onmessage = (ev) => {
      try {
        const s = JSON.parse(ev.data);
        if (s.type === "state") window.UI.render(s);
      } catch (e) { /* ignore malformed */ }
    };
    ws.onclose = () => {
      window.UI.setMode("off");
      if (!wantLive || settings.demo) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10000);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* noop */ } };
  }

  function startDemo() {
    window.UI.setMode("demo");
    demoTimer = setInterval(() => window.UI.render(window.demoStep()), 200);
  }

  function stopDemo() {
    clearInterval(demoTimer);
    demoTimer = null;
  }

  function applyMode() {
    window.__txDemo = settings.demo;
    if (settings.demo) {
      wantLive = false;
      try { ws && ws.close(); } catch (e) { /* noop */ }
      stopDemo();
      startDemo();
    } else {
      wantLive = true;
      stopDemo();
      connect();
    }
    renderSettings();
  }

  // ---- tabs ----
  document.querySelectorAll("#tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      $("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ---- settings tab ----
  function renderSettings() {
    $("settings-content").innerHTML = `
      <label>Endpoint WebSocket (deixe vazio p/ mesma origem do bridge)</label>
      <input id="set-ws" type="text" placeholder="ws://192.168.15.x:11436/ws" value="${settings.wsUrl || ""}">
      <label style="display:flex;align-items:center;gap:8px;margin-top:14px">
        <input id="set-demo" type="checkbox" style="width:auto" ${settings.demo ? "checked" : ""}>
        Modo demo (dados simulados, sem jogo)
      </label>
      <button id="set-save">Salvar & reconectar</button>
      <div class="status">atual: ${settings.demo ? "demo" : currentWsUrl()}</div>`;
    $("set-save").addEventListener("click", () => {
      settings.wsUrl = $("set-ws").value.trim();
      settings.demo = $("set-demo").checked;
      localStorage.setItem("wsUrl", settings.wsUrl);
      localStorage.setItem("demo", settings.demo ? "1" : "0");
      applyMode();
    });
  }

  renderSettings();
  applyMode();

  // --- foco de teclado do sistema (APK apenas; no navegador window.ThorNative não existe) ---
  if (window.ThorNative) {
    window.__txNative = true;
    function isTextTarget(el) {
      return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    }
    document.addEventListener("focusin", function (e) {
      if (isTextTarget(e.target)) window.ThorNative.requestTextFocus();
    });
    document.addEventListener("focusout", function (e) {
      if (isTextTarget(e.target)) window.ThorNative.releaseTextFocus();
    });
  }
})();
