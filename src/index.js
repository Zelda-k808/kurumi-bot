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
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{17,20}$/.test(s));
}

async function propagateSlashCommands(applicationId) {
  const rest = new REST({ version: "10" }).setToken(token);
  const guildIds = parseGuildIds(process.env.DISCORD_GUILD_ID || "");

  if (guildIds.length > 0) {
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

async function connectMuted(interaction) {
  const memberChannel = interaction.member?.voice?.channel;
  if (!memberChannel) {
    await interaction.reply({
      content: "Join a voice channel first, then run `/join`.",
      ephemeral: true
    });
    return;
  }

  const existing = guildConnections.get(interaction.guildId);
  if (existing) {
    try {
      existing.destroy();
    } catch (_) {}
    guildConnections.delete(interaction.guildId);
  }

  const connection = joinVoiceChannel({
    channelId: memberChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfMute: true,
    selfDeaf: false
  });

  guildConnections.set(interaction.guildId, connection);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch (_) {
      connection.destroy();
      guildConnections.delete(interaction.guildId);
    }
  });

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
