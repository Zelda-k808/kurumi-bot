// Local `.env` only when not on Render; never override existing env keys.
if (!process.env.RENDER) {
  require("dotenv").config({ override: false });
}

/* ── Write PID file so `prestart` can kill old instances on restart ── */
const fs = require("fs");
const path = require("path");
const BOT_PID_FILE = path.join(__dirname, "..", ".bot.pid");
try {
  fs.writeFileSync(BOT_PID_FILE, String(process.pid), "utf-8");
} catch (_) {}
// Clean up PID file on exit
function removePidFile() {
  try { fs.unlinkSync(BOT_PID_FILE); } catch (_) {}
}
process.on("exit", removePidFile);

process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));

const http = require("http");
const Sentiment = require("sentiment");
const sentiment = new Sentiment();
const oldExit = process.exit;
process.exit = function(code) {
  console.error("PROCESS EXIT CALLED WITH CODE", code, new Error().stack);
  oldExit(code);
};
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");
const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus
} = require("@discordjs/voice");
const wordle = require("./wordle");
const { parseKurumiLine, KURUMI_HELP } = require("./kurumi-text");
const persona = require("./kurumi-persona");
const { formatTimeAmPmVerbose, DEFAULT_DISPLAY_TIMEZONE } = require("./time-util");
const dailyWordle = require("./daily-wordle");
const db = require("./database");
const llmChat = require("./local-llm");
const voiceXpTracker = require("./voice-xp-tracker");
const kurumiLeaderboard = require("./kurumi-leaderboard");
const chatContext = require("./chat-context");
const chatResearch = require("./chat-research");
const failover = require("./failover");

/* ───────────── Music system ───────────── */
const shoukakuClient = require("./music/shoukaku-client");
const { musicCommandData } = require("./music/commands");
const { handleMusicInteraction, handleMusicButton, setDb: setMusicDb } = require("./music/interaction-handler");
const musicQueue = require("./music/queue-manager");
const { buildNowPlaying } = require("./music/now-playing");
const musicTrackResolver = require("./music/track-resolver");
const { getPreset: getMusicFilter } = require("./music/filters");
const musicLyrics = require("./music/lyrics-client");

const guildConnections = new Map();
/** guildId → voice channel id to rejoin after drops (cleared on /leave). */
const guildVoiceTargets = new Map();

/** Avoid duplicate replies if Discord delivers the same message twice. */
const kurumiHandledMessageIds = new Set();

const VOICE_RECOVERY_MS = 120_000;
const VOICE_HEALTH_INTERVAL_MS = 4 * 60 * 1000;

if (process.env.DEBUG_BOT_ENV === "1") {
  const t = typeof process.env.DISCORD_TOKEN === "string" ? process.env.DISCORD_TOKEN.trim() : "";
  console.log(
    "[DEBUG_BOT_ENV] RENDER=%s token_len=%s",
    Boolean(process.env.RENDER),
    t.length
  );
}

function startKeepAliveHttp() {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    if (process.env.RENDER) {
      console.warn("PORT unset; HTTP keep-alive disabled.");
    }
    return null;
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port <= 0) {
    console.error("Invalid PORT:", JSON.stringify(rawPort));
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";

    // ── Existing keep-alive routes ──
    if (req.method === "GET" && (path === "/" || path === "/ping")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    // ── Failover: heartbeat receiver (Render side) ──
    if (req.method === "POST" && path === "/heartbeat") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const ts = typeof data.timestamp === "number" ? data.timestamp : Date.now();
          failover.updateHeartbeat(ts);

          if (data.status === "shutdown") {
            console.log("[failover] laptop sent shutdown signal — will activate soon");
            // Force heartbeat to epoch so shouldActivate() is true on next check
            failover.updateHeartbeat(0);
          } else if (failover.getMode() === "active") {
            // Laptop is back — schedule stand-down
            failover.scheduleStandDown(async () => {
              console.log("[failover] deactivating Render bot (laptop took over)");
              try { client.destroy(); } catch (_) {}
            });
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, mode: failover.getMode() }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
        }
      });
      return;
    }

    // ── Failover: status endpoint for debugging ──
    if (req.method === "GET" && path === "/failover-status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(failover.getStatus(), null, 2));
      return;
    }

    res.writeHead(404).end();
  });

  server.on("error", (err) => {
    console.error("HTTP server error:", err);
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`HTTP keep-alive 0.0.0.0:${port} (GET / /ping /failover-status, POST /heartbeat)`);
  });

  return server;
}

startKeepAliveHttp();

/* ───────────── Heartbeat sender (laptop → Render) ───────────── */
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) || 30_000;
const RENDER_HEARTBEAT_URL = (process.env.RENDER_HEARTBEAT_URL || "").trim();

