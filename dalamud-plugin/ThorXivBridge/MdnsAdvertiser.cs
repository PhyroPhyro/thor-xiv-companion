using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading;
using Makaretu.Dns;

namespace ThorXivBridge;

/// <summary>
/// Anuncia o bridge via mDNS (_thorxiv._tcp.local) para descoberta automática pelo APK do Thor.
/// Implementação própria sobre MulticastService (a lib não traz advertiser).
/// Se o firewall bloquear UDP 5353, o scan /24 do app ainda funciona — isto é um plus.
/// </summary>
public sealed class MdnsAdvertiser : IDisposable
{
    private static readonly DomainName Service = "_thorxiv._tcp.local";
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(120);

    private readonly DomainName _instance;
    private readonly DomainName _host;
    private readonly MulticastService _service = new() { UseIpv6 = false };
    private readonly int _port;
    private Timer? _announceTimer;

    public MdnsAdvertiser(int port, string machineName)
    {
        _port = port;
        var hostLabel = Sanitize(machineName);
        _host = hostLabel + ".local";
        _instance = "ThorXivBridge-" + hostLabel + "." + Service;
    }

    public void Start()
    {
        _service.QueryReceived += OnQuery;
        _service.Start();
        _announceTimer = new Timer(_ => Announce(), null,
            TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(100));
    }

    private static string Sanitize(string s)
    {
        var t = new string(s.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_').ToArray()).Trim('-');
        return string.IsNullOrEmpty(t) ? "thorxiv" : t;
    }

    private void OnQuery(object? sender, MessageEventArgs e)
    {
        var answers = AnswersFor(e.Message.Questions);
        if (answers.Count == 0) return;

        var msg = e.Message.CreateResponse();
        foreach (var a in answers)
            msg.Answers.Add(a);
        foreach (var a in AddressRecords())
            msg.AdditionalRecords.Add(a);

        try { _service.SendAnswer(msg, e, false); }
        catch { /* multicast pode falhar em algumas NICs; scan /24 cobre */ }
    }

    private void Announce()
    {
        var msg = new Message { QR = true };
        foreach (var a in AnswersFor(new List<Question> {
                     new() { Name = Service, Type = DnsType.PTR, Class = DnsClass.IN },
                     new() { Name = _instance, Type = DnsType.SRV, Class = DnsClass.IN },
                 }))
            msg.Answers.Add(a);
        foreach (var a in AddressRecords())
            msg.AdditionalRecords.Add(a);
        try { _service.SendAnswer(msg, false); } catch { }
    }

    private List<ResourceRecord> AnswersFor(List<Question> questions)
    {
        var outRecords = new List<ResourceRecord>();
        foreach (var q in questions)
        {
            if (q.Name == Service && (q.Type == DnsType.PTR || q.Type == DnsType.ANY))
            {
                outRecords.Add(new PTRRecord
                {
                    Name = Service, Type = DnsType.PTR, Class = DnsClass.IN, TTL = Ttl,
                    DomainName = _instance,
                });
            }
            else if (q.Name == _instance)
            {
                if (q.Type is DnsType.SRV or DnsType.ANY)
                {
                    outRecords.Add(new SRVRecord
                    {
                        Name = _instance, Type = DnsType.SRV, Class = DnsClass.IN, TTL = Ttl,
                        Priority = 0, Weight = 0, Port = (ushort)_port, Target = _host,
                    });
                }
                if (q.Type is DnsType.TXT or DnsType.ANY)
                {
                    outRecords.Add(new TXTRecord
                    {
                        Name = _instance, Type = DnsType.TXT, Class = DnsClass.IN, TTL = Ttl,
                        Strings = { "app=thorxiv-companion", "id=thorxiv" },
                    });
                }
                if (q.Type is DnsType.A or DnsType.ANY)
                {
                    outRecords.Add(new ARecord
                    {
                        Name = _host, Type = DnsType.A, Class = DnsClass.IN, TTL = Ttl,
                    });
                    outRecords[outRecords.Count - 1] = FirstA();
                }
            }
        }
        return outRecords;
    }

    private ARecord FirstA()
    {
        var ips = AddressRecords().OfType<ARecord>().ToList();
        return ips.Count > 0 ? ips[0] : new ARecord
        {
            Name = _host, Type = DnsType.A, Class = DnsClass.IN, TTL = Ttl,
        };
    }

    private List<ResourceRecord> AddressRecords()
    {
        var list = new List<ResourceRecord>();
        try
        {
            foreach (var ip in MulticastService.GetIPAddresses().OfType<IPAddress>().Where(i => i.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork))
            {
                var rec = new ARecord
                {
                    Name = _host, Type = DnsType.A, Class = DnsClass.IN, TTL = Ttl,
                };
                rec.Address = ip;
                list.Add(rec);
            }
        }
        catch { /* sem IPs */ }
        return list;
    }

    public void Dispose()
    {
        _announceTimer?.Dispose();
        _service.QueryReceived -= OnQuery;
        try { _service.Stop(); } catch { }
        _service.Dispose();
    }
}
