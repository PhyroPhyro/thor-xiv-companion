using System;
using System.Collections.Generic;

namespace ThorXivBridge;

// Stub só para o harness compilar sem referenciar FFXIVClientStructs.
public sealed class CommandQueue
{
    public CommandQueue(BridgeConfig config, Action<string> log) { }
    public System.Func<string, ulong>? TargetResolver { get; set; }
    public void Enqueue(string cmd) { }
    public void EnqueueAction(uint actionId, string? target) { }
    public void EnqueueSequence(IReadOnlyList<string> lines, int delayMs) { }
    public void Process() { }
}