function startHeartbeatSender() {
  if (!RENDER_HEARTBEAT_URL) return;
  // Don't send heartbeats FROM Render TO itself
  if (process.env.RENDER) return;

  const url = RENDER_HEARTBEAT_URL.replace(/\/+$/, "") + "/heartbeat";
  console.log(`[heartbeat] sending to ${url} every ${HEARTBEAT_INTERVAL_MS}ms`);

  async function sendHeartbeat(status) {
    const payload = JSON.stringify({ status: status || "alive", timestamp: Date.now() });
    try {
      const { hostname, port, pathname, protocol } = new URL(url);
      const mod = protocol === "https:" ? require("https") : require("http");
      await new Promise((resolve, reject) => {
        const req = mod.request(
          {
            hostname,
            port: port || (protocol === "https:" ? 443 : 80),
            path: pathname,
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
            timeout: 10_000,
          },
          (res) => {
            res.resume(); // drain
            resolve();
          }
        );
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.write(payload);
        req.end();
      });
    } catch (err) {
      console.warn(`[heartbeat] failed: ${err.message}`);
    }
  }

  // Send an initial heartbeat immediately
  sendHeartbeat("alive");

  const timer = setInterval(() => sendHeartbeat("alive"), HEARTBEAT_INTERVAL_MS);

  // On graceful shutdown, tell Render to take over immediately
  function onShutdown(signal) {
    console.log(`[heartbeat] ${signal} received — sending shutdown heartbeat`);
    clearInterval(timer);
    sendHeartbeat("shutdown").finally(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", () => onShutdown("SIGINT"));
  process.on("SIGTERM", () => onShutdown("SIGTERM"));

  return timer;
}

startHeartbeatSender();

const token = (process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error(
    "Missing DISCORD_TOKEN (Render: Environment → variable, no quotes; local: .env)."
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const commandData = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your current voice channel and stay muted."),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the current voice channel."),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check if the bot is connected in this server."),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency (Discord only; does not wake Render)."),
  new SlashCommandBuilder()
    .setName("wordle")
    .setDescription("Play Wordle (5 letters, 6 guesses, private board).")
    .addSubcommand((s) =>
      s.setName("new").setDescription("Start a new game (replaces your current game).")
    )
    .addSubcommand((s) =>
      s
        .setName("guess")
        .setDescription("Submit a 5-letter guess.")
        .addStringOption((o) =>
          o
            .setName("word")
            .setDescription("Five letters (a–z)")
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(5)
        )
    )
    .addSubcommand((s) => s.setName("status").setDescription("Show your current board."))
    .addSubcommand((s) => s.setName("stats").setDescription("Show your lifetime Wordle stats."))
    .addSubcommand((s) => s.setName("share").setDescription("Share your last finished game."))
    .addSubcommand((s) => s.setName("hardmode").setDescription("Toggle hard mode for future games."))
    .addSubcommand((s) => s.setName("colorblind").setDescription("Toggle high-contrast colorblind tiles."))
    .addSubcommand((s) => s.setName("giveup").setDescription("Surrender your current game and reveal the answer.")),
  new SlashCommandBuilder()
    .setName("dailywordle")
    .setDescription("Server daily Wordle: 8:00 post + one shared word per day.")
    .addSubcommand((s) =>
      s
        .setName("setup")
        .setDescription("Post the daily puzzle every day at 8:00 in this channel (Manage Server).")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel for the morning announcement")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("timezone")
            .setDescription("IANA timezone, e.g. America/New_York, Asia/Tokyo (default UTC)")
            .setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("guess")
        .setDescription("Guess today's shared daily word (same for everyone in this server).")
        .addStringOption((o) =>
          o
            .setName("word")
            .setDescription("Five letters")
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(5)
        )
    )
    .addSubcommand((s) => s.setName("status").setDescription("Your board for today's daily Wordle."))
    .addSubcommand((s) => s.setName("leaderboard").setDescription("See today's server leaderboard."))
    .addSubcommand((s) =>
      s
        .setName("stop")
        .setDescription("Stop daily posts for this server (Manage Server).")
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Voice XP leaderboard — 100 XP per minute in voice channels.")
    .addIntegerOption((o) =>
      o
        .setName("page")
        .setDescription("Page number (10 per page)")
        .setMinValue(1)
        .setRequired(false)
    )
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Show one member's rank card instead of the top list")
        .setRequired(false)
    )
].map((c) => c.toJSON()).concat(musicCommandData);

function parseGuildIds(raw) {
  if (!raw || typeof raw !== "string") return [];
  const seen = new Set();
  const out = [];
  for (const s of raw.split(",").map((x) => x.trim())) {
    if (/^\d{17,20}$/.test(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

async function propagateSlashCommands(applicationId) {
  const rest = new REST({ version: "10" }).setToken(token);
  const guildIds = parseGuildIds(process.env.DISCORD_GUILD_ID || "");

  if (guildIds.length > 0) {
    // Guild + global both register the same names → Discord shows duplicates. Keep guild only.
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    await Promise.all(
      guildIds.map((guildId) =>
        rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
          body: commandData
        })
      )
    );
    return { mode: "guild", count: guildIds.length };
  }

  await rest.put(Routes.applicationCommands(applicationId), { body: commandData });
  return { mode: "global", count: 0 };
}

function bindVoiceRecovery(connection, guildId) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    const channelId = guildVoiceTargets.get(guildId);
    if (!channelId) return;

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, VOICE_RECOVERY_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, VOICE_RECOVERY_MS),
        entersState(connection, VoiceConnectionStatus.Ready, VOICE_RECOVERY_MS)
      ]);
    } catch (_) {
      console.warn(`[voice] guild ${guildId} did not recover in time; rejoining…`);
      try {
        await establishMutedConnection(guildId, channelId);
      } catch (err) {
        console.error("[voice] rejoin failed (will retry while you keep this session):", err);
        guildConnections.delete(guildId);
      }
    }
  });
}

