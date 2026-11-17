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
- [ ] **M2**: cooldown real nos botões — próximo item natural
- [ ] **M3**: páginas de hotbar (swipe) — avaliar demanda (grid configurável já atende)
- Qualidade: `scripts/check-dom.mjs` no smoke; lições no `AGENTS.md`; ciclo = build → smoke → versão → APK → deploy PC → commit

## T3 — Mapa útil

- [ ] Mapa por zona: dropar imagens `maps/{mapId}.{png|jpg}` (uso da convenção já criada); opção futura de extrair do próprio jogo
- [ ] Toque no mapa → abre o mapa grande do jogo com flag (pendente de executor de comando adequado)
- [ ] Pins de aetherytes/markers (dados estáticos de XIVAPI)
- [ ] Radar de hunts (fase posterior; fonte: endpoint de hunt público)

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
