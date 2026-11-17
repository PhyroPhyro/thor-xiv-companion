// Minimap renderer: grade do mapa + imagem online (XIVAPI v2) como fundo + marcador do player.
// A resolução zone.id -> {sheetKey,index} é assíncrona e cacheada em localStorage ("txmap.v1").
(function () {
  "use strict";

  const ROOT = getComputedStyle(document.documentElement);
  const gv = (name) => ROOT.getPropertyValue(name).trim();
  const MAP_BG = gv("--map-bg");
  const MAP_GRID = gv("--map-grid");
  const MAP_GRID_SUB = gv("--map-grid-sub");
  const MAP_LABEL = gv("--map-label");
  const MAP_PIN = gv("--map-pin");
  const MAP_PIN_STROKE = gv("--map-pin-stroke");
  const MAP_EMPTY = gv("--map-empty");
  const MAP_OFFLINE = gv("--map-offline");

  const INVERT_Y = true; // y de mapa aumenta para o norte (topo) — inverta se o pino ficar espelhado
  const MAP_CACHE_KEY = "txmap.v1";
  const RESOLVE_TIMEOUT_MS = 6000;
  const XIVAPI_BASE = "https://v2.xivapi.com";

  class Minimap {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.zoneId = null;      // zona cuja imagem está (ou esteve) associada ao canvas
      this.img = null;         // imagem do mapa online, quando disponível
      this.resolved = null;    // {key,index} | false (offline apurado) | null (ainda não tentou)
      this.loading = false;    // resolução/carregamento em andamento para this.zoneId
      this.pendingZoneId = null; // zona da requisição de rede em voo (descarta se trocar no meio)
    }

    // Carrega (de forma assíncrona) o mapa da zona informada. Fire-and-forget: o render
    // exibe "carregando…" até a imagem ficar pronta e o badge "mapa offline" em falha.
    async loadImage(zoneId) {
      if (zoneId == null) {
        this.zoneId = null;
        this.img = null;
        this.resolved = null;
        this.loading = false;
        this.pendingZoneId = null;
        return;
      }
      if (this.zoneId === zoneId) {
        if (this.img || this.resolved === false) return;   // já resolvida (com imagem ou offline)
        if (this.loading) return;                          // já está resolvendo essa zona
      }
      // troca de zona: limpa a imagem antiga imediatamente — nunca mostra mapa errado, nem que por 1 frame
      this.zoneId = zoneId;
      this.img = null;
      this.resolved = null;
      this.loading = true;
      this.pendingZoneId = zoneId;
      await this.resolveAndLoad(zoneId);
      this.loading = false;
    }

    async resolveAndLoad(zoneId) {
      let resolved;
      try {
        resolved = await this.resolveKey(zoneId);
      } catch (e) {
        resolved = null;
      }
      // a zona pode ter trocado enquanto a rede aguardava
      if (this.pendingZoneId !== zoneId) return;
      if (!resolved) {
        this.resolved = false; // offline: mantem grade + badge discreto, sem refazer fetch por frame
        return;
      }
      this.resolved = resolved;
      await this.loadAsset(resolved);
    }

    // Resolve zone.id -> {key,index} da sheet Map. Cache em localStorage primeiro;
    // senão, consulta o XIVAPI v2 (timeout 6s). Retorna null em qualquer falha.
    async resolveKey(zoneId) {
      // 1) cache localStorage
      let cache = {};
      try {
        cache = JSON.parse(localStorage.getItem(MAP_CACHE_KEY) || "{}");
      } catch (e) { /* localStorage indisponível — segue sem cache */ }
      const hit = cache[zoneId];
      if (hit && hit.key) return { key: hit.key, index: hit.index || "00" };

      // 2) XIVAPI v2: busca a linha da sheet Map cujo TerritoryType == zone.id
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
      let data;
      try {
        const url =
          XIVAPI_BASE +
          "/api/search?sheets=Map&fields=Id&query=" +
          encodeURIComponent("TerritoryType=" + zoneId);
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) return null;
        data = await r.json();
      } catch (e) {
        return null;
      } finally {
        clearTimeout(timer);
      }

      const results = data.results || data.rows || [];
      const row = results[0];
      if (!row) return null;
      const fields = row.fields || {};
      const idv = fields.Id;
      const idStr = idv && idv.value !== undefined ? idv.value : idv;
      if (!idStr) return null;
      // Id vem no formato "s1d1/00" (sheetKey/index); index "00" default
      const parts = String(idStr).split("/");
      const resolved = { key: parts[0], index: parts[1] || "00" };

      // grava no cache para a próxima troca de zona
      try {
        cache[zoneId] = resolved;
        localStorage.setItem(MAP_CACHE_KEY, JSON.stringify(cache));
      } catch (e) { /* sem cache — segue sem gravar */ }
      return resolved;
    }

    async loadAsset(resolved) {
      const url =
        XIVAPI_BASE + "/api/asset/map/" + resolved.key + "/" + resolved.index + "?format=jpg";
      const img = new Image();
      const ok = await new Promise((res) => {
        img.onload = () => res(true);
        img.onerror = () => res(false);
        img.src = url;
      });
      // descarta se a zona mudou enquanto a imagem baixava
      if (this.pendingZoneId === null) return;
      if (ok) this.img = img;
    }

    render(mapCoords) {
      const c = this.canvas, ctx = this.ctx, W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      if (this.img) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(this.img, 0, 0, W, H);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = MAP_BG;
        ctx.fillRect(0, 0, W, H);
      }

      // grade 4x4 (setores) + subdivisões de 10%
      ctx.strokeStyle = MAP_GRID;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const p = (W * i) / 4;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, H); ctx.stroke();
        const q = (H * i) / 4;
        ctx.beginPath(); ctx.moveTo(0, q); ctx.lineTo(W, q); ctx.stroke();
      }
      ctx.strokeStyle = MAP_GRID_SUB;
      for (let i = 1; i < 41; i++) {
        if (i % 10 === 0) continue;
        const p = (W * (i - 1)) / 40;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, H); ctx.stroke();
        const q = (H * (i - 1)) / 40;
        ctx.beginPath(); ctx.moveTo(0, q); ctx.lineTo(W, q); ctx.stroke();
      }

      // labels de setor (1-4 colunas, A-D linhas) estilo FFXIV
      ctx.fillStyle = MAP_LABEL;
      ctx.font = "22px sans-serif";
      const letters = INVERT_Y ? ["A", "B", "C", "D"] : ["D", "C", "B", "A"];
      for (let i = 0; i < 4; i++) {
        ctx.fillText(String(i + 1), (W * i) / 4 + 6, 24);
        ctx.fillText(letters[i], 6, (H * i) / 4 + 26);
      }

      if (mapCoords) {
        const px = Math.min(Math.max((mapCoords.x - 1) / 40, 0), 1) * W;
        let py = (mapCoords.y - 1) / 40;
        py = INVERT_Y ? 1 - py : py;
        const y = Math.min(Math.max(py, 0), 1) * H;

        // pino do player
        ctx.beginPath();
        ctx.arc(px, y, 12, 0, Math.PI * 2);
        ctx.fillStyle = MAP_PIN;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = MAP_PIN_STROKE;
        ctx.stroke();
      }

      // status do mapa online (badge discreto em um canto, definido uma única vez por zona)
      if (this.resolved === false) {
        this.drawBadge(ctx, W, H, "mapa offline");
      } else if (!this.img && this.loading) {
        this.drawBadge(ctx, W, H, "carregando mapa…");
      }
    }

    drawBadge(ctx, W, H, text) {
      ctx.fillStyle = MAP_OFFLINE;
      ctx.font = "16px sans-serif";
      ctx.textAlign = "end";
      ctx.textBaseline = "bottom";
      ctx.fillText(text, W - 10, H - 10);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
  }

  window.Minimap = Minimap;
})();
