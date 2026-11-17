// Renderização da UI a partir do snapshot do bridge.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let lastChatSig = "";
  const minimap = new window.Minimap($("minimap"));

  function pct(cur, max) {
    if (!max) return 0;
    return Math.min(100, Math.max(0, (cur / max) * 100));
  }

  function setBar(fillId, txtId, cur, max) {
    $(fillId).style.width = pct(cur, max) + "%";
    $(txtId).textContent = cur.toLocaleString() + " / " + max.toLocaleString();
  }

  function renderPlayer(p) {
    if (!p) return;
    $("self-name").textContent = p.name;
    $("self-job").textContent = p.job || "?";
    $("self-level").textContent = "Lv " + p.level;
    setBar("self-hp-fill", "self-hp-txt", p.hp, p.maxHp);
    setBar("self-mp-fill", "self-mp-txt", p.mp, p.maxMp);

    if (p.mapCoords) {
      $("coords").textContent = p.mapCoords.x.toFixed(1) + ", " + p.mapCoords.y.toFixed(1);
      minimap.loadImage(state ? state.map && state.map.id : null);
      minimap.render(p.mapCoords);
    } else {
      $("coords").textContent = "--.--, --.--";
      minimap.render(null);
    }
  }

  function renderTarget(t) {
    if (!t) { $("target").classList.add("hidden"); return; }
    $("target").classList.remove("hidden");
    $("target-name").textContent = t.name + (t.job ? " (" + t.job + ")" : "");
    $("target-job").textContent = "T";
    const fill = $("target-hp-fill");
    fill.style.width = pct(t.hp, t.maxHp) + "%";
    $("target-hp-txt").textContent = (t.dead ? "DEAD" : t.hp.toLocaleString() + " / " + t.maxHp.toLocaleString());
  }

  function renderParty(list) {
    const ul = $("party-list");
    if (!list || list.length === 0) {
      ul.innerHTML = '<li class="dim" style="justify-content:center">sem party</li>';
      return;
    }
    ul.innerHTML = list.map((m) => {
      const p = pct(m.hp, m.maxHp);
      return '<li class="' + (m.online ? "" : "offline") + '">' +
        '<span class="jobchip">' + (m.job || "?") + "</span>" +
        '<span class="pname">' + escapeHtml(m.name) + "</span>" +
        '<span class="dim">' + m.level + "</span>" +
        '<div class="bar hp"><i style="width:' + p + '%"></i><b>' + Math.round(p) + "%</b></div>" +
        "</li>";
    }).join("");
  }

  function renderChat(list) {
    const box = $("chat-log");
    const sig = JSON.stringify(list && list.length ? list[list.length - 1] : null) + "|" + (list ? list.length : 0);
    if (sig === lastChatSig) return;
    lastChatSig = sig;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const info = window.channelInfo;
    box.innerHTML = (list || []).map((m) => {
      const ch = info(m.channel);
      const head = '<span class="' + ch.cls + '"><span class="ch-tag">[' + ch.name + "]</span> ";
      const sender = m.sender ? '<span class="ch-sender">' + escapeHtml(m.sender) + ":</span> " : "";
      return '<div class="line ' + ch.cls + '">' + head + sender + escapeHtml(m.text) + "</div>";
    }).join("");
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- envio de chat (T6) ----
  const CHAT_MAX = 500;
  // prefixo do comando -> XivChatType do eco local (Say=10, Party=14, LS1=16)
  const CHAT_CHANNELS = { "/say ": 10, "/p ": 14, "/ls1 ": 16 };
  let chatPrefix = "/say ";

  // unico helper de vibracao do app. Sem navegador/sem motor -> no-op silencioso.
  function haptic(ms) { if (navigator.vibrate) navigator.vibrate(ms); }
  window.haptic = haptic; // usado tambem por hotbar.js (tooltips de long-press)

  function chatEcho(channelId, text) {
    const box = $("chat-log");
    const ch = window.channelInfo(channelId);
    const cls = ch.cls || "";
    const div = document.createElement("div");
    div.className = "line " + cls;
    div.innerHTML = "<span class=\"" + cls + "\"><span class=\"ch-tag\">[" + ch.name + "]</span> </span>" +
      '<span class="dim">(você)</span> ' + escapeHtml(text);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  let chatStatusTimer = null;
  function chatStatus(msg) {
    const el = $("chat-status");
    if (!el) return;
    if (!msg) { el.textContent = ""; clearTimeout(chatStatusTimer); chatStatusTimer = null; return; }
    el.textContent = msg;
    clearTimeout(chatStatusTimer);
    chatStatusTimer = setTimeout(() => { el.textContent = ""; }, 2500);
  }

  function chatChannelId() { return CHAT_CHANNELS[chatPrefix] || 10; }

  function chatSend() {
    const input = $("chat-input");
    let text = String(input.value || "").replace(/\r\n|\r|\n/g, " ").trim();
    if (!text) { chatStatus("digite uma mensagem"); return; }
    if (text.length > CHAT_MAX) text = text.slice(0, CHAT_MAX);
    if (!(window.__txState && window.__txState.loggedIn)) { chatStatus("entre no jogo primeiro"); haptic(60); return; }
    if (window.__txDemo) { haptic(10); chatEcho(chatChannelId(), text); input.value = ""; chatStatus("enviado (demo)"); return; }
    const cmd = chatPrefix + text;
    fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "command", cmd: cmd }) })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) { haptic(10); chatEcho(chatChannelId(), text); input.value = ""; chatStatus("enviado"); }
        else { haptic(60); chatStatus("erro: " + (d.error || "?")); }
      })
      .catch(() => { haptic(60); chatStatus("sem conexão com o bridge"); });
  }

  let state = null;

  window.UI = {
    render(s) {
      state = s;
      window.__txState = s;
      const zone = s.zone ? s.zone.name : "—";
      $("zone-name").textContent = s.loggedIn ? zone : "sem personagem (não logado)";
      $("map-name").textContent = s.map ? s.map.name : "";
      renderPlayer(s.player);
      renderTarget(s.loggedIn ? s.target : null);
      renderParty(s.party);
      renderChat(s.chat);
    },
    setMode(mode) {
      const dot = $("conn-dot");
      dot.className = "dot " + (mode === "demo" ? "demo" : mode === "live" ? "on" : "off");
    },
  };

  // Eorzean clock
  setInterval(() => {
    const etSec = (Date.now() / 1000) * (86400 / 4200);
    const h = Math.floor(etSec / 3600) % 24;
    const m = Math.floor((etSec % 3600) / 60);
    $("et-clock").textContent = "ET " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }, 1000);

  // wiring da barra de envio de chat (ids estaticos em index.html, seguros capturar aqui)
  (function () {
    const seg = $("chat-seg");
    seg.querySelectorAll(".hb-seg-btn").forEach((bt) => {
      bt.onclick = function () {
        seg.querySelectorAll(".hb-seg-btn").forEach((b) => b.classList.remove("active"));
        this.classList.add("active");
        chatPrefix = this.dataset.prefix;
      };
    });
    $("chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter") chatSend(); });
    $("chat-send").onclick = chatSend;
  })();
})();
