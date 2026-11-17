# Thor XIV Companion

A **Final Fantasy XIV** companion for the **AYN Thor's second screen** (and any touch device) — a touch hotbar with real cooldowns, a live zone map with POIs, and chat, all fed by the game running on your PC.

```
FFXIV + plugin (PC)  ──LAN WebSocket/HTTP──▶  PWA (browser or Thor APK)
```

## ⚠️ Legal & safety notices — read first

- Unofficial fan project, **not affiliated with Square Enix**. FINAL FANTASY XIV © Square Enix Co., Ltd.
- Depends on [XIVLauncher/Dalamud](https://github.com/goatcorp/Dalamud), a third-party tool governed by the game's terms — use at your own risk; game patches may break the plugin at any time.
- **This is not automation**: the executor only injects static `/commands` (single lines, human-paced multi-line sequences, and skills via `ActionManager.UseAction` — the exact same code path as pressing the in-game hotbar button) when **you tap** on the second screen. Nothing reacts to game events, nothing loops, nothing plays for you.
- **Privacy**: the bridge listens **on your LAN only** — no port forwarding, no cloud, no accounts. The only optional outbound traffic is public data: zone map images and icons from the XIVAPI CDN (allowed under SE's fan-content guidelines for non-commercial use).
- No character data ever leaves your devices besides the LAN stream; UI preferences live in the device's `localStorage`.

## Components

| Path | What it is |
|---|---|
| `dalamud-plugin/ThorXivBridge/` | Dalamud plugin (C#/.NET): exposes live state (HP/MP, job, zone, map coords, target, party, chat, cooldowns), runs the native command executor, serves the PWA + WebSocket |
| `companion/` | PWA (vanilla JS, no build step): hotbar, online zone map with zoom/pan/POIs, chat, split view, demo mode |
| `android-app/` | Android APK (WebView) for the AYN Thor: opens on the lower screen, discovers the bridge over mDNS/TCP scan, never steals gamepad focus |
| `tests/` + `scripts/` | Protocol harness + smoke tests (no game needed), manual APK build, deploy helpers |

## Requirements

- PC: Windows with XIVLauncher + Dalamud (plugin built against Dalamud API 15), FFXIV 7.x
- Building the plugin needs .NET 10 SDK; running it just needs the zip extracted
- Second device: any modern browser, or the APK (Android 13+, tested on AYN Thor / Cocoon OS)
- Same LAN

## Install

### 1. Plugin on the PC

1. Grab `ThorXivBridge-<version>.zip` from the [GitHub Releases](../../releases) of this repo and extract to a fixed folder, e.g. `C:\Tools\ThorXivBridge`.
2. In game: `/xlsettings` → **Experimental** → *Dev Plugin Locations* → add `C:\Tools\ThorXivBridge\ThorXivBridge.dll` → save.
3. `/xlplugins` → **Dev Tools** → enable **Thor XIV Companion Bridge**.
4. `/thorxiv` in chat prints the bridge URL (`http://<PC-IP>:11436/`) and connected clients.
5. Allow TCP `11436` (and UDP `5353` for mDNS) in the Windows firewall — **private networks only**.

Optional config — `thorxiv.json` next to the DLL: `port`, `pollMs`, `broadcastMs`, `chatEnabled`.

### 2. Companion on the device

- **APK (recommended on Thor)**: install `thorxiv-companion-<version>.apk` (allow unknown apps). It auto-discovers the bridge (mDNS + subnet TCP scan), lands on the lower display under Cocoon OS, and never takes input focus from the game. No PC? Built-in offline demo mode.
- **Browser**: open `http://<PC-IP>:11436/` on the second screen.

## Using it

- **Hotbar** — grid presets 2x2/3x3/4x4; slot kinds: `command` (one line), `sequence` (multi-line with human delay) and `Skill` (picked from your current class's action catalog, icons + tooltips). **Each job gets its own hotbar** — it switches automatically when you change class in game. Editing: ✏️ Edit → tap a slot to edit, drag to reorder/swap, long-press for tooltips; ⚙️ popover has grid presets, export/import JSON and the job chip; ◫ toggles the split view.
- **Real cooldowns** — skill buttons show live recast (darkening bar + seconds) sourced from `ActionManager`; tapping a charging button tells you the remaining time instead of sending it.
- **Map** — current zone rendered from XIVAPI's composed map image (cached; works offline after first visit), player marker on the game's exact coordinate system, zoom +/−, pan, and a cycling camera mode (◎ auto-frame → ◉ follow → ◇ explore). POIs: aetherytes (cyan diamond), aethernet nodes (gold) and district markers.
- **Chat** — colored channel log + send bar (Say/Party/LS1) through the same human-tap command executor.
- **Settings** — custom WebSocket endpoint, demo toggle.
- **Split view (◫)** — map on the left half, hotbar on the right, same live canvas, persisted.

## Protocol (summary)

- `GET /` → PWA · `GET /api/state` → snapshot · `GET /api/actions` → current class catalog · `GET /api/macros` → your macros (importable as sequences) · `WS /ws` → continuous snapshot broadcast · `POST /api/command` → `{type: command|skill|sequence, ...}` (allow-listed, human-triggered)

Coordinate systems follow the official datamining docs (`xivapi/ffxiv-datamining/docs/MapCoordinates.md`); map images and icons come from the XIVAPI v2 CDN.

## Development

```bash
# plugin (needs .NET 10 SDK and Dalamud refs via DALAMUD_HOME)
dotnet build dalamud-plugin/ThorXivBridge -c Release   # -> bin/Release/ThorXivBridge/latest.zip

# protocol validation without the game
dotnet build tests/ServerHarness -c Release
dotnet tests/ServerHarness/bin/Release/net10.0/ServerHarness.dll companion 11437 &
node scripts/smoke.mjs 11437

# APK (JDK 17 + android build-tools + android-33 platform; Gradle-free, see scripts/build-apk.sh)
APK_VERSION_NAME=x.y.z scripts/build-apk.sh
```

The mandatory per-round workflow (build → smoke → bump → deploy → commit) and all accumulated engineering lessons live in [`AGENTS.md`](AGENTS.md).

## Roadmap

Done: full hotbar (per-job, cooldowns, drag & drop, split), online map with POIs, chat with sending. Next: quest/duty tracker, party buffs layer, consumable presets, UX polish. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Credits

- [goatcorp](https://github.com/goatcorp) — Dalamud / XIVLauncher, FFXIVClientStructs, Lumina
- [XIVAPI](https://xivapi.com) — game data API and icon/map CDN; [ffxiv-datamining](https://github.com/xivapi/ffxiv-datamining) for the map coordinate formulas
- XIVMap / XIVApp communities — map geometry references
- Square Enix — FFXIV and all game assets (none are redistributed here)
- Maintained by **phyro**, developed with AI agents (opencode + Hermes) since 2026-11

## License

MIT — see [LICENSE](LICENSE). Game imagery remains © Square Enix.
