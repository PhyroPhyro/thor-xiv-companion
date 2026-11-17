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

  // tokens de ponto de interesse (css/tokens.css)
  const POI_AETHERYTE = gv("--poi-aetheryte");
  const POI_COMMERCE = gv("--poi-commerce");
  const POI_DEFAULT = gv("--poi-default");
  const MAP_LABEL_INK = gv("--map-label-ink");
  const MAP_LABEL_HALO = gv("--map-label-halo");

  const POI_TIMEOUT_MS = 8000;
  const POI_LIMIT = 100;

  // POIs do jogo vivem so por zona/sessao: cache em memoria (mapRowId -> lista),
  // sem persistir em localStorage (txpoi.v1 aposentado p/ essa fonte).
  const POI_MEM = new Map();

  const MAP_CACHE_KEY = "txmap.v1";
  // 60311 = aetheryte (confere: marca as pedras de invocação / aetherytes).
  // Nenhum ícone de comércio/lojista apareceu nos conjuntos coletados; a classe
  // fica definida para receber ids reais quando confirmados pelos dados.
  // classes por ícone REAL (inspecionados via xivapi):
  // 60453 = cristal (aetheryte) | 60311 = chocobinho dourado (aethernet) | 60441 = triângulo (aetheryte de distrito/emerald)
  const POI_AETHERYTE_ICONS = new Set([60453]);
  const POI_AETHERNET_ICONS = new Set([60311]);
  const POI_DISTRICT_ICONS = new Set([60441]);

  const RESOLVE_TIMEOUT_MS = 6000;
  const XIVAPI_BASE = "https://v2.xivapi.com";
  const Y_FLIP = true; // v. teste de marco: true se norte-sul espelhado na imagem do xivapi

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
      this.SF = { x: 100, y: 100 }; // SizeFactor da linha Map: px de textura por unidade de coord via (imgW/2.54)/SF
      this.lastCoords = null;  // últimas coords vistas (projeção do pino mesmo em modo manual parado)
      this.mode = "auto";      // "auto" | "follow" | "explore" (◎ cicla; pan/± → explore)
      this.autoFrame = true;   // enquadra a área onde o player anda (média + spread do buffer); off em pan/zoom manual
      this.buf = [];           // últimas coords da zona
      this.lastPos = null;
      this.pois = null; // marcadores da zona atual (null = ainda não carregados; [] = nenhum)
      this.poiSource = null; // "game" | "api" | null — fonte dos this.pois (jogo ou fallback xivapi)

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
        this.pois = null;
        this.poiSource = null;
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
      this.autoFrame = true;
      this.mode = "auto";
      this.buf = [];
      this.manualAnchor = null;
      this.lastPos = null;
      this.pois = null; // troca de zona: limpa marcadores antigos imediatamente, nunca POI de zona errada
      this.poiSource = null;
      await this.resolveAndLoad(zoneId);
      this.loading = false;
      // a zona pode ter trocado enquanto a rede aguardava
      if (this.pendingZoneId !== zoneId) return;
      // pontos de interesse da zona: 1 HTTP por página, cache em localStorage, falha silenciosa
      if (this.resolved && this.resolved.rowId) await this.loadPois(this.resolved.rowId);
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
      if (hit && hit.key && hit.sf && hit.sf.x && hit.sf.y && hit.rowId)
        return { key: hit.key, index: hit.index || "00", sf: hit.sf, rowId: hit.rowId };

      // 2) XIVAPI v2: busca a linha da sheet Map cujo TerritoryType == zone.id
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
      let data;
      try {
        const url =
          XIVAPI_BASE +
          "/api/search?sheets=Map&fields=Id,SizeFactor&query=" +
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
      // preferir a linha principal "/00" (mapa completo da zona); sub-rotinas /01+ são recortes
      let row = results.find((r) => { const idv = (r.fields || {}).Id; const t = idv && idv.value !== undefined ? idv.value : idv; return String(t || "").endsWith("/00"); }) || results[0];
      if (!row) return null;
      const rowId = row.row_id; // row_id da linha Map: chave da busca de marcadores (DataKey)
      const fields = row.fields || {};
      const idv = fields.Id;
      const idStr = idv && idv.value !== undefined ? idv.value : idv;
      if (!idStr) return null;
      // SizeFactor: v2 devolve a coluna inteira (numero em muitos jobs, ou {value:N} — aceitar ambos)
      let sfv = fields.SizeFactor;
      if (sfv && typeof sfv === "object" && sfv.value !== undefined) sfv = sfv.value;
      const sf = Number.isFinite(sfv) && sfv > 0 ? { x: sfv, y: sfv } : null;
      // Id vem no formato "s1d1/00" (sheetKey/index); index "00" default
      const parts = String(idStr).split("/");
      const resolved = { key: parts[0], index: parts[1] || "00", sf, rowId };

      // grava no cache para a próxima troca de zona (rowId incluído)
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
        this.SF = (resolved && resolved.sf) ? resolved.sf : { x: 100, y: 100 };
        this.buf = []; this.manualAnchor = null; if (this.autoFrame) { this.scale = ZOOM_MIN; }
      }
    }

    // Busca os marcadores da sheet MapMarker para o mapa da zona (rowId da linha Map).
    // FALLBACK do xivapi: so usado quando o jogo nao fornece state.pois (fora do jogo).
    // 1 HTTP por página; segue o cursor `next` até esgotar. Timeout 8s, falha silenciosa.
    // Resultado: this.pois = [{x, y, icon, name}] em valores brutos da API (X,Y ~0..1024),
    // cache apenas em memoria (POI_MEM, chaveado por mapRowId) — sem localStorage.
    async loadPois(mapRowId) {
      if (this.pois != null) return; // já carregado para esta zona (jogo ou API)
      const hit = POI_MEM.get(mapRowId);
      if (hit) { this.pois = hit; this.poiSource = "api"; return; }

      const pois = [];
      let cursor = null;
      for (let pages = 0; pages < 8; pages++) { // freio de segurança; esgota via cursor `next`
        let url =
          XIVAPI_BASE +
          "/api/search?sheets=MapMarker&fields=X,Y,Icon,PlaceNameSubtext.Name&query=" +
          encodeURIComponent("DataKey=" + mapRowId) +
          "&limit=" + POI_LIMIT;
        if (cursor) url += "&cursor=" + encodeURIComponent(cursor);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), POI_TIMEOUT_MS);
        let data;
        try {
          const r = await fetch(url, { signal: controller.signal });
          if (!r.ok) break;
          data = await r.json();
        } catch (e) {
          this.jserr("loadPois fetch page falhou: " + (e && e.message ? e.message : e));
          break; // falha silenciosa na UI, mas logada p/ diagnóstico
        } finally {
          clearTimeout(timer);
        }
        const results = data.results || data.rows || [];
        for (const res of results) {
          const f = res.fields || {};
          if (!f.Icon || !f.Icon.id) continue; // sem ícone: não desenha nada
          const x = Number(f.X), y = Number(f.Y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          pois.push({
            x: x, y: y,
            icon: Number(f.Icon.id),
            name: (f.PlaceNameSubtext && f.PlaceNameSubtext.fields && f.PlaceNameSubtext.fields.Name) || ""
          });
        }
        cursor = data.next;
        if (!cursor || results.length < POI_LIMIT) break; // esgotou
      }

      this.pois = pois; // [] quando não há marcadores ou a busca falhou
      this.poiSource = "api"; // fallback ativo: badge discreto no render
      this.jserr("loadPois row=" + mapRowId + " -> " + pois.length + " marcadores (API)");
      POI_MEM.set(mapRowId, pois); // apenas memoria, nada de localStorage
    }

    // Recebe os POIs do estado do jogo (state.pois, ja em px2048 alinhados ao pino do player).
    // Chame a cada novo estado, apos loadImage da zona, para que os marcadores do jogo
    // sobrescrevam o fallback da API e nunca mostrem marcador de zona errada.
    setPois(pois) {
      const have = Array.isArray(pois) && pois.length > 0;
      this.pois = have ? pois : null; // null => sem dados do jogo: fallback xivapi rearma
      this.poiSource = have ? "game" : null;
    }

    // ---- viewport ----

    // Limita o centro para que a textura nunca saia da tela: quando o recorte é
    // menor que a textura (zoom > 1), o centro pode rodar até as bordas da imagem;
    // quando a imagem já cabe inteira (scale 1), o centro fica travado ao meio.
    // CANÔNICO (xivapi/ffxiv-datamining MapCoordinates.md): coord = px/SF*2 + 1 na textura 2048.
    // px = (coord-1)*SF/2 ; pino y-invertido (norte topo). Escala por imgW/2048 p/ variações de asset.
    // Y_FLIP: se um teste em marco conhecido mostrar o pino espelhado verticalmente
    // (ex.: virar ao norte e o pino descer), trocar para true — único ponto da inversão.
    xImg(x) { return (x - 1) * (this.SF.x / 2) * (this.imgW / 2048); }
    yImg(y) { return Y_FLIP ? (y - 1) * (this.SF.y / 2) * (this.imgH / 2048)
                            : this.imgH - (y - 1) * (this.SF.y / 2) * (this.imgH / 2048); }
    imgXToCoord(px) { return px * 2 / this.SF.x * (2048 / this.imgW) + 1; }
    imgYToCoord(py) { return (Y_FLIP ? py : this.imgH - py) * 2 / this.SF.y * (2048 / this.imgH) + 1; }

    clamp() {
      const c = this.canvas;
      const W = c.width, H = c.height;
      const iw = this.imgW, ih = this.imgH;
      const fit = Math.min(W / iw, H / ih);
      const s_eff = this.scale * fit;
      const vx = W / (2 * s_eff); // metade da largura visível em px de textura
      const vy = H / (2 * s_eff);
      let minX = vx, maxX = Math.max(vx, iw - vx);
      let minY = vy, maxY = Math.max(vy, ih - vy);
      const cx_img = Math.min(Math.max(this.xImg(this.cx), minX), maxX);
      const cy_img = Math.min(Math.max(this.yImg(this.cy), minY), maxY);
      this.cx = this.imgXToCoord(cx_img);
      this.cy = this.imgYToCoord(cy_img);
      // bordas do span de coords (independentes de Y_FLIP): pega o MAIOR entre as duas origens
      this.cx = Math.min(Math.max(this.cx, 1), this.imgXToCoord(this.imgW));
      this.cy = Math.min(Math.max(this.cy, 1), Math.max(this.imgYToCoord(0), this.imgYToCoord(this.imgH)));
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
      const cx_img = this.xImg(this.cx);
      const cy_img = this.yImg(this.cy);
      // ponto do mapa sob o ponto da tela, antes da mudança
      const ux = cx_img + (aboutX - W / 2) / s_eff;
      const uy = cy_img + (aboutY - H / 2) / s_eff;
      this.scale = next;
      const s2 = this.scale * fit;
      // novo centro de modo a manter (ux, uy) projetado em (aboutX, aboutY)
      this.cx = this.imgXToCoord(ux - (aboutX - W / 2) / s2);
      this.cy = this.imgYToCoord(uy - (aboutY - H / 2) / s2);
      this.clamp();
    }

    // +/− só mudam o fator de zoom; o enquadramento continua acompanhando o player
    // (autoFrame ligado; se desligado antes, mantém-se a ancora manual que anda com o player)
    zoomIn() {
      if (!this.autoFrame && !this.follow) this.mode = "explore";
      this.setScale(this.scale * ZOOM_STEP, this.canvas.width / 2, this.canvas.height / 2);
    }

    zoomOut() {
      if (!this.autoFrame && !this.follow) this.mode = "explore";
      this.setScale(this.scale / ZOOM_STEP, this.canvas.width / 2, this.canvas.height / 2);
    }

    // ◎ ciclo de modos: AUTO (enquadra onde você anda) -> SEGUIR (jogador centrado) -> EXPLORAR.
    // pan/zoom ± também caem em EXPLORAR.
    toggleFollow() {
      if (this.autoFrame) {
        this.autoFrame = false; this.follow = true; this.mode = "follow";
      } else if (this.follow) {
        this.follow = false; this.mode = "explore";
      } else {
        this.autoFrame = true; this.follow = false; this.buf = []; this.manualAnchor = null; this.mode = "auto";
      }
      this.syncFollowBtn();
    }

    modeLabel() { return this.autoFrame ? "auto" : (this.follow ? "follow" : "explore"); }

    syncFollowBtn() {
      const b = $("map-follow");
      if (!b) return;
      const label = this.modeLabel();
      b.textContent = label === "auto" ? "◎" : (label === "follow" ? "◉" : "◇");
      b.title = "Modo " + label + " — toque: auto → seguir → explorar";
    }

    // Arrasta o viewport (dx,dy em px de tela). Desliga o follow: o usuário assumiu o centro.
    pan(dx, dy) {
      this.follow = false; this.autoFrame = false; this.mode = "explore";
      const c = this.canvas;
      const iw = this.imgW, ih = this.imgH;
      const fit = this.img ? Math.min(c.width / iw, c.height / ih) : Math.min(c.width / iw, c.height / ih);
      const s_eff = this.scale * fit;
      this.cx -= dx * (2 / this.SF.x) * (2048 / iw) / s_eff;
      // Y_FLIP: coord cresce para o sul (baixo da tela). Arrastar o dedo p/ baixo (dy>0)
      // deve DESLIZAR o mapa p/ baixo => janela sobe p/ norte => coord do centro DIMINUI.
      this.cy += (Y_FLIP ? -dy : dy) * (2 / this.SF.y) * (2048 / ih) / s_eff;
      this.manualAnchor = this.lastCoords ? { x: this.lastCoords.x, y: this.lastCoords.y } : null;
      this.clamp();
      this.syncFollowBtn();
    }

    render(mapCoords) {
      try {
        this.renderInner(mapCoords);
      } catch (e) {
        this.errCount = (this.errCount || 0) + 1;
        if (this.errCount <= 5) this.jserr("render #" + this.errCount + ": " + (e && e.stack ? e.stack : e));
      }
    }

    jserr(m) {
      if (window.ThorNative && window.ThorNative.log) { try { window.ThorNative.log("MAP " + m); } catch (e2) { /* noop */ } }
      if (window.console && console.warn) console.warn("MAP " + m);
    }

    renderInner(mapCoords) {
      const c = this.canvas, ctx = this.ctx, W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      const iw = this.imgW, ih = this.imgH;
      const fit = this.img ? Math.min(W / iw, H / ih) : Math.min(W / iw, H / ih);
      const s_eff = this.scale * fit;

      if (mapCoords) {
        const pt = { x: mapCoords.x, y: mapCoords.y };
        if (this.lastPos && Math.abs(pt.x - this.lastPos.x) + Math.abs(pt.y - this.lastPos.y) > 25) { this.buf = []; this.cx = pt.x; this.cy = pt.y; } // teleporte re-ancora
        this.lastPos = pt;
        this.buf.push(pt);
        if (this.buf.length > 90) this.buf.shift();
        if (this.autoFrame && this.buf.length >= 4) {
          let mx = 0, my = 0;
          for (const b of this.buf) { mx += b.x; my += b.y; }
          mx /= this.buf.length; my /= this.buf.length;
          let dev = 0;
          for (const b of this.buf) dev = Math.max(dev, Math.abs(b.x - mx) * (this.SF.x / 2), Math.abs(b.y - my) * (this.SF.y / 2)); // spread em px
          // alvo: ver ~600px de textura do andar de 90s; clampado a um zoom local baixo por pedido do dono
          const target = Math.min(2.5, Math.max(ZOOM_MIN, 600 / Math.max(dev, 60)));
          this.scale += (target - this.scale) * 0.12;
          this.cx += (mx - this.cx) * 0.15;
          this.cy += (my - this.cy) * 0.15;
        } else if (this.follow) {
          this.cx = mapCoords.x;
          this.cy = mapCoords.y;
        } else if (this.manualAnchor) {
          // modo manual: o centro anda com o player mantendo a posição relativa na tela (pino nunca sai/para)
          this.cx += mapCoords.x - this.manualAnchor.x;
          this.cy += mapCoords.y - this.manualAnchor.y;
        }
        this.manualAnchor = { x: mapCoords.x, y: mapCoords.y };
        this.lastCoords = pt;
      } else {
        this.manualAnchor = null;
        this.lastCoords = null; // sem dados: sem pino (evita fantasma congelado no logout)
      }
      this.clamp();

      const cx_img = this.xImg(this.cx);
      const cy_img = this.yImg(this.cy);

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
      const gridMax = Math.ceil(Math.max(this.imgXToCoord(iw), 100) / GRID_STEP) * GRID_STEP;
      for (let m = 0; m <= gridMax; m += GRID_STEP) {
        const x = this.xImg(m);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ih); ctx.stroke();
        const y = this.yImg(m);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(iw, y); ctx.stroke();
      }
      ctx.restore();

      // rótulos 0/10/.../100 nas linhas maiores, tamanho fixo na tela, só o que couber no recorte
      ctx.fillStyle = MAP_LABEL;
      ctx.font = "12px sans-serif";
      ctx.textBaseline = "middle";
      for (let m = 0; m <= gridMax; m += GRID_STEP) {
        const sx = W / 2 + (this.xImg(m) - cx_img) * s_eff; // linha vertical x = m
        if (sx >= 0 && sx <= W) {
          ctx.textAlign = "center";
          ctx.fillText(String(m), sx, 16);
        }
        const sy = H / 2 + (this.yImg(m) - cy_img) * s_eff; // linha horizontal y = m
        if (sy >= 0 && sy <= H) {
          ctx.textAlign = "start";
          ctx.fillText(String(m), 10, sy);
        }
      }
      ctx.textAlign = "start";

      // pontos de interesse: mesma projeção do pino do player (xImg/yImg),
      // desenhados antes dele; v1 puramente visual, sem hit-testing/toque
      if (this.pois && this.img) {
        for (const p of this.pois) {
          // Docs XIVAPI: px do doc = topo-esquerda igual ao nosso (eixo Y medido: marcador X=804 a ~8px do
          // player em modo direto). Y do doc (FishingSpot-style) é origem INFERIOR -> yImg trata o norte;
          // mantemos cy direto como no X e o Y_FLIP do pipeline cuida da tela.
          const cx = p.x * 2 / this.SF.x + 1;
          const cy = p.y * 2 / this.SF.y + 1;
          const px = this.xImg(cx);
          const py = this.yImg(cy);
          const sx = W / 2 + (px - cx_img) * s_eff;
          const sy = H / 2 + (py - cy_img) * s_eff;
          const kind = POI_AETHERYTE_ICONS.has(p.icon) ? "aetheryte"
            : POI_AETHERNET_ICONS.has(p.icon) ? "aethernet"
            : POI_DISTRICT_ICONS.has(p.icon) ? "district" : "default";
          // tamanho dinâmico: no zoom 1 o POI é quase o pino do jogador (10px) e cresce com o zoom
          const base = kind === "aetheryte" ? 9 : (kind === "aethernet" ? 8 : 7);
          const r = Math.min(28, base * (0.95 + 0.45 * (this.scale - 1)));
          if (sx < -r - 8 || sx > W + r + 8 || sy < -r - 8 || sy > H + r + 8) continue;
          const col = kind === "aetheryte" ? POI_AETHERYTE
            : (kind === "default" ? POI_DEFAULT : POI_COMMERCE);
          ctx.beginPath();
          if (kind === "aetheryte") {
            // losango (cristal)
            ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy);
            ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r, sy); ctx.closePath();
          } else if (kind === "district") {
            // triângulo (marcador de alvo/NPC como no jogo)
            ctx.moveTo(sx, sy + r); ctx.lineTo(sx - r, sy - r); ctx.lineTo(sx + r, sy - r); ctx.closePath();
          } else if (kind === "aethernet") {
            // estrela de 4 pontas (nó de aethernet)
            ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r * 0.38, sy - r * 0.38); ctx.lineTo(sx + r, sy);
            ctx.lineTo(sx + r * 0.38, sy + r * 0.38); ctx.lineTo(sx, sy + r);
            ctx.lineTo(sx - r * 0.38, sy + r * 0.38); ctx.lineTo(sx - r, sy);
            ctx.lineTo(sx - r * 0.38, sy - r * 0.38); ctx.closePath();
          } else {
            ctx.arc(sx, sy, r * 0.8, 0, Math.PI * 2);
          }
          ctx.fillStyle = col;
          ctx.fill();
          ctx.lineWidth = kind === "default" ? 1 : 1.5;
          ctx.strokeStyle = MAP_PIN_STROKE;
          ctx.stroke();
          // label embaixo do marcador: fade progressivo com o zoom (invisível no zoom-out,
          // legível conforme aproxima) — não polui a vista geral
          const nm = p.label || p.name ||
            (kind === "aetheryte" ? "Aetheryte" : kind === "aethernet" ? "Aethernet Node" : "");
          if (nm) {
            const a = Math.min(1, Math.max(0, (this.scale - 1.15) / 1.1));
            if (a > 0.04) {
              ctx.save();
              ctx.globalAlpha = a;
              ctx.font = Math.round(9 + 3 * (this.scale - 1)) + "px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              const lx = sx, ly = sy + r + 3;
              ctx.lineWidth = 3;
              ctx.strokeStyle = MAP_LABEL_HALO;
              ctx.strokeText(nm, lx, ly);
              ctx.fillStyle = MAP_LABEL_INK;
              ctx.fillText(nm, lx, ly);
              ctx.restore();
            }
          }
        }
      }

      // pino do player: projeta SEMPRE que houver coords (mesmo com auto/follow desligados)
      if (this.lastCoords) {
        const px = this.xImg(this.lastCoords.x);
        const py = this.yImg(this.lastCoords.y);
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
      if (this.poiSource === "api") {
        // fallback do xivapi (fora do jogo): aviso discreto, acima do badge de status
        ctx.fillStyle = MAP_OFFLINE;
        ctx.font = "12px sans-serif";
        ctx.textAlign = "end";
        ctx.textBaseline = "bottom";
        ctx.fillText("POI aproximado (API)", W - 10, H - 26);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
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
        this.follow = false; this.autoFrame = false; this.mode = "explore"; this.manualAnchor = this.lastCoords ? { x: this.lastCoords.x, y: this.lastCoords.y } : null; this.autoFrame = false;
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
        this.follow = false; this.autoFrame = false; this.mode = "explore"; this.manualAnchor = this.lastCoords ? { x: this.lastCoords.x, y: this.lastCoords.y } : null; this.autoFrame = false;
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
