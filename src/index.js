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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
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
    .setDescription("Check bot latency (Discord only; does not wake Render).")
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

async function connectMuted(interaction) {
  const memberChannel = interaction.member?.voice?.channel;
  if (!memberChannel) {
    await interaction.reply({
      content: "Join a voice channel first, then run `/join`.",
      ephemeral: true
    });
    return;
  }

  guildVoiceTargets.set(interaction.guildId, memberChannel.id);

  try {
    await establishMutedConnection(interaction.guildId, memberChannel.id);
  } catch (err) {
    guildVoiceTargets.delete(interaction.guildId);
    guildConnections.delete(interaction.guildId);
    console.error("[voice] join failed:", err);
    await interaction.reply({
      content: "Could not join voice (permissions, channel, or network). Try again.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply(`Joined **${memberChannel.name}** and staying muted.`);
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
  } catch (err) {
    console.error("Command registration failed:", err);
  }
  startVoiceHealthLoop();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "join":
      await connectMuted(interaction);
      return;
    case "leave": {
      const c = guildConnections.get(interaction.guildId);
      if (!c) {
        await interaction.reply({
          content: "I am not in a voice channel in this server.",
          ephemeral: true
        });
        return;
      }
      guildVoiceTargets.delete(interaction.guildId);
      c.destroy();
      guildConnections.delete(interaction.guildId);
      await interaction.reply("Left the voice channel.");
      return;
    }
    case "status": {
      const c = guildConnections.get(interaction.guildId);
      await interaction.reply(
        c ? "I am connected and muted in this server." : "I am not connected in this server."
      );
      return;
    }
    case "ping":
      await handlePing(interaction);
      return;
    default:
  }
});

client.login(token).catch((err) => {
  console.error("Discord login failed:", err);
  process.exit(1);
});
