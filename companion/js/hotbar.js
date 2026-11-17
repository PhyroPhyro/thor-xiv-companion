// Hotbar touch (T2/M1): grid configurável (3x3/4x3/4x4), drag & drop entre slots só em editMode,
// tooltips de slot e execução de comandos/skills/sequências nativas no jogo.
// POST /api/command aceita APENAS type command|skill|sequence — Telesto foi removido.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KEY = "hotbar.v1";
  const GRID_KEY = "hotbar.grid.v1";
  const MAX_SLOTS = 16; // maior preset (4x4); slots além do grade atual ficam preservados na memória
  const PRESETS = {
    "3x3": { c: 3, r: 3, label: "3×3", n: 9 },
    "4x3": { c: 4, r: 3, label: "4×3", n: 12 },
    "4x4": { c: 4, r: 4, label: "4×4", n: 16 },
  };

  const wrap = $("hotbar-wrap");
  let grid = null; // criado dentro de build(); NUNCA capturar em cima elemento de innerHTML

  let slots = load();
  let editMode = false;
  let editIdx = -1;
  let selSkill = null;
  let blockClick = false;
  let ttOpen = false;
  let ttTimer = null;
  let ttSuppressUntil = 0; // bloqueia a ação do toque que fecha o tooltip

  let gridPreset = localStorage.getItem(GRID_KEY);
  if (!PRESETS[gridPreset]) gridPreset = "4x3";

  const TOOLTIP_MS = 400; // long-press antes de mostrar o tooltip
  const DRAG_THRESHOLD = 8; // px de movimento p/ iniciar arraste (só em editMode)

  // Uma interação ativa por vez (press/tooltip/arraste/tap)
  let pi = null; // {idx, el, s, x, y, armed, tooltipShown, dragging, src, ghost, overEl, timer}

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
  function save() { localStorage.setItem(KEY, JSON.stringify(slots)); }
  function gridTotal() { const p = PRESETS[gridPreset]; return p.c * p.r; }

  function skillIconUrl(icon) {
    const n = String(icon | 0).padStart(6, "0"); // 6 dígitos
    return `https://xivapi.com/i/${n.slice(0, 3)}000/${n}.png`; // https://xivapi.com/i/006000/006273.png
  }

  function build() {
    wrap.innerHTML = `
      <div id="hotbar-grid"></div>
      <div class="hb-tools">
        <button id="hb-edit">Editar</button>
        <button id="hb-gridbtn">Config</button>
        <button id="hb-export">Exportar</button>
        <button id="hb-import">Importar</button>
        <span id="hb-status" class="dim"></span>
      </div>
      <div id="hb-editor" class="hidden"></div>
      <div id="hb-confirm" class="hidden"></div>
      <div id="hb-gridcfg" class="hidden"></div>
      <div id="hb-tooltip" class="hidden">
        <div class="hb-tooltip-card">
          <div id="hb-tt-name" class="hb-tt-name"></div>
          <div id="hb-tt-desc" class="hb-tt-desc hidden"></div>
          <div id="hb-tt-id" class="hb-tt-id"></div>
        </div>
      </div>`;
    grid = $("hotbar-grid");
    renderGrid();
    $("hb-edit").onclick = () => { editMode = !editMode; $("hb-edit").textContent = editMode ? "Pronto" : "Editar"; closeEditor(); renderGrid(); };
    $("hb-gridbtn").onclick = openConfig;
    $("hb-export").onclick = exportJson;
    $("hb-import").onclick = importJson;

    // reconhecedor global de move/up (segue o dedo mesmo saindo do elemento do slot)
    document.addEventListener("pointermove", onGlobalMove);
    document.addEventListener("pointerup", onGlobalUp);
    document.addEventListener("pointercancel", onGlobalUp);

    // toque em qualquer lugar fecha o tooltip; o toque que fecha NÃO dispara a ação do elemento tocado (FFXIV)
    document.addEventListener("pointerdown", (e) => {
      if (!ttOpen) return;
      hideTooltip();
      ttSuppressUntil = Date.now() + 600;
    }, true);
  }

  function renderGrid() {
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
      b.innerHTML = s
        ? `<span class="hb-ico-wrap">${slotIconHtml(s)}</span><span class="hb-name">${esc(s.name || "slot")}</span>`
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

  // ---- reconhecedor de press do slot (tooltip vs arraste vs tap) ----
  function setupSlot(b, s, i) {
    b.addEventListener("pointerdown", (ev) => startPress(ev, b, s, i), { passive: true });
    b.addEventListener("pointercancel", cancelPress);
    b.addEventListener("click", (ev) => { if (blockClick) { ev.stopImmediatePropagation(); blockClick = false; } });
  }

  function startPress(ev, b, s, i) {
    if (Date.now() < ttSuppressUntil) return; // toque que fechou o tooltip: ignora tudo
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    cancelPress();
    pi = { idx: i, el: b, s, x: ev.clientX, y: ev.clientY, armed: false, tooltipShown: false, dragging: false, src: -1, ghost: null, overEl: null, timer: null };
    const onArm = s ? () => { showSlotTooltip(s); pi.tooltipShown = true; } : null;
    pi.timer = setTimeout(() => {
      pi.armed = true;
      pi.timer = null;
      if (onArm) onArm();
    }, TOOLTIP_MS);
  }

  function cancelPress() {
    if (!pi) return;
    clearTimeout(pi.timer); pi.timer = null;
    endDragVisuals();
    pi = null;
  }

  function endDragVisuals() {
    if (pi.ghost) { pi.ghost.remove(); pi.ghost = null; }
    if (pi.overEl) { pi.overEl.classList.remove("hb-drag-over"); pi.overEl = null; }
    if (pi.el) pi.el.classList.remove("hb-dragging");
  }

  function onGlobalMove(ev) {
    if (!pi) return;
    if (pi.dragging) { placeGhost(ev); updateDragOver(ev); return; }
    if (pi.armed) return; // tooltip mostrando: prioridade, nunca vira arraste
    const dx = Math.abs(ev.clientX - pi.x), dy = Math.abs(ev.clientY - pi.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      clearTimeout(pi.timer); pi.timer = null;
      pi.armed = false;
      if (editMode && pi.s) {
        beginDrag(ev);
      } else {
        cancelPress(); // fora de editMode ou slot vazio: não há arraste
      }
    }
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

  function onGlobalUp(ev) {
    if (!pi) return;
    if (pi.dragging) { doDrop(); cleanupPress(); return; }
    // não arrastando: pointerup num slot (ou em qualquer lugar)
    if (pi.tooltipShown) {
      // tooltip permanece aberto; o toque que fecha não dispara nada (suprimido abaixo no próximo pointerdown)
      blockClick = true; setTimeout(() => blockClick = false, 600);
      cleanupPress();
      return;
    }
    // tap curto (timer não armado)
    if (Date.now() < ttSuppressUntil) { cleanupPress(); return; }
    clearTimeout(pi.timer); pi.timer = null;
    tapSlot(pi.s, pi.idx, pi.el);
    cleanupPress();
  }

  function cleanupPress() { endDragVisuals(); pi = null; }

  function doDrop() {
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
  // Fora disso: editMode -> editor (preenchido ou vazio); fora do editMode -> executa (preenchido) ou dica (vazio).
  function tapSlot(s, i, b) {
    if (Date.now() < ttSuppressUntil) return; // toque que fechou o tooltip: não executa ação
    blockClick = true; setTimeout(() => blockClick = false, 600);
    if (!s) {
      if (editMode) openEditor(i);
      else status("ative Editar p/ configurar");
      return;
    }
    if (!(window.__txState && window.__txState.loggedIn)) { status("entre no jogo primeiro"); return; }
    if (editMode) openEditor(i); else if (s.confirm) confirmThen(s, () => fire(s, b)); else fire(s, b);
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
              <textarea id="ed-seqv" rows="5" placeholder="/ac \"Holy Sheltron\" <1&#10;/ac \"Goring Blade\" <t>">${esc(s.seq || "")}</textarea></label>
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
      if (k === "skill") loadActions(() => renderSkillList($("ed-skillq").value));
    };
    seg.querySelectorAll(".hb-seg-btn").forEach((bt) => bt.onclick = () => setKind(bt.dataset.kind));
    setKind(editKind);

    const q = $("ed-skillq");
    q.oninput = () => renderSkillList(q.value);
    loadActions(() => renderSkillList(q.value));

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

  // ---- configuracao da grade (popover ancorado no botao Config) ----
  function openConfig() {
    const el = $("hb-gridcfg");
    const p = PRESETS[gridPreset];
    el.innerHTML = `
      <div class="hb-pop-head"><span class="panel-title">Grade</span>
        <button class="btn btn-ghost" id="cfg-close">Fechar</button></div>
      <p class="hb-pop-hint dim">Mais slots = botoes menores</p>
      <div class="hb-presets" id="cfg-presets"></div>`;
    const cont = $("cfg-presets");
    Object.keys(PRESETS).forEach((k) => {
      const pr = PRESETS[k];
      const bt = document.createElement("button");
      bt.type = "button";
      bt.className = "btn hb-preset-btn" + (k === gridPreset ? " sel" : "");
      bt.dataset.preset = k;
      bt.innerHTML = `<span class="hb-preset-big">${pr.label}</span><span class="hb-preset-small">${pr.n} slots</span>`;
      bt.onclick = () => applyPreset(k);
      cont.appendChild(bt);
    });
    // ancora: logo abaixo do botao Config, alinhado a direita dele
    el.classList.remove("hidden");
    const btn = $("hb-gridbtn").getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const w = r.width || 340;
    let left = btn.right - w;
    if (left < 8) left = 8;
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(btn.bottom + 8) + "px";
    $("cfg-close").onclick = closeConfig;
    document.addEventListener("pointerdown", cfgOutside, true);
  }
  function cfgOutside(ev) {
    const el = $("hb-gridcfg");
    if (el && !el.classList.contains("hidden") && !el.contains(ev.target)
        && ev.target !== $("hb-gridbtn") && !$("hb-gridbtn").contains(ev.target)) closeConfig();
  }
  function closeConfig() {
    const el = $("hb-gridcfg");
    if (el) el.classList.add("hidden");
    document.removeEventListener("pointerdown", cfgOutside, true);
  }
  function applyPreset(k) {
    gridPreset = k;
    localStorage.setItem(GRID_KEY, k);
    closeConfig();
    renderGrid();
    status("grade " + PRESETS[k].label + " (" + PRESETS[k].n + " slots)");
  }

  // ---- import/export ----
  function exportJson() {
    const ta = document.createElement("textarea");
    ta.value = JSON.stringify(slots);
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); status("JSON copiado"); } catch (e) { prompt("Copie:", ta.value); }
    ta.remove();
  }
  function importJson() {
    const txt = prompt("Cole o JSON da hotbar:");
    if (!txt) return;
    try {
      const d = JSON.parse(txt);
      if (!Array.isArray(d)) throw 0;
      slots = padToMax(d.map((s) => s && (s.kind === "command" || s.kind === "skill" || s.kind === "sequence") ? s : null));
      save(); renderGrid(); status("importado");
    } catch (e) { status("JSON invalido"); }
  }

  function splitLines(text) {
    return String(text || "").split("\n").map((l) => l.trim())
      .filter((l) => l.length && !l.startsWith("//"));
  }

  // ---- skills do catalogo ----
  function loadActions(cb) {
    if (window.__txActions && window.__txActions.length) { cb && cb(); return; }
    fetch("/api/actions").then((r) => r.json()).then((d) => {
      const items = d.items || [];
      if (items.length) { window.__txActions = items; cb && cb(); return; }
      if (++actionsTries < 4) setTimeout(() => loadActions(cb), 800);
      else { const l = $("ed-actions-list"); if (l) l.innerHTML = '<div class="dim">catalogo vazio — abra o editor novamente com o jogo em mundo</div>'; }
    }).catch(() => { if (++actionsTries < 4) setTimeout(() => loadActions(cb), 800); });
  }
  let actionsTries = 0;

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

  function status(t) { const el = $("hb-status"); if (el) el.textContent = t || ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])); }

  build();
  setInterval(() => {
    const w = $("hotbar-grid");
    if (w) w.classList.toggle("offline", !(window.__txState && window.__txState.loggedIn));
  }, 700);
})();
