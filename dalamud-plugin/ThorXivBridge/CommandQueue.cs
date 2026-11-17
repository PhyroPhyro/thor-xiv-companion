using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using FFXIVClientStructs.FFXIV.Client.System.String;
using FFXIVClientStructs.FFXIV.Client.UI.Shell;

namespace ThorXivBridge;

/// <summary>
/// Executor nativo de comandos de chat ("/ac ...", "/marking ...", etc.) — sem depender de plugins
/// de terceiros. A fila é alimentada pela thread HTTP e consumida no Framework.Update (thread do jogo).
/// Ações de macro de jogo (multi-linha) são suportadas como "sequências": linha a linha com delay,
/// exatamente como o jogo faria ao apertar um botão de macro manualmente.
/// </summary>
public sealed class CommandQueue
{
    private readonly record struct Item(string? Cmd, long DueMs, uint ActionId = 0, string? Target = null);

    private readonly object _lock = new();
    private readonly Queue<Item> _pending = new();
    private readonly BridgeConfig _config;
    private readonly Action<string> _log;

    private long _sequenceTailMs;

    public CommandQueue(BridgeConfig config, Action<string> log)
    {
        _config = config;
        _log = log;
    }

    public Func<string, ulong>? TargetResolver { get; set; }

    public void Enqueue(string cmd)
    {
        lock (_lock) _pending.Enqueue(new Item(cmd, 0));
    }

    public void EnqueueAction(uint actionId, string? target)
    {
        lock (_lock) _pending.Enqueue(new Item(null, 0, actionId, target));
    }

    public void EnqueueSequence(IReadOnlyList<string> lines, int delayMs)
    {
        var step = Math.Clamp(delayMs <= 0 ? _config.SequenceDelayMs : delayMs, 50, 2000);
        lock (_lock)
        {
            var baseMs = Math.Max(Environment.TickCount64 + 100, _sequenceTailMs);
            for (var i = 0; i < lines.Count; i++)
            {
                var line = lines[i]?.Trim() ?? "";
                if (line.Length == 0 || line.StartsWith("//")) continue;
                _pending.Enqueue(new Item(line, baseMs + (long)i * step));
            }
            _sequenceTailMs = baseMs + (long)lines.Count * step;
        }
    }

    /// <summary>Chamar no Framework.Update (thread do jogo).</summary>
    public void Process()
    {
        Item item;
        while (true)
        {
            lock (_lock)
            {
                if (_pending.Count == 0) return;
                if (_pending.Peek().DueMs > Environment.TickCount64) return;
                item = _pending.Dequeue();
            }
            if (item.ActionId != 0) ExecuteSkill(item.ActionId, item.Target);
            else Execute(item.Cmd!);
        }
    }

    private unsafe void ExecuteSkill(uint actionId, string? target)
    {
        try
        {
            var am = FFXIVClientStructs.FFXIV.Client.Game.ActionManager.Instance();
            if (am == null) return;
            var targetId = TargetResolver?.Invoke(target ?? "auto") ?? 0xE000_0000;
            am->UseAction(FFXIVClientStructs.FFXIV.Client.Game.ActionType.Action,
                actionId, targetId, 0,
                FFXIVClientStructs.FFXIV.Client.Game.ActionManager.UseActionMode.None);
        }
        catch (Exception ex)
        {
            _log($"skill {actionId} falhou: {ex.GetType().Name}");
        }
    }

    private unsafe void Execute(string cmd)
    {
        try
        {
            var shell = RaptureShellModule.Instance();
            if (shell == null)
            {
                _log("shell module indisponivel");
                return;
            }
            Utf8String* u8 = Utf8String.FromString(cmd);
            try
            {
                shell->ExecuteCommandInner(u8, shell->UIModule);
            }
            finally
            {
                u8->Dtor(true);
            }
        }
        catch (Exception ex)
        {
            _log($"execute falhou: {ex.GetType().Name}");
        }
    }
}
