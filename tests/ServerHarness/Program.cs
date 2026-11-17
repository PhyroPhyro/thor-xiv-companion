using System;
using System.Threading.Tasks;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using ThorXivBridge;

var root = args.Length > 0 ? args[0] : "../../companion";
var port = args.Length > 1 ? int.Parse(args[1]) : 11436;
var counter = 0;

var cfg = new BridgeConfig { Port = port, StaticRoot = Path.GetFullPath(root), MapsDirectory = "" };
var server = new BridgeServer(() =>
{
    var i = Interlocked.Increment(ref counter);
    return SampleJson.Snapshot(i);
}, cfg, json => CommandsApi.HandleAsync(json, cfg, new CommandQueue(cfg, m => Console.WriteLine("QUEUE: " + m))));

server.Start();
Console.WriteLine("harness: " + server.Url + " | static: " + cfg.StaticRoot);

_ = Task.Run(async () =>
{
    var ct = new CancellationTokenSource().Token;
    while (true)
    {
        await Task.Delay(cfg.BroadcastMs);
        try { await server.BroadcastAsync(SampleJson.Snapshot(Interlocked.Increment(ref counter)), ct); } catch { }
    }
});

Thread.Sleep(Timeout.Infinite);

static class SampleJson
{
    public static string Snapshot(int i) => $$$"""
    {"type":"state","ts":1731700000000,"loggedIn":true,
     "cooldowns":{"1":{"r":2.5,"t":4}},
     "zone":{"id":399,"name":"The Goblet"},"map":{"id":184,"name":"The Goblet"},
     "player":{"name":"Tester One","job":"DRG","jobId":19,"level":100,"hp":300000,"maxHp":432100,"mp":9000,"maxMp":10000,
       "world":{"x":100.2,"y":12.0,"z":200.3},
      "mapCoords":{"x":21.0,"y":21.0}},
     "target":{"name":"Boss","job":"","hp":380000,"maxHp":400000,"dead":false},
     "party":[{"name":"Aella Vane","job":"WAR","level":100,"hp":380000,"maxHp":380000,"mp":10000,"maxMp":10000,"online":true},
              {"name":"Ysilde","job":"WHM","level":100,"hp":300000,"maxHp":350000,"mp":9000,"maxMp":12000,"online":true}],
     "pois":[
       {"x":1390,"y":1150,"icon":60453,"name":"Aetheryte — The Goblet"},
       {"x":1100,"y":900,"icon":60311,"name":"Aethernet"},
       {"x":1700,"y":1400,"icon":60441,"name":"District"}
     ],
     "chat":[{"channel":14,"sender":"Aella Vane","text":"pull in {{{i}}}s","stamp":1731700000}]}
    """;
}