async function establishMutedConnection(guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error("guild not in cache");

  let vc = guild.channels.cache.get(channelId);
  if (!vc) {
    vc = await guild.channels.fetch(channelId).catch(() => null);
  }
  if (!vc || !vc.isVoiceBased()) throw new Error("voice channel unavailable");

  const existing = guildConnections.get(guildId);
  if (existing) {
    try {
      existing.destroy();
    } catch (_) {}
    guildConnections.delete(guildId);
  }

  const connection = joinVoiceChannel({
    channelId: vc.id,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfMute: true,
    selfDeaf: false
  });

  guildConnections.set(guildId, connection);
  bindVoiceRecovery(connection, guildId);
  return connection;
}

function startVoiceHealthLoop() {
  setInterval(() => {
    for (const [guildId, channelId] of guildVoiceTargets) {
      const connection = guildConnections.get(guildId);
      if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
        establishMutedConnection(guildId, channelId).catch((err) => {
          console.error("[voice] health rejoin:", err);
        });
      }
    }
  }, VOICE_HEALTH_INTERVAL_MS);
}

/** @param {import("discord.js").GuildMember | null | undefined} member */
async function voiceJoinFromMember(member) {
  const memberChannel = member?.voice?.channel;
  if (!memberChannel) {
    return {
      ok: false,
      text:
        "You are not in a voice channel right now, Master — I **stay connected** where you last asked until you say **`/leave`** or **`kurumi leave`**. " +
        "Join a VC and run **`/join`** or **`kurumi join`** again if you want me to move with you."
    };
  }

  const guildId = member.guild.id;
  guildVoiceTargets.set(guildId, memberChannel.id);

  try {
    await establishMutedConnection(guildId, memberChannel.id);
  } catch (err) {
    guildConnections.delete(guildId);
    console.error("[voice] join failed:", err);
    return {
      ok: false,
      text:
        "Could not join or refresh voice right now, Master — I will **keep trying** to hold this session. " +
        "Use **`/leave`** or **`kurumi leave`** only when you want me to disconnect."
    };
  }

  return { ok: true, text: `Joined **${memberChannel.name}** and staying muted.` };
}

function voiceLeaveGuild(guildId) {
  const c = guildConnections.get(guildId);
  const hadTarget = guildVoiceTargets.has(guildId);
  guildVoiceTargets.delete(guildId);
  if (c) {
    c.destroy();
    guildConnections.delete(guildId);
    return { ok: true, text: "Left the voice channel." };
  }
  if (hadTarget) {
    return {
      ok: true,
      text: "Understood, Master — I've cleared the voice session (I wasn't connected just now)."
    };
  }
  return { ok: false, text: "I am not in a voice channel in this server." };
}

function voiceStatusText(guildId) {
  const c = guildConnections.get(guildId);
  return c ? "I am connected and muted in this server." : "I am not connected in this server.";
}

async function connectMuted(interaction) {
  const r = await voiceJoinFromMember(interaction.member);
  await interaction.reply({
    content: r.text,
    ephemeral: !r.ok
  });
}

async function handlePing(interaction) {
  try {
    // ACK within Discord’s ~3s window (cold Render / queue lag → 10062 if we only reply() late).
    await interaction.deferReply();
    const ackMs = Date.now() - interaction.createdTimestamp;
    const ws = Number.isFinite(client.ws.ping) ? client.ws.ping : -1;
    await interaction.editReply(
      `Pong. Ack ~${ackMs} ms · WebSocket ping ~${ws} ms`
    );
  } catch (err) {
    console.error("/ping:", err);
    const body = { content: "Could not complete /ping.", ephemeral: true };
    try {
      await (interaction.deferred || interaction.replied
        ? interaction.followUp(body)
        : interaction.reply(body));
    } catch (_) {}
  }
}

client.once("ready", async () => {
  try {
    const { mode, count } = await propagateSlashCommands(client.user.id);
    const where = mode === "guild" ? `guild ×${count}` : "global";
    console.log(`Logged in as ${client.user.tag} · slash commands: ${where}`);
    console.log(
      "Text: messages starting with **kurumi** — enable **Message Content Intent** (Bot tab) in the Developer Portal."
    );
  } catch (err) {
    console.error("Command registration failed:", err);
  }
  await db.init();
  wordle.loadWordList().catch((e) => console.error("[wordle] loadWordList", e));
  startVoiceHealthLoop();
  setInterval(() => {
    dailyWordle.tickDailyPost(client).catch((e) => console.error("[daily-wordle] tick", e));
  }, 60_000);
  dailyWordle.tickDailyPost(client).catch((e) => console.error("[daily-wordle] initial tick", e));

  voiceXpTracker.attach(client);

  /* ── Set music DB reference (Shoukaku is already initialized before login) ── */
  setMusicDb(db);
  musicQueue.setDb(db);

  if (llmChat.isEnabled()) {
    const cfg = llmChat.getConfig();
    if (cfg.misconfiguredOnRender) {
      console.warn(
        "[local-llm] OLLAMA_HOST is localhost but this process is on Render — set OLLAMA_HOST to your PC/VPS URL in Render Environment (see docs/ollama-remote.md)"
      );
    }
    const probe = await llmChat.probe(true);
    if (probe.ok) {
      console.log(`[local-llm] ready · ${cfg.host} · model ${cfg.model}`);
    } else {
      console.warn(`[local-llm] offline — ${probe.reason} (chat uses persona fallback)`);
    }
  } else {
    console.log("[local-llm] disabled (OLLAMA_ENABLED=0)");
  }

  // Conversation cleanup: prune stale sessions every minute
  setInterval(() => {
    const now = Date.now();
    for (const [key, s] of activeConversations.entries()) {
      if (now - s.lastActivity > CONV_TIMEOUT_MS) {
        activeConversations.delete(key);
      }
    }
  }, 60_000);
});

