// Checagem estática de DOM da PWA (roda como parte do smoke):
// 1) ids duplicados (index.html + innerHTML dos JS)  — bug 0.5.4 (hb-config)
// 2) $("id") que não existe em lugar nenhum          — typos/rename esquecido
// 3) $() top-level para id que não é estático do index.html — captura null
//    (bug 0.5.4: const grid = $("hotbar-grid") antes de build() criar o elemento)
// Uso: node scripts/check-dom.mjs <caminho-da-pasta-companion>
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || "companion";
const fail = (msg) => { console.error("DOM-FAIL:", msg); process.exit(1); };

const html = readFileSync(join(dir, "index.html"), "utf8");
const jsFiles = readdirSync(join(dir, "js")).filter((f) => f.endsWith(".js"));
const js = jsFiles.map((f) => [f, readFileSync(join(dir, "js", f), "utf8")]);

const staticIds = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const staticSet = new Set(staticIds);
for (const id of staticIds) {
  if (staticIds.filter((x) => x === id).length > 1) fail(`id "${id}" duplicado no index.html`);
}

// ids definidos em innerHTML/templates dos JS (heurística: id="..." e .id = "..." no código)
const dynamicIds = new Set();
for (const [, src] of js) {
  for (const m of src.matchAll(/id="([^"]+)"/g)) {
    if (dynamicIds.has(m[1])) fail(`id "${m[1]}" definido 2x em templates JS`);
    dynamicIds.add(m[1]);
  }
  for (const m of src.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)) {
    if (dynamicIds.has(m[1])) fail(`id "${m[1]}" definido 2x em templates JS`);
    dynamicIds.add(m[1]);
  }
}
for (const id of dynamicIds) if (staticIds.includes(id)) fail(`id "${id}" estático no index E em template JS`);

const definedIds = new Set([...staticSet, ...dynamicIds]);

// ids referenciados via $("...") / getElementById("...")
const refs = []; // {file, line, id, topLevel}
for (const [f, src] of js) {
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\$\(\s*["']([^"']+)["']\s*\)|getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
      const id = m[1] || m[2];
      if (!id || /^[a-z]+-id\b|dataset/i.test(id)) return;
      // top-level = linha com indentação <= 2 espaços (fora de funções do IIFE)
      const indent = l.match(/^\s*/)[0].length;
      refs.push({ file: f, line: i + 1, id, topLevel: indent <= 2 && !l.includes("function") });
    }
  });
}
for (const r of refs) {
  if (!definedIds.has(r.id)) fail(`${r.file}:${r.line} $("${r.id}") não existe no HTML nem em templates`);
  if (r.topLevel && !staticSet.has(r.id))
    fail(`${r.file}:${r.line} $("${r.id}") top-level mas id não é estático do index.html (captura null)`);
}
console.log(`ok: check-dom — ${staticSet.size} ids estáticos, ${dynamicIds.size} dinâmicos, ${refs.length} refs, tudo consistente`);
