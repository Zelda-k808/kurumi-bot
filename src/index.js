// Render injects secrets into process.env before Node starts. Load a local `.env` only
// when not running on Render, and never let a file override existing env keys.
if (!process.env.RENDER) {
  require("dotenv").config({ override: false });
}

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
  const raw = process.env.DISCORD_TOKEN;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  console.log(
    "[DEBUG_BOT_ENV] RENDER=%s DISCORD_TOKEN_defined=%s DISCORD_TOKEN_length=%s",
    Boolean(process.env.RENDER),
    raw !== undefined && raw !== null,
    trimmed.length
  );
}

function startKeepAliveHttp() {
  const rawPort = process.env.PORT;
  if (!rawPort) return null;

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`Invalid PORT: ${JSON.stringify(rawPort)}`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    if (req.method === "GET" && (path === "/" || path === "/ping")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on("error", (err) => {
    console.error("HTTP keep-alive server error:", err);
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `HTTP keep-alive listening on 0.0.0.0:${port} (GET / and GET /ping → 200)`
    );
  });

  return server;
}

startKeepAliveHttp();

const token = (process.env.DISCORD_TOKEN || "").trim();

if (!token) {
  console.error(
    "Missing DISCORD_TOKEN. Locally: add it to .env. On Render: Environment → add variable DISCORD_TOKEN (no quotes)."
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
].map((cmd) => cmd.toJSON());

async function registerGlobalCommands(applicationId) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(applicationId), { body: commandData });
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
    } catch (_) {
      // Ignore destroy errors for stale connections.
    }
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

  await interaction.reply(
    `Joined **${memberChannel.name}** and staying muted.`
  );
}

client.once("ready", async () => {
  try {
    await registerGlobalCommands(client.user.id);
    console.log(`Logged in as ${client.user.tag}`);
    console.log("Slash commands are registered globally.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "join") {
    await connectMuted(interaction);
    return;
  }

  if (interaction.commandName === "leave") {
    const connection = guildConnections.get(interaction.guildId);
    if (!connection) {
      await interaction.reply({
        content: "I am not in a voice channel in this server.",
        ephemeral: true
      });
      return;
    }

    connection.destroy();
    guildConnections.delete(interaction.guildId);
    await interaction.reply("Left the voice channel.");
    return;
  }

  if (interaction.commandName === "status") {
    const connection = guildConnections.get(interaction.guildId);
    if (!connection) {
      await interaction.reply("I am not connected in this server.");
      return;
    }

    await interaction.reply("I am connected and muted in this server.");
    return;
  }

  if (interaction.commandName === "ping") {
    try {
      const sent = await interaction.reply({
        content: "Pinging…",
        fetchReply: true
      });
      const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
      const wsPing = Number.isFinite(client.ws.ping) ? client.ws.ping : -1;
      await interaction.editReply(
        `Pong. Round trip ~${roundTrip} ms · WebSocket ping ~${wsPing} ms`
      );
    } catch (err) {
      console.error("/ping interaction error:", err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "Could not complete /ping.",
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: "Could not complete /ping.",
            ephemeral: true
          });
        }
      } catch (_) {
        // Ignore secondary failures.
      }
    }
  }
});

client
  .login(token)
  .then(() => {
    console.log("Discord login: credentials accepted (waiting for ready event…)");
  })
  .catch((err) => {
    console.error(
      "Discord login failed (invalid/revoked token, intents, or network):",
      err
    );
    process.exit(1);
  });
