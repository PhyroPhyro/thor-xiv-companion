using System;
using System.Globalization;
using System.Numerics;
using Dalamud.Game.ClientState.Objects;
using Dalamud.Game.ClientState.Objects.SubKinds;
using Dalamud.Game.ClientState.Objects.Types;
using Dalamud.Plugin.Services;
using Lumina.Excel.Sheets;

namespace ThorXivBridge;

/// <summary>
/// Lê o estado do jogo no thread do framework e produz um snapshot JSON.
/// </summary>
public sealed class StateCollector
{
    private readonly IClientState _clientState;
    private readonly IDataManager _dataManager;
    private readonly IPartyList _partyList;
    private readonly IObjectTable _objectTable;
    private readonly ActionCatalog _catalog;
    private readonly IPluginLog _log;
    private readonly ChatWatcher? _chat;
    private readonly string _bridgeVersion;

    private bool _loggedWarn;

    // Cache de POIs do mapa atual (AgentMap do jogo). Regenera apenas quando
    // CurrentMapId/CurrentTerritoryId mudam — nunca por frame.
    private string _poisJson = "[]";
    private uint _poisMapId;
    private uint _poisTerritory;

    public StateCollector(IClientState clientState, IDataManager dataManager, IPartyList partyList, IObjectTable objectTable, ActionCatalog catalog, IPluginLog log, ChatWatcher? chat, string bridgeVersion)
    {
        _bridgeVersion = bridgeVersion;
        _clientState = clientState;
        _dataManager = dataManager;
        _partyList = partyList;
        _objectTable = objectTable;
        _catalog = catalog;
        _log = log;
        _chat = chat;
    }

    public string BuildSnapshotJson()
    {
        var sb = new System.Text.StringBuilder(1024);
        sb.Append('{');
        sb.Append("\"type\":\"state\",");
        sb.Append("\"bridgeVer\":\"").Append(_bridgeVersion).Append("\",");
        sb.Append("\"ts\":").Append(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).Append(',');

        try
        {
            var player = _objectTable.LocalPlayer;
            var loggedIn = player != null && _clientState.IsLoggedIn;
            sb.Append("\"loggedIn\":").Append(loggedIn ? "true" : "false").Append(',');

            if (!loggedIn || player == null)
            {
                sb.Append("\"zone\":null,\"map\":null,\"player\":null,\"target\":null,\"party\":[]");
                AppendCooldowns(sb);
                if (_chat != null) sb.Append(",\"chat\":").Append(_chat.SnapshotJson());
                sb.Append(",\"pois\":[]");
                sb.Append('}');
                return sb.ToString();
            }

            AppendZoneAndMap(sb, player);
            AppendPlayer(sb, player);
            AppendTarget(sb, player);
            AppendParty(sb);
            AppendCooldowns(sb);
            if (_chat != null) sb.Append(",\"chat\":").Append(_chat.SnapshotJson());
        }
        catch (Exception ex)
        {
            if (!_loggedWarn)
            {
                _loggedWarn = true;
                _log.Warning($"ThorXivBridge: erro ao montar snapshot ({ex.GetType().Name}: {ex.Message})");
            }
            sb.Append("\"error\":true");
        }

        sb.Append(",\"pois\":").Append(BuildPoisJson());
        sb.Append('}');
        return sb.ToString();
    }

    private void AppendZoneAndMap(System.Text.StringBuilder sb, IPlayerCharacter player)
    {
        uint territoryId = _clientState.TerritoryType;
        string zoneName = "";
        uint mapId = 0;
        string mapName = "";

        try
        {
            var terrSheet = _dataManager.GetExcelSheet<TerritoryType>();
            var mapSheet = _dataManager.GetExcelSheet<Map>();
            var placeSheet = _dataManager.GetExcelSheet<PlaceName>();

            var terrRow = terrSheet.GetRowOrDefault(territoryId);
            if (terrRow != null)
            {
                zoneName = terrRow.Value.PlaceName.ValueNullable?.Name.ToString() ?? "";
                mapId = terrRow.Value.Map.RowId;
                var mapRow = mapSheet.GetRowOrDefault(mapId);
                if (mapRow != null)
                    mapName = mapRow.Value.PlaceName.ValueNullable?.Name.ToString() ?? zoneName;
            }
        }
        catch
        {
            // nomes opcionais
        }

        sb.Append("\"zone\":{\"id\":").Append(territoryId)
          .Append(",\"name\":").Append(System.Text.Json.JsonSerializer.Serialize(zoneName)).Append("},");
        sb.Append("\"map\":{\"id\":").Append(mapId)
          .Append(",\"name\":").Append(System.Text.Json.JsonSerializer.Serialize(mapName)).Append("},");
    }

