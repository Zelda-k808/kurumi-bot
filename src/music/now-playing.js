/* ───────────── Now Playing Embed + Button Controls ───────────── */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { formatDuration } = require("./track-resolver");
const { LOOP, LOOP_LABELS } = require("./queue-manager");

/**
 * Build a text progress bar.
 * @param {number} currentMs
 * @param {number} totalMs
 * @returns {string}
 */
function progressBar(currentMs, totalMs) {
  const PROGRESS_LENGTH = 18;
  const BAR_FILLED = "━";
  const BAR_EMPTY = "─";
  const BAR_SLIDER = "⚪"; // Sleeker slider

  if (!totalMs || totalMs <= 0) return `${BAR_FILLED.repeat(PROGRESS_LENGTH)} 🔴 LIVE`;
  const pct = Math.min(currentMs / totalMs, 1);
  const filledCount = Math.round(pct * PROGRESS_LENGTH);
  const emptyCount = PROGRESS_LENGTH - filledCount;

  let bar = "";
  if (filledCount > 0) {
    bar += BAR_FILLED.repeat(Math.max(0, filledCount - 1));
  }
  bar += BAR_SLIDER;
  if (emptyCount > 0) {
    bar += BAR_EMPTY.repeat(emptyCount);
  }
  return bar;
}

/**
 * Build the Now Playing embed.
 * @param {import("./queue-manager").GuildQueue} queue
 * @returns {EmbedBuilder}
 */
function buildEmbed(queue) {
  const track = queue.current;
  if (!track) {
    return new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription("Nothing is playing right now, Master.");
  }

  const position = queue.getPosition();
  const bar = progressBar(position, track.duration);
  const color = _trackColor(track);
  const displayName = track.requesterName || track.requesterId || "Master";
  const quote = _getKurumiMusicQuote(track);
  const status = _statusLine(queue);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ 
      name: "Now Playing — Kurumi Music", 
      iconURL: "https://cdn.discordapp.com/emojis/1071857438042984510.gif" 
    })
    .setTitle(track.title)
    .setURL(track.uri || null)
    .setDescription(
      `*"${quote}"*\n\n` +
      `${bar}\n` +
      `**${formatDuration(position)} / ${formatDuration(track.duration)}**\n` +
      `${status ? `\n${status}` : ""}`
    );

  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  }

  embed.addFields(
    { name: "👤 Artist", value: `\`${track.author || "Unknown"}\``, inline: true },
    { name: "🌐 Source", value: _getSourceName(track.sourceName), inline: true },
    { name: "📥 Master", value: `\`${displayName}\``, inline: true }
  );

  if (queue.tracks.length > 0) {
    const totalDuration = queue.getQueueDuration();
    const upNextStr = queue.tracks.slice(0, 3).map((t, i) =>
      `\`${i + 1}.\` **[${_truncate(t.title, 40)}](${t.uri || ""})**`
    ).join("\n") + (queue.tracks.length > 3 ? `\n*... and ${queue.tracks.length - 3} more tracks*` : "");
    
    embed.addFields({ 
      name: `⏭️ Up Next (${queue.tracks.length} tracks • ${formatDuration(totalDuration)})`, 
      value: upNextStr, 
      inline: false 
    });
  }

  embed.setFooter({ 
    text: `Volume: ${queue.volume}% • Filter: ${queue.activeFilter || "None"} • Loop: ${LOOP_LABELS[queue.loop]}`,
    iconURL: "https://cdn.discordapp.com/emojis/1089242562447384667.png"
  });

  return embed;
}

/**
 * Build the control button row.
 * @param {import("./queue-manager").GuildQueue} queue
 * @returns {ActionRowBuilder}
 */
function buildButtons(queue) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_back")
      .setEmoji("⏮️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!queue.previous),
    new ButtonBuilder()
      .setCustomId("music_rewind")
      .setEmoji("⏪")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_pause")
      .setEmoji(queue.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_forward")
      .setEmoji("⏩")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Primary)
  );

  const loopEmoji = queue.loop === LOOP.TRACK ? "🔂" : queue.loop === LOOP.QUEUE ? "🔁" : "➡️";
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("music_shuffle")
      .setEmoji("🔀")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_loop")
      .setEmoji(loopEmoji)
      .setStyle(queue.loop !== LOOP.OFF ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_volume_down")
      .setEmoji("🔉")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_volume_up")
      .setEmoji("🔊")
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_lyrics")
      .setLabel("Lyrics")
      .setEmoji("🎤")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_bass")
      .setLabel("Bass")
      .setEmoji("🔊")
      .setStyle(queue.activeFilter === "bassboost" ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_autoplay")
      .setEmoji("✨")
      .setStyle(queue.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_queue")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3];
}

/**
 * Build full Now Playing message payload (embed + buttons).
 * @param {import("./queue-manager").GuildQueue} queue
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildNowPlaying(queue) {
  return {
    embeds: [buildEmbed(queue)],
    components: queue.current ? buildButtons(queue) : [],
  };
}

// ──── Helpers ────

function _statusLine(queue) {
  const parts = [];
  parts.push(`🔊 ${queue.volume}%`);
  if (queue.loop !== LOOP.OFF) parts.push(`🔁 ${LOOP_LABELS[queue.loop]}`);
  if (queue.paused) parts.push("⏸️ Paused");
  if (queue.activeFilter) parts.push(`🎛️ ${queue.activeFilter}`);
  if (queue.autoplay) parts.push("✨ Autoplay");
  return parts.join(" │ ");
}

function _truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

/**
 * Generate a vibrant color from the track title+author.
 * Produces rich, saturated colors that feel unique per track.
 */
function _trackColor(track) {
  const seed = `${track.title}${track.author}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  // HSL with high saturation and medium lightness for vibrant colors
  const hue = Math.abs(hash) % 360;
  const sat = 65 + (Math.abs(hash >> 8) % 20);  // 65-85%
  const lum = 45 + (Math.abs(hash >> 16) % 15); // 45-60%
  return _hslToHex(hue, sat, lum);
}

function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return parseInt(`${f(0)}${f(8)}${f(4)}`, 16);
}

function _getSourceName(sourceName) {
  switch (sourceName?.toLowerCase()) {
    case "spotify":
      return "🟢 Spotify";
    case "soundcloud":
      return "🟠 SoundCloud";
    case "applemusic":
      return "🔴 Apple Music";
    case "youtube":
      return "🔴 YouTube";
    case "bandcamp":
      return "📻 Bandcamp";
    case "local":
      return "📁 Local File";
    default:
      return "🎵 Web Stream";
  }
}

function _getKurumiMusicQuote(track) {
  const quotes = [
    "Fufu… sit back and enjoy the melody, Master~",
    "A beautiful song, isn't it? Just for you~",
    "Master, does this music please your ears? Fufu…",
    "Time flows just like music… let's make this moment last~",
    "Listening to this with you is quite delightful, Master~",
    "Ah, what a lovely choice, Master~",
  ];
  const seed = track.title.length + (track.author ? track.author.length : 0);
  return quotes[seed % quotes.length];
}

module.exports = { buildNowPlaying, buildEmbed, buildButtons, progressBar, formatDuration };
