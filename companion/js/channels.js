// Mapeamento XivChatType -> rótulo/classe de exibição (subset útil).
window.CHANNELS = {
  10: { name: "Say", cls: "" },
  11: { name: "Shout", cls: "" },
  12: { name: "→Tell", cls: "" },
  13: { name: "←Tell", cls: "" },
  14: { name: "Party", cls: "" },
  15: { name: "Alliance", cls: "" },
  16: { name: "LS1", cls: "" },
  17: { name: "LS2", cls: "" },
  24: { name: "FC", cls: "" },
  27: { name: "Novice", cls: "" },
  28: { name: "Emote", cls: "" },
  29: { name: "Emote", cls: "" },
  30: { name: "Yell", cls: "" },
  41: { name: "Damage", cls: "ch-sys" },
  43: { name: "Action", cls: "ch-sys" },
  44: { name: "Item", cls: "ch-sys" },
  45: { name: "Healing", cls: "ch-sys" },
  46: { name: "Buff", cls: "ch-sys" },
  47: { name: "Debuff", cls: "ch-sys" },
  48: { name: "Buff−", cls: "ch-sys" },
  49: { name: "Debuff−", cls: "ch-sys" },
  56: { name: "Echo", cls: "ch-sys" },
  57: { name: "System", cls: "ch-sys" },
  58: { name: "SysErr", cls: "ch-err" },
  60: { name: "Error", cls: "ch-err" },
  61: { name: "NPC", cls: "ch-sys" },
  62: { name: "Loot", cls: "ch-sys" },
  64: { name: "Progress", cls: "ch-sys" },
};

window.channelInfo = function (id) {
  return window.CHANNELS[id] || { name: "ch" + id, cls: "ch-sys" };
};