/* ───────────── Sticky conversation + Wordle shorthand ───────────── */
const activeConversations = new Map();
const CONV_TIMEOUT_MS = 12 * 60 * 1000; // 12 minutes
const CONV_MAX_TURNS = 40;

function getConvKey(gid, uid) { return `${gid}:${uid}`; }

function enterConversation(gid, uid) {
  activeConversations.set(getConvKey(gid, uid), {
    startedAt: Date.now(),
    lastActivity: Date.now(),
    turnCount: 0,
  });
}

function exitConversation(gid, uid) {
  activeConversations.delete(getConvKey(gid, uid));
}

function bumpConversation(gid, uid) {
  const s = activeConversations.get(getConvKey(gid, uid));
  if (s) {
    s.lastActivity = Date.now();
    s.turnCount += 1;
  }
}

function isInConversation(gid, uid) {
  const key = getConvKey(gid, uid);
  const s = activeConversations.get(key);
  if (!s) return false;
  if (Date.now() - s.lastActivity > CONV_TIMEOUT_MS) {
    activeConversations.delete(key);
    return false;
  }
  if (s.turnCount >= CONV_MAX_TURNS) {
    activeConversations.delete(key);
    return false;
  }
  return true;
}

const CONV_ENDERS = /\b(bye|goodbye|farewell|stop|end|quit|exit|cya|see ya|later|peace|gn|goodnight|good night)\b/i;

function isConvEnd(text) {
  return CONV_ENDERS.test(text.toLowerCase());
}

async function handleChatReply(message, text, replyOpts, timeLine) {
  const userId = message.author.id;
  const guildId = message.guild?.id || null;
  await db.ensureUser(userId, message.author.username);
  const recentChat = await db.getRecentChat(userId, 24);

  const { query: resolvedQuery } = chatContext.resolveQuery(text, recentChat);
  const recap = chatContext.buildConversationRecap(recentChat, 14);
  const wantsLookup =
    /\b(look\s*it\s*up|look\s*up|search|google)\b/i.test(text) ||
    chatContext.needsPriorQuestion(text);
  const shouldResearch =
    wantsLookup || chatContext.isLikelyFactual(resolvedQuery);

  let researchBlock = null;
  if (llmChat.isEnabled()) {
    try {
      await message.channel.sendTyping();
    } catch (_) {}
    if (shouldResearch) {
      researchBlock = await chatResearch.gatherFacts(resolvedQuery, { force: wantsLookup });
      try {
        await message.channel.sendTyping();
      } catch (_) {}
    }
  }

  let line = await llmChat.chat(userId, message.author.username, recentChat, text, timeLine, {
    researchBlock,
    conversationRecap: recap,
    resolvedQuery,
    historyLimit: 18,
  });
  if (!line) {
    line = persona.chatReply(text, { timeLine, userId, recentChat });
  }

  try {
    await message.reply({ content: line, ...replyOpts });
  } catch (err) {
    if (err.code === 50035) {
      // If reply fails (e.g. message deleted), try sending to channel instead
      await message.channel.send({ content: line }).catch(() => null);
    } else {
      console.error("[kurumi text] reply error:", err);
    }
  }
  const sent = sentiment.analyze(text);
  const intent = persona.detectIntent(text);
  await db.logChat(userId, guildId, text, line, sent.score, intent.type);
  const conv = persona.getConv(userId);
  const genericSocial = ["greeting", "thanks", "love", "boredom", "excitement"].includes(intent.type);
  const topicIntent = (intent.type === "none" && conv && conv.lastIntent) ? conv.lastIntent
                      : (genericSocial && conv && conv.lastIntent) ? conv.lastIntent
                      : intent.type;
  persona.setConv(userId, { lastIntent: topicIntent, lastBotReply: line, lastUserMsg: text });
}

