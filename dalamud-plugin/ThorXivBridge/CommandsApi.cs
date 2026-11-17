using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

namespace ThorXivBridge;

/// <summary>
/// Handler do POST /api/command. Formatos aceitos (APENAS nativos):
///  {"type":"command","cmd":"/ac ..."}                -> nativo (RaptureShellModule)
///  {"type":"sequence","lines":[...],"delayMs":200}   -> nativo (macro multi-linha manual)
///  {"type":"skill","actionId":29,"target":"target"}   -> nativo (UseAction)
/// Telesto foi removido: não há mais forwarding de nenhum tipo.
/// Allow-list rígida de tipos; sem loop/reatividade a eventos do jogo.
/// </summary>
public static class CommandsApi
{
    public static Task<(int status, string body)> HandleAsync(string json, BridgeConfig config, CommandQueue queue)
    {
        if (!config.CommandsEnabled)
            return Task.FromResult((403, "{\"ok\":false,\"error\":\"commands desabilitados\"}"));

        JsonDocument doc;
        try { doc = JsonDocument.Parse(json); }
        catch (JsonException) { return Task.FromResult((400, "{\"ok\":false,\"error\":\"json invalido\"}")); }

        using (doc)
        {
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";

            switch (type.ToLowerInvariant())
            {
                case "command": {
                    var cmd = GetStr(root, "cmd");
                    if (!Valid(cmd)) return Task.FromResult((400, "{\"ok\":false,\"error\":\"cmd invalido\"}"));
                    queue.Enqueue(cmd!);
                    return Task.FromResult((200, "{\"ok\":true,\"via\":\"native\"}"));
                }
                case "sequence": {
                    var lines = new List<string>();
                    if (root.TryGetProperty("lines", out var arr) && arr.ValueKind == JsonValueKind.Array)
                        foreach (var el in arr.EnumerateArray())
                            if (el.ValueKind == JsonValueKind.String) lines.Add(el.GetString() ?? "");
                    var delay = root.TryGetProperty("delayMs", out var dm) && dm.TryGetInt32(out var dv) ? dv : 0;
                    var filtered = lines.FindAll(l => !string.IsNullOrWhiteSpace(l) && !l.TrimStart().StartsWith("//"));
                    if (filtered.Count == 0 || filtered.Count > 16) return Task.FromResult((400, "{\"ok\":false,\"error\":\"lines vazio ou >16\"}"));
                    foreach (var l in filtered)
                        if (!Valid(l)) return Task.FromResult((400, "{\"ok\":false,\"error\":\"linha invalida\"}"));
                    queue.EnqueueSequence(filtered, delay);
                    return Task.FromResult((200, "{\"ok\":true,\"via\":\"native\",\"count\":" + filtered.Count + "}"));
                }
                case "skill": {
                    if (!root.TryGetProperty("actionId", out var aidEl)) return Task.FromResult((400, "{\"ok\":false,\"error\":\"faltando actionId\"}"));
                    var aid = aidEl.ValueKind == JsonValueKind.String
                        ? int.TryParse(aidEl.GetString(), out var ps) ? ps : -1
                        : aidEl.TryGetInt32(out var n) ? n : -1;
                    if (aid <= 0 || aid > 65535) return Task.FromResult((400, "{\"ok\":false,\"error\":\"actionId invalido\"}"));
                    var tgt = GetStr(root, "target") ?? "auto";
                    if (tgt != "auto" && tgt != "self" && tgt != "target" &&
                        !(tgt.Length == 2 && (tgt[0] == 'p' || tgt[0] == 'P') && char.IsDigit(tgt[1])))
                        return Task.FromResult((400, "{\"ok\":false,\"error\":\"target invalido\"}"));
                    queue.EnqueueAction((uint)aid, tgt);
                    return Task.FromResult((200, "{\"ok\":true,\"via\":\"native-skill\"}"));
                }
                default:
                    return Task.FromResult((403, "{\"ok\":false,\"error\":\"tipo nao permitido\"}"));
            }
        }
    }

    private static string? GetStr(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool Valid(string? cmd) =>
        !string.IsNullOrWhiteSpace(cmd) && cmd.Length <= 512 && cmd.StartsWith('/');
}
