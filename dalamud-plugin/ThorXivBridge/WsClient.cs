using System;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThorXivBridge;

/// <summary>
/// Um cliente WebSocket conectado. Implementação mínima:
/// server envia frames de texto (snapshot JSON), aceita ping/pong/close do cliente.
/// </summary>
public sealed class WsClient : IDisposable
{
    private readonly TcpClient _tcp;
    private readonly NetworkStream _stream;
    private readonly BridgeConfig _config;

    public WsClient(TcpClient tcp, NetworkStream stream, BridgeConfig config)
    {
        _tcp = tcp;
        _stream = stream;
        _config = config;
    }

    public static string ComputeAcceptKey(string key)
    {
        const string magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        var bytes = SHA1.HashData(Encoding.ASCII.GetBytes(key + magic));
        return Convert.ToBase64String(bytes);
    }

    /// <summary>Loop que consome frames do cliente (ping/close) até desconectar.</summary>
    public async Task RunAsync(CancellationToken ct)
    {
        var buffer = new byte[4096];
        while (!ct.IsCancellationRequested)
        {
            int read;
            try
            {
                read = await _stream.ReadAsync(buffer, ct);
            }
            catch
            {
                break;
            }
            if (read == 0) break;

            // Decodifica frames do cliente; ignora payload (só nos importa o tipo).
            int pos = 0;
            while (pos + 2 <= read)
            {
                var opcode = buffer[pos] & 0x0F;
                var masked = (buffer[pos + 1] & 0x80) != 0;
                var len = buffer[pos + 1] & 0x7F;
                pos += 2;
                if (len == 126 || len == 127)
                {
                    // frames grandes do cliente não são esperados; trata como desconexão
                    if (len == 127) { pos = int.MaxValue; break; }
                    if (pos + 2 > read) break;
                    len = (buffer[pos] << 8) | buffer[pos + 1];
                    pos += 2;
                }
                var maskLen = masked ? 4 : 0;
                if (pos + maskLen + len > read) break;
                pos += maskLen + len;

                if (opcode == 0x8) // close
                {
                    Close();
                    return;
                }
                // ping (0x9) / outros: respondemos no próximo broadcast; ignora
            }
        }

    }

    public async Task SendTextAsync(string text, CancellationToken ct)
    {
        var payload = Encoding.UTF8.GetBytes(text);
        var headerLen = payload.Length < 126 ? 2 : payload.Length <= ushort.MaxValue ? 4 : 10;
        var frame = new byte[headerLen + payload.Length];

        int idx = 0;
        frame[idx++] = 0x81; // FIN + text
        if (payload.Length < 126)
        {
            frame[idx++] = (byte)payload.Length;
        }
        else if (payload.Length <= ushort.MaxValue)
        {
            frame[idx++] = 126;
            frame[idx++] = (byte)(payload.Length >> 8);
            frame[idx++] = (byte)(payload.Length & 0xFF);
        }
        else
        {
            frame[idx++] = 127;
            var len = payload.Length;
            for (var i = 7; i >= 0; i--)
                frame[idx++] = (byte)((len >> (8 * i)) & 0xFF);
        }
        Array.Copy(payload, 0, frame, idx, payload.Length);

        await _stream.WriteAsync(frame, ct);
    }

    public void Close()
    {
        try { _stream.Close(); } catch { }
        try { _tcp.Close(); } catch { }
    }

    public void Dispose() => Close();
}
