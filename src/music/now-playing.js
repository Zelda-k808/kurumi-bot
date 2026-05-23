/* ───────────── Now Playing Embed + Button Controls ───────────── */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { formatDuration } = require("./track-resolver");
const { LOOP, LOOP_LABELS } = require("./queue-manager");

const PROGRESS_LENGTH = 14;
const BAR_FILLED = "▓";
const BAR_EMPTY = "░";

/**
 * Build a text progress bar.
 * @param {number} currentMs
 * @param {number} totalMs
 * @returns {string}
 */
function progressBar(currentMs, totalMs) {
  if (!totalMs || totalMs <= 0) return `${"▓".repeat(PROGRESS_LENGTH)} LIVE`;
  const pct = Math.min(currentMs / totalMs, 1);
  const filled = Math.round(pct * PROGRESS_LENGTH);
  const empty = PROGRESS_LENGTH - filled;
  return `${BAR_FILLED.repeat(filled)}${BAR_EMPTY.repeat(empty)} ${formatDuration(currentMs)} / ${formatDuration(totalMs)}`;
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

  const embed = new EmbedBuilder()
    .setColor(0xc0392b) // Kurumi's crimson
    .setAuthor({ name: "♪ Now Playing" })
    .setTitle(track.title)
    .setURL(track.uri || null)
    .setDescription(
      `**${track.author}**\n\n` +
      `\`${bar}\`\n\n` +
      `${_statusLine(queue)}`
    );

  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  }

  if (track.requesterId) {
    embed.setFooter({ text: `Requested by ${track.requesterId}` });
  }

  if (queue.tracks.length > 0) {
    embed.addFields({
      name: "Up Next",
      value: queue.tracks.slice(0, 3).map((t, i) =>
        `\`${i + 1}.\` **${_truncate(t.title, 40)}** — ${formatDuration(t.duration)}`
      ).join("\n") + (queue.tracks.length > 3 ? `\n… and ${queue.tracks.length - 3} more` : ""),
      inline: false,
    });
  }

  return embed;
}

/**
 * Build the control button row.
 * @param {import("./queue-manager").GuildQueue} queue
 * @returns {ActionRowBuilder}
 */
function buildButtons(queue) {
  const pauseBtn = new ButtonBuilder()
    .setCustomId("music_pause")
    .setEmoji(queue.paused ? "▶️" : "⏸️")
    .setStyle(ButtonStyle.Secondary);

  const skipBtn = new ButtonBuilder()
    .setCustomId("music_skip")
    .setEmoji("⏭️")
    .setStyle(ButtonStyle.Primary);

  const stopBtn = new ButtonBuilder()
    .setCustomId("music_stop")
    .setEmoji("⏹️")
    .setStyle(ButtonStyle.Danger);

  const shuffleBtn = new ButtonBuilder()
    .setCustomId("music_shuffle")
    .setEmoji("🔀")
    .setStyle(ButtonStyle.Secondary);

  const loopEmoji = queue.loop === LOOP.TRACK ? "🔂" : queue.loop === LOOP.QUEUE ? "🔁" : "➡️";
  const loopBtn = new ButtonBuilder()
    .setCustomId("music_loop")
    .setEmoji(loopEmoji)
    .setStyle(queue.loop !== LOOP.OFF ? ButtonStyle.Success : ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(pauseBtn, skipBtn, stopBtn, shuffleBtn, loopBtn);
}

/**
 * Build full Now Playing message payload (embed + buttons).
 * @param {import("./queue-manager").GuildQueue} queue
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildNowPlaying(queue) {
  return {
    embeds: [buildEmbed(queue)],
    components: queue.current ? [buildButtons(queue)] : [],
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

module.exports = { buildNowPlaying, buildEmbed, buildButtons, progressBar, formatDuration };
