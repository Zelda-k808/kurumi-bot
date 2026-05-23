// Local `.env` only when not on Render; never override existing env keys.
if (!process.env.RENDER) {
  require("dotenv").config({ override: false });
}

process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));

const http = require("http");
const Sentiment = require("sentiment");
const sentiment = new Sentiment();
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
    if (req.method === "GET" && (path === "/" || path === "/ping")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    res.writeHead(404).end();
  });

  server.on("error", (err) => {
    console.error("HTTP server error:", err);
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`HTTP keep-alive 0.0.0.0:${port} (GET / /ping)`);
  });

  return server;
}

startKeepAliveHttp();

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
].map((c) => c.toJSON());

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
  db.init();
  wordle.loadWordList().catch((e) => console.error("[wordle] loadWordList", e));
  startVoiceHealthLoop();
  setInterval(() => {
    dailyWordle.tickDailyPost(client).catch((e) => console.error("[daily-wordle] tick", e));
  }, 60_000);
  dailyWordle.tickDailyPost(client).catch((e) => console.error("[daily-wordle] initial tick", e));

  voiceXpTracker.attach(client);

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
const CONV_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const CONV_MAX_TURNS = 20;

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
  db.ensureUser(userId, message.author.username);
  const recentChat = db.getRecentChat(userId, 10);

  if (llmChat.isEnabled()) {
    try {
      await message.channel.sendTyping();
    } catch (_) {}
  }

  // Try LLM first for human-like conversation; fall back to hardcoded persona
  let line = await llmChat.chat(userId, message.author.username, recentChat, text, timeLine);
  if (!line) {
    line = persona.chatReply(text, { timeLine, userId, recentChat });
  }

  await message.reply({ content: line, ...replyOpts });
  const sent = sentiment.analyze(text);
  const intent = persona.detectIntent(text);
  db.logChat(userId, guildId, text, line, sent.score, intent.type);
  const conv = persona.getConv(userId);
  const genericSocial = ["greeting", "thanks", "love", "boredom", "excitement"].includes(intent.type);
  const topicIntent = (intent.type === "none" && conv && conv.lastIntent) ? conv.lastIntent
                      : (genericSocial && conv && conv.lastIntent) ? conv.lastIntent
                      : intent.type;
  persona.setConv(userId, { lastIntent: topicIntent, lastBotReply: line, lastUserMsg: text });
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
  const sch = dailyWordle.getSchedule(message.guild.id);
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
          const r = wordle.startNewGame(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "status") {
          const r = wordle.getStatus(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "guess") {
          const r = wordle.submitGuess(uid, parsed.word);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "stats") {
          const r = wordle.getStats(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "share") {
          const r = wordle.getShare(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "hardmode") {
          const r = wordle.toggleHardMode(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "colorblind") {
          const r = wordle.toggleColorblind(uid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "giveup") {
          const r = wordle.giveUp(uid);
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
            content: dailyWordle.dailyStatus(gid, uid),
            ...replyOpts
          });
          return;
        }
        if (parsed.sub === "guess") {
          const r = dailyWordle.submitDailyGuess(gid, uid, parsed.word);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
        if (parsed.sub === "leaderboard") {
          const r = dailyWordle.getLeaderboard(gid);
          await message.reply({ content: r.text, ...replyOpts });
          return;
        }
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
      const line = persona.chatReply(content, { timeLine, userId: uid, recentChat: db.getRecentChat(uid, 10) });
      await message.reply({ content: line, ...replyOpts });
      const sent = sentiment.analyze(content);
      const intent = persona.detectIntent(content);
      db.logChat(uid, gid, content, line, sent.score, intent.type);
      return;
    }

    // 2. Wordle shorthand (exactly 5 letters + valid word + active game)
    const wordleGame = db.getWordleGame(uid);
    if (wordleGame && !wordleGame.solved && !wordleGame.lost) {
      const w = content.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length === 5 && wordle.isValidWord(w)) {
        const r = wordle.submitGuess(uid, w);
        await message.reply({ content: r.text, ...replyOpts });
        return;
      }
    }

    // 3. Daily shorthand
    if (dailyWordle.hasActiveDaily && dailyWordle.hasActiveDaily(gid, uid)) {
      const w = content.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length === 5 && wordle.isValidWord(w)) {
        const r = dailyWordle.submitDailyGuess(gid, uid, w);
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
  if (!interaction.isChatInputCommand()) return;

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
        const r = wordle.startNewGame(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "status") {
        const r = wordle.getStatus(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "guess") {
        const w = interaction.options.getString("word", true);
        const r = wordle.submitGuess(uid, w);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "stats") {
        const r = wordle.getStats(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "share") {
        const r = wordle.getShare(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "hardmode") {
        const r = wordle.toggleHardMode(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "colorblind") {
        const r = wordle.toggleColorblind(uid);
        await interaction.reply({ content: r.text, ephemeral: r.ephemeral !== false });
        return;
      }
      if (sub === "giveup") {
        const r = wordle.giveUp(uid);
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
          dailyWordle.setSchedule(gid, ch.id, tzRaw || undefined);
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
        dailyWordle.clearSchedule(gid);
        await interaction.reply({ content: "Daily Wordle scheduling cleared for this server.", ephemeral: true });
        return;
      }

      if (sub === "guess") {
        const w = interaction.options.getString("word", true);
        const r = dailyWordle.submitDailyGuess(gid, uid, w);
        await interaction.reply({ content: r.text, ephemeral: true });
        return;
      }

      if (sub === "status") {
        await interaction.reply({
          content: dailyWordle.dailyStatus(gid, uid),
          ephemeral: true
        });
        return;
      }
      if (sub === "leaderboard") {
        const r = dailyWordle.getLeaderboard(gid);
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

client.login(token).catch((err) => {
  console.error("Discord login failed:", err);
  process.exit(1);
});
