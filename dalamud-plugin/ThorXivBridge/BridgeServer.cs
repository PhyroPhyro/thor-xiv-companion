using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Collections.Generic;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThorXivBridge;

/// <summary>
/// Servidor HTTP/WebSocket minimalista sobre TcpListener.
/// Sem dependências externas e sem necessidade de URLACL (não usa HttpListener).
/// </summary>
public sealed class BridgeServer : IDisposable
{
    private readonly Func<string> _snapshotProvider;
    private readonly Func<string, Task<(int, string)>> _commandHandler;

    /// <summary>Provider opcional do JSON de macros do jogador.</summary>
    public Func<string>? MacrosProvider { get; set; }

    /// <summary>Provider opcional do catálogo de ações da classe atual.</summary>
    public Func<string>? ActionsProvider { get; set; }
    private readonly BridgeConfig _config;
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private Thread? _acceptThread;
    private readonly ConcurrentSet<WsClient> _clients = new();

    public BridgeServer(Func<string> snapshotProvider, BridgeConfig config, Func<string, Task<(int, string)>> commandHandler)
    {
        _snapshotProvider = snapshotProvider;
        _commandHandler = commandHandler;
        _config = config;
    }

    public string Url => $"http://{GetLocalIp()}:{_config.Port}/ws";

