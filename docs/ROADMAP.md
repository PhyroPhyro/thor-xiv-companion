# Roadmap de Features — Thor XIV Companion

> Atualizado: 2026-11-17 (checkpoint bugfixes v0.5.6). Referência de layout/tracks: [DS-Forever](https://github.com/Jreese702/DS-Forever) (companion dual-screen de WoW no Thor) — borrowed: tracks de features, companion-first, guias offline. Mantemos nossa arquitetura (bridge + WebSocket + PWA/APK) e nossas features.

---

## T1 — Fundação ✅ concluída

- Bridge Dalamud (WebSocket 5 Hz + HTTP + mDNS + companion embutido na DLL)
- PWA: minimapa, party, chat (canais XivChatType), target, self, relógio Eorzean
- APK Thor: tela de baixo, descoberta mDNS/scan, demo offline, watchdog
- PC: instalação deployada, firewall LAN-only, IP estático .194; deploy de novas builds via `scripts/deploy-pc.sh` (obrigatório após cada build do plugin)

## T2 — Macro / Hotkey bar ✅ checkpoint v0.5.6 (feature-complete p/ v1)

- [x] **M1**: grid com **executor nativo** (`RaptureShellModule`): `comando` (1 linha) ou `sequência` (multi-linha com delay); editor, confirmação, import/export
- [x] **M1.5**: tipo **Skill (nativo)** — `ActionManager.UseAction`, catálogo da classe (`GET /api/actions`, `icon` + `desc` via `ActionTransient`), alvos `auto/target/self/p1–p8`
- [x] **M1.7 (UX, 0.5.1–0.5.6)**: ícones CDN, tooltip long-press persistente, editor sheet + segmented, slots editáveis, **drag & drop** (move/swap), **grid 3x3/4x3/4x4** (Config centralizado), layout "uma aba por vez", identidade visual FFXIV (tokens.css), gesture-proofing WebView
- [x] **M4**: reordenar arrastando + import/export JSON
- [x] **M5 (re-escopo)**: ícones via CDN xivapi (online-first)
- [x] **M2**: cooldown real nos botões (0.5.9; countdown corrigido 0.5.12 — restante=total−elapsed)
- [x] **M6**: hotbar POR JOB (0.5.15): buckets por `player.jobId` com troca automática, catálogo de skills por job, export/import v2, chip de job no ⚙️ nos botões — próximo item natural
- [ ] **M3**: páginas de hotbar (swipe) — avaliar demanda (grid configurável já atende)
- Qualidade: `scripts/check-dom.mjs` no smoke; lições no `AGENTS.md`; ciclo = build → smoke → versão → APK → deploy PC → commit

## T10 — Settings (mapeamento futuro, 2026-11-17)

A aba Settings hoje só tem endpoint WS + modo demo. Mapa de opções para as próximas rodadas:

- [ ] **Idioma** (pt-BR / en, depois de/fr/ja) — exige extrair strings da UI p/ um `i18n.js` (chave→texto); default: detectar `navigator.language`
- [ ] **Color scheme** — temas via `tokens.css` (Midnight Gold default, Claro, Alto contraste, Daltônico p/ barras HP/MP); trocar só os tokens, zero mudança de layout
- [ ] **Aparência/layout** — escala da UI (root font-size), preset de grade default da hotbar, mostrar/ocultar target no status-bar, densidade dos slots
- [ ] **Conexão** — host/porta WS (já ✓), descoberta automática (mDNS `_thorxiv._tcp`), reconexão automática, status de latência
- [ ] **Mapa** — fonte das imagens (online xivapi ✓ default / assets locais opcionais), camadas de pins (aetheryte, FATE, marked spots), zoom inicial
- [ ] **Chat** — canal default p/ envio (party/linkshell/say), filtro por canal, mensagens rápidas configuráveis
- [ ] **Notificações** (T8) — vibração ao terminar cooldown, sons on/off, alerta de role/kill em party
- [ ] **Acessibilidade** — botões maiores (4x2 forçado), reduz movimento (desliga ghost/anim), alto contraste
- [ ] **Backup** — export/import de TUDO (hotbar+settings) num JSON só; reset de fábrica
Ordem sugerida: idioma+temes juntos (rodada leve), depois conexão/backup, resto conforme demanda.

## T3 — Mapa útil

> **✅ FEITO 0.5.11 (2026-11-17):** fundo da zona via XIVAPI v2 (`/api/search?sheets=Map&fields=Id&query=TerritoryType={id}` → `Id` `s1t1/01` → `/api/asset/map/{key}/{index}?format=jpg`), cache `txmap.v1`, fallback grade + badge. **Fonte de mapa (decisão 2026-11-17):**xivapi v2 compõe mapas por zona em runtime — `GET https://v2.xivapi.com/api/asset/map/{territoryType}/{subIndex}?format=jpg` (ex.: `s1d1/00`); hotlink encorajado pelo provedor, ~100–300 KB/zona, cache do browser resolve. Assets locais viram opcionais (offline não é meta). Falta o bridge expor `territoryType` numérico (row_id) no estado.

- [ ] Mapa por zona: dropar imagens `maps/{mapId}.{png|jpg}` (uso da convenção já criada); opção futura de extrair do próprio jogo
- [ ] Toque no mapa → abre o mapa grande do jogo com flag (pendente de executor de comando adequado)
- [ ] Pins de aetherytes/markers (dados estáticos de XIVAPI)
- [ ] Radar de hunts (fase posterior; fonte: endpoint de hunt público)

## T3.3 — POIs no mapa (parcial, 0.5.20)

- [x] Infra: busca MapMarker via xivapi v2 (cursor+cache `txpoi.v1`), pipeline de projeção igual ao pino (Y_FLIP=true validado contra MapUtil), classificação por ícone (60311 aetheryte ciano, comércio dourado pronto, demais cinza sutil)
- [x] ◎ ciclo de modos AUTO→SEGUIR(◉)→EXPLORAR(◇); pan/± caem em EXPLORAR
- [ ] Cobertura completa: API v2 deduplica subrows → poucas zonas retornam tudo. Fonte definitiva: plugin expor marcadores via AgentMap do jogo (próxima rodada, payload `pois[]` no state)

## T4 — Tracker de quests/duty

- [ ] Quest log no payload (Dalamud: `QuestManager`/Journal) — painel "quests" com tracker ativo (layout referência DS-Forever: tracked quest fixo no topo)
- [ ] Fases de duty (reusable content) + progresso de instância
- [ ] Checklist manual por duty (offline-friendly, estilo Game Twin)

## T5 — Party melhorada

- [ ] Papéis (T/H/D) com cores + ícones de job (imagens do jogo via bridge)
- [ ] Status/buffs da party no payload (`Statuses` do `IPartyMember`/ObjectTable)
- [ ] Posições relativas (minimapa com dots da party — já temos coords, falta render)
- [ ] DPS/encounter via ACT/IINACT WebSocket (fase posterior, opcional)

## T6 — Chat completo

- [ ] Filtro por canal + busca
- [ ] Enviar mensagem/comando pela tela de baixo (comando nativo `/say`, `/p`, `/shout` via `/api/command`)
- [ ] Cores por linha de battle chat (action/heal/dmg já categorizados; refinar)

## T7 — Guias offline

- [ ] Wiki/checklists por duty salvos (semelhante ao guia do DS-Forever)
- [ ] Notas por personagem/perfil (localStorage, exportável)

## T8 — App Android nativo (substituir WebView)

- [x] Não rouba foco de gamepad/teclado do jogo (0.5.14): janela `FLAG_NOT_FOCUSABLE` no companion; foco temporário p/ IME via `ThorNative.requestTextFocus`
- [ ] `Presentation` não-focusável como no padrão gen1recomp; vibration/haptic ao apertar macro
- [ ] Slots de hotbar visíveis mesmo sem rede (último snapshot cacheado)
- [ ] Atalho de tela + profile por jogo (integração Wayfinder)

## T9 — Extras/avançado

- [ ] Streaming de pair (estilo DS-Forever Desktop: código de pareamento) — só se valer o custo

---

## Notas de política/segurança

- Hotbar só executa **macro de jogo ou /command digitável**: equivale a apertar um botão do hotbar — sem automação, sem loop, sem reação a eventos do jogo. Manter assim para respeito à política da SE.
- Bridge faz allow-list de telegramas (ExecuteCommand, Macro, PrintMessage, Bundle); Doodle/Subscribe/Form ficam desabilitados até T9.
- `/api/command` só ouve na LAN; respostas de erro não vazam stack.
