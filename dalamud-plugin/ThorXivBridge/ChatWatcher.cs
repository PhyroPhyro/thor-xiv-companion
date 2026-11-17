using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using Dalamud.Plugin.Services;

namespace ThorXivBridge;

/// <summary>
/// Ring buffer de últimas mensagens de chat, capturadas no thread do jogo via IChatGui.
/// </summary>
public sealed class ChatWatcher : IDisposable
{
    private const int Capacity = 60;
    private readonly IChatGui _chatGui;
    private readonly List<string> _entries = new();
    private readonly object _lock = new();

    public ChatWatcher(IChatGui chatGui)
    {
        _chatGui = chatGui;
        _chatGui.ChatMessageUnhandled += OnMessage;
    }

    private void OnMessage(Dalamud.Game.Chat.IChatMessage message)
    {
        try
        {
            var sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"channel\":").Append((int)message.LogKind).Append(',');
            sb.Append("\"sender\":").Append(JsonSerializer.Serialize(message.Sender.TextValue)).Append(',');
            sb.Append("\"text\":").Append(JsonSerializer.Serialize(message.Message.TextValue)).Append(',');
            sb.Append("\"stamp\":").Append(message.Timestamp);
            sb.Append('}');

            lock (_lock)
            {
                _entries.Add(sb.ToString());
                while (_entries.Count > Capacity)
                    _entries.RemoveAt(0);
            }
        }
        catch
        {
            // nunca deixar exceção vazar para o evento do jogo
        }
    }

    public string SnapshotJson()
    {
        lock (_lock)
        {
            if (_entries.Count == 0) return "[]";
            return "[" + string.Join(",", _entries) + "]";
        }
    }

    public void Dispose()
    {
        _chatGui.ChatMessageUnhandled -= OnMessage;
    }
}
