using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using Dalamud.Game.ClientState.Objects;
using Dalamud.Game.ClientState.Objects.Types;
using Dalamud.Plugin.Services;
using Lumina.Excel.Sheets;

namespace ThorXivBridge;

/// <summary>
/// Catálogo das ações (skills) da classe atual, lido das planilhas do jogo, e resolução de
/// alvos nomeados para o UseAction. Cacheado por jobId.
/// </summary>
public sealed class ActionCatalog
{
    private readonly IDataManager _dataManager;
    private readonly IObjectTable _objectTable;
    private readonly IPartyList _partyList;

    private uint _cachedJob = uint.MaxValue;
    private string _cachedJson = "{\"type\":\"actions\",\"items\":[]}";
    private string? _lastError;

    public ActionCatalog(IDataManager dataManager, IObjectTable objectTable, IPartyList partyList)
    {
        _dataManager = dataManager;
        _objectTable = objectTable;
        _partyList = partyList;
    }

    /// <summary>Thread do jogo. Reconstrói apenas quando o job mudou.</summary>
    public string GetJson()
    {
        var job = _objectTable.LocalPlayer?.ClassJob.RowId ?? uint.MaxValue;
        if (job == _cachedJob && _cachedJson.Length > 30) return _cachedJson;
        _cachedJob = job;
        _cachedJson = Build(job);
        return _cachedJson;
    }

    public void Invalidate() => _cachedJob = uint.MaxValue;

    private string Build(uint job)
    {
        var sb = new StringBuilder(8192);
        int allowedCount = -1;
        sb.Append("{\"type\":\"actions\",\"job\":").Append(job).Append(",\"items\":[");
        var first = true;
        try
        {
            var allowed = AllowedCategories(job);
            allowedCount = allowed.Count;
            if (allowed.Count > 0)
            {
                foreach (var row in _dataManager.GetExcelSheet<Lumina.Excel.Sheets.Action>())
                {
                    try
                    {
                        if (row.ClassJobCategory.RowId == 0 || !allowed.Contains(row.ClassJobCategory.RowId)) continue;
                        if (row.IsPvP) continue;
                        var name = row.Name.ToString();
                        if (string.IsNullOrWhiteSpace(name)) continue;
                        if (!first) sb.Append(',');
                        first = false;
                        var desc = "";
                        try
                        {
                            var tr = _dataManager.GetExcelSheet<Lumina.Excel.Sheets.ActionTransient>().GetRowOrDefault(row.RowId);
                            var d = tr?.Description.ToString();
                            if (!string.IsNullOrWhiteSpace(d)) desc = d;
                        }
                        catch { /* transient faltando: desc fica vazio */ }
                        sb.Append("{\"id\":").Append(row.RowId)
                          .Append(",\"name\":").Append(JsonSerializer.Serialize(name))
                          .Append(",\"desc\":").Append(JsonSerializer.Serialize(desc))
                          .Append(",\"icon\":").Append(row.Icon)
                          .Append('}');
                    }
                    catch
                    {
                        // linha problemática: segue o baile
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _lastError = ex.GetType().Name + ": " + ex.Message;
            return "{\"type\":\"actions\",\"job\":" + job + ",\"items\":[],\"allowed\":" + allowedCount + ",\"error\":\"build\"}";
        }
        sb.Append("]}");
        if (first) return "{\"type\":\"actions\",\"job\":" + job + ",\"items\":[],\"allowed\":" + allowedCount + (_lastError != null ? ",\"lastError\":\"" + _lastError + "\"" : "") + "}";
        return sb.ToString();
    }

    private HashSet<uint> AllowedCategories(uint jobId)
    {
        var set = new HashSet<uint>();
        try
        {
            // ClassJobCategory é uma matriz de flags: uma coluna por abreviação de job (PLD, WAR...).
            // Descobre a abreviação do job atual e marca as categorias onde a coluna é != 0.
            var cjRow = _dataManager.GetExcelSheet<ClassJob>().GetRowOrDefault(jobId);
            var abbrev = cjRow?.Abbreviation.ToString() ?? "";
            if (string.IsNullOrEmpty(abbrev)) return set;
            var col = typeof(ClassJobCategory).GetProperty(abbrev);
            if (col == null) { _lastError = "coluna nao achada: " + abbrev; return set; }

            foreach (var cat in _dataManager.GetExcelSheet<ClassJobCategory>())
            {
                try
                {
                    var v = col.GetValue(cat);
                    if (IsOn(v)) set.Add(cat.RowId);
                }
                catch
                {
                    // linha inesperada: ignora
                }
            }
        }
        catch (Exception ex)
        {
            _lastError = "cats: " + ex.GetType().Name + ": " + ex.Message;
        }
        return set;
    }

    private static bool IsOn(object? v) => v switch
    {
        null => false,
        bool b => b,
        byte by => by != 0,
        sbyte sb => sb != 0,
        short s => s != 0,
        ushort us => us != 0,
        int i => i != 0,
        uint u => u != 0,
        _ => v.ToString() is string t && t != "0" && !t.Equals("False", StringComparison.OrdinalIgnoreCase),
    };

    /// <summary>Resolve "auto|self|target|p1..p8" para o targetId do UseAction (thread do jogo).</summary>
    public ulong ResolveTarget(string? mode)
    {
        var me = _objectTable.LocalPlayer;
        switch ((mode ?? "auto").ToLowerInvariant())
        {
            case "self":
                return me?.EntityId ?? AutoTarget;
            case "target":
            {
                var tgt = me?.TargetObject;
                return tgt != null && tgt.EntityId != 0 ? (ulong)tgt.EntityId : AutoTarget;
            }
            default:
            {
                if (mode != null && mode.Length == 2 && (mode[0] == 'p' || mode[0] == 'P')
                    && int.TryParse(mode[1..], out var idx) && idx >= 1 && idx <= 8)
                {
                    var i = 0;
                    foreach (var m in _partyList)
                    {
                        if (++i == idx) return (ulong)m.EntityId;
                    }
                }
                return AutoTarget;
            }
        }
    }

    public const ulong AutoTarget = 0xE000_0000;
}
