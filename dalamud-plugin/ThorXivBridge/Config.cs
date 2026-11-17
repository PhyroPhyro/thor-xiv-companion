using System;
using System.IO;
using System.Text.Json;

namespace ThorXivBridge;

public sealed class BridgeConfig
{
    public int Port { get; set; } = 11436;
    /// <summary>Intervalo do broadcast em ms (padrão 200 = 5 Hz).</summary>
    public int BroadcastMs { get; set; } = 200;
    /// <summary>Intervalo do polling do estado do jogo em ms (padrão 100).</summary>
    public int PollMs { get; set; } = 100;
    /// <summary>Pasta com imagens de mapa nomeadas como {mapId}.{png|jpg|webp}.</summary>
    public string MapsDirectory { get; set; } = "";
    /// <summary>Raiz dos arquivos estáticos do companion. Vazio = <plugin dir>/companion (pode falhar no Dalamud; prefira definir aqui).</summary>
    public string StaticRoot { get; set; } = "";
    public bool ChatEnabled { get; set; } = true;
    /// <summary>Permite POST /api/command (hotbar touch, execução nativa apenas).</summary>
    public bool CommandsEnabled { get; set; } = true;
    /// <summary>Intervalo entre linhas de uma sequencia (ms).</summary>
    public int SequenceDelayMs { get; set; } = 200;
}

public static class ConfigLoader
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string ConfigPath(string pluginDir) => Path.Combine(pluginDir, "thorxiv.json");

    /// <summary>
    /// Preferência pelo thorxiv.json ao lado do DLL; como fallback, %APPDATA%\XIVLauncher\thorxiv.json
    /// (necessário quando o Dalamud carrega o plugin em memória e Assembly.Location fica vazio).
    /// </summary>
    public static BridgeConfig LoadBest(string pluginDir)
    {
        var local = ConfigPath(pluginDir);
        if (File.Exists(local)) return Load(local);

        var global = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "XIVLauncher", "thorxiv.json");
        if (File.Exists(global)) return Load(global);

        return new BridgeConfig();
    }

    public static BridgeConfig Load(string path)
    {
        try
        {
            return JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(path), Options) ?? new BridgeConfig();
        }
        catch
        {
            return new BridgeConfig();
        }
    }

    public static void Save(string pluginDir, BridgeConfig config)
    {
        var path = ConfigPath(pluginDir);
        File.WriteAllText(path, JsonSerializer.Serialize(config, Options));
    }
}
