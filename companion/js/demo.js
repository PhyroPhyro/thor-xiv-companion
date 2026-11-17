// Modo demo: gera snapshots falsos para testar a UI sem o jogo/plugin.
(function () {
  "use strict";

  const ZONES = [
    { id: 128, name: "Limsa Lominsa Upper Decks", mapId: 139 },
    { id: 137, name: "Central Thanalan", mapId: 51 },
    { id: 399, name: "The Goblet", mapId: 184 },
  ];

  const NAMES = ["Aella Vane", "Brand Ironheart", "Ysilde", "Kororo Tomo", "Zwiebelmann", "Tule mahci"];
  const JOBS = ["WAR", "WHM", "MNK", "DRG", "SCH", "BLM"];

  // IDs reais do ClassJob.RowId: 19 = PLD (Paladin), 27 = SMN (Summoner).
  // O demo alterna entre os dois a cada ~45s p/ exercitar a troca de hotbar por job.
  const JOB_PAIRS = [
    { jobId: 19, job: "PLD", level: 90 },
    { jobId: 27, job: "SMN", level: 80 },
  ];

  let t0 = null;
  let chat = [];
  let chatSeed = 0;
  let zoneIdx = 0;

  const CHAT_LINES = [
    [14, "Aella Vane", "pull em 2"],
    [10, "Kororo Tomo", "alguem tem o atlas de Kholusia?"],
    [56, "", "You gain 250 experience points."],
    [47, "", "Brand Ironheart gains the effect of Freecure from Ysilde."],
    [13, "Zwiebelmann", "df fixado, bora??"],
    [61, "F'lhami", "What brings you to the House of Ffamillar?"],
    [57, "", "The battle continues elsewhere. Please wait or leave the area."],
    [11, "Tule mahci", "WTS: Heaven's Thunder x12, cheap!!"],
  ];

  window.demoStep = function () {
    const now = Date.now();
    if (!t0) t0 = now;
    const t = (now - t0) / 1000;

    if (Math.floor(t / 8) !== zoneIdx % ZONES.length) zoneIdx++;
    const zone = ZONES[zoneIdx % ZONES.length];

    // movimento circular nas coords 1..41
    const cx = 21 + 10 * Math.cos(t / 3);
    const cy = 21 + 10 * Math.sin(t / 3);

    // chat: injeta uma linha a cada ~2.5s
    if (Math.floor(t / 2.5) > chatSeed) {
      chatSeed = Math.floor(t / 2.5);
      const src = CHAT_LINES[chatSeed % CHAT_LINES.length];
      chat.push({ channel: src[0], sender: src[1], text: src[2], stamp: Math.floor(now / 1000) });
      if (chat.length > 60) chat.shift();
    }

    const hpPct = 0.62 + 0.3 * Math.abs(Math.sin(t / 2.7));
    // alterna o job do personagem a cada ~45s (19 PLD <-> 27 SMN) para exercitar a troca de hotbar
    const job = JOB_PAIRS[Math.floor(t / 45) % JOB_PAIRS.length];
    const state = {
      type: "state",
      ts: now,
      loggedIn: true,
      zone: { id: zone.id, name: zone.name },
      map: { id: zone.mapId, name: zone.name },
      player: {
        name: "Phyro Axelpin", jobId: job.jobId, job: job.job, level: job.level,
        hp: Math.floor(hpPct * 432100), maxHp: 432100,
        mp: 9500 + Math.floor(500 * Math.sin(t)), maxMp: 10000,
        world: { x: cx * 10, y: 12, z: cy * 10 },
        mapCoords: { x: cx, y: cy },
      },
      target: { name: "Nael Ghangha", job: "", hp: Math.max(0, Math.floor((400000 - (t % 20) * 20000))), maxHp: 400000, dead: false },
      party: NAMES.map((n, i) => {
        const p = 0.55 + 0.4 * Math.abs(Math.sin(t / (2 + i * 0.3)));
        return {
          name: n, job: JOBS[i], level: 100,
          hp: Math.floor(p * 380000), maxHp: 380000,
          mp: 8000, maxMp: 10000, online: true,
        };
      }),
      chat: chat.slice(),
    };
    return state;
  };
})();
