using System;
using System.IO;
using System.Reflection;

namespace ThorXivBridge;

/// <summary>
/// Serve arquivos do companion: disco (StaticRoot) com fallback para recursos
/// embutidos no assembly (necessário porque o Dalamud pode carregar o plugin em
/// memória, deixando Assembly.Location vazio).
/// </summary>
public static class Assets
{
    private static readonly Assembly Asm = typeof(Assets).Assembly;

    public static byte[]? Get(string relPath, string? diskRoot)
    {
        relPath = relPath.Replace('\\', '/').TrimStart('/');

        if (!string.IsNullOrEmpty(diskRoot))
        {
            try
            {
                var full = Path.GetFullPath(Path.Combine(diskRoot, relPath.Replace('/', Path.DirectorySeparatorChar)));
                var rootFull = Path.GetFullPath(diskRoot);
                if (full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase) && File.Exists(full))
                    return File.ReadAllBytes(full);
            }
            catch
            {
                // cai no embutido
            }
        }

        using var stream = Asm.GetManifestResourceStream("companion/" + relPath);
        if (stream == null) return null;
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        return ms.ToArray();
    }
}
