// Local `.env` only when not on Render; never override existing env keys.
if (!process.env.RENDER) {
  require("dotenv").config({ override: false });
}

process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));

const http = require("http");
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");
const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus
} = require("@discordjs/voice");
const wordle = require("./wordle");
const { parseKurumiLine, KURUMI_HELP } = require("./kurumi-text");

const guildConnections = new Map();
/** guildId → voice channel id to rejoin after drops (cleared on /leave). */
const guildVoiceTargets = new Map();

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
        console.error("[voice] rejoin failed:", err);
        guildVoiceTargets.delete(guildId);
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
    for (const [guildId, connection] of guildConnections) {
      const channelId = guildVoiceTargets.get(guildId);
      if (!channelId) continue;
      // Only fix “zombie” map entries; Disconnected is handled by bindVoiceRecovery (long timeout + rejoin).
      if (connection.state.status === VoiceConnectionStatus.Destroyed) {
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
      text: "Join a voice channel first, then run **`/join`** or say **`kurumi join`**."
    };
  }

  const guildId = member.guild.id;
  guildVoiceTargets.set(guildId, memberChannel.id);

  try {
    await establishMutedConnection(guildId, memberChannel.id);
  } catch (err) {
    guildVoiceTargets.delete(guildId);
    guildConnections.delete(guildId);
    console.error("[voice] join failed:", err);
    return {
      ok: false,
      text: "Could not join voice (permissions, channel, or network). Try again."
    };
  }

  return { ok: true, text: `Joined **${memberChannel.name}** and staying muted.` };
}

function voiceLeaveGuild(guildId) {
  const c = guildConnections.get(guildId);
  if (!c) {
    return { ok: false, text: "I am not in a voice channel in this server." };
  }
  guildVoiceTargets.delete(guildId);
  c.destroy();
  guildConnections.delete(guildId);
  return { ok: true, text: "Left the voice channel." };
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
  startVoiceHealthLoop();
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const parsed = parseKurumiLine(message.content);
  if (!parsed) return;

  const replyOpts = { allowedMentions: { repliedUser: false } };

  try {
    if (parsed.type === "help") {
      await message.reply({ content: KURUMI_HELP, ...replyOpts });
      return;
    }

    if (parsed.type === "unknown") {
      await message.reply({ content: parsed.text || KURUMI_HELP, ...replyOpts });
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
          content: `Pong. Round trip ~${rt} ms · WebSocket ping ~${ws} ms`,
          ...replyOpts
        });
        return;
      }
    }

    if (parsed.type === "wordle") {
      const uid = message.author.id;
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
    }
  } catch (err) {
    console.error("[kurumi text]", err);
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
      return;
    }
    default:
  }
});

client.login(token).catch((err) => {
  console.error("Discord login failed:", err);
  process.exit(1);
});
