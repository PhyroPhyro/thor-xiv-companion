// Smoke test do protocolo do bridge: static, /api/state e WebSocket.
// Uso: node scripts/smoke.mjs [porta] [dir-da-pwa] — exige ServerHarness rodando.
// Inclui check-dom.mjs (sanidade de ids: duplicados, referências e capturas top-level).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = process.argv[2] || "11436";
const pwaDir = process.argv[3] || "companion";
const here = dirname(fileURLToPath(import.meta.url));
const base = `http://127.0.0.1:${port}`;

// 0) sanidade de DOM (estático)
const dom = spawnSync("node", [join(here, "check-dom.mjs"), pwaDir], { encoding: "utf8" });
(dom.stdout || "").trim().split("\n").filter(Boolean).forEach((l) => console.log(l));
if (dom.status !== 0) process.exit(1);

const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

// 1) static index
const html = await (await fetch(base + "/")).text();
if (!html.includes("Thor XIV Companion")) fail("index.html não servido corretamente");
console.log("ok: / serve o companion");

// 2) manifest + js
for (const p of ["/manifest.webmanifest", "/js/app.js", "/css/app.css", "/js/demo.js"]) {
  const r = await fetch(base + p);
  if (r.status !== 200) fail(p + " -> " + r.status);
}
console.log("ok: assets estáticos");

// 3) api/state
const state = await (await fetch(base + "/api/state")).json();
if (state.type !== "state" || !state.player?.mapCoords) fail("payload /api/state inválido");
console.log("ok: /api/state ->", state.zone.name, state.player.mapCoords.x);

// 4) websocket
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const msg = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("timeout 3s sem frame WS")), 3000);
  ws.onmessage = (e) => { clearTimeout(t); res(e.data); };
  ws.onerror = () => clearTimeout(t);
});
const s = JSON.parse(msg);
if (s.type !== "state") fail("primeiro frame WS não é snapshot");
console.log("ok: WS handshake + frame #1 -> party", s.party.length, "membros");

// 5) frames sucessivos (broadcast 200ms)
const msg2 = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("segundo frame não chegou")), 3000);
  ws.onmessage = (e) => { clearTimeout(t); res(e.data); };
});
if (JSON.parse(msg2).type !== "state") fail("segundo frame inválido");
console.log("ok: broadcast contínuo");

ws.close();
console.log("\nSMOKE PASSOU ✔");
