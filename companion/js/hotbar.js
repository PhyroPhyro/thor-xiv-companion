// Hotbar touch (T2/M1): grid 3x3/4x3/4x2, drag & drop entre slots só em editMode,
// tooltips de slot e execução de comandos/skills/sequências nativas no jogo.
// POST /api/command aceita APENAS type command|skill|sequence — Telesto foi removido.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KEY = "hotbar.v1";          // legado v1 (array plano): somente leitura após a migração — não apagar
  const JOBS_KEY = "hotbar.jobs.v2";// { "<jobId>": {slots:[...12], preset}, "0": {...} }
  const GRID_KEY = "hotbar.grid.v1";// preset global: default de buckets novos e usado na migração
  const MAX_SLOTS = 12; // maior preset (4x3); slots além do grade atual ficam preservados na memória
  const PRESETS = {
    "3x3": { c: 3, r: 3, label: "3×3", n: 9 },
    "4x2": { c: 4, r: 2, label: "4×2", n: 8 },
    "4x3": { c: 4, r: 3, label: "4×3", n: 12 },
  };

  const wrap = $("hotbar-wrap");
  let grid = null; // criado dentro de build(); NUNCA capturar em cima elemento de innerHTML

  let slots = new Array(MAX_SLOTS).fill(null); // slots do bucket em uso agora
  let editMode = false;
  let editIdx = -1;
  let selSkill = null;
  let blockClick = false;
  let ttOpen = false;
  let ttTimer = null;
  let ttSuppressUntil = 0; // bloqueia a ação do toque que fecha o tooltip
  let toastTimer = null;

  // cooldown real (M2): último valor renderizado por slot p/ evitar toque desnecessário no DOM
  const cdLast = new Map(); // idx => { pct: number, active: boolean }

  // buckets por job: chave = String(player.jobId) ou "0" (sem login / job indisponível)
  const buckets = new Map();
  let currentJobKey = "0"; // chave do bucket em uso agora
  let gridPreset = "4x3";  // preset do bucket em uso agora
  let jobsReady = false;   // migração v1 -> v2 já executada (ou nada para migrar)
  let lastJobKey = null;   // última chave vista (detecta troca de job)

  const TOOLTIP_MS = 400; // long-press parado antes de mostrar o tooltip (fora do editMode)
  const DRAG_THRESHOLD = 8; // px de movimento p/ iniciar arraste (só em editMode)

  // Uma interação ativa por vez (press/tooltip/arraste/tap)
  let pi = null; // {idx, el, s, x, y, armed, holdArmed, moved, tooltipShown, dragging, src, ghost, overEl, timer, touchId}

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(d))
        // Telesto foi removido: descarta slots de macro antigos
        return padToMax(d.map((s) => s && (s.kind === "command" || s.kind === "skill" || s.kind === "sequence") ? s : null));
    } catch (e) { /* noop */ }
    return new Array(MAX_SLOTS).fill(null);
  }
  function padToMax(d) {
    const a = d.slice(0, MAX_SLOTS);
    while (a.length < MAX_SLOTS) a.push(null);
    return a;
  }
  // ---------- storage v2 (por job) ----------
  // Chave do bucket: String(player.jobId) quando houver job de classe real (> 0),
  // caso contrario "0" (geral: sem login, personagem sem classe ou job indisponível).
  function jobKeyOf(state) {
    const p = state && state.player;
    const jid = p && typeof p.jobId === "number" ? p.jobId : null;
    return (jid != null && jid > 0) ? String(jid) : "0";
  }
  function loadJobs() {
    try {
      const o = JSON.parse(localStorage.getItem(JOBS_KEY) || "null");
      if (o && typeof o === "object" && !Array.isArray(o))
        return new Map(Object.entries(o));
    } catch (e) { /* noop */ }
    return new Map();
  }
  function saveJobs() {
    localStorage.setItem(JOBS_KEY, JSON.stringify(Object.fromEntries(buckets)));
  }
  function bucketOf(key) {
    const b = buckets.get(key);
    return b && Array.isArray(b.slots) ? b : null;
  }
  function defaultPreset() {
    const g = localStorage.getItem(GRID_KEY);
    return PRESETS[g] ? g : "4x3";
  }
  function enterBucket(key) {
    // posiciona slots/preset do bucket `key` como estado atual (cria vazio se inexistente)
    const b = bucketOf(key);
    if (b) {
      slots = padToMax(b.slots.slice());
      gridPreset = b.preset && PRESETS[b.preset] ? b.preset : defaultPreset();
    } else {
      slots = new Array(MAX_SLOTS).fill(null);
      gridPreset = defaultPreset();
    }
    buckets.set(key, { slots: padToMax(slots.slice()), preset: gridPreset });
    currentJobKey = key;
  }
  function persistCurrent() {
    // grava o bucket em uso no disco (chamado antes de trocar de job e a cada edição)
    buckets.set(currentJobKey, { slots: padToMax(slots.slice()), preset: gridPreset });
    saveJobs();
  }
  function save() {
    persistCurrent(); // hotbar.v1 agora e read-only (ja foi copiado na migracao)
  }
  // migração única: hotbar.v1 (array plano) copia para o bucket do job atual,
  // ou para "0" quando o jobId ainda nao e conhecido. hotbar.v1 nao e apagado.
  function migrateV1(state) {
    if (jobsReady || buckets.size > 0) return;
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(d)) {
        const slotsV1 = padToMax(d.map((s) => s && (s.kind === "command" || s.kind === "skill" || s.kind === "sequence") ? s : null));
        buckets.set(jobKeyOf(state), { slots: slotsV1, preset: defaultPreset() });
        saveJobs();
      }
    } catch (e) { /* noop */ }
    jobsReady = true;
  }
  function gridTotal() { const p = PRESETS[gridPreset]; return p.c * p.r; }

  function skillIconUrl(icon) {
    const n = String(icon | 0).padStart(6, "0"); // 6 dígitos
    return `https://xivapi.com/i/${n.slice(0, 3)}000/${n}.png`; // https://xivapi.com/i/006000/006273.png
  }

  function build() {
    wrap.innerHTML = `
      <div id="hotbar-grid"></div>
      <button id="hb-gear" type="button" aria-label="Ferramentas da hotbar">⚙️</button>
      <button id="hb-split" type="button" aria-label="Unir/separar mapa">◫</button>
      <div id="hb-toast" class="hidden"></div>
      <div id="hb-editor" class="hidden"></div>
      <div id="hb-confirm" class="hidden"></div>
      <div id="hb-tooltip" class="hidden">
        <div class="hb-tooltip-card">
          <div id="hb-tt-name" class="hb-tt-name"></div>
          <div id="hb-tt-desc" class="hb-tt-desc hidden"></div>
          <div id="hb-tt-id" class="hb-tt-id"></div>
        </div>
      </div>`;
    grid = $("hotbar-grid");
    renderGrid();
    $("hb-gear").onclick = openTools;
    $("hb-split").onclick = toggleSplit;

    // reconhecedor global de move/up (segue o dedo mesmo saindo do elemento do slot)
    document.addEventListener("pointermove", onGlobalMove);
    document.addEventListener("pointerup", onGlobalUp);
    document.addEventListener("pointercancel", onGlobalUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchCancel);

    // WebView: long-press não pode abrir o menu de contexto do navegador (mata o drag)
    wrap.addEventListener("contextmenu", (e) => e.preventDefault());

    // toque em qualquer lugar fecha o tooltip; o toque que fecha NÃO dispara a ação do elemento tocado (FFXIV)
    document.addEventListener("pointerdown", (e) => {
      if (!ttOpen) return;
      hideTooltip();
      ttSuppressUntil = Date.now() + 600;
    }, true);
  }

  function renderGrid() {
    grid.innerHTML = ""; // sempre limpa: renderGrid re-renderiza do zero (não acumula)
    const p = PRESETS[gridPreset];
    grid.style.gridTemplateColumns = `repeat(${p.c}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${p.r}, 1fr)`;
    grid.className = editMode ? "editing" : "";
    const total = gridTotal();
    for (let i = 0; i < total; i++) {
      const s = slots[i];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hb-slot" + (s ? "" : " empty");
      b.dataset.index = i;
      const cdHtml = s && s.kind === "skill"
        ? `<div class="hb-cd hidden"><div class="hb-cd-fill"></div><div class="hb-cd-txt"></div></div>`
        : "";
      b.innerHTML = s
        ? `<span class="hb-ico-wrap">${slotIconHtml(s)}</span><span class="hb-name">${esc(s.name || "slot")}</span>${cdHtml}`
        : `<span class="hb-ico empty">+</span>`;
      setupSlot(b, s, i);
      grid.appendChild(b);
    }
  }

  function slotIconHtml(s) {
    if (s.kind === "skill" && s.actionIcon != null) {
      const url = skillIconUrl(s.actionIcon);
      return `<img class="hb-ico-img" src="${url}" onerror="this.closest('.hb-ico-wrap').classList.add('ico-bad')"><span class="hb-ico hb-ico-fb">${esc(s.icon || "✦")}</span>`;
    }
    return `<span class="hb-ico">${esc(s.icon || (s.kind === "skill" ? "✦" : "#"))}</span>`;
  }

  // ---- tooltip (único, reutilizável) ----
  // long-press 400ms abre; fica ABERTO até a tela ser tocada de novo (sem auto-fecho).
  // desktop: hover abre, mouseleave fecha.
  function showTooltip(name, desc, idLine) {
    const tt = $("hb-tooltip");
    const nameEl = $("hb-tt-name"), descEl = $("hb-tt-desc"), idEl = $("hb-tt-id");
    nameEl.textContent = esc(name || "");
    if (desc) { descEl.textContent = esc(desc); descEl.classList.remove("hidden"); }
    else descEl.classList.add("hidden");
    idEl.textContent = idLine || "";
    if (tt) tt.classList.remove("hidden");
    ttOpen = true;
    window.haptic?.(15); // longa: abertura de tooltip por long-press
    clearTimeout(ttTimer); ttTimer = null; // sem auto-fechamento
  }
  function hideTooltip() { clearTimeout(ttTimer); ttTimer = null; const tt = $("hb-tooltip"); if (tt) tt.classList.add("hidden"); ttOpen = false; }

  function showSlotTooltip(s) {
    let name = s.name || "", desc = "", idLine = "";
    if (s.kind === "skill") {
      idLine = "Action ID: " + s.actionId;
      const cat = catalogItem(s.actionId);
      if (cat) { desc = cat.desc || ""; if (!s.name) name = cat.name; }
    }
    showTooltip(name, desc, idLine);
  }

  // ---- reconhecedor de press do slot ----
  // TOUCH (WebView/Thor): segurar 400ms parado em slot preenchido -> tooltip (ambos os modos).
  // Mover alem de TOUCH_SLOP(16px): editMode+cheio -> drag imediato (tooltip aberto cede lugar);
  // demais casos -> nada (a aba nao rola). Tap curto (<=slop) -> editMode? openEditor : executar.
  // Jitter de dedo NUNCA engole o tap (limite generoso + rede de seguranca no touchend).
  // MOUSE (pointer events): fluxo atual (drag por movimento > 8px em editMode; tooltip com hold fora do editMode).
  const TOUCH_SLOP = 16; // px: abaixo do jitter real de dedo em tela capacitiva
  function setupSlot(b, s, i) {
    b.addEventListener("touchstart", (ev) => startTouch(ev, b, s, i), { passive: true });
    b.addEventListener("pointerdown", (ev) => { if (ev.pointerType === "mouse") startPress(ev, b, s, i); });
    b.addEventListener("pointercancel", () => { if (pi && !pi.touch) cancelPress(); });
    b.addEventListener("click", (ev) => { if (blockClick) { ev.stopImmediatePropagation(); blockClick = false; } });
  }

  function makePi(i, el, s, x, y, isTouch) {
    return { idx: i, el, s, x, y, touch: isTouch, armed: false, holdArmed: false, moved: false, tooltipShown: false, dragging: false, src: -1, ghost: null, overEl: null, timer: null, touchId: null };
  }

  function startPress(ev, b, s, i) { // mouse
    if (Date.now() < ttSuppressUntil) return;
    if (ev.button !== 0) return;
    cancelPress();
    pi = makePi(i, b, s, ev.clientX, ev.clientY, false);
    pi.timer = setTimeout(() => {
      if (!pi) return;
      pi.timer = null;
      if (s && !editMode) { pi.armed = true; showSlotTooltip(s); pi.tooltipShown = true; }
      else if (editMode && s) pi.el.classList.add("hb-dragging");
    }, TOOLTIP_MS);
  }

  function startTouch(ev, b, s, i) { // WebView/Thor
    if (Date.now() < ttSuppressUntil) return;
    cancelPress();
    const t = ev.changedTouches[0];
    pi = makePi(i, b, s, t.clientX, t.clientY, true);
    pi.touchId = t.identifier;
    pi.t0 = Date.now(); pi.maxDist = 0;
    if (s) {
      // segurar parado abre o tooltip em AMBOS os modos (editMode: mover depois ainda vira drag)
      pi.timer = setTimeout(() => {
        if (!pi) return;
        pi.holdArmed = true; pi.timer = null;
        showSlotTooltip(pi.s); pi.tooltipShown = true;
      }, TOOLTIP_MS);
    }
  }

  function cancelPress() {
    if (!pi) return;
    clearTimeout(pi.timer); pi.timer = null;
    endDragVisuals();
    pi = null;
  }

  function endDragVisuals() {
    if (!pi) return;
    if (pi.ghost) { pi.ghost.remove(); pi.ghost = null; }
    if (pi.overEl) { pi.overEl.classList.remove("hb-drag-over"); pi.overEl = null; }
    if (pi.el) pi.el.classList.remove("hb-dragging");
  }

  // MOUSE (pointer events)
  function onGlobalMove(ev) {
    if (!pi || pi.touch) return;
    if (pi.dragging) { placeGhost(ev); updateDragOver(ev); return; }
    if (pi.armed) return; // tooltip mostrando: prioridade, nunca vira arraste
    const dx = Math.abs(ev.clientX - pi.x), dy = Math.abs(ev.clientY - pi.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      clearTimeout(pi.timer); pi.timer = null;
      pi.armed = false;
      if (editMode && pi.s) beginDrag(ev);
      else cancelPress(); // fora de editMode ou slot vazio: nao ha arraste
    }
  }

  // TOUCH: decide drag vs tooltip vs nada; preventDefault só a partir do arraste confirmado
  function onTouchMove(ev) {
    if (!pi || !pi.touch) return;
    const t = touchById(ev.changedTouches, pi.touchId);
    if (!t) return;
    const dx = Math.abs(t.clientX - pi.x), dy = Math.abs(t.clientY - pi.y);
    const dist = Math.max(dx, dy);
    if (dist > pi.maxDist) pi.maxDist = dist;
    if (pi.dragging) { ev.preventDefault(); placeGhost(t); updateDragOver(t); return; }
    // slop de 16px: treme-dedo de tela capacitiva NAO vira drag nem cancela tooltip
    if (dist <= TOUCH_SLOP) return;
    pi.moved = true;
    if (pi.timer) { clearTimeout(pi.timer); pi.timer = null; } // ainda nao mostrou: abafa o tooltip
    if (editMode && pi.s) {
      ev.preventDefault();
      if (pi.tooltipShown) hideTooltip(); // tooltip aberto + dedo andou em editMode: passa a ser drag
      beginDrag(t);
      return;
    }
    if (pi.tooltipShown) ev.preventDefault(); // tooltip fica aberto; gesto é nosso
    // sem editMode/slot vazio: nada (a aba não rola)
  }
  function touchById(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  function beginDrag(ev) {
    pi.dragging = true;
    pi.src = pi.idx;
    pi.el.classList.add("hb-dragging");
    const s = pi.s;
    const url = s.kind === "skill" && s.actionIcon != null ? skillIconUrl(s.actionIcon) : "";
    const fb = (s.kind === "skill" && s.actionIcon == null) ? (s.icon || "✦") : "";
    const ghost = document.createElement("div");
    ghost.id = "hb-drag-ghost";
    ghost.className = "hidden";
    ghost.innerHTML = `<div class="hb-drag-card"><img class="hb-drag-img" src="${url}"${url ? "" : ' style="display:none"' }><span class="hb-drag-fb">${esc(fb)}</span><span class="hb-drag-name">${esc(s.name || "slot")}</span></div>`;
    document.body.appendChild(ghost);
    pi.ghost = ghost;
    placeGhost(ev);
    ghost.classList.remove("hidden");
    updateDragOver(ev);
  }

  function placeGhost(ev) {
    if (!pi || !pi.ghost) return;
    pi.ghost.style.left = ev.clientX + "px";
    pi.ghost.style.top = ev.clientY + "px";
  }

  function updateDragOver(ev) {
    let target = null;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const slotEl = el && el.closest ? el.closest(".hb-slot") : null;
    if (slotEl && slotEl.dataset.index != null) {
      const idx = +slotEl.dataset.index;
      if (idx >= 0 && idx < gridTotal()) target = slotEl;
    }
    if (pi.overEl && pi.overEl !== target) pi.overEl.classList.remove("hb-drag-over");
    pi.overEl = target;
    if (target) target.classList.add("hb-drag-over");
  }

  // MOUSE (pointer events)
  function onGlobalUp(ev) {
    if (!pi || pi.touch) return;
    if (pi.dragging) { doDrop(); cleanupPress(); return; }
    if (pi.tooltipShown) {
      blockClick = true; setTimeout(() => blockClick = false, 600);
      cleanupPress();
      return;
    }
    if (Date.now() < ttSuppressUntil) { cleanupPress(); return; }
    clearTimeout(pi.timer); pi.timer = null;
    tapSlot(pi.s, pi.idx, pi.el);
    cleanupPress();
  }

  // TOUCH
  function onTouchEnd(ev) {
    if (!pi || !pi.touch) return;
    const p = pi;
    if (p.dragging) {
      // rede de seguranca: "drag" que quase nao andou foi um tap com jitter
      if (p.maxDist < TOUCH_SLOP * 2 && Date.now() - p.t0 < 450) {
        cleanupPress();
        tapSlot(p.s, p.idx, p.el);
        return;
      }
      doDrop(); cleanupPress(); return;
    }
    if (Date.now() < ttSuppressUntil) { cleanupPress(); return; }
    if (p.tooltipShown) { ttSuppressUntil = Date.now() + 600; cleanupPress(); return; } // tooltip fica aberta; toque nao age
    if (p.moved) { cleanupPress(); return; } // dedo andou sem drag: gesto descartado
    clearTimeout(p.timer); p.timer = null;
    tapSlot(p.s, p.idx, p.el);
    cleanupPress();
  }
  function onTouchCancel() { if (pi && pi.touch) cancelPress(); }

  function cleanupPress() { endDragVisuals(); pi = null; }

  function doDrop() {
    blockClick = true; setTimeout(() => blockClick = false, 600); // click sintético no slot de destino não age
    const src = pi.src;
    const over = pi.overEl ? +pi.overEl.dataset.index : -1;
    let changed = false;
    if (over !== -1 && over !== src && over < gridTotal()) {
      if (slots[over] == null) {
        // soltar em slot vazio: move (origem fica vazia)
        slots[over] = slots[src];
        slots[src] = null;
        changed = true;
      } else {
        // soltar em slot preenchido: troca os dois
        const tmp = slots[src];
        slots[src] = slots[over];
        slots[over] = tmp;
        changed = true;
      }
    }
    // soltar fora do grid ou na própria origem: cancela (sem mudança)
    if (changed) save();
    renderGrid();
  }

  // ---- toque curto nos slots (fluxo centralizado) ----
  // ttSuppressUntil ativo -> todo tap ignorado.
  // Fora disso: slot vazio + editMode -> editor; preenchido + editMode -> editor (SEMPRE, sem login);
  // preenchido fora do editMode -> executa (exige login); vazio fora do editMode -> dica.
  function tapSlot(s, i, b) {
    if (Date.now() < ttSuppressUntil) return; // toque que fechou o tooltip: não executa ação
    blockClick = true; setTimeout(() => blockClick = false, 600);
    if (!s) {
      if (editMode) openEditor(i);
      else status("ative Editar p/ configurar");
      return;
    }
    if (editMode) { openEditor(i); return; } // editMode: editar slot preenchido nunca exige login
    if (!(window.__txState && window.__txState.loggedIn)) { status("entre no jogo primeiro"); return; }
    // M2: skill em cooldown não executa — mostra quanto falta (ceil)
    if (s.kind === "skill" && s.actionId != null) {
      const c = window.__txState && window.__txState.cooldowns ? window.__txState.cooldowns[String(s.actionId)] : null;
      if (c && c.r > 0) { status("recarrega em " + Math.ceil(c.r) + "s"); return; }
    }
    if (s.confirm) confirmThen(s, () => fire(s, b)); else fire(s, b);
  }

  // ---- confirmação ----
  function confirmThen(s, cb) {
    const el = $("hb-confirm");
    el.className = "";
    el.innerHTML = `<div class="hb-confirm-box">
      <p>Executar <b>${esc(s.name || "slot")}</b>?</p>
      <button id="hb-yes">Sim</button><button id="hb-no">Cancelar</button></div>`;
    $("hb-yes").onclick = () => { el.classList.add("hidden"); cb(); };
    $("hb-no").onclick = () => el.classList.add("hidden");
  }

  // ---- editor (sheet deslizante) ----
  let editKind = "command";
  function openEditor(i) {
    editIdx = i;
    const s = slots[i] || { kind: "command" };
    editKind = s.kind || "command";
    selSkill = null;
    if (s.kind === "skill") {
      const cat = catalogItem(s.actionId);
      if (cat) selSkill = { id: cat.id, name: cat.name, icon: cat.icon };
    }
    const el = $("hb-editor");
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="hb-sheet">
        <div class="hb-sheet-head">
          <button id="ed-close">Fechar</button>
          <span class="hb-sheet-title">Editar slot <b>${i + 1}</b></span>
          <button id="ed-save">Salvar</button>
        </div>
        <div class="hb-sheet-body">
          <label>Tipo</label>
          <div class="hb-seg" id="ed-kind-seg">
            <button type="button" class="hb-seg-btn${editKind === "command" ? " active" : ""}" data-kind="command">Comando único</button>
            <button type="button" class="hb-seg-btn${editKind === "skill" ? " active" : ""}" data-kind="skill">Skill</button>
            <button type="button" class="hb-seg-btn${editKind === "sequence" ? " active" : ""}" data-kind="sequence">Sequência</button>
          </div>
          <div id="ed-panel-basic" class="hb-panel${editKind === "skill" ? " hidden" : ""}">
            <label>Nome <input id="ed-name" type="text" value="${esc(s.name || "")}" maxlength="20"></label>
            <label>Ícone (fallback, emoji/texto) <input id="ed-icon" type="text" value="${esc(kindIcon(s))}" maxlength="8"></label>
          </div>
          <div id="ed-panel-command" class="hb-panel${editKind !== "command" ? " hidden" : ""}">
            <label>Comando <input id="ed-cmdv" type="text" value="${esc(s.cmd || "")}" placeholder="/p alerta no <alvo>"></label>
          </div>
          <div id="ed-panel-skill" class="hb-panel${editKind !== "skill" ? " hidden" : ""}">
            <label>Skill <input id="ed-skillq" type="text" value="${esc(selSkill ? selSkill.name : s.actionName || "")}" placeholder="digite p/ filtrar…" autocomplete="off"></label>
            <div id="ed-actions-list" class="hb-skill-list"></div>
            <label>Alvo <select id="ed-target">
              ${[["auto","auto (alvo atual)"],["target","alvo fixo"],["self","eu"],["p1","party 1"],["p2","party 2"],["p3","party 3"],["p4","party 4"],["p5","party 5"],["p6","party 6"],["p7","party 7"],["p8","party 8"]]
                .map(([v, l]) => `<option value="${v}" ${((s.target || "auto") === v) ? "selected" : ""}>${l}</option>`).join("")}
            </select></label>
            <div class="dim" id="ed-skill-id">${selSkill ? "actionId " + selSkill.id : s.actionId ? "actionId " + s.actionId : "nada selecionado"}</div>
          </div>
          <div id="ed-panel-sequence" class="hb-panel${editKind !== "sequence" ? " hidden" : ""}">
            <label>Linhas (um /comando por linha; // comentário)
              <textarea id="ed-seqv" rows="5" placeholder="/ac &quot;Holy Sheltron&quot; &lt;1&#10;/ac &quot;Goring Blade&quot; &lt;t&gt;">${esc(s.seq || "")}</textarea></label>
            <label>Delay entre linhas (ms) <input id="ed-delay" type="number" min="50" max="2000" step="50" value="${s.delay || 200}"></label>
          </div>
          <label class="row"><input id="ed-confirm" type="checkbox"${s.confirm ? " checked" : ""}> pedir confirmação antes de executar</label>
        </div>
        <div class="hb-sheet-foot">
          <button id="ed-cancel">Cancelar</button>
          <button id="ed-clear">Limpar slot</button>
          <button id="ed-save-bottom">Salvar slot</button>
        </div>
      </div>`;

    const seg = $("ed-kind-seg");
    const setKind = (k) => {
      editKind = k;
      seg.querySelectorAll(".hb-seg-btn").forEach((bt) => bt.classList.toggle("active", bt.dataset.kind === k));
      ["command", "skill", "sequence"].forEach((k2) => {
        $("ed-panel-" + k2).classList.toggle("hidden", k2 !== k);
      });
      $("ed-panel-basic").classList.toggle("hidden", k === "skill");
      if (k === "skill") ensureCatalog(currentJobKey, () => renderSkillList($("ed-skillq").value));
    };
    seg.querySelectorAll(".hb-seg-btn").forEach((bt) => bt.onclick = () => setKind(bt.dataset.kind));
    setKind(editKind);

    const q = $("ed-skillq");
    q.oninput = () => renderSkillList(q.value);
    ensureCatalog(currentJobKey, () => renderSkillList(q.value));

    const doSave = () => {
      const kind = editKind;
      const next = {
        kind,
        name: $("ed-name").value.trim(),
        icon: $("ed-icon").value.trim(),
        confirm: $("ed-confirm").checked,
      };
      if (kind === "skill") {
        if (!selSkill) { status("toque numa skill da lista p/ selecionar"); return; }
        next.actionId = selSkill.id;
        next.actionName = selSkill.name;
        next.actionIcon = selSkill.icon;
        next.target = $("ed-target").value;
        next.name = selSkill.name;
        next.icon = selSkill.icon || "✦";
      } else if (kind === "sequence") {
        const lines = splitLines($("ed-seqv").value);
        if (lines.length === 0 || lines.length > 16) { status("1-16 linhas de comando"); return; }
        if (lines.some((l) => !l.startsWith("/"))) { status("cada linha precisa começar com /"); return; }
        next.seq = $("ed-seqv").value;
        next.delay = parseInt($("ed-delay").value, 10) || 200;
      } else {
        const cmd = $("ed-cmdv").value.trim();
        if (!cmd.startsWith("/")) { status("comando precisa começar com /"); return; }
        next.cmd = cmd;
        if (!next.icon) next.icon = "/";
      }
      slots[editIdx] = next; save(); renderGrid(); closeEditor(); status("slot " + (editIdx + 1) + " salvo");
    };
    $("ed-save").onclick = doSave;
    $("ed-save-bottom").onclick = doSave;
    $("ed-clear").onclick = () => { slots[editIdx] = null; save(); renderGrid(); closeEditor(); status("slot limpo"); };
    $("ed-cancel").onclick = closeEditor;
    $("ed-close").onclick = closeEditor;
  }
  function kindIcon(s) { return s.icon == null ? (s.kind === "skill" ? "✦" : "") : s.icon; }
  function closeEditor() { editIdx = -1; hideTooltip(); const el = $("hb-editor"); if (el) { el.classList.add("hidden"); el.innerHTML = ""; } }

  // ---- popup de ferramentas (único popup: ⚙️) ----
  // Editar/Pronto, grade (3x3/4x3/4x2), Exportar, Importar. Fecha por toque fora ou botão Fechar.
  function openTools() {
    closeEditor();
    document.removeEventListener("pointerdown", toolsOutside, true);
    let el = $("hb-tools-pop");
    if (!el) {
      el = document.createElement("div");
      el.id = "hb-tools-pop";
      document.body.appendChild(el);
    }
    const editing = editMode;
    el.innerHTML = `
      <div class="hb-pop-head"><span class="panel-title">Ferramentas</span>
        <button class="btn btn-ghost" id="hb-pop-close">Fechar</button></div>
      <p class="hb-pop-hint" id="hb-pop-job"></p>
      <button id="hb-pop-edit" class="btn hb-pop-btn">${editing ? "✅ Pronto" : "✏️ Editar"}</button>
      <div class="divider"></div>
      <p class="hb-pop-hint dim">Grade</p>
      <div class="hb-presets" id="hb-pop-presets"></div>
      <div class="divider"></div>
      <button id="hb-pop-export" class="btn hb-pop-btn">Exportar</button>
      <button id="hb-pop-import" class="btn hb-pop-btn">Importar</button>`;
    el.classList.remove("hidden");
    $("hb-pop-close").onclick = closeTools;
    $("hb-pop-edit").onclick = () => { editMode = !editMode; $("hb-pop-edit").textContent = editMode ? "✅ Pronto" : "✏️ Editar"; closeEditor(); renderGrid(); };
    const cont = $("hb-pop-presets");
    Object.keys(PRESETS).forEach((k) => {
      const pr = PRESETS[k];
      const bt = document.createElement("button");
      bt.type = "button";
      bt.className = "btn hb-preset-btn" + (k === gridPreset ? " sel" : "");
      bt.dataset.preset = k;
      bt.innerHTML = `<span class="hb-preset-big">${pr.label}</span><span class="hb-preset-small">${pr.n} slots</span>`;
      bt.onclick = () => { applyPreset(k); closeTools(); };
      cont.appendChild(bt);
    });
    $("hb-pop-export").onclick = () => { closeTools(); exportJson(); };
    $("hb-pop-import").onclick = () => { closeTools(); importJson(); };

    // chip discreto do job atual (recria a cada abertura do popover)
    const st = window.__txState;
    const p = st && st.player ? st.player : null;
    const jobEl = $("hb-pop-job");
    if (jobEl) jobEl.textContent = p && p.job ? esc(p.job + (p.level != null ? " " + p.level : "")) : "sem job";

    document.addEventListener("pointerdown", toolsOutside, true);
  }
  function toolsOutside(ev) {
    const el = $("hb-tools-pop");
    const gear = $("hb-gear");
    if (el && !el.classList.contains("hidden") && !el.contains(ev.target)
        && ev.target !== gear && !gear.contains(ev.target)) closeTools();
  }
  function closeTools() {
    const el = $("hb-tools-pop");
    if (el) el.classList.add("hidden");
    document.removeEventListener("pointerdown", toolsOutside, true);
  }
  function applyPreset(k) {
    gridPreset = k;
    buckets.set(currentJobKey, { slots: padToMax(slots.slice()), preset: k });
    saveJobs();
    localStorage.setItem(GRID_KEY, k); // default global para buckets novos / migracao
    renderGrid();
    status("grade " + PRESETS[k].label + " (" + PRESETS[k].n + " slots)");
  }

  // ---- import/export ----
  function exportJson() {
    persistCurrent(); // garante o bucket atual no disco antes de exportar
    const payload = { version: 2, jobs: Object.fromEntries(buckets) };
    const ta = document.createElement("textarea");
    ta.value = JSON.stringify(payload, null, 2);
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); status("JSON copiado (v2, todos os jobs)"); } catch (e) { prompt("Copie:", ta.value); }
    ta.remove();
  }
  function importJson() {
    const txt = prompt("Cole o JSON da hotbar:");
    if (!txt) return;
    try {
      const d = JSON.parse(txt);
      let jobs;
      if (d && d.version === 2 && d.jobs && typeof d.jobs === "object") {
        // v2: substitui o mapa inteiro de jobs
        jobs = new Map(Object.entries(d.jobs));
      } else if (Array.isArray(d)) {
        // v1 (array plano): so o bucket geral "0"; jobs existentes sao mantidos
        jobs = new Map(buckets);
        jobs.set("0", { slots: d, preset: defaultPreset() });
      } else {
        throw 0;
      }
      // normaliza todos os buckets
      for (const [k, b] of jobs) {
        if (!b || !Array.isArray(b.slots)) { jobs.delete(k); continue; }
        b.slots = padToMax(b.slots.slice(0, MAX_SLOTS)
          .map((s) => s && (s.kind === "command" || s.kind === "skill" || s.kind === "sequence") ? s : null));
        if (!b.preset || !PRESETS[b.preset]) b.preset = defaultPreset();
      }
      buckets.clear();
      jobs.forEach((v, k) => buckets.set(k, v));
      saveJobs();
      enterBucket(currentJobKey); // reposiciona no bucket do job atual (cria se necessario)
      renderGrid();
      status("importado");
    } catch (e) { status("JSON invalido"); }
  }

  function splitLines(text) {
    return String(text || "").split("\n").map((l) => l.trim())
      .filter((l) => l.length && !l.startsWith("//"));
  }

  // ---- skills do catalogo (cacheado por job; invalida ao trocar de job) ----
  let actionsTries = 0;
  let catalogFetching = false;
  function catalogCached(key) {
    return window.__txActionsByJob && window.__txActionsByJob[key]
      && window.__txActionsByJob[key].length;
  }
  function invalidateCatalog() {
    window.__txActionsByJob = null;
    window.__txActions = null;
    actionsTries = 0;
    catalogFetching = false;
    staleTries = 0;
  }
  let staleTries = 0;
  function fetchCatalog(key, cb) {
    if (catalogFetching) { cb && cb(); return; } // ja ha um voo em andamento
    const list = $("ed-actions-list");
    if (list) list.innerHTML = '<div class="dim">carregando skills do job…</div>';
    catalogFetching = true;
    fetch("/api/actions").then((r) => r.json()).then((d) => {
      // o bridge reconstrói o catalogo no frame SEGUINTE ao pedido: logo apos trocar de job a
      // resposta pode ser o catalogo do job ANTERIOR. Comparar d.job com o jobId atual.
      const want = window.__txState && window.__txState.player ? window.__txState.player.jobId : null;
      if (want != null && d.job != null && String(d.job) !== String(want) && staleTries < 5) {
        staleTries++;
        setTimeout(() => { catalogFetching = false; fetchCatalog(key, cb); }, 700);
        return;
      }
      staleTries = 0;
      const items = d.items || [];
      window.__txActionsByJob = window.__txActionsByJob || {};
      window.__txActionsByJob[String(key)] = items;
      window.__txActions = items; // compatibilidade (tooltip / slot atual)
      catalogFetching = false;
      actionsTries = 0;
      cb && cb();
      renderSkillList($("ed-skillq") ? $("ed-skillq").value : "");
    }).catch(() => {
      if (++actionsTries < 4) { setTimeout(() => fetchCatalog(key, cb), 800); return; }
      catalogFetching = false;
      const l = $("ed-actions-list");
      if (l) l.innerHTML = '<div class="dim">catalogo vazio — abra o editor novamente com o jogo em mundo</div>';
    });
  }
  function ensureCatalog(key, cb) {
    if (catalogCached(key)) { cb && cb(); return; }
    fetchCatalog(key, cb);
  }
  function catalogItem(id) {
    const map = window.__txActionsByJob;
    if (map) for (const k in map) {
      const it = map[k] && map[k].find((a) => a.id == id);
      if (it) return it;
    }
    const cur = window.__txActions;
    if (Array.isArray(cur)) return cur.find((a) => a.id == id);
    return null;
  }

  function renderSkillList(filter) {
    const list = $("ed-actions-list");
    if (!list) return;
    const f = String(filter || "").trim().toLowerCase();
    const items = (window.__txActions || [])
      .filter((a) => !f || a.name.toLowerCase().includes(f))
      .slice(0, 40);
    list.innerHTML = items.map((a) =>
      `<button class="hb-skill-opt ${selSkill && selSkill.id === a.id ? "sel" : ""}" data-id="${a.id}" data-name="${esc(a.name)}" data-desc="${esc(a.desc || "")}" data-icon="${a.icon}">
        <img class="hb-opt-img" src="${skillIconUrl(a.icon)}" onerror="this.style.display='none'">
        <span class="hb-opt-name">${esc(a.name)}</span>
      </button>`).join("") || '<div class="dim">' + ((window.__txActions || []).length ? "nada com esse nome" : "carregando…") + "</div>";
    list.querySelectorAll(".hb-skill-opt").forEach((b) => {
      b.onclick = () => pickSkill(b);
      attachTooltip(b, b.dataset.name, b.dataset.desc || "", b.dataset.id);
    });
  }
  function pickSkill(b) {
    selSkill = { id: +b.dataset.id, name: b.dataset.name, icon: b.dataset.icon };
    $("ed-skillq").value = selSkill.name;
    $("ed-skill-id").textContent = "actionId " + selSkill.id;
    renderSkillList($("ed-skillq").value);
  }

  // ---- tooltip generico (long-press 400ms + hover no desktop) ----
  function attachTooltip(el, name, desc, id) {
    const rec = pressRecognizer(el, () => showTooltip(name, desc, id ? "Action ID: " + id : ""));
    el.addEventListener("pointerup", () => { rec.stop(); }); // tooltip fica aberto até toque em outro lugar
    el.addEventListener("click", (e) => { if (blockClick) { e.stopImmediatePropagation(); blockClick = false; } });
  }

  // reconhecedor de press longo com tolerância de movimento (~10px):
  // pequenos movimentos durante o press NÃO cancelam; apenas desvia > MOVE_TOL cancela.
  // usado pelas opções da lista de skills (tooltip já funciona; mantido intocado).
  function pressRecognizer(el, onArm) {
    let timer = null;
    let armed = false;
    let px = 0, py = 0;
    const start = (e) => {
      if (Date.now() < ttSuppressUntil) return;
      px = e.clientX; py = e.clientY;
      armed = false;
      timer = setTimeout(() => { armed = true; onArm(); }, TOOLTIP_MS);
    };
    const stop = () => {
      clearTimeout(timer); timer = null;
      const wasArmed = armed;
      armed = false;
      if (Date.now() < ttSuppressUntil) return false; // toque que fechou o tooltip: não dispara nada
      if (wasArmed) { blockClick = true; setTimeout(() => blockClick = false, 600); return true; }
      return false;
    };
    const cancel = () => { clearTimeout(timer); timer = null; armed = false; };
    el.addEventListener("pointerdown", start, { passive: true });
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointermove", (e) => {
      if (!timer) return;
      if (Math.abs(e.clientX - px) > 10 || Math.abs(e.clientY - py) > 10) cancel();
    });
    el.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") start(); });
    el.addEventListener("pointerleave", cancel);
    return { stop };
  }

  // ---- execução ----
  function fire(s, btn) {
    let telegram;
    if (s.kind === "skill") telegram = { type: "skill", actionId: s.actionId, target: s.target || "auto" };
    else if (s.kind === "sequence") telegram = { type: "sequence", lines: splitLines(s.seq), delayMs: s.delay || 0 };
    else telegram = { type: "command", cmd: s.cmd };

    const done = (ok, msg) => {
      btn && btn.classList.add(ok ? "ok" : "err");
      setTimeout(() => btn && btn.classList.remove("ok", "err"), 350);
      status(msg);
    };

    if (window.__txDemo) { done(true, "(demo) " + (s.name || "")); return; }
    fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(telegram) })
      .then((r) => r.json())
      .then((d) => done(d.ok, d.ok ? (s.name || "ok") : "erro: " + (d.error || "?")))
      .catch(() => done(false, "sem conexão com o bridge"));
  }

  function status(t) {
    const el = $("hb-toast");
    if (!el) return;
    if (!t) { el.classList.add("hidden"); clearTimeout(toastTimer); toastTimer = null; return; }
    el.textContent = t;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.add("hidden"); }, 2500);
  }

  // ---- cooldown real (M2) ----
  // Aplica overlay de escurecimento (altura = r/t, de baixo pra cima) + segundos restantes.
  // Só toca no DOM quando houver mudança real (>= 1% ou ligar/desligar).
  function applyCd(i, r, t) {
    const b = grid.children[i];
    if (!b) return;
    const cd = b.querySelector(".hb-cd");
    if (!cd) return; // apenas slots de skill têm overlay de cooldown
    const fill = cd.querySelector(".hb-cd-fill");
    const txt = cd.querySelector(".hb-cd-txt");
    if (r > 0 && t > 0) {
      cd.classList.remove("hidden");
      fill.style.height = Math.round((r / t) * 100) + "%";
      txt.textContent = Math.ceil(r) + "s";
    } else {
      cd.classList.add("hidden");
    }
  }

  function updateCooldowns(state) {
    if (!grid) return;
    const cds = state && state.cooldowns ? state.cooldowns : {};
    const total = gridTotal();
    for (let i = 0; i < total; i++) {
      const s = slots[i];
      if (!s || s.kind !== "skill" || s.actionId == null) continue;
      const c = cds[String(s.actionId)];
      const r = c && typeof c.r === "number" ? c.r : 0;
      const t = c && typeof c.t === "number" ? c.t : 0;
      const active = r > 0 && t > 0;
      const pct = active ? Math.round((r / t) * 100) : 0;
      const prev = cdLast.get(i);
      if (prev && prev.pct === pct && prev.active === active) continue; // sem mudança >= 1%
      cdLast.set(i, { pct, active });
      applyCd(i, r, t);
    }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  loadJobs().forEach((v, k) => buckets.set(k, v));
  if (buckets.size === 0) migrateV1(window.__txState); // v1 -> bucket do job atual, ou "0" se ainda desconhecido
  enterBucket(jobKeyOf(window.__txState)); // posiciona o bucket atual (cria vazio se necessario)
  build();
  setInterval(() => {
    const w = $("hotbar-grid");
    if (w) w.classList.toggle("offline", !(window.__txState && window.__txState.loggedIn));
    const st = window.__txState;
    if (st) {
      migrateV1(st); // uma vez: hotbar.v1 -> bucket do job atual (ou "0")
      updateCooldowns(st);
      const key = jobKeyOf(st);
      if (key !== currentJobKey) switchJob(key, st);
    }
  }, 700);

  function switchJob(key, st) {
    // fecha o bucket que estava em uso
    persistCurrent();
    currentJobKey = key;
    const b = bucketOf(key);
    if (b) {
      slots = padToMax(b.slots.slice());
      gridPreset = b.preset && PRESETS[b.preset] ? b.preset : defaultPreset();
    } else {
      slots = new Array(MAX_SLOTS).fill(null);
      gridPreset = defaultPreset();
    }
    buckets.set(currentJobKey, { slots: padToMax(slots.slice()), preset: gridPreset });
    saveJobs();
    renderGrid();
    // catalogo do novo job: invalida o cache local p/ forcar re-fetch ao abrir o editor
    invalidateCatalog();
    // toast: so de job conhecido para outro job conhecido (sem spam de login/logout)
    const prev = lastJobKey;
    lastJobKey = key;
    if (prev != null && prev !== "0" && key !== "0" && prev !== key) {
      const sig = st && st.player ? st.player.job : null;
      if (sig) status("hotbar: " + esc(sig));
    }
  }
// ==== T2/M7 split: hotbar esquerda + mapa direito, 50/50, toggle por ◫ ====
// Estado: localStorage "split.v1" ("1"/"0"); "split.seen" marca que a dica ja foi exibida.
const SPLIT_KEY = "split.v1";
const SPLIT_SEEN = "split.seen";
// Guarda pai original + elementos do mapa na 1a ativacao para restauracao EXATA (idempotente).
let splitOrig = null; // { parent: Element, els: [mapFit, mapHud, coords] }

function splitMapEls() {
  const tab = $("tab-mapa");
  return [tab.querySelector(".map-fit"), $("map-hud"), $("coords")];
}

function moveSplitMap(on) {
  const tab = $("tab-mapa");
  const sr = $("split-right");
  const wrap = $("hotbar-wrap");
  if (on) {
    if (!splitOrig) splitOrig = { parent: tab, els: splitMapEls() };
    splitOrig.els.forEach((el) => el && sr.appendChild(el)); // appendChild move o no ja existente
    wrap.classList.add("split-left");
  } else {
    if (splitOrig)
      splitOrig.els.forEach((el) => el && splitOrig.parent.appendChild(el)); // volta aos pais originais
    wrap.classList.remove("split-left");
  }
}

function applySplit(on) {
  on = !!on;
  document.body.classList.toggle("split", on);
  localStorage.setItem(SPLIT_KEY, on ? "1" : "0");
  moveSplitMap(on);
  if (on && !localStorage.getItem(SPLIT_SEEN)) {
    localStorage.setItem(SPLIT_SEEN, "1");
    status("dica: grade 3x3 fica melhor junto"); // primeira vez: so dica, nao força preset
  }
}

function toggleSplit() {
  applySplit(!document.body.classList.contains("split"));
}

// app.js chama no boot: window.__txSplit.apply(localStorage.getItem("split.v1") === "1")
window.__txSplit = { apply: applySplit };

})();
