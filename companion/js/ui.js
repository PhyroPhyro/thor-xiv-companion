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
})();