    private static string GetLocalIp()
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0);
            socket.Connect("192.168.15.1", 65530);
            if (socket.LocalEndPoint is IPEndPoint ep)
                return ep.Address.ToString();
        }
        catch
        {
            // ignora — fallback abaixo
        }
        return "0.0.0.0";
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _listener = new TcpListener(IPAddress.Any, _config.Port);
        _listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
        _listener.Start();
        _acceptThread = new Thread(() => AcceptLoop(_cts.Token)) { IsBackground = true };
        _acceptThread.Start();
    }

    private async void AcceptLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener!.AcceptTcpClientAsync(ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                break;
            }
            _ = Task.Run(() => HandleClient(client, ct), ct);
        }
    }

    private async Task HandleClient(TcpClient tcp, CancellationToken ct)
    {
        using var _ = tcp;
        tcp.NoDelay = true;
        var stream = tcp.GetStream();

        var (request, bodyPrefix) = await ReadRequestAsync(stream, ct);
        if (request == null) return;

        if (request.Path == "/ws" && request.IsWebSocketUpgrade)
        {
            await HandleWebSocketAsync(tcp, stream, request, ct);
        }
        else
        {
            await HandleHttpAsync(stream, request, bodyPrefix, ct);
        }
    }

    private static async Task<(HttpRequest?, byte[])> ReadRequestAsync(NetworkStream stream, CancellationToken ct)
    {
        var buffer = new byte[8192];
        var all = new List<byte>();
        int read;
        int headerEnd = -1;
        while ((read = await stream.ReadAsync(buffer, ct)) > 0)
        {
            all.AddRange(buffer.AsSpan(0, read).ToArray());
            headerEnd = FindHeaderEnd(all);
            if (headerEnd >= 0) break;
            if (all.Count > 16384) return (null, Array.Empty<byte>());
        }
        if (all.Count == 0) return (null, Array.Empty<byte>());

        var text = Encoding.ASCII.GetString(all.ToArray(), 0, headerEnd < 0 ? all.Count : headerEnd);
        var lines = text.Split("\r\n");
        var requestLine = lines[0].Split(' ');
        if (requestLine.Length < 2) return (null, Array.Empty<byte>());

        var request = new HttpRequest
        {
            Method = requestLine[0],
            Path = requestLine[1],
        };
        foreach (var line in lines.Skip(1))
        {
            var idx = line.IndexOf(':');
            if (idx <= 0) break;
            request.Headers[line[..idx].Trim().ToLowerInvariant()] = line[(idx + 1)..].Trim();
        }
        byte[] prefix = headerEnd >= 0 && all.Count > headerEnd + 4
            ? all.GetRange(headerEnd + 4, all.Count - headerEnd - 4).ToArray()
            : Array.Empty<byte>();
        return (request, prefix);
    }

    private static int FindHeaderEnd(List<byte> bytes)
    {
        var arr = bytes.ToArray();
        for (var i = 0; i + 3 < arr.Length; i++)
        {
            if (arr[i] == 13 && arr[i + 1] == 10 && arr[i + 2] == 13 && arr[i + 3] == 10) return i;
        }
        return -1;
    }

    private async Task HandleWebSocketAsync(TcpClient tcp, NetworkStream stream, HttpRequest request, CancellationToken ct)
    {
        var key = request.Headers.GetValueOrDefault("sec-websocket-key", "");
        if (string.IsNullOrEmpty(key))
        {
            await WriteResponseAsync(stream, 400, "Bad Request", ct);
            return;
        }

        var acceptKey = WsClient.ComputeAcceptKey(key);
        var headers =
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            $"Sec-WebSocket-Accept: {acceptKey}\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(headers), ct);

        var wsClient = new WsClient(tcp, stream, _config);
        _clients.Add(wsClient);

        try
        {
            await wsClient.RunAsync(ct);
        }
        finally
        {
            _clients.Remove(wsClient);
            wsClient.Close();
        }
    }

    private async Task HandleHttpAsync(NetworkStream stream, HttpRequest request, byte[] bodyPrefix, CancellationToken ct)
    {
        var path = request.Path.Split('?')[0];

        if (request.Method == "POST" && path == "/api/command")
        {
            if (!_config.CommandsEnabled)
            {
                await WriteResponseAsync(stream, 403, "Forbidden", ct, "application/json",
                    Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"commands desabilitados\"}"));
                return;
            }
            var len = request.Headers.TryGetValue("content-length", out var cl) && int.TryParse(cl, out var l) ? l : 0;
            if (len <= 0 || len > 8192) { await WriteResponseAsync(stream, 400, "Bad Request", ct); return; }
            var postBody = new byte[len];
            var have = Math.Min(bodyPrefix.Length, len);
            Array.Copy(bodyPrefix, postBody, have);
            var got = have;
            while (got < len)
            {
                var n = await stream.ReadAsync(postBody.AsMemory(got, len - got), ct);
                if (n <= 0) break;
                got += n;
            }
            var (status, respBody) = await _commandHandler(Encoding.UTF8.GetString(postBody, 0, got));
            await WriteResponseAsync(stream, status, status == 200 ? "OK" : "Error", ct,
                "application/json; charset=utf-8", Encoding.UTF8.GetBytes(respBody));
            return;
        }

        if (path == "/api/actions")
        {
            if (ActionsProvider == null) { await WriteResponseAsync(stream, 503, "Unavailable", ct); return; }
            await WriteResponseAsync(stream, 200, "OK", ct, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes(ActionsProvider()));
            return;
        }

        if (path == "/api/macros")
        {
            if (MacrosProvider == null) { await WriteResponseAsync(stream, 503, "Unavailable", ct); return; }
            await WriteResponseAsync(stream, 200, "OK", ct, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes(MacrosProvider()));
            return;
        }

        if (path == "/api/state")
        {
            var json = _snapshotProvider();
            await WriteResponseAsync(stream, 200, "OK", ct, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes(json));
            return;
        }

        if (path.StartsWith("/api/"))
        {
            await WriteResponseAsync(stream, 404, "Not Found", ct);
            return;
        }

        // Static files do companion (wwwroot) + mapas do usuário (maps/)
        var safePath = path == "/" ? "/index.html" : path;
        safePath = safePath.Replace('\\', '/').TrimStart('/');
        if (safePath.Contains("..")) { await WriteResponseAsync(stream, 400, "Bad Request", ct); return; }

        byte[]? body = null;
        var contentType = "application/octet-stream";

        if (safePath.StartsWith("maps/"))
        {
            var mapDir = _config.MapsDirectory;
            if (!string.IsNullOrEmpty(mapDir))
            {
                var file = Path.Combine(mapDir, safePath["maps/".Length..]);
                if (File.Exists(file))
                {
                    body = await File.ReadAllBytesAsync(file, ct);
                    contentType = GuessContentType(file);
                }
            }
        }
        else
        {
            body = Assets.Get(safePath, _config.StaticRoot);
            if (body != null) contentType = GuessContentType(safePath);
        }

        if (body == null)
        {
            await WriteResponseAsync(stream, 404, "Not Found", ct);
            return;
        }

        await WriteResponseAsync(stream, 200, "OK", ct, contentType, body);
    }

    private static string GuessContentType(string file) => Path.GetExtension(file).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json",
        ".webmanifest" => "application/manifest+json",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        ".ico" => "image/x-icon",
        _ => "application/octet-stream",
    };

    private static async Task WriteResponseAsync(NetworkStream stream, int status, string reason, CancellationToken ct,
        string contentType = "text/plain", byte[]? body = null)
    {
        body ??= Array.Empty<byte>();
        var header =
            $"HTTP/1.1 {status} {reason}\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            $"Content-Length: {body.Length}\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Connection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(header), ct);
        if (body.Length > 0)
            await stream.WriteAsync(body, ct);
    }

    /// <summary>Broadcast do snapshot para todos os clientes WS conectados.</summary>
    public async Task BroadcastAsync(string json, CancellationToken ct)
    {
        foreach (var client in _clients.Snapshot())
        {
            try
            {
                await client.SendTextAsync(json, ct);
            }
            catch
            {
                _clients.Remove(client);
                client.Close();
            }
        }
    }

    public int ConnectedCount => _clients.Count;

    public void Dispose()
    {
        _cts?.Cancel();
        foreach (var c in _clients.Snapshot()) c.Close();
        _listener?.Stop();
    }
}

public sealed class HttpRequest
{
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public System.Collections.Generic.Dictionary<string, string> Headers { get; } = new(StringComparer.OrdinalIgnoreCase);
    public bool IsWebSocketUpgrade =>
        Headers.TryGetValue("upgrade", out var u) &&
        u.Equals("websocket", StringComparison.OrdinalIgnoreCase) &&
        Headers.TryGetValue("connection", out var c) &&
        c.Contains("Upgrade", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Conjunto thread-safe simples.</summary>
public sealed class ConcurrentSet<T>
{
    private readonly object _lock = new();
    private System.Collections.Generic.HashSet<T> _items = new();

    public int Count { get { lock (_lock) return _items.Count; } }

    public void Add(T item) { lock (_lock) _items.Add(item); }
    public void Remove(T item) { lock (_lock) _items.Remove(item); }
    public T[] Snapshot() { lock (_lock) return _items.ToArray(); }
}
