// Minimap renderer: grid do mapa + imagem opcional (/maps/{mapId}.jpg|png|webp) + marcador do player.
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

  const INVERT_Y = true; // y de mapa aumenta para o norte (topo) — inverta se o pino ficar espelhado

  class Minimap {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.mapId = null;
      this.img = null;
      this.imgTried = false;
    }

    loadImage(mapId) {
      if (this.mapId === mapId && (this.img || this.imgTried)) return;
      this.mapId = mapId;
      this.img = null;
      this.imgTried = false;
      if (mapId == null) { this.imgTried = true; return; }
      const exts = ["jpg", "png", "webp"];
      let idx = 0;
      const tryNext = () => {
        if (idx >= exts.length) { this.imgTried = true; return; }
        const img = new Image();
        img.onload = () => { this.img = img; this.imgTried = true; };
        img.onerror = () => { idx++; tryNext(); };
        img.src = "/maps/" + mapId + "." + exts[idx++];
      };
      tryNext();
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

      // grid 4x4 (setores) + subdivisões de 10%
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

      if (!this.img && !this.imgTried) {
        ctx.fillStyle = MAP_EMPTY;
        ctx.font = "20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("carregando mapa…", W / 2, H / 2);
        ctx.textAlign = "start";
      }
    }
  }

  window.Minimap = Minimap;
})();
