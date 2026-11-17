# Feature Roadmap — Thor XIV Companion

> Updated: 2026-11-17 (English is the project's default documentation language; pt-BR may come back as an extra). Layout/track reference: [DS-Forever](https://github.com/Jreese702/DS-Forever) (dual-screen WoW companion on the Thor) — borrowed: feature tracks, companion-first, offline guides. We keep our own architecture (bridge + WebSocket + PWA/APK) and our own features.

---

## T1 — Foundation ✅ done

- Dalamud bridge (WebSocket ~5 Hz + HTTP + mDNS + PWA served from the plugin)
- PWA: minimap, party, chat (XivChatType channels), target, self, Eorzean clock
- Thor APK: lower screen, mDNS/scan discovery, offline demo, watchdog
- PC: deployed install, LAN-only firewall, static IP; every plugin build ships via `scripts/deploy-pc.sh` (mandatory)

## T2 — Macro / Hotkey bar ✅ complete (0.5.x series)

- [x] **M1**: grid with **native executor** (`RaptureShellModule`): `command` (one line) or `sequence` (multi-line, human delay); editor, confirm, import/export
- [x] **M1.5**: **Skill (native)** kind — `ActionManager.UseAction`, class catalog (`GET /api/actions`, `icon` + `desc` via `ActionTransient`), targets `auto/target/self/p1–p8`
- [x] **M1.7 (UX, 0.5.1–0.5.25)**: CDN icons, persistent long-press tooltip, sheet editor + segmented control, drag & drop (move/swap), grid presets (now **2x2/3x3/4x4**), "one tab at a time" layout, FFXIV-style design tokens, WebView gesture-proofing (jitter-safe touch recognizer)
- [x] **M2**: real cooldowns (0.5.9; countdown fixed 0.5.12 — remaining = total − elapsed)
- [x] **M3**: superseded by configurable grids (kept as backlog)
- [x] **M4**: reorder by dragging + JSON import/export
- [x] **M5 (re-scoped)**: icons via XIVAPI CDN (online-first)
- [x] **M6**: **per-job hotbars** (0.5.15) — buckets keyed by `player.jobId`, auto-switch, per-job skill catalog, export/import v2, job chip in ⚙️
- [x] **M7**: **split view ◫** (0.5.24, refined 0.5.25) — map left / hotbar right, persisted, single canvas instance

## T3 — Useful map

- [x] Zone background via XIVAPI v2 (resolve Map row → composed `.../asset/map/{key}/{index}` jpg; caches `txmap.v1`; grid fallback + badge)
- [x] Correct player marker (official coordinate formula; camera modes ◎/◉/◇; zoom +/−, pan, no page scroll)
- [x] POIs (see T3.3)
- [ ] Tap map → open in-game map with a flag (needs proper command executor support)
- [ ] Hunt radar (later phase; public hunt endpoint)

## T3.3 — Map POIs (partial, 0.5.25)

- [x] Infrastructure: MapMarker search via XIVAPI v2 (cursor pagination + `txpoi.v1` cache), same projection pipeline as the player pin, icon-verified classification (60453 aetheryte → cyan diamond, 60311 aethernet → gold, 60441 district triangle, rest subtle gray)
- [ ] Full coverage: the v2 API collapses sub-rows → some zones return only a few markers. Definitive source: plugin exposing markers via the game's `AgentMap` (next: `pois[]` in the state payload)

## T10 — Settings (planned mapping, 2026-11-17)

The Settings tab currently has only the WS endpoint + demo toggle. Options map for upcoming rounds:

- [ ] **Language** (en default; pt-BR/de/fr/ja later) — requires extracting UI strings into `i18n.js`; default from `navigator.language`
- [ ] **Color scheme** — themes via `tokens.css` (Midnight Gold default, Light, High contrast, colorblind-safe HP/MP bars); token swap only, zero layout changes
- [ ] **Appearance/layout** — UI scale (root font-size), default hotbar grid preset, show/hide target in status bar, slot density
- [ ] **Connection** — WS host/port (done), auto-discovery (mDNS `_thorxiv._tcp`), auto-reconnect, latency readout
- [ ] **Map** — image source (online XIVAPI default / optional local assets), pin layers (aetheryte, FATE, custom marks), initial zoom
- [ ] **Chat** — default send channel (party/linkshell/say), channel filter, quick messages
- [ ] **Notifications** (T8) — haptic when cooldown ends, sounds on/off, party role alerts
- [ ] **Accessibility** — bigger buttons, reduced motion (no ghost/animations), high contrast
- [ ] **Backup** — single JSON with everything (hotbar+settings); factory reset
Suggested order: language + themes together (light round), then connection/backup, rest on demand.

## T4 — Quest/duty tracker

- [ ] Quest log in the payload (Dalamud `QuestManager`/Journal) — quest panel with tracked quest pinned (DS-Forever layout reference)
- [ ] Duty (reusable content) phases + instance progress
- [ ] Manual duty checklist (Game-Twin style)

## T5 — Party, improved

- [ ] Roles (T/H/D) with colors + job icons
- [ ] Party statuses/buffs in the payload (`Statuses` from `IPartyMember`/ObjectTable)
- [ ] Relative positions on the minimap (dots; data already in state)
- [ ] DPS/encounter via ACT/IINACT WebSocket (later, optional)

## T6 — Chat, complete

- [x] Send messages/commands from the second screen (`/say`, `/p`, `/ls1` via the native executor)
- [ ] Per-channel filter + search
- [ ] Battle-chat line colors (already categorized; refine)

## T7 — Guides

- [ ] Duty wiki/checklists stored per content (DS-Forever-style guide)
- [ ] Notes per character/profile (localStorage, exportable)

## T8 — Native Android app (replace plain WebView)

- [x] Never steals gamepad/keyboard focus from the game (0.5.14+): `FLAG_NOT_FOCUSABLE` window, temporary IME focus through `ThorNative`
- [x] Installs and verifies itself: deploy pipeline opens the app and asserts resumed + crash-free (deploy-thor.sh)
- [ ] Last-state cached bars/hotbar visible without network
- [ ] Home shortcut + per-game profile (Wayfinder integration)

## T9 — Extras/advanced

- [ ] Paired streaming (DS-Forever Desktop pairing-code style) — only if it earns its cost
- [ ] Waymarks/doodles via Telesto-class plugin (would reintroduce the removed dependency; open question)

---

## Policy/security notes

- The hotbar only executes a **game macro or a typed `/command`**: equivalent to pressing a hotbar button — no automation, no loops, no reacting to game events. Keep it this way out of respect for SE's terms.
- `/api/command` allow-lists native types (`command|skill|sequence`); Telesto was removed entirely (0.5.0).
- `/api/command` only answers on the LAN; error responses never leak stacks.