    private void AppendPlayer(System.Text.StringBuilder sb, IPlayerCharacter player)
    {
        sb.Append("\"player\":{");
        sb.Append("\"name\":").Append(System.Text.Json.JsonSerializer.Serialize(player.Name.TextValue)).Append(',');
        sb.Append("\"job\":\"").Append(JobAbbrev(player.ClassJob.RowId)).Append("\",");
        sb.Append("\"jobId\":").Append(player.ClassJob.RowId).Append(',');
        sb.Append("\"level\":").Append(player.Level).Append(',');
        sb.Append("\"hp\":").Append(player.CurrentHp).Append(",\"maxHp\":").Append(player.MaxHp).Append(',');
        sb.Append("\"mp\":").Append(player.CurrentMp).Append(",\"maxMp\":").Append(player.MaxMp).Append(',');

        var pos = player.Position;
        sb.Append("\"world\":{\"x\":").Append(Fmt(pos.X))
          .Append(",\"y\":").Append(Fmt(pos.Y))
          .Append(",\"z\":").Append(Fmt(pos.Z)).Append("},");

        sb.Append("\"mapCoords\":").Append(MapCoords(pos));
        sb.Append("},");
    }

    private string MapCoords(Vector3 world)
    {
        try
        {
            var mapId = _clientState.TerritoryType;
            var terrRow = _dataManager.GetExcelSheet<TerritoryType>().GetRowOrDefault(mapId);
            if (terrRow == null) return "null";
            var mapRow = _dataManager.GetExcelSheet<Map>().GetRowOrDefault(terrRow.Value.Map.RowId);
            if (mapRow == null) return "null";
            var mc = Dalamud.Utility.MapUtil.WorldToMap(new Vector2(world.X, world.Z), mapRow.Value);
            return "{\"x\":" + Fmt(mc.X) + ",\"y\":" + Fmt(mc.Y) + "}";
        }
        catch
        {
            return "null";
        }
    }

    private void AppendTarget(System.Text.StringBuilder sb, IPlayerCharacter player)
    {
        var target = player.TargetObject;
        if (target is ICharacter ch)
        {
            sb.Append("\"target\":{\"name\":").Append(System.Text.Json.JsonSerializer.Serialize(ch.Name.TextValue))
              .Append(",\"job\":\"").Append(JobAbbrev(ch.ClassJob.RowId)).Append('"')
              .Append(",\"hp\":").Append(ch.CurrentHp)
              .Append(",\"maxHp\":").Append(ch.MaxHp)
              .Append(",\"dead\":").Append(ch.IsDead ? "true" : "false")
              .Append("},");
        }
        else
        {
            sb.Append("\"target\":null,");
        }
    }

    private void AppendParty(System.Text.StringBuilder sb)
    {
        sb.Append("\"party\":[");
        var first = true;
        try
        {
            foreach (var member in _partyList)
            {
                if (member == null) continue;
                if (!first) sb.Append(',');
                first = false;
                sb.Append('{');
                sb.Append("\"name\":").Append(System.Text.Json.JsonSerializer.Serialize(member.Name.TextValue)).Append(',');
                sb.Append("\"job\":\"").Append(JobAbbrev(member.ClassJob.RowId)).Append("\",");
                sb.Append("\"level\":").Append(member.Level).Append(',');
                sb.Append("\"hp\":").Append(member.CurrentHP).Append(",\"maxHp\":").Append(member.MaxHP).Append(',');
                sb.Append("\"mp\":").Append(member.CurrentMP).Append(",\"maxMp\":").Append(member.MaxMP).Append(',');
                sb.Append("\"online\":").Append(member.MaxHP > 0 ? "true" : "false");
                sb.Append('}');
            }
        }
        catch (Exception ex)
        {
            _log.Verbose($"ThorXivBridge: party indisponível ({ex.Message})");
        }
        sb.Append("]");
    }

    /// <summary>Anexa cooldowns ativos (apenas skills do job atual) ao snapshot de estado.
    /// FFXIVCS: GetRecastTime = TOTAL da recarga; GetRecastTimeElapsed = decorrido; restante = total - decorrido.</summary>
    private unsafe void AppendCooldowns(System.Text.StringBuilder sb)
    {
        sb.Append(",\"cooldowns\":{");
        try
        {
            var am = FFXIVClientStructs.FFXIV.Client.Game.ActionManager.Instance();
            if (am != null)
            {
                bool first = true;
                foreach (uint id in _catalog.GetActionIds())
                {
                    try
                    {
                        float total = am->GetRecastTime(FFXIVClientStructs.FFXIV.Client.Game.ActionType.Action, id);
                        if (total <= 0f) continue;
                        float r = total - am->GetRecastTimeElapsed(FFXIVClientStructs.FFXIV.Client.Game.ActionType.Action, id);
                        if (r > 0f)
                        {
                            if (!first) sb.Append(',');
                            first = false;
                            sb.Append('"').Append(id).Append("\":{\"r\":").Append(Fmt(r)).Append(",\"t\":").Append(Fmt(total)).Append('}');
                        }
                    }
                    catch { /* ação indisponível no momento: pula */ }
                }
            }
        }
        catch { /* ActionManager indisponível: cooldowns fica vazio */ }
        sb.Append('}');
    }

