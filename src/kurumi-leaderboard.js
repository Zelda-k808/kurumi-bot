const { EmbedBuilder } = require("discord.js");
const db = require("./database");
const levels = require("./voice-levels");

const KURUMI_COLOR = 0x5c1a2e;
const PAGE_SIZE = 10;

const RANK_EMOJI = ["🥇", "🥈", "🥉"];

function rankLabel(rank) {
  if (rank <= 3) return RANK_EMOJI[rank - 1];
  return `#${rank}`;
}

/**
 * @param {import("discord.js").Client} client
 * @param {string} guildId
 * @param {{ page?: number, userId?: string }} opts
 */
async function buildLeaderboardPayload(client, guildId, opts = {}) {
  if (opts.userId) {
    return buildUserCard(client, guildId, opts.userId);
  }

  const page = Math.max(1, opts.page || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const total = db.getVoiceLeaderboardCount(guildId);

  if (total === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(KURUMI_COLOR)
          .setTitle("Kurumi Leaderboard")
          .setDescription(
            "No voice XP yet, Master. Join a voice channel — **100 XP per minute** while connected."
          )
          .setFooter({ text: "Fufu… the clock rewards those who linger." }),
      ],
    };
  }

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, maxPage);
  const rows = db.getVoiceLeaderboard(guildId, PAGE_SIZE, offset);

  const embeds = [];
  let rank = offset + 1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const user = await client.users.fetch(row.user_id).catch(() => null);
    const name = user?.globalName || user?.username || row.username || "Unknown";
    const avatar = user?.displayAvatarURL({ size: 128 }) || null;
    const p = levels.progressInLevel(row.total_xp);
    const bar = levels.progressBar(p.need > 0 ? p.inLevel / p.need : 1);
    const pct = p.need > 0 ? Math.floor((p.inLevel / p.need) * 100) : 100;

    const embed = new EmbedBuilder()
      .setColor(KURUMI_COLOR)
      .setAuthor({
        name: `${rankLabel(rank)}  ${name}`,
        iconURL: avatar || undefined,
      })
      .setDescription(
        `**Level ${p.level}** · **${levels.formatXp(p.totalXp)}** XP\n` +
          `${bar}  **${pct}%**\n` +
          `*${levels.formatXp(p.inLevel)} / ${levels.formatXp(p.need)} XP → Level ${p.level + 1}* · Voice **${levels.formatVoiceTime(row.voice_seconds)}*`
      );

    if (i === 0 && safePage === 1) {
      embed.setTitle("Kurumi Leaderboard").setFooter({
        text: "100 XP/min in voice · L1 = 1,000 XP · +100 XP per level cap",
      });
    } else {
      embed.setFooter({
        text: `Page ${safePage}/${maxPage} · ${total} ranked`,
      });
    }

    embeds.push(embed);
    rank += 1;
  }

  if (embeds.length > 0 && safePage > 1) {
    embeds[0].setTitle("Kurumi Leaderboard");
  }

  return { embeds: embeds.slice(0, 10) };
}

async function buildUserCard(client, guildId, userId) {
  const row = db.getUserVoiceXp(guildId, userId);
  if (!row || row.total_xp <= 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(KURUMI_COLOR)
          .setTitle("Voice profile")
          .setDescription("No voice XP recorded yet. Join a voice channel to begin, Master."),
      ],
    };
  }

  const user = await client.users.fetch(userId).catch(() => null);
  const rank = db.getUserVoiceRank(guildId, userId);
  const p = levels.progressInLevel(row.total_xp);
  const bar = levels.progressBar(p.need > 0 ? p.inLevel / p.need : 1);
  const pct = p.need > 0 ? Math.floor((p.inLevel / p.need) * 100) : 100;

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(KURUMI_COLOR)
        .setAuthor({
          name: user?.globalName || user?.username || "Master",
          iconURL: user?.displayAvatarURL({ size: 128 }) || undefined,
        })
        .setTitle("Your voice rank")
        .setDescription(
          `**Rank #${rank}** in this server\n\n` +
            `**Level ${p.level}** · **${levels.formatXp(p.totalXp)}** XP\n` +
            `${bar}  **${pct}%**\n` +
            `*${levels.formatXp(p.inLevel)} / ${levels.formatXp(p.need)} XP to Level ${p.level + 1}*\n\n` +
            `Voice time: **${levels.formatVoiceTime(row.voice_seconds)}**`
        )
        .setFooter({ text: "100 XP per minute in voice · Kurumi" }),
    ],
  };
}

module.exports = { buildLeaderboardPayload, PAGE_SIZE, KURUMI_COLOR };
