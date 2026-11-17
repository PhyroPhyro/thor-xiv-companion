using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Dalamud.IoC;
using Dalamud.Game.Command;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;

namespace ThorXivBridge;

/// <summary>
/// Entry point: expõe o estado do FFXIV em WebSocket/HTTP para o companion do AYN Thor.
/// Sem UI — configuração via thorxiv.json ao lado do DLL.
/// </summary>
public sealed class Plugin : IDalamudPlugin
{
    public static string PluginName => "ThorXivBridge";
    public static string PluginVersion { get; } = typeof(Plugin).Assembly.GetName().Version?.ToString(3) ?? "dev";
    public string Name => "Thor XIV Companion Bridge";

    [PluginService] internal static IPluginLog Log { get; private set; } = null!;
    [PluginService] internal static IClientState ClientState { get; private set; } = null!;
    [PluginService] internal static IFramework Framework { get; private set; } = null!;
    [PluginService] internal static IDataManager DataManager { get; private set; } = null!;
    [PluginService] internal static IPartyList PartyList { get; private set; } = null!;
    [PluginService] internal static IObjectTable ObjectTable { get; private set; } = null!;
    [PluginService] internal static IChatGui ChatGui { get; private set; } = null!;
    [PluginService] internal static ICommandManager CommandManager { get; private set; } = null!;

    private readonly BridgeConfig _config;
    private readonly ChatWatcher? _chatWatcher;
    private readonly StateCollector _collector;
    private readonly BridgeServer _server;

    private readonly string _pluginDirectory;
    private MdnsAdvertiser? _mdns;
    private long _lastPoll;
    private string? _cachedJson;
    private string _macrosJson = "{\"type\":\"macros\",\"items\":[]}";
    private volatile string _actionsJson = "{\"type\":\"actions\",\"items\":[]}";
    private volatile bool _actionsRequested;
    private long _lastMacrosRefresh;
    private readonly CommandQueue _queue;
    private readonly ActionCatalog _catalog;
    private CancellationTokenSource? _broadcastCts;
    private Task? _broadcastTask;

    public Plugin()
    {
        var loc = Assembly.GetExecutingAssembly().Location;
        _pluginDirectory = string.IsNullOrEmpty(loc) ? "." : Path.GetDirectoryName(loc)!;
        _config = ConfigLoader.LoadBest(_pluginDirectory);
        if (string.IsNullOrEmpty(_config.StaticRoot))
            _config.StaticRoot = Path.Combine(_pluginDirectory, "companion");
        if (string.IsNullOrEmpty(_config.MapsDirectory))
            _config.MapsDirectory = Path.Combine(_pluginDirectory, "maps");

        _chatWatcher = _config.ChatEnabled ? new ChatWatcher(ChatGui) : null;
        _collector = new StateCollector(ClientState, DataManager, PartyList, ObjectTable, Log, _chatWatcher, PluginVersion);
        _queue = new CommandQueue(_config, msg => Log.Info("[ThorXivBridge] cmd: " + msg));
        _catalog = new ActionCatalog(DataManager, ObjectTable, PartyList);
        _queue.TargetResolver = _catalog.ResolveTarget;
        _server = new BridgeServer(GetCachedSnapshot, _config,
            json => CommandsApi.HandleAsync(json, _config, _queue))
        {
            MacrosProvider = () => Volatile.Read(ref _macrosJson),
            ActionsProvider = () => { _actionsRequested = true; return _actionsJson; }
        };

        try
        {
            _server.Start();
        }
        catch (Exception ex)
        {
            Log.Error($"ThorXivBridge: falha ao abrir a porta {_config.Port}: {ex.Message}");
            ChatGui.PrintError($"[ThorXivBridge] porta {_config.Port} ocupada — ajuste em thorxiv.json");
            return;
        }

        Framework.Update += OnFrameworkUpdate;

        _mdns = new MdnsAdvertiser(_config.Port, Environment.MachineName);
        try
        {
            _mdns.Start();
        }
        catch (Exception ex)
        {
            Log.Info($"ThorXivBridge: mDNS indisponivel ({ex.Message}) - o app do Thor ainda pode achar via scan /24.");
            _mdns.Dispose();
            _mdns = null;
        }

        _broadcastCts = new CancellationTokenSource();
        _broadcastTask = Task.Run(() => BroadcastLoop(_broadcastCts.Token));

        CommandManager.AddHandler("/thorxiv", new CommandInfo(OnCommand)
        {
            HelpMessage = "Mostra o endpoint do Thor XIV Companion Bridge",
        });

        Log.Info($"ThorXivBridge v{PluginVersion} ativo em {_server.Url} (static: {_config.StaticRoot})");
    }

    private void OnFrameworkUpdate(IFramework framework)
    {
        var now = Environment.TickCount64;
        if (now - _lastPoll < _config.PollMs) return;
        _lastPoll = now;

        _queue.Process();

        if (_actionsRequested)
        {
            _actionsRequested = false;
            try { _actionsJson = _catalog.GetJson(); } catch { }
        }

        if (now - _lastMacrosRefresh > 10000)
        {
            _lastMacrosRefresh = now;
            try { Volatile.Write(ref _macrosJson, _collector.BuildMacrosJson()); } catch { }
        }

        try
        {
            Interlocked.Exchange(ref _cachedJson, _collector.BuildSnapshotJson());
        }
        catch (Exception ex)
        {
            Log.Verbose($"ThorXivBridge: poll falhou: {ex.Message}");
        }
    }

    private async Task BroadcastLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(_config.BroadcastMs, ct);
                var json = _cachedJson;
                if (json != null)
                    await _server.BroadcastAsync(json, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                // reconexões futuras; ignora erros de write individuais
            }
        }
    }

    private void OnCommand(string command, string args)
    {
        if (args.Trim().Equals("reload", StringComparison.OrdinalIgnoreCase))
        {
            // recarrega apenas valores simples sem reiniciar o servidor
            var fresh = ConfigLoader.LoadBest(_pluginDirectory);
            _config.BroadcastMs = fresh.BroadcastMs;
            _config.PollMs = fresh.PollMs;
            _config.ChatEnabled = fresh.ChatEnabled;
            ChatGui.Print($"[ThorXivBridge v{PluginVersion}] config recarregada (BroadcastMs={_config.BroadcastMs}, PollMs={_config.PollMs}, chat={_config.ChatEnabled}).");
            return;
        }

        var baseUrl = _server.Url.Replace("/ws", "/");
        ChatGui.Print($"[ThorXivBridge v{PluginVersion}] companion: {baseUrl} | ws: {_server.Url} | estado: {baseUrl}api/state | clientes: {_server.ConnectedCount}");
    }

    private string GetCachedSnapshot()
    {
        return Volatile.Read(ref _cachedJson) ?? "{\"type\":\"state\",\"error\":\"no-snapshot-yet\"}";
    }

    public void Dispose()
    {
        _mdns?.Dispose();
        CommandManager.RemoveHandler("/thorxiv");
        Framework.Update -= OnFrameworkUpdate;

        _broadcastCts?.Cancel();
        try { _broadcastTask?.Wait(TimeSpan.FromSeconds(2)); } catch { }

        _server.Dispose();
        _chatWatcher?.Dispose();
    }
}