    private string JobAbbrev(uint classJobId)
    {
        try
        {
            var row = _dataManager.GetExcelSheet<ClassJob>().GetRowOrDefault(classJobId);
            return row == null ? "" : Escape(row.Value.Abbreviation.ToString());
        }
        catch
        {
            return "";
        }
    }

    private static string Escape(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    /// <summary>Lista os macros existentes do jogador (thread do jogo).</summary>
    public unsafe string BuildMacrosJson()
    {
        var sb = new System.Text.StringBuilder(4096);
        sb.Append("{\"type\":\"macros\",\"items\":[");
        var first = true;
        try
        {
            var mod = FFXIVClientStructs.FFXIV.Client.UI.Misc.RaptureMacroModule.Instance();
            if (mod != null)
            {
                for (uint set = 0; set <= 1; set++)
                {
                    for (uint i = 0; i < 100; i++)
                    {
                        var m = mod->GetMacro(set, i);
                        if (m == null) continue;
                        var name = m->Name.ToString();
                        if (string.IsNullOrWhiteSpace(name)) continue;
                        if (!first) sb.Append(',');
                        first = false;
                        sb.Append("{\"set\":\"").Append(set == 0 ? "char" : "shared").Append("\",\"id\":").Append(i);
                        sb.Append(",\"name\":").Append(System.Text.Json.JsonSerializer.Serialize(name));
                        sb.Append(",\"lines\":[");
                        for (var l = 0; l < 15; l++)
                        {
                            if (l > 0) sb.Append(',');
                            sb.Append(System.Text.Json.JsonSerializer.Serialize(m->Lines[l].ToString()));
                        }
                        sb.Append("]}");
                    }
                }
            }
        }
        catch
        {
            return "{\"type\":\"macros\",\"items\":[]}";
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static string Fmt(float f) =>
        f.ToString("0.####", CultureInfo.InvariantCulture);

    /// <summary>
    /// POIs of the current map, from the game's AgentMap (definitive source, replaces xivapi).
    /// Each entry: {x, y} in px2048 (same texture space the player pin projects to), icon (IconId)
    /// and name (Subtext). Converted by the plugin through the px -> world -> coord chain using
    /// the same MapUtil + SizeFactor/offset that generate the player pin, so alignment is
    /// guaranteed by construction: coord = px*2/SF + 1 + 0.02*offset
    /// (derived from composing WorldToMap with world = (px - 1024)*100/SF; see /tmp/opencode/poi-math.mjs).
    /// Regenerated only when CurrentMapId/CurrentTerritoryId change.
    /// </summary>
    private unsafe string BuildPoisJson()
    {
        if (!_clientState.IsLoggedIn)
        {
            _poisMapId = 0;
            _poisTerritory = 0;
            return "[]";
        }
        try
        {
            var agentPtr = FFXIVClientStructs.FFXIV.Client.UI.Agent.AgentMap.Instance();
            if (agentPtr == null) return "[]";
            // stack copy of the struct: the fixed buffers (FixedSizeArrayN) travel along,
            // and Span<T> properties can be read without pointer arithmetic.
            var agent = *agentPtr;
            var mapId = agent.CurrentMapId;
            var territory = agent.CurrentTerritoryId;
            if (mapId == _poisMapId && territory == _poisTerritory && _poisJson.Length > 2)
                return _poisJson;
            _poisMapId = mapId;
            _poisTerritory = territory;
            _poisJson = BuildPoisArrayJson(ref agent);
            return _poisJson;
        }
        catch
        {
            return "[]";
        }
    }

    private unsafe string BuildPoisArrayJson(ref FFXIVClientStructs.FFXIV.Client.UI.Agent.AgentMap agent)
    {
        var sb = new System.Text.StringBuilder(8192);
        sb.Append('[');
        int n = 0;
        var seen = new System.Collections.Generic.HashSet<string>();
        float sf = agent.CurrentMapSizeFactor == 0 ? 100f : agent.CurrentMapSizeFactor;
        float offX = agent.CurrentOffsetX, offY = agent.CurrentOffsetY;

        // The static MapMarkers array is (re)built by the map UI layer. If our first read for a
        // zone comes back nearly empty (player never opened the map this session), ask the agent
        // itself to create them — same call the UI does — then read again.
        AppendPoisFromSpan(sb, agent.MapMarkers, sf, offX, offY, ref n, seen);
        if (n < 3)
        {
            try
            {
                agent.CreateMapMarkers(false);
                AppendPoisFromSpan(sb, agent.MapMarkers, sf, offX, offY, ref n, seen);
            }
            catch { /* keep what we already had */ }
        }
        AppendPoisFromWarpSpan(sb, agent.WarpMarkers, sf, offX, offY, ref n, seen);

        try
        {
            ref var evs = ref agent.EventMarkers;
            int ec = (int)evs.Count;
            for (int i = 0; i < ec && n < 600; i++)
            {
                var m = evs[i];
                if (m.MapId == 0) continue;
                if (m.Position.X == 0f && m.Position.Z == 0f) continue;
                // MapUtil semantics: Excel offsets == -CurrentOffset* (see Dalamud GetMapCoordinates)
                float cx = 0.02f * offX + 2048f / sf + 0.02f * m.Position.X + 1f;
                float cy = 0.02f * offY + 2048f / sf + 0.02f * m.Position.Z + 1f;
                if (cx < 0f || cx > 200f || cy < 0f || cy > 200f) continue;
                string label = "";
                try
                {
                    if (m.PlaceNameId != 0)
                        label = _dataManager.GetExcelSheet<Lumina.Excel.Sheets.PlaceName>().GetRowOrDefault(m.PlaceNameId)?.Name.ToString() ?? "";
                    if (string.IsNullOrEmpty(label) && m.TooltipString != null && m.TooltipString->StringLength > 0)
                        label = m.TooltipString->ToString();
                }
                catch { /* label opcional */ }
                AddPoi(sb, ref n, seen, cx, cy, m.IconId, label);
            }
        }
        catch { /* event markers indisponiveis: fontes 1-2 ainda validas */ }

        sb.Append(']');
        return sb.ToString();
    }

    private static void AppendPoisFromSpan(System.Text.StringBuilder sb,
        System.Span<FFXIVClientStructs.FFXIV.Client.UI.Agent.MapMarkerInfo> markers,
        float sf, float offX, float offY, ref int n, System.Collections.Generic.HashSet<string> seen)
    {
        for (int i = 0; i < markers.Length && n < 600; i++) // count underreports until map UI inits
        {
            var m = markers[i].MapMarker;
            EmitBaseMarker(sb, ref m, sf, offX, offY, ref n, seen);
        }
    }

    private static void AppendPoisFromWarpSpan(System.Text.StringBuilder sb,
        System.Span<FFXIVClientStructs.FFXIV.Client.UI.Agent.MapMarkerBase> markers,
        float sf, float offX, float offY, ref int n, System.Collections.Generic.HashSet<string> seen)
    {
        for (int i = 0; i < markers.Length && n < 600; i++)
            EmitBaseMarker(sb, ref markers[i], sf, offX, offY, ref n, seen);
    }

    private static void EmitBaseMarker(System.Text.StringBuilder sb,
        ref FFXIVClientStructs.FFXIV.Client.UI.Agent.MapMarkerBase m,
        float sf, float offX, float offY, ref int n, System.Collections.Generic.HashSet<string> seen)
    {
        if (m.IconId == 0) return;
        float cx = m.X * 2f / sf + 1f - 0.02f * offX;
        float cy = m.Y * 2f / sf + 1f - 0.02f * offY;
        if (cx < 0f || cx > 200f || cy < 0f || cy > 200f) return;
        string name = "";
        try { if (m.Subtext.HasValue) name = m.Subtext.ToString(); } catch { }
        AddPoi(sb, ref n, seen, cx, cy, m.IconId, name);
    }

    private static void AddPoi(System.Text.StringBuilder sb, ref int n,
        System.Collections.Generic.HashSet<string> seen, float cx, float cy, uint icon, string name)
    {
        var key = icon.ToString() + ":" + System.Math.Round(cx, 1) + ":" + System.Math.Round(cy, 1);
        if (!seen.Add(key)) return;
        if (n++ > 0) sb.Append(',');
        sb.Append('{')
          .Append("\"x\":").Append(Fmt(cx)).Append(",\"y\":").Append(Fmt(cy))
          .Append(",\"icon\":").Append(icon)
          .Append(",\"name\":").Append(System.Text.Json.JsonSerializer.Serialize(name ?? ""))
          .Append('}');
    }
}