/* ───────────── Music text command handler ───────────── */
async function handleMusicTextCommand(message, parsed, replyOpts) {
  const { cmd } = parsed;
  const gid = message.guild.id;
  const uid = message.author.id;

  if (!shoukakuClient.isReady()) {
    await message.reply({ content: "Fufu… my music system isn't connected right now, Master~", ...replyOpts });
    return;
  }

  // Commands that need voice channel
  if (cmd === "play" || cmd === "247") {
    const vc = message.member?.voice?.channel;
    if (!vc) {
      await message.reply({ content: "You need to be in a voice channel, Master~", ...replyOpts });
      return;
    }

    if (cmd === "play") {
      const { tracks, playlistName } = await musicTrackResolver.resolve(parsed.query, uid, message.member?.displayName || message.author.username);
      if (!tracks.length) {
        await message.reply({ content: "Couldn't find anything for that, Master~", ...replyOpts });
        return;
      }
      let q = musicQueue.get(gid);
      if (!q) {
        q = musicQueue.getOrCreate(gid, message.channelId, vc.id);
        await q.connect();
      }
      const count = await q.enqueue(tracks);
      if (playlistName) {
        await message.reply({ content: `📋 Queued **${count}** tracks from **${playlistName}**, Master~`, ...replyOpts });
      } else if (count === 1 && q.current === tracks[0] && q.tracks.length === 0) {
        await message.reply({ content: `🎶 Now playing **${tracks[0].title}**, Master~`, ...replyOpts });
      } else {
        await message.reply({ content: `🎵 Queued **${tracks[0].title}** — position #${q.tracks.length}, Master~`, ...replyOpts });
      }
      return;
    }

    if (cmd === "247") {
      let q = musicQueue.get(gid);
      if (!q) {
        q = musicQueue.getOrCreate(gid, message.channelId, vc.id);
        await q.connect();
      }
      q.stay247 = !q.stay247;
      if (q.stay247) q._clearIdleTimer();
      await message.reply({ content: `🕐 24/7 mode: **${q.stay247 ? "ON" : "OFF"}**`, ...replyOpts });
      return;
    }
  }

  // Commands that need an active queue
  const q = musicQueue.get(gid);
  if (!q || !q.current) {
    if (cmd === "queue" || cmd === "nowplaying") {
      await message.reply({ content: "Nothing is playing, Master.", ...replyOpts });
    } else {
      await message.reply({ content: "Nothing is playing right now, Master.", ...replyOpts });
    }
    return;
  }

  switch (cmd) {
    case "skip": {
      const t = q.current;
      await q.skip();
      await message.reply({ content: `⏭️ Skipped **${t?.title || "track"}**.`, ...replyOpts });
      break;
    }
    case "stop":
      await q.stop();
      await message.reply({ content: "⏹️ Stopped and cleared the queue.", ...replyOpts });
      break;
    case "pause":
      await q.pause();
      await message.reply({ content: "⏸️ Paused.", ...replyOpts });
      break;
    case "resume":
      await q.resume();
      await message.reply({ content: "▶️ Resumed.", ...replyOpts });
      break;
    case "nowplaying": {
      const np = buildNowPlaying(q);
      await message.reply(np);
      break;
    }
    case "queue": {
      const page = parsed.page || 1;
      const perPage = 10;
      const totalPages = Math.max(1, Math.ceil(q.tracks.length / perPage));
      const p = Math.min(page, totalPages);
      const start = (p - 1) * perPage;
      const slice = q.tracks.slice(start, start + perPage);
      let desc = `**Now:** ${q.current.title}\n`;
      desc += slice.map((t, i) => `\`${start + i + 1}.\` ${t.title} — ${musicTrackResolver.formatDuration(t.duration)}`).join("\n");
      if (!slice.length) desc += "*Queue is empty.*";
      await message.reply({ content: desc + `\n*Page ${p}/${totalPages} • ${q.tracks.length} tracks*`, ...replyOpts });
      break;
    }
    case "volume":
      if (parsed.level === null || parsed.level === undefined) {
        await message.reply({ content: `🔊 Volume: **${q.volume}%**`, ...replyOpts });
      } else {
        const v = await q.setVolume(parsed.level);
        await message.reply({ content: `🔊 Volume: **${v}%**`, ...replyOpts });
      }
      break;
    case "shuffle":
      q.shuffle();
      await message.reply({ content: "🔀 Queue shuffled!", ...replyOpts });
      break;
    case "loop": {
      const mode = q.cycleLoop();
      const labels = { 0: "Off", 1: "Track", 2: "Queue" };
      await message.reply({ content: `🔁 Loop: **${labels[mode]}**`, ...replyOpts });
      break;
    }
    case "clear":
      q.clear();
      await message.reply({ content: "🧹 Queue cleared!", ...replyOpts });
      break;
    case "autoplay":
      q.autoplay = !q.autoplay;
      await message.reply({ content: `✨ Autoplay: **${q.autoplay ? "ON" : "OFF"}**`, ...replyOpts });
      break;
    case "seek": {
      const t = parsed.time;
      const colons = t.match(/^(\d+):(\d{1,2})$/);
      let ms;
      if (colons) ms = (parseInt(colons[1]) * 60 + parseInt(colons[2])) * 1000;
      else ms = parseInt(t) * 1000;
      if (isNaN(ms)) { await message.reply({ content: "Invalid time format.", ...replyOpts }); break; }
      await q.seek(ms);
      await message.reply({ content: `⏩ Seeked to **${musicTrackResolver.formatDuration(ms)}**.`, ...replyOpts });
      break;
    }
    case "filter": {
      const preset = await q.setFilter(parsed.preset);
      if (!preset) { await message.reply({ content: "Unknown filter.", ...replyOpts }); break; }
      await message.reply({ content: `${preset.label} — ${preset.description}`, ...replyOpts });
      break;
    }
    case "lyrics": {
      const title = parsed.query || q.current.title;
      const artist = parsed.query ? null : q.current.author;
      const result = await musicLyrics.searchLyrics(title, artist);
      if (!result) { await message.reply({ content: `No lyrics found for **${title}**.`, ...replyOpts }); break; }
      const pages = musicLyrics.paginateLyrics(result.lyrics, 1900);
      await message.reply({ content: `🎤 **${result.title}** — ${result.artist}\n\n${pages[0]}`, ...replyOpts });
      break;
    }
    case "remove": {
      const removed = q.remove(parsed.position);
      if (!removed) { await message.reply({ content: "Invalid position.", ...replyOpts }); break; }
      await message.reply({ content: `🗑️ Removed **${removed.title}**.`, ...replyOpts });
      break;
    }
    case "move": {
      if (!q.move(parsed.from, parsed.to)) { await message.reply({ content: "Invalid positions.", ...replyOpts }); break; }
      await message.reply({ content: `↕️ Moved track ${parsed.from} → ${parsed.to}.`, ...replyOpts });
      break;
    }
    case "playlist": {
      const { sub, name } = parsed;
      if (sub === "save") {
        const tracks = [];
        if (q.current) tracks.push({ title: q.current.title, author: q.current.author, uri: q.current.uri, duration: q.current.duration });
        for (const t of q.tracks) tracks.push({ title: t.title, author: t.author, uri: t.uri, duration: t.duration });
        await db.savePlaylist(uid, name, tracks);
        await message.reply({ content: `💾 Saved **${tracks.length}** tracks as **${name}**.`, ...replyOpts });
      } else if (sub === "load") {
        const playlist = await db.getPlaylist(uid, name);
        if (!playlist) { await message.reply({ content: `Playlist **${name}** not found.`, ...replyOpts }); break; }
        const vc = message.member?.voice?.channel;
        if (!vc) { await message.reply({ content: "Join a voice channel first.", ...replyOpts }); break; }
        const plTracks = JSON.parse(playlist.tracks);
        let lq = musicQueue.get(gid);
        if (!lq) { lq = musicQueue.getOrCreate(gid, message.channelId, vc.id); await lq.connect(); }
        let loaded = 0;
        for (const t of plTracks) {
          try {
            const { tracks: r } = await musicTrackResolver.resolve(t.uri || t.title, uid);
            if (r.length) { await lq.enqueue([r[0]]); loaded++; }
          } catch (_) {}
        }
        await message.reply({ content: `📋 Loaded **${loaded}/${plTracks.length}** from **${name}**.`, ...replyOpts });
      } else if (sub === "list") {
        const pls = await db.getUserPlaylists(uid);
        if (!pls.length) { await message.reply({ content: "No saved playlists.", ...replyOpts }); break; }
        const lines = pls.map((p) => `**${p.name}** — ${JSON.parse(p.tracks).length} tracks`);
        await message.reply({ content: `💾 **Your Playlists:**\n${lines.join("\n")}`, ...replyOpts });
      } else if (sub === "delete") {
        await db.deletePlaylist(uid, name);
        await message.reply({ content: `🗑️ Deleted **${name}**.`, ...replyOpts });
      } else if (sub === "info") {
        const playlist = await db.getPlaylist(uid, name);
        if (!playlist) { await message.reply({ content: `Playlist **${name}** not found.`, ...replyOpts }); break; }
        const plTracks = JSON.parse(playlist.tracks);
        const lines = plTracks.slice(0, 15).map((t, i) => `\`${i + 1}.\` ${t.title}`);
        if (plTracks.length > 15) lines.push(`… and ${plTracks.length - 15} more`);
        await message.reply({ content: `📋 **${name}:**\n${lines.join("\n")}`, ...replyOpts });
      }
      break;
    }
    default:
      await message.reply({ content: "Unknown music command, Master.", ...replyOpts });
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  if (kurumiHandledMessageIds.has(message.id)) return;
  kurumiHandledMessageIds.add(message.id);
  if (kurumiHandledMessageIds.size > 6000) kurumiHandledMessageIds.clear();

  const content = message.content.trim();
  const uid = message.author.id;
  const gid = message.guild.id;
  const replyOpts = { allowedMentions: { repliedUser: false } };
  const sch = await dailyWordle.getSchedule(message.guild.id);
  const timeLine = formatTimeAmPmVerbose(new Date(), sch?.timezone || DEFAULT_DISPLAY_TIMEZONE);

  // EXPLICIT "kurumi" prefix
  const parsed = parseKurumiLine(content);
  if (parsed) {
    try {
      if (parsed.type === "yes_master") {
        await message.reply({ content: persona.YES_MASTER, ...replyOpts });
        enterConversation(gid, uid);
        return;
      }

      if (parsed.type === "help") {
        await message.reply({ content: KURUMI_HELP, ...replyOpts });
        return;
      }

      if (parsed.type === "unknown_command") {
        await message.reply({ content: persona.UNKNOWN_COMMAND, ...replyOpts });
        return;
      }

      if (parsed.type === "voice") {
        if (parsed.cmd === "join") {
          let member = message.member;
          if (!member) {
            try {
              member = await message.guild.members.fetch(message.author.id);
            } catch (_) {
              await message.reply({
                content: "Could not load your member profile. Try again from this server.",
                ...replyOpts
              });
              return;
            }
          }
          const r = await voiceJoinFromMember(member);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.cmd === "leave") {
          const r = voiceLeaveGuild(message.guild.id);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.cmd === "status") {
          await message.reply({ content: voiceStatusText(message.guild.id), ...replyOpts });
          return;
        }
        if (parsed.cmd === "ping") {
          const ws = Number.isFinite(client.ws.ping) ? client.ws.ping : -1;
          const rt = Date.now() - message.createdTimestamp;
          await message.reply({
            content: `Pong. Round trip ~${rt} ms \u00b7 WebSocket ping ~${ws} ms`,
            ...replyOpts
          });
          return;
        }
      }

      if (parsed.type === "wordle") {
        if (parsed.sub === "new") {
          const r = await wordle.startNewGame(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "status") {
          const r = await wordle.getStatus(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "guess") {
          const r = await wordle.submitGuess(uid, parsed.word);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "stats") {
          const r = await wordle.getStats(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "share") {
          const r = await wordle.getShare(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "hardmode") {
          const r = await wordle.toggleHardMode(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "colorblind") {
          const r = await wordle.toggleColorblind(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "giveup") {
          const r = await wordle.giveUp(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
      }

      if (parsed.type === "leaderboard") {
        const payload = await kurumiLeaderboard.buildLeaderboardPayload(
          client,
          message.guild.id,
          {
            page: parsed.page,
            userId: parsed.self ? message.author.id : undefined,
          }
        );
        await message.reply({ ...payload, ...replyOpts });
        return;
      }

      if (parsed.type === "daily") {
        if (parsed.sub === "status") {
          await message.reply({
            content: await dailyWordle.dailyStatus(gid, uid),
            ...replyOpts
          });
          return;
        }
        if (parsed.sub === "guess") {
          const r = await dailyWordle.submitDailyGuess(gid, uid, parsed.word);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "leaderboard") {
          const r = await dailyWordle.getLeaderboard(gid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
      }

      /* ── Music text commands (kurumi play/skip/etc.) ── */
      if (parsed.type === "music") {
        try {
          await handleMusicTextCommand(message, parsed, replyOpts);
        } catch (err) {
          console.error("[music text]", err);
          await message.reply({ content: "Something went wrong with the music command, Master…", ...replyOpts });
        }
        return;
      }

      if (parsed.type === "chat") {
        await handleChatReply(message, parsed.text, replyOpts, timeLine);
        if (!isConvEnd(parsed.text)) {
          enterConversation(gid, uid);
        }
        return;
      }
    } catch (err) {
      console.error("[kurumi text]", err);
    }
    return;
  }

  // NO explicit "kurumi" prefix — check shorthand modes
  try {
    // 1. Conversation enders
    if (isInConversation(gid, uid) && isConvEnd(content)) {
      exitConversation(gid, uid);
      const line = persona.chatReply(content, { timeLine, userId: uid, recentChat: await db.getRecentChat(uid, 24) });
      await message.reply({ content: line, ...replyOpts });
      const sent = sentiment.analyze(content);
      const intent = persona.detectIntent(content);
      await db.logChat(uid, gid, content, line, sent.score, intent.type);
      return;
    }

    // 2. Wordle shorthand (exactly 5 letters + valid word + active game)
    const wordleGame = await db.getWordleGame(uid);
    if (wordleGame && !wordleGame.solved && !wordleGame.lost) {
      const w = content.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length === 5 && wordle.isValidWord(w)) {
        const r = await wordle.submitGuess(uid, w);
        await message.reply({ content: r.text, ...replyOpts });
        return;
      }
    }

    // 3. Daily shorthand
    if (dailyWordle.hasActiveDaily && (await dailyWordle.hasActiveDaily(gid, uid))) {
      const w = content.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length === 5 && wordle.isValidWord(w)) {
        const r = await dailyWordle.submitDailyGuess(gid, uid, w);
        await message.reply({ content: r.text, ...replyOpts });
        return;
      }
    }

    // 4. Conversation mode chat
    if (isInConversation(gid, uid)) {
      await handleChatReply(message, content, replyOpts, timeLine);
      bumpConversation(gid, uid);
      return;
    }
  } catch (err) {
    console.error("[kurumi text shorthand]", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  // Handle music button clicks
  if (interaction.isButton()) {
    try { await handleMusicButton(interaction); } catch (e) { console.error("[music] button error:", e); }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // Try music commands first
  try {
    const handled = await handleMusicInteraction(interaction);
    if (handled) return;
  } catch (e) { console.error("[music] interaction error:", e); }

  switch (interaction.commandName) {
    case "join":
      await connectMuted(interaction);
      return;
    case "leave": {
      const r = voiceLeaveGuild(interaction.guildId);
      await interaction.reply({ content: r.text, ephemeral: !r.ok });
      return;
    }
    case "status": {
      await interaction.reply(voiceStatusText(interaction.guildId));
      return;
    }
    case "ping":
      await handlePing(interaction);
      return;
    case "wordle": {
      const uid = interaction.user.id;
      const sub = interaction.options.getSubcommand();
      if (sub === "new") {
        const r = await wordle.startNewGame(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "status") {
        const r = await wordle.getStatus(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "guess") {
        const w = interaction.options.getString("word", true);
        const r = await wordle.submitGuess(uid, w);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "stats") {
        const r = await wordle.getStats(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "share") {
        const r = await wordle.getShare(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "hardmode") {
        const r = await wordle.toggleHardMode(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "colorblind") {
        const r = await wordle.toggleColorblind(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "giveup") {
        const r = await wordle.giveUp(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      return;
    }
    case "dailywordle": {
      if (!interaction.guild) {
        await interaction.reply({ content: "Daily Wordle works in servers only, Master.", ephemeral: true });
        return;
      }
      const gid = interaction.guild.id;
      const uid = interaction.user.id;
      const sub = interaction.options.getSubcommand();

      if (sub === "setup") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "Only members with **Manage Server** may configure the daily, Master.",
            ephemeral: true
          });
          return;
        }
        const ch = interaction.options.getChannel("channel", true);
        const tzRaw = interaction.options.getString("timezone");
        try {
          await dailyWordle.setSchedule(gid, ch.id, tzRaw || undefined);
        } catch (e) {
          await interaction.reply({
            content: String(e.message || e),
            ephemeral: true
          });
          return;
        }
        await interaction.reply({
          content: `Daily Wordle will post in ${ch} at **8:00** each day (**${tzRaw?.trim() || dailyWordle.DEFAULT_TZ}**).`,
          ephemeral: true
        });
        return;
      }

      if (sub === "stop") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "Only members with **Manage Server** may stop the daily, Master.",
            ephemeral: true
          });
          return;
        }
        await dailyWordle.clearSchedule(gid);
        await interaction.reply({ content: "Daily Wordle scheduling cleared for this server.", ephemeral: true });
        return;
      }

      if (sub === "guess") {
        const w = interaction.options.getString("word", true);
        const r = await dailyWordle.submitDailyGuess(gid, uid, w);
        await interaction.reply({ content: r.text, ephemeral: true });
        return;
      }

      if (sub === "status") {
        await interaction.reply({
          content: await dailyWordle.dailyStatus(gid, uid),
          ephemeral: true
        });
        return;
      }
      if (sub === "leaderboard") {
        const r = await dailyWordle.getLeaderboard(gid);
        await interaction.reply({ content: r.text, ephemeral: !r.ok });
        return;
      }
      return;
    }
    case "leaderboard": {
      if (!interaction.guild) {
        await interaction.reply({
          content: "Voice leaderboard works in servers only, Master.",
          ephemeral: true,
        });
        return;
      }
      const page = interaction.options.getInteger("page") || 1;
      const target = interaction.options.getUser("user");
      const payload = await kurumiLeaderboard.buildLeaderboardPayload(
        client,
        interaction.guild.id,
        {
          page,
          userId: target?.id,
        }
      );
      await interaction.reply(payload);
      return;
    }
    default:
  }
});

/* ───────────── Voice State Update Event ───────────── */
client.on("voiceStateUpdate", async (oldState, newState) => {
  if (oldState.member.id === client.user.id) {
    console.log(`[music] Bot voice state updated: oldChannel=${oldState.channelId}, newChannel=${newState.channelId}`);
  }
  // If the bot itself was disconnected from a voice channel
  if (oldState.member.id === client.user.id && oldState.channelId && !newState.channelId) {
    // Wait 5 seconds and verify the bot is still disconnected before cleaning up the queue.
    // This avoids transient state changes (e.g. handshakes, channel moves, region swaps) from killing the active player.
    setTimeout(async () => {
      try {
        const member = newState.guild.members.me || await newState.guild.members.fetch(client.user.id).catch(() => null);
        console.log(`[music] Disconnect verification: channelId=${member?.voice?.channelId}`);
        if (member && !member.voice.channelId) {
          const q = musicQueue.get(oldState.guild.id);
          if (q) {
            console.log(`[music] Bot was disconnected from voice channel in guild ${oldState.guild.id} — cleaning up queue`);
            await q.disconnect();
          }
        }
      } catch (err) {
        console.error("[music] Error cleaning up queue on disconnect:", err);
      }
    }, 5000);
  }
});

/* ───────────── Initialize Shoukaku BEFORE login ───────────── */
/* Shoukaku hooks into the client's 'raw' event to catch the gateway READY
   packet. If we init after login, it misses the event and never connects. */
try {
  shoukakuClient.init(client);
  musicQueue.setClient(client);
  console.log("[music] Shoukaku initialized — will connect to Lavalink on gateway READY");
} catch (err) {
  console.warn("[music] Shoukaku init failed (music features disabled):", err.message);
}

/* ───────────── Startup: normal login or standby mode ───────────── */
if (failover.isStandbyEnabled()) {
  // Render standby mode — do NOT log into Discord yet.
  console.log("[failover] Render standby mode enabled — waiting for laptop heartbeat to go stale");
  failover.startWatcher({
    async onActivate() {
      console.log("[failover] activating — logging into Discord");
      try {
        await client.login(token);
      } catch (err) {
        console.error("[failover] Discord login failed:", err);
      }
    },
    async onDeactivate() {
      // This is handled in the /heartbeat route's scheduleStandDown callback
    },
  });
} else {
  // Normal mode (laptop or non-standby Render) — log in immediately.
  client.login(token).catch((err) => {
    console.error("Discord login failed:", err);
    process.exit(1);
  });
}
