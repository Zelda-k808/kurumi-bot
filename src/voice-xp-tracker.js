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

async function creditMinutes(guildId, userId, username, minutes) {
  if (minutes <= 0) return;
  const xp = minutes * levels.XP_PER_MINUTE;
  await db.addVoiceXp(guildId, userId, username, xp, minutes * 60);
}

async function startSession(guildId, userId, username) {
  const key = sessionKey(guildId, userId);
  const now = Date.now();
  if (sessions.has(key)) return;
  sessions.set(key, {
    guildId,
    userId,
    joinedAt: now,
    lastCreditAt: now,
  });
  await db.ensureUser(userId, username);
  await db.ensureUserVoiceXp(guildId, userId, username);
}

async function endSession(guildId, userId, username) {
  const key = sessionKey(guildId, userId);
  const s = sessions.get(key);
  if (!s) return;
  sessions.delete(key);
  const elapsedMs = Date.now() - s.lastCreditAt;
  const minutes = Math.floor(elapsedMs / 60_000);
  await creditMinutes(guildId, userId, username, minutes);
}

async function tickSession(s, username) {
  const now = Date.now();
  const elapsedMs = now - s.lastCreditAt;
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return;
  await creditMinutes(s.guildId, s.userId, username, minutes);
  s.lastCreditAt += minutes * 60_000;
}

async function runTick(client) {
  for (const s of sessions.values()) {
    const guild = client.guilds.cache.get(s.guildId);
    if (!guild) {
      sessions.delete(sessionKey(s.guildId, s.userId));
      continue;
    }
    const vs = guild.voiceStates.cache.get(s.userId);
    if (!vs?.channelId || vs.member?.user?.bot) {
      await endSession(s.guildId, s.userId, vs?.member?.user?.username);
      continue;
    }
    await tickSession(s, vs.member.user.username);
  }
}

async function handleVoiceStateUpdate(oldState, newState) {
  const member = newState.member || oldState.member;
  if (member?.user?.bot) return;
  if (!newState.guild) return;

  const guildId = newState.guild.id;
  const userId = newState.id;
  const username = member.user?.username;

  const wasIn = oldState.channelId;
  const nowIn = newState.channelId;

  if (!wasIn && nowIn) {
    await startSession(guildId, userId, username);
    return;
  }
  if (wasIn && !nowIn) {
    await endSession(guildId, userId, username);
    return;
  }
  if (wasIn && nowIn && wasIn !== nowIn) {
    await endSession(guildId, userId, username);
    await startSession(guildId, userId, username);
  }
}

async function syncGuildOnReady(guild) {
  try {
    // Fetch members to ensure cache is populated
    await guild.members.fetch();
    for (const vs of guild.voiceStates.cache.values()) {
      if (shouldTrack(vs.member)) {
        await startSession(guild.id, vs.id, vs.member.user.username);
      }
    }
  } catch (err) {
    console.error(`[voice-xp] sync error for guild ${guild.id}:`, err);
  }
}

function attach(client) {
  client.on("voiceStateUpdate", (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState).catch((e) => {
      console.error("[voice-xp] voiceStateUpdate", e);
    });
  });

  client.once("ready", async () => {
    for (const guild of client.guilds.cache.values()) {
      await syncGuildOnReady(guild);
    }
    console.log(`[voice-xp] tracking · ${sessions.size} active voice session(s)`);
  });

  setInterval(() => {
    runTick(client).catch((e) => console.error("[voice-xp] tick", e));
  }, 60_000);
}

module.exports = { attach, startSession, endSession, sessions };
