require("dotenv").config();

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

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("Missing DISCORD_TOKEN in .env");
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

const guildConnections = new Map();

function startKeepAliveHttp() {
  const port = process.env.PORT;
  if (!port) return;

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

  server.listen(Number(port), "0.0.0.0", () => {
    console.log(`HTTP keep-alive on port ${port} — use GET / or /ping for uptime pings`);
  });
}

startKeepAliveHttp();

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
    const sent = await interaction.reply({
      content: "Pinging…",
      fetchReply: true
    });
    const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `Pong. Round trip ~${roundTrip} ms · WebSocket ping ~${client.ws.ping} ms`
    );
  }
});

client.login(token);
