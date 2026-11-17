# AGENTS.md — Thor XIV Companion

> Operational guide for AI agents (opencode/Hermes) working in this repo.

## Overview

FFXIV companion for the **AYN Thor's second screen** (touch, online-only): a Dalamud plugin (`dalamud-plugin/ThorXivBridge/`) on the PC + a PWA (`companion/`) on the lower screen (WebView via `android-app/` or browser). Architecture/roadmap details: README.md, `docs/ROADMAP.md` and the maintainer's vault.

**Language policy (2026-11-17): English is the default** for docs, code comments, commit messages and release notes. pt-BR may come back as an extra later.

## Working cycle (MANDATORY every code round)

1. Make the changes.
2. Build: `DALAMUD_HOME=/root/.xlcore/dalamud/Hooks/dev dotnet build dalamud-plugin/ThorXivBridge -c Release` → 0 errors.
3. Smoke: `dotnet build tests/ServerHarness -c Release` + harness + `node scripts/smoke.mjs <port> <pwa-dir>` → SMOKE PASS
   3b. (Thor connected to the PC) `scripts/deploy-pc.sh <zip> <apk>` also installs on the Thor via adb AND verifies (opens the app, `THOR-OK` = alive, resumed-on-lower-display, no crash). APK-only change: `scripts/deploy-thor.sh <apk>`.
   (smoke runs `scripts/check-dom.mjs`: unique ids, valid references, no top-level capture of dynamically-created ids, no `#tab-* { display }` outside `.active`.)
