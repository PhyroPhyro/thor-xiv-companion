// Minimap renderer: imagem online (XIVAPI v2) como fundo, grade de setores,
// viewport com zoom/pan e marcador do player alinhado à posição real.
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

  const INVERT_Y = true; // y de mapa aumenta para o norte (topo) — inverte na textura
  const MAP_CACHE_KEY = "txmap.v1";
  const RESOLVE_TIMEOUT_MS = 6000;
  const XIVAPI_BASE = "https://v2.xivapi.com";

  const ZOOM_STEP = 1.6;
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 8;
  const GRID_STEP = 10; // unidades de coord de mapa entre linhas da grade

  const $ = (id) => document.getElementById(id);
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  class Minimap {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.zoneId = null;      // zona cuja imagem está (ou esteve) associada ao canvas
      this.img = null;         // imagem do mapa online, quando disponível
      this.imgW = 100;         // largura natural da textura (0..100 em coords de mapa enquanto sem imagem)
      this.imgH = 100;         // altura natural da textura
      this.resolved = null;    // {key,index} | false (offline apurado) | null (ainda não tentou)
      this.loading = false;    // resolução/carregamento em andamento para this.zoneId
      this.pendingZoneId = null; // zona da requisição de rede em voo (descarta se trocar no meio)

      // viewport: {scale, cx, cy}; cx/cy em coords de mapa 0..100 (x=leste, y=norte)
      this.scale = ZOOM_MIN;   // multiplicador sobre o "fit" (1 = textura inteira visível)
      this.cx = 50;            // centro do viewport
      this.cy = 50;
      this.follow = true;      // recentra no player a cada coords novo (desligado pelo ◎ ou arraste/zoom manual)

      this.bindHUD();
      this.bindInput();
    }

    // Carrega (de forma assíncrona) o mapa da zona informada. Fire-and-forget: o render
    // exibe "carregando…" até a imagem ficar pronta e o badge "mapa offline" em falha.
    async loadImage(zoneId) {
      if (zoneId == null) {
        this.zoneId = null;
        this.img = null;
        this.imgW = 100;
        this.imgH = 100;
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
      // e reseta o viewport: zoom 1 (inteiro visível) e follow ligado
      this.zoneId = zoneId;
      this.img = null;
      this.imgW = 100;
      this.imgH = 100;
      this.resolved = null;
      this.loading = true;
      this.pendingZoneId = zoneId;
      this.scale = ZOOM_MIN;
      this.follow = true;
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
      if (ok) {
        this.img = img;
        this.imgW = img.naturalWidth || 100;
        this.imgH = img.naturalHeight || 100;
      }
    }

    // ---- viewport ----

    // Limita o centro para que a textura nunca saia da tela: quando o recorte é
    // menor que a textura (zoom > 1), o centro pode rodar até as bordas da imagem;
    // quando a imagem já cabe inteira (scale 1), o centro fica travado ao meio.
    clamp() {
      const c = this.canvas;
      const W = c.width, H = c.height;
      const iw = this.imgW, ih = this.imgH;
      const fit = this.img ? Math.min(W / iw, H / ih) : Math.min(W / iw, H / ih);
      const s_eff = this.scale * fit;
      const vx = W / (2 * s_eff); // metade da largura visível em px de textura
      const vy = H / (2 * s_eff); // metade da altura visível em px de textura
      let minX = vx, maxX = iw - vx;
      if (minX > maxX) { minX = maxX = iw / 2; }
      let minY = vy, maxY = ih - vy;
      if (minY > maxY) { minY = maxY = ih / 2; }
      const cx_img = Math.min(Math.max((this.cx / 100) * iw, minX), maxX);
      const cy_img = Math.min(Math.max(((100 - this.cy) / 100) * ih, minY), maxY);
      this.cx = (cx_img / iw) * 100;
      this.cy = 100 - (cy_img / ih) * 100;
      this.cx = Math.min(Math.max(this.cx, 0), 100);
      this.cy = Math.min(Math.max(this.cy, 0), 100);
    }

    // Muda o zoom, opcionalmente fixando o ponto da tela (aboutX, aboutY) sobre o
    // mesmo ponto do mapa (zoom em torno do cursor/dedo).
    setScale(next, aboutX, aboutY) {
      next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      const c = this.canvas;
      const W = c.width, H = c.height;
      const iw = this.imgW, ih = this.imgH;
      const fit = this.img ? Math.min(W / iw, H / ih) : Math.min(W / iw, H / ih);
      if (aboutX == null) {
        this.scale = next;
        this.clamp();
        return;
      }
      const s_eff = this.scale * fit;
      const cx_img = (this.cx / 100) * iw;
      const cy_img = ((100 - this.cy) / 100) * ih;
      // ponto do mapa sob o ponto da tela, antes da mudança
      const ux = cx_img + (aboutX - W / 2) / s_eff;
      const uy = cy_img + (aboutY - H / 2) / s_eff;
      this.scale = next;
      const s2 = this.scale * fit;
      // novo centro de modo a manter (ux, uy) projetado em (aboutX, aboutY)
      this.cx = (ux - (aboutX - W / 2) / s2) / iw * 100;
      this.cy = 100 - (uy - (aboutY - H / 2) / s2) / ih * 100;
      this.clamp();
    }

    zoomIn() {
      this.setScale(this.scale * ZOOM_STEP, this.canvas.width / 2, this.canvas.height / 2);
    }

    zoomOut() {
      this.setScale(this.scale / ZOOM_STEP, this.canvas.width / 2, this.canvas.height / 2);
    }

    toggleFollow() {
      this.follow = !this.follow;
      this.syncFollowBtn();
    }

    syncFollowBtn() {
      const b = $("map-follow");
      if (!b) return;
      b.textContent = this.follow ? "◎" : "◇";
      b.title = this.follow ? "Seguir jogador (desligar)" : "Seguir jogador (ligar)";
    }

    // Arrasta o viewport (dx,dy em px de tela). Desliga o follow: o usuário assumiu o centro.
    pan(dx, dy) {
      this.follow = false;
      const c = this.canvas;
      const iw = this.imgW, ih = this.imgH;
      const fit = this.img ? Math.min(c.width / iw, c.height / ih) : Math.min(c.width / iw, c.height / ih);
      const s_eff = this.scale * fit;
      this.cx -= dx * 100 / (iw * s_eff);
      this.cy += dy * 100 / (ih * s_eff);
      this.clamp();
      this.syncFollowBtn();
    }

    render(mapCoords) {
      const c = this.canvas, ctx = this.ctx, W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      const iw = this.imgW, ih = this.imgH;
      const fit = this.img ? Math.min(W / iw, H / ih) : Math.min(W / iw, H / ih);
      const s_eff = this.scale * fit;

      // follow ON: toda atualização de coords reposiciona o centro (segue em tempo real)
      if (this.follow && mapCoords) {
        this.cx = mapCoords.x;
        this.cy = mapCoords.y;
      }
      this.clamp();

      const cx_img = (this.cx / 100) * iw;
      const cy_img = ((100 - this.cy) / 100) * ih; // norte = topo da textura

      ctx.save();
      ctx.setTransform(s_eff, 0, 0, s_eff, W / 2 - s_eff * cx_img, H / 2 - s_eff * cy_img);

      if (this.img) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(this.img, 0, 0, iw, ih);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = MAP_BG;
        ctx.fillRect(0, 0, iw, ih);
      }

      // grade: linha a cada 10 unidades de coord de mapa, recortada pelos limites do canvas
      ctx.strokeStyle = MAP_GRID;
      ctx.lineWidth = 1 / s_eff;
      for (let m = 0; m <= 100; m += GRID_STEP) {
        const x = (m / 100) * iw;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ih); ctx.stroke();
        const y = ((100 - m) / 100) * ih;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(iw, y); ctx.stroke();
      }
      ctx.restore();

      // rótulos 0/10/.../100 nas linhas maiores, tamanho fixo na tela, só o que couber no recorte
      ctx.fillStyle = MAP_LABEL;
      ctx.font = "12px sans-serif";
      ctx.textBaseline = "middle";
      for (let m = 0; m <= 100; m += GRID_STEP) {
        const sx = W / 2 + ((m / 100) * iw - cx_img) * s_eff; // linha vertical x = m
        if (sx >= 0 && sx <= W) {
          ctx.textAlign = "center";
          ctx.fillText(String(m), sx, 16);
        }
        const sy = H / 2 + (((100 - m) / 100) * ih - cy_img) * s_eff; // linha horizontal y = m
        if (sy >= 0 && sy <= H) {
          ctx.textAlign = "start";
          ctx.fillText(String(m), 10, sy);
        }
      }
      ctx.textAlign = "start";

      // pino do player: coordenadas reais, nunca somado (fica na tela por causa do clamp do centro)
      if (mapCoords) {
        const px = (mapCoords.x / 100) * iw;
        const py = ((100 - mapCoords.y) / 100) * ih;
        const sx = W / 2 + (px - cx_img) * s_eff;
        const sy = H / 2 + (py - cy_img) * s_eff;
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fillStyle = MAP_PIN;
        ctx.fill();
        ctx.lineWidth = 2;
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

    // ---- HUD e input ----

    bindHUD() {
      const inB = $("map-zoom-in");
      const outB = $("map-zoom-out");
      const folB = $("map-follow");
      if (inB) inB.addEventListener("click", (e) => { e.preventDefault(); this.zoomIn(); });
      if (outB) outB.addEventListener("click", (e) => { e.preventDefault(); this.zoomOut(); });
      if (folB) folB.addEventListener("click", (e) => { e.preventDefault(); this.toggleFollow(); });
      this.syncFollowBtn();
    }

    bindInput() {
      const c = this.canvas;
      let panX = null;
      let panY = null;
      let pinch = false;
      let pinchScale = 1;
      let pinchD0 = 0;
      let pinchMx = 0;
      let pinchMy = 0;

      c.addEventListener("touchstart", (e) => {
        if (e.touches.length === 2) {
          pinch = true;
          pinchD0 = dist(e.touches[0], e.touches[1]);
          pinchScale = this.scale;
          pinchMx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          pinchMy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        } else {
          panX = e.touches[0].clientX;
          panY = e.touches[0].clientY;
        }
        this.follow = false;
        e.preventDefault();
      }, { passive: false });

      c.addEventListener("touchmove", (e) => {
        if (pinch && e.touches.length === 2) {
          const d = dist(e.touches[0], e.touches[1]);
          this.setScale(pinchScale * (d / pinchD0), pinchMx, pinchMy);
        } else if (panX != null) {
          const t = e.touches[0];
          this.pan(t.clientX - panX, t.clientY - panY);
          panX = t.clientX;
          panY = t.clientY;
        }
        e.preventDefault();
      }, { passive: false });

      const endTouch = () => { pinch = false; panX = null; };
      c.addEventListener("touchend", endTouch);
      c.addEventListener("touchcancel", endTouch);

      c.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        panX = e.clientX;
        panY = e.clientY;
        this.follow = false;
      });
      c.addEventListener("mousemove", (e) => {
        if (panX == null) return;
        this.pan(e.clientX - panX, e.clientY - panY);
        panX = e.clientX;
        panY = e.clientY;
      });
      c.addEventListener("mouseup", () => { panX = null; });
      c.addEventListener("mouseleave", () => { panX = null; });

      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        const f = e.deltaY < 0 ? 1.25 : 1 / 1.25;
        this.setScale(this.scale * f, e.offsetX, e.offsetY);
      }, { passive: false });
    }
  }

  window.Minimap = Minimap;
})();
