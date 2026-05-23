const db = require("./database");
const levels = require("./voice-levels");

/** @type {Map<string, { guildId: string, userId: string, joinedAt: number, lastCreditAt: number }>} */
const sessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function shouldTrack(member) {
  if (!member?.user || member.user.bot) return false;
  if (!member.voice?.channelId) return false;
  return true;
}

function creditMinutes(guildId, userId, username, minutes) {
  if (minutes <= 0) return;
  const xp = minutes * levels.XP_PER_MINUTE;
  db.addVoiceXp(guildId, userId, username, xp, minutes * 60);
}

function startSession(guildId, userId, username) {
  const key = sessionKey(guildId, userId);
  const now = Date.now();
  if (sessions.has(key)) return;
  sessions.set(key, {
    guildId,
    userId,
    joinedAt: now,
    lastCreditAt: now,
  });
  db.ensureUser(userId, username);
  db.ensureUserVoiceXp(guildId, userId, username);
}

function endSession(guildId, userId, username) {
  const key = sessionKey(guildId, userId);
  const s = sessions.get(key);
  if (!s) return;
  sessions.delete(key);
  const elapsedMs = Date.now() - s.lastCreditAt;
  const minutes = Math.floor(elapsedMs / 60_000);
  creditMinutes(guildId, userId, username, minutes);
}

function tickSession(s, username) {
  const now = Date.now();
  const elapsedMs = now - s.lastCreditAt;
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return;
  creditMinutes(s.guildId, s.userId, username, minutes);
  s.lastCreditAt += minutes * 60_000;
}

function runTick(client) {
  for (const s of sessions.values()) {
    const guild = client.guilds.cache.get(s.guildId);
    if (!guild) {
      sessions.delete(sessionKey(s.guildId, s.userId));
      continue;
    }
    const vs = guild.voiceStates.cache.get(s.userId);
    if (!vs?.channelId || vs.member?.user?.bot) {
      endSession(s.guildId, s.userId, vs?.member?.user?.username);
      continue;
    }
    tickSession(s, vs.member.user.username);
  }
}

function handleVoiceStateUpdate(oldState, newState) {
  const member = newState.member || oldState.member;
  if (member?.user?.bot) return;
  if (!newState.guild) return;

  const guildId = newState.guild.id;
  const userId = newState.id;
  const username = member.user?.username;

  const wasIn = oldState.channelId;
  const nowIn = newState.channelId;

  if (!wasIn && nowIn) {
    startSession(guildId, userId, username);
    return;
  }
  if (wasIn && !nowIn) {
    endSession(guildId, userId, username);
    return;
  }
  if (wasIn && nowIn && wasIn !== nowIn) {
    endSession(guildId, userId, username);
    startSession(guildId, userId, username);
  }
}

function syncGuildOnReady(guild) {
  for (const vs of guild.voiceStates.cache.values()) {
    if (shouldTrack(vs.member)) {
      startSession(guild.id, vs.id, vs.member.user.username);
    }
  }
}

function attach(client) {
  client.on("voiceStateUpdate", (oldState, newState) => {
    try {
      handleVoiceStateUpdate(oldState, newState);
    } catch (e) {
      console.error("[voice-xp] voiceStateUpdate", e);
    }
  });

  client.once("ready", () => {
    for (const guild of client.guilds.cache.values()) {
      syncGuildOnReady(guild);
    }
    console.log(`[voice-xp] tracking · ${sessions.size} active voice session(s)`);
  });

  setInterval(() => {
    runTick(client);
  }, 60_000);
}

module.exports = { attach, startSession, endSession, sessions };