4. Bump the csproj version (fix → patch, feature → minor) and ship `dist/ThorXivBridge-<v>.zip` from `bin/Release/ThorXivBridge/latest.zip`.
5. APK whenever the PWA changed: `APK_VERSION_NAME=<v> APK_VERSION_CODE=<n> scripts/build-apk.sh`.
6. **Deploy to the PC**: `scripts/deploy-pc.sh` — SHA256 must match local; `LOCKED` means close the game first (never work around it). Verify the PC-side `ThorXivBridge.json` `AssemblyVersion`.
7. **Commit**: one commit per round (`<version>: summary`). Remote `origin` = private GitHub repo; **push** after committing.
8. **GitHub Release**: `gh release create v<version> dist/ThorXivBridge-<v>.zip dist/thorxiv-companion-<v>.apk` (binary distribution lives in Releases, not in the tree).
9. **Vault bookkeeping** (maintainer's private Obsidian repo, edited over SSH): update `4. Projetos/Thor XIV Companion/Estado/Status.md` (+ Roadmap/Logs when relevant), then **commit and push only the files under that project folder**, one commit per round. Never touch other vault paths; never include secrets, IPs or credentials in vault notes.

## Visual identity (fantasy-MMORPG UI, FFXIV-flavored)

- All styling comes from `companion/css/tokens.css`. **No hex or inline colors** outside tokens.
- Window/panel: `--panel` background, `--border` + inner `--border-inner`, `--radius`.
- Titles: `--font-title`, small caps, `--gold`, thin gold rule below.
- Text: always `--text` with `--text-shadow`; secondary in `--text-muted`.
- Button: `--panel-solid` background, `--border`; focus/active uses `--focus-glow`.
- Selected list item: `--select-gradient` (left→right), `--gold-bright` text.
- Divider: 1px gradient fading at both ends.
- Gold only for titles/selection/focus; at most one highlight per area.
- No color gradients, no big shadows, no overly round corners.
- Every interactive element needs a visible focus state.
- Reusable components in `companion/css/components/` (`panel.css` → `.panel`, `button.css` → `.btn` + variants). New screens reuse them instead of reinventing.

## Conventions

- PWA: vanilla JS, no build step; element IDs are contracts across js modules — move DOM keeping ids.
- Touch-first: targets ≥44px; long-press = tooltip; nothing depends on hover.
- Hotbar state: `localStorage` — buckets per job in `hotbar.jobs.v2` (legacy read-only `hotbar.v1`), presets `2x2/3x3/4x4`, split state `split.v1`, caches `txmap.v1`/`txpoi.v1`. Export/import JSON covers all jobs.
- Security: no port-forwarding; bridge LAN-only; no reactive automation in game, ever.

## Lessons (mistakes that don't repeat)

- **Unique IDs, always** (v0.5.3): a button and its overlay shared `hb-config`; `$("id")` grabbed the first, the overlay CSS (`position:fixed; inset:0`) applied to the button → full-screen garbage. Before committing: each id exactly once in generated HTML (check-dom enforces).
- **innerHTML elements don't exist at script load** (v0.5.5): `const grid = $("hotbar-grid")` captured `null` (born in `build()`) → empty hotbar hidden behind another bug. Reference ids at use-time, never top-level for dynamic ids (check-dom enforces).
- **WebView scroll × drag** (v0.5.7): `touch-action:none` killed page scrolling and pointer events lose the race to scroll (pointercancel before threshold). Use touch events (`touchmove passive:false`); never `touch-action:none` in a scrollable list. Since the hotbar tab became scroll-free, jitter-aware slop (16px) + hold patterns replaced it — see next.
- **Touch slop is not mouse slop** (0.5.12): 8px is below capacitive finger jitter — every tap became a cancelled drag/killed tooltip. 16px slop + "small drag = tap" safety net at touchend.
- **Map geometry is official, not intuition** (0.5.18/0.5.25): `coord = px/SF*2 + 1` on the 2048 texture (xivapi-datamining MapCoordinates.md); Map.SizeFactor sets the coord SPAN per zone (cities 200–400 → tiny ranges — "8.8" in Idyllshire is mid-town, not a corner). MapMarker raw X/Y are already px2048 (verified live against the player position, 8px apart). Verify with XIVMap/XIVApp sources before inventing.
- **AYN Thor: the lower display belongs to the vendor** (0.4.19): `rip.moth.cocoonshell/.ExternalDisplayActivity` owns the presentation display; activities we start on the upper display get killed in ~4s ("instant flash"), and in-app `startActivity(launchDisplayId)` is silently denied. Only reliable path to the lower screen: `adb shell am start --display <id>`.
- **`Write-Output` inside a PowerShell function becomes its return value** (deploy-thor.sh): logs captured into `$ok` turned assertions into silent truthy — false green. Test functions log into a global array and return a pure bool.
- **Cocoon keeps `topResumedActivity` while a game session runs**: our activity is lifecycle-PAUSED yet visible/interactive — normal. Success asserts: `Displayed` + game activities still resumed (before/after lists) + clean crash buffer; `topResumed=thorxiv` is only a WARN.
- **Never start the window focusable** (0.4.20): window focus steals foreground from the streamed game. `FLAG_NOT_FOCUSABLE` always, temporary focus only around text inputs via `ThorNative.requestTextFocus/releaseTextFocus` (picker included).
- **Verify apps by opening them, not by `pidof`** (0.4.17): deploy-thor.sh installs, clears logcat, opens the app on the lower display and requires Displayed + no crash stack; JS errors go to logcat through `ThorNative.log` (window.onerror/rejections wired in app.js).
- **Plugin zip comes from the real build output** (v0.5.7): `bin/Release/latest.zip` once lingered stale while the SDK wrote `bin/Release/ThorXivBridge/latest.zip` — we shipped 0.5.1 for five rounds. Zip = the inner one; after deploy verify the PC manifest `AssemblyVersion` and DLL hash.
- **Hermes delegations: scan for dirty unicode** (0.5.11): the worker once wrote NFD accents and soft-hyphens into comments. After every Hermes round: scan `\u00ad \u0301 \u0131` in touched files + NFC-normalize.
- **Activity lifecycle: never assume initialized fields** (0.4.17): early `return` before init + `finish()` → onDestroy NPE loop. Null-guard lifecycle hooks; pending runnables must be removed on destroy (`removeCallbacksAndMessages`).
- **Re-render = clear before appendChild** (v0.5.6).
- **WebView gestures: yours or the browser's** (v0.5.6): `touch-action:none` only where the page provably cannot scroll; `-webkit-touch-callout/user-select: none`; preventDefault `contextmenu`; `pointer-events:none` on slot `<img>`.
- **Overlays: smallest shape possible** (v0.5.3): popovers anchored/minimal, never full-screen modals for tiny content. Modals only for big content (the slot editor).
- **Stale caches poison new features** (0.5.23): `txmap.v1` entries written by an older version lacked `rowId`, silently disabling POI loading forever. Cache schemas must version-check every field the new code requires.
