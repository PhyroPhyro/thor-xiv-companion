# Roadmap de Features — Thor XIV Companion

> Atualizado: 2026-11-16. Referência de layout/tracks: [DS-Forever](https://github.com/Jreese702/DS-Forever) (companion dual-screen de WoW no Thor) — borrowed: tracks de features, companion-first, guias offline. Mantemos nossa arquitetura (bridge + WebSocket + PWA/APK) e nossas features.

---

## T1 — Fundação ✅ concluída

- Bridge Dalamud (WebSocket 5 Hz + HTTP + mDNS + companion embutido na DLL)
- PWA: minimapa, party, chat (canais XivChatType), target, self, relógio Eorzean
- APK Thor: tela de baixo, descoberta mDNS/scan, demo offline, watchdog
- PC: instalação deployada, firewall LAN-only, IP estático .194; deploy de novas builds via `scripts/deploy-pc.sh` (obrigatório após cada build do plugin)

## T2 — Macro / Hotkey bar (PRIORIDADE MÁXIMA) 🔨 em curso

O uso mais útil do segundo ecrã: tocar um botão na tela de baixo e o jogo agir.

- [x] **M1**: grid de 12 slots com **executor nativo** (`RaptureShellModule` — zero plugin extra): tipo `comando` (1 linha) ou `sequência` (macro próprio multi-linha com delay); editor, confirmação por botão, import/export. Tipo `Macro por ID do jogo` removido com o Telesto.
- [x] **M1.5**: tipo **Skill da classe (nativo)** — botões chamam `ActionManager.UseAction` (`UseActionMode.None` = "hotbar button press" no clientstructs), com catálogo de ações da classe via planilhas (`GET /api/actions`, cache por job) e alvos `auto/target/self/p1–p8`. Sem `/ac` textual, sem nome ambíguo, sem Telesto
- [ ] M2: cooldown real nos botões (recarga via ActionManager no payload; botão mostra recarga e disponibilidade)
- [ ] M3: páginas de hotbar (swipe horizontal) + por-zone/per-job automáticos
- [ ] M4: reordenar arrastando; importar/exportar JSON
- [ ] M5: ícones reais das ações (arquivos do jogo via bridge)

Sem dependências externas. O executor é 100% nativo (RaptureShellModule); nenhum plugin externo é necessário.

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
