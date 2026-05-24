/* ───────────── Music Interaction Handler ───────────── */

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const queueManager = require("./queue-manager");
const trackResolver = require("./track-resolver");
const { buildNowPlaying } = require("./now-playing");
const { listPresets } = require("./filters");
const lyricsClient = require("./lyrics-client");
const { isReady } = require("./shoukaku-client");
const { LOOP, LOOP_LABELS } = require("./queue-manager");

const KURUMI_COLOR = 0xc0392b;

// ──── Helpers ────

function kurumiMsg(text) {
  return { content: text, ephemeral: true };
}

function parseTime(str) {
  // Supports: "1:30", "90", "1m30s", "90s", "2m"
  const t = str.trim().toLowerCase();
  const colons = t.match(/^(\d+):(\d{1,2})$/);
  if (colons) return (parseInt(colons[1]) * 60 + parseInt(colons[2])) * 1000;

  const complex = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (complex && (complex[1] || complex[2] || complex[3])) {
    const h = parseInt(complex[1] || "0");
    const m = parseInt(complex[2] || "0");
    const s = parseInt(complex[3] || "0");
    return (h * 3600 + m * 60 + s) * 1000;
  }

  const num = parseInt(t);
  return isNaN(num) ? null : num * 1000;
}

function requireVoice(interaction) {
  const vc = interaction.member?.voice?.channel;
  if (!vc) {
    return { ok: false, text: "You need to be in a voice channel first, Master~" };
  }
  return { ok: true, channel: vc };
}

function requireQueue(guildId) {
  const q = queueManager.get(guildId);
  // Ensure we have a valid queue AND a player that is actually connected/active
  if (!q || !q.current || !q.player) {
    return { ok: false, text: "Nothing is playing right now, Master." };
  }
  return { ok: true, queue: q };
}

// ──── Database placeholders — set by integration layer ────
let db = null;
function setDb(database) { db = database; }

// ──── Command handlers ────

async function handlePlay(interaction) {
  if (!isReady()) return interaction.reply(kurumiMsg("Fufu… my music system isn't connected right now. Try again in a moment, Master~"));

  const voice = requireVoice(interaction);
  if (!voice.ok) return interaction.reply(kurumiMsg(voice.text));

  await interaction.deferReply();

  const query = interaction.options.getString("query", true);
  const guildId = interaction.guildId;

  try {
    const { tracks, playlistName, source } = await trackResolver.resolve(query, interaction.user.id, interaction.member?.displayName || interaction.user.username);
    if (!tracks.length) {
      return interaction.editReply({ content: "Kukuku… I couldn't find anything for that, Master. Try a different search~" });
    }

    let q = queueManager.get(guildId);
    if (!q || !q.player) {
      q = queueManager.getOrCreate(guildId, interaction.channelId, voice.channel.id);
      await q.connect();
    }

    const count = await q.enqueue(tracks);

    if (playlistName) {
      const embed = new EmbedBuilder()
        .setColor(KURUMI_COLOR)
        .setDescription(`📋 Queued **${count}** tracks from **${playlistName}**, Master~`)
        .setFooter({ text: `Source: ${source}` });
      return interaction.editReply({ embeds: [embed] });
    }

    if (count === 1 && q.tracks.length === 0 && q.current === tracks[0]) {
      return interaction.editReply({ content: `🎶 Now playing **${tracks[0].title}**, Master~` });
    } else {
      const track = tracks[0];
      const embed = new EmbedBuilder()
        .setColor(KURUMI_COLOR)
        .setDescription(`🎵 Queued **[${track.title}](${track.uri})** — ${trackResolver.formatDuration(track.duration)}, Master~`)
        .setFooter({ text: `Position #${q.tracks.length} in queue` });
      if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);
      return interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("[music] play error:", err);
    return interaction.editReply({ content: "Something went wrong trying to play that, Master… Forgive me." });
  }
}

async function handlePause(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  await r.queue.pause();
  return interaction.reply(kurumiMsg("⏸️ Paused, Master."));
}

async function handleResume(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  await r.queue.resume();
  return interaction.reply(kurumiMsg("▶️ Resumed, Master."));
}

/**
 * Perform skip immediately or register a skip vote based on DJ settings.
 * @returns {Promise<{ skipped: boolean, voted: boolean, text: string }>}
 */
async function performSkipOrVote(interaction, q) {
  // Check if DJ role is configured
  let djRoleId = null;
  if (db) {
    const settings = await db.getMusicSettings(interaction.guildId);
    djRoleId = settings?.dj_role_id || null;
  }

  // If DJ role is configured, enforce vote skip for non-privileged users
  if (djRoleId) {
    const isRequester = q.current && q.current.requesterId === interaction.user.id;
    const isDj = interaction.member?.roles?.cache?.has(djRoleId);
    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || 
                    interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

    if (!isRequester && !isDj && !isAdmin) {
      const vc = interaction.member?.voice?.channel;
      if (!vc) {
        return { skipped: false, voted: false, text: "You need to be in a voice channel to vote, Master~" };
      }

      // Count active listeners (excluding bots)
      const listeners = vc.members.filter(m => !m.user.bot);
      const listenerCount = listeners.size;
      const required = Math.ceil(listenerCount / 2);

      if (!q.skipVotes) {
        q.skipVotes = new Set();
      }

      if (q.skipVotes.has(interaction.user.id)) {
        return { skipped: false, voted: false, text: `Master, you have already voted to skip this song! (${q.skipVotes.size}/${required} votes)` };
      }

      q.skipVotes.add(interaction.user.id);

      if (q.skipVotes.size >= required) {
        const title = q.current?.title || "track";
        await q.skip();
        return { skipped: true, voted: true, text: `⏭️ Vote threshold met (${q.skipVotes.size}/${required}). Skipping **${title}**, Master~` };
      } else {
        return { skipped: false, voted: true, text: `🗳️ Voted to skip! Need **${required - q.skipVotes.size}** more votes (${q.skipVotes.size}/${required}).` };
      }
    }
  }

  // Default / privileged: skip immediately
  const title = q.current?.title || "track";
  await q.skip();
  return { skipped: true, voted: false, text: `⏭️ Skipped **${title}**, Master.` };
}

async function handleSkip(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  
  const result = await performSkipOrVote(interaction, r.queue);
  return interaction.reply({ 
    content: result.text, 
    ephemeral: !result.skipped && !result.voted 
  });
}

async function handleStop(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  await r.queue.stop();
  return interaction.reply({ content: "⏹️ Stopped and cleared the queue. Until next time, Master~", ephemeral: false });
}

async function handleNowPlaying(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  
  // Delete previous message if exists
  if (r.queue.nowPlayingMessage) {
    try {
      await r.queue.nowPlayingMessage.delete();
    } catch (_) {}
  }
  
  const np = buildNowPlaying(r.queue);
  await interaction.reply(np);
  r.queue.nowPlayingMessage = await interaction.fetchReply();
}

async function handleQueue(interaction) {
  const q = queueManager.get(interaction.guildId);
  if (!q || (!q.current && q.tracks.length === 0)) {
    return interaction.reply(kurumiMsg("The queue is empty, Master."));
  }

  const page = interaction.options.getInteger("page") || 1;
  const perPage = 10;
  const totalPages = Math.max(1, Math.ceil(q.tracks.length / perPage));
  const p = Math.min(page, totalPages);
  const start = (p - 1) * perPage;
  const slice = q.tracks.slice(start, start + perPage);

  let desc = "";
  if (q.current) {
    desc += `**Now Playing:** [${q.current.title}](${q.current.uri}) — ${trackResolver.formatDuration(q.current.duration)}\n\n`;
  }

  if (slice.length > 0) {
    desc += slice.map((t, i) =>
      `\`${start + i + 1}.\` **${t.title}** — ${trackResolver.formatDuration(t.duration)}`
    ).join("\n");
  } else {
    desc += "*No more tracks in the queue.*";
  }

  const embed = new EmbedBuilder()
    .setColor(KURUMI_COLOR)
    .setTitle("📋 Queue")
    .setDescription(desc)
    .setFooter({ text: `Page ${p}/${totalPages} • ${q.tracks.length} tracks • Total: ${trackResolver.formatDuration(q.getQueueDuration())}` });

  return interaction.reply({ embeds: [embed] });
}

async function handleVolume(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  const level = interaction.options.getInteger("level", true);
  const vol = await r.queue.setVolume(level);
  return interaction.reply(kurumiMsg(`🔊 Volume set to **${vol}%**, Master.`));
}

async function handleSeek(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  const timeStr = interaction.options.getString("time", true);
  const ms = parseTime(timeStr);
  if (ms === null) return interaction.reply(kurumiMsg("I couldn't understand that time format, Master. Try `1:30`, `90s`, or `2m30s`."));
  await r.queue.seek(ms);
  return interaction.reply(kurumiMsg(`⏩ Seeked to **${trackResolver.formatDuration(ms)}**.`));
}

async function handleShuffle(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  if (!r.queue.shuffle()) return interaction.reply(kurumiMsg("Not enough tracks to shuffle, Master."));
  return interaction.reply({ content: "🔀 Queue shuffled!", ephemeral: false });
}

async function handleLoop(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  const mode = r.queue.cycleLoop();
  return interaction.reply({ content: `🔁 Loop: **${LOOP_LABELS[mode]}**`, ephemeral: false });
}

async function handleRemove(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  const pos = interaction.options.getInteger("position", true);
  const removed = r.queue.remove(pos);
  if (!removed) return interaction.reply(kurumiMsg("Invalid position, Master."));
  return interaction.reply({ content: `🗑️ Removed **${removed.title}** from position ${pos}.`, ephemeral: false });
}

async function handleMove(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  const from = interaction.options.getInteger("from", true);
  const to = interaction.options.getInteger("to", true);
  if (!r.queue.move(from, to)) return interaction.reply(kurumiMsg("Invalid positions, Master."));
  return interaction.reply(kurumiMsg(`↕️ Moved track from position ${from} to ${to}.`));
}

async function handleClear(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  r.queue.clear();
  return interaction.reply({ content: "🧹 Queue cleared!", ephemeral: false });
}

async function handleFilter(interaction) {
  const r = requireQueue(interaction.guildId);
  if (!r.ok) return interaction.reply(kurumiMsg(r.text));
  const name = interaction.options.getString("preset", true);
  const preset = await r.queue.setFilter(name);
  if (!preset) return interaction.reply(kurumiMsg("Unknown filter preset, Master."));
  return interaction.reply({ content: `${preset.label} — ${preset.description}`, ephemeral: false });
}

async function handleLyrics(interaction) {
  await interaction.deferReply();
  const query = interaction.options.getString("query");
  let title, artist;

  if (query) {
    title = query;
    artist = null;
  } else {
    const q = queueManager.get(interaction.guildId);
    if (!q?.current) return interaction.editReply({ content: "Nothing is playing. Use `/lyrics <song>` to search, Master." });
    title = q.current.title;
    artist = q.current.author;
  }

  const result = await lyricsClient.searchLyrics(title, artist);
  if (!result) return interaction.editReply({ content: `No lyrics found for **${title}**, Master.` });

  const pages = lyricsClient.paginateLyrics(result.lyrics);
  const embed = new EmbedBuilder()
    .setColor(KURUMI_COLOR)
    .setTitle(`🎤 ${result.title}`)
    .setDescription(pages[0] || "No lyrics available.")
    .setFooter({ text: `Artist: ${result.artist}${pages.length > 1 ? ` • Page 1/${pages.length}` : ""}` });

  return interaction.editReply({ embeds: [embed] });
}

async function handleAutoplay(interaction) {
  const q = queueManager.get(interaction.guildId);
  if (!q) return interaction.reply(kurumiMsg("No active music session, Master."));
  q.autoplay = !q.autoplay;
  
  if (db) {
    const settings = (await db.getMusicSettings(interaction.guildId)) || {};
    settings.autoplay = q.autoplay ? 1 : 0;
    await db.setMusicSettings(interaction.guildId, settings);
  }

  return interaction.reply(kurumiMsg(`✨ Autoplay is now **${q.autoplay ? "ON" : "OFF"}**, Master.`));
}

async function handle247(interaction) {
  const voice = requireVoice(interaction);
  if (!voice.ok) return interaction.reply(kurumiMsg(voice.text));

  let q = queueManager.get(interaction.guildId);
  if (!q || !q.player) {
    q = queueManager.getOrCreate(interaction.guildId, interaction.channelId, voice.channel.id);
    await q.connect();
  }
  q.stay247 = !q.stay247;
  if (q.stay247) q._clearIdleTimer();
  return interaction.reply(kurumiMsg(`🕐 24/7 mode is now **${q.stay247 ? "ON" : "OFF"}**. ${q.stay247 ? "I will stay in your voice channel forever, Master~" : "I will leave when idle."}`));
}

async function handlePlaylist(interaction) {
  if (!db) return interaction.reply(kurumiMsg("Playlist system is not available right now, Master."));
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === "save") {
    const name = interaction.options.getString("name", true).trim();
    const q = queueManager.get(interaction.guildId);
    if (!q || (!q.current && q.tracks.length === 0)) return interaction.reply(kurumiMsg("Nothing to save, Master — the queue is empty."));

    const tracks = [];
    if (q.current) tracks.push({ title: q.current.title, author: q.current.author, uri: q.current.uri, duration: q.current.duration });
    for (const t of q.tracks) tracks.push({ title: t.title, author: t.author, uri: t.uri, duration: t.duration });

    await db.savePlaylist(userId, name, tracks);
    return interaction.reply(kurumiMsg(`💾 Saved **${tracks.length}** tracks as playlist **${name}**, Master.`));
  }

  if (sub === "load") {
    const name = interaction.options.getString("name", true).trim();
    const playlist = await db.getPlaylist(userId, name);
    if (!playlist) return interaction.reply(kurumiMsg(`Playlist **${name}** not found, Master.`));

    const voice = requireVoice(interaction);
    if (!voice.ok) return interaction.reply(kurumiMsg(voice.text));

    await interaction.deferReply();

    const tracks = JSON.parse(playlist.tracks);
    if (!tracks.length) return interaction.editReply({ content: `Playlist **${name}** is empty, Master.` });

    let q = queueManager.get(interaction.guildId);
    if (!q || !q.player) {
      q = queueManager.getOrCreate(interaction.guildId, interaction.channelId, voice.channel.id);
      await q.connect();
    }

    // Resolve each track URI through Lavalink
    let loaded = 0;
    for (const t of tracks) {
      try {
        const { tracks: resolved } = await trackResolver.resolve(t.uri || t.title, interaction.user.id, interaction.member?.displayName || interaction.user.username);
        if (resolved.length > 0) {
          await q.enqueue([resolved[0]]);
          loaded++;
        }
      } catch (_) {}
    }

    return interaction.editReply({ content: `📋 Loaded **${loaded}/${tracks.length}** tracks from playlist **${name}**, Master.` });
  }

  if (sub === "list") {
    const playlists = await db.getUserPlaylists(userId);
    if (!playlists.length) return interaction.reply(kurumiMsg("You have no saved playlists yet, Master."));

    const lines = playlists.map((p) => {
      const tracks = JSON.parse(p.tracks);
      return `**${p.name}** — ${tracks.length} tracks`;
    });

    const embed = new EmbedBuilder()
      .setColor(KURUMI_COLOR)
      .setTitle("💾 Your Playlists")
      .setDescription(lines.join("\n"));
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === "delete") {
    const name = interaction.options.getString("name", true).trim();
    await db.deletePlaylist(userId, name);
    return interaction.reply(kurumiMsg(`🗑️ Deleted playlist **${name}**, Master.`));
  }

  if (sub === "info") {
    const name = interaction.options.getString("name", true).trim();
    const playlist = await db.getPlaylist(userId, name);
    if (!playlist) return interaction.reply(kurumiMsg(`Playlist **${name}** not found, Master.`));

    const tracks = JSON.parse(playlist.tracks);
    const lines = tracks.slice(0, 20).map((t, i) =>
      `\`${i + 1}.\` **${t.title}** — ${trackResolver.formatDuration(t.duration)}`
    );
    if (tracks.length > 20) lines.push(`… and ${tracks.length - 20} more`);

    const embed = new EmbedBuilder()
      .setColor(KURUMI_COLOR)
      .setTitle(`📋 ${name}`)
      .setDescription(lines.join("\n") || "Empty playlist.")
      .setFooter({ text: `${tracks.length} tracks` });
    return interaction.reply({ embeds: [embed] });
  }
}

async function handleDjRole(interaction) {
  if (!db) return interaction.reply(kurumiMsg("Configuration system not available."));
  const role = interaction.options.getRole("role");
  const settings = (await db.getMusicSettings(interaction.guildId)) || {};
  settings.dj_role_id = role?.id || null;
  await db.setMusicSettings(interaction.guildId, settings);
  return interaction.reply(kurumiMsg(role ? `🎧 DJ role set to **${role.name}**.` : "🎧 DJ role cleared."));
}

async function handleMusicChannel(interaction) {
  if (!db) return interaction.reply(kurumiMsg("Configuration system not available."));
  const channel = interaction.options.getChannel("channel");
  const settings = (await db.getMusicSettings(interaction.guildId)) || {};
  settings.music_channel_id = channel?.id || null;
  await db.setMusicSettings(interaction.guildId, settings);
  return interaction.reply(kurumiMsg(channel ? `🔒 Music commands locked to ${channel}.` : "🔓 Music channel restriction cleared."));
}

// ──── Route map ────

const MUSIC_COMMANDS = {
  play: handlePlay,
  pause: handlePause,
  resume: handleResume,
  skip: handleSkip,
  stop: handleStop,
  nowplaying: handleNowPlaying,
  queue: handleQueue,
  volume: handleVolume,
  seek: handleSeek,
  shuffle: handleShuffle,
  loop: handleLoop,
  remove: handleRemove,
  move: handleMove,
  clear: handleClear,
  filter: handleFilter,
  lyrics: handleLyrics,
  autoplay: handleAutoplay,
  "247": handle247,
  playlist: handlePlaylist,
  djrole: handleDjRole,
  musicchannel: handleMusicChannel,
};

/**
 * Handle a music slash command interaction.
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>} true if handled
 */
async function handleMusicInteraction(interaction) {
  const handler = MUSIC_COMMANDS[interaction.commandName];
  if (!handler) return false;

  try {
    await handler(interaction);
  } catch (err) {
    console.error(`[music] Command error (/${interaction.commandName}):`, err);
    const body = { content: "An error occurred, Master… Please try again.", ephemeral: true };
    try {
      await (interaction.deferred || interaction.replied
        ? interaction.followUp(body)
        : interaction.reply(body));
    } catch (_) {}
  }
  return true;
}

// ──── Button handler ────

/**
 * Handle music button interactions.
 * @param {import("discord.js").ButtonInteraction} interaction
 * @returns {Promise<boolean>} true if handled
 */
async function handleMusicButton(interaction) {
  const id = interaction.customId;
  if (!id.startsWith("music_")) return false;

  // Avoid handling already acknowledged interactions
  if (interaction.deferred || interaction.replied) return true;

  const q = queueManager.get(interaction.guildId);
  // Buttons that DO NOT require an active player/queue
  const nonPlaybackButtons = ["music_refresh"]; 
  
  if (!q || !q.current || (!q.player && !nonPlaybackButtons.includes(id))) {
    try {
      await interaction.reply(kurumiMsg("Nothing is playing right now, Master."));
    } catch (_) {}
    return true;
  }

  let shouldUpdateEmbed = true;
  try {
    await interaction.deferUpdate();

    switch (id) {
      case "music_pause":
        await q.togglePause();
        break;

      case "music_skip": {
        const result = await performSkipOrVote(interaction, q);
        await interaction.followUp({ content: result.text, ephemeral: !result.skipped && !result.voted });
        if (result.skipped) shouldUpdateEmbed = false;
        break;
      }

      case "music_back":
        await q.back();
        shouldUpdateEmbed = false;
        break;

      case "music_rewind":
        await q.seek(q.getPosition() - 5000);
        break;

      case "music_forward":
        await q.seek(q.getPosition() + 5000);
        break;

      case "music_stop":
        await q.stop();
        shouldUpdateEmbed = false;
        break;

      case "music_shuffle":
        q.shuffle();
        break;

      case "music_loop":
        q.cycleLoop();
        break;

      case "music_bass":
        if (q.activeFilter === "bassboost") {
          await q.setFilter("clear");
        } else {
          await q.setFilter("bassboost");
        }
        break;

      case "music_volume_down":
        await q.setVolume(q.volume - 10);
        break;

      case "music_volume_up":
        await q.setVolume(q.volume + 10);
        break;

      case "music_lyrics": {
        const result = await lyricsClient.searchLyrics(q.current.title, q.current.author);
        if (result) {
          const pages = lyricsClient.paginateLyrics(result.lyrics);
          const embed = new EmbedBuilder()
            .setColor(KURUMI_COLOR)
            .setTitle(`🎤 ${result.title}`)
            .setDescription(pages[0])
            .setFooter({ text: `Artist: ${result.artist}` });
          await interaction.followUp({ embeds: [embed], ephemeral: true });
        } else {
          await interaction.followUp({ content: "No lyrics found, Master.", ephemeral: true });
        }
        break;
      }

      case "music_autoplay":
        q.autoplay = !q.autoplay;
        if (db) {
          const settings = (await db.getMusicSettings(interaction.guildId)) || {};
          settings.autoplay = q.autoplay ? 1 : 0;
          await db.setMusicSettings(interaction.guildId, settings);
        }
        break;

      case "music_queue": {
        const perPage = 10;
        const totalPages = Math.max(1, Math.ceil(q.tracks.length / perPage));
        const slice = q.tracks.slice(0, perPage);

        let desc = "";
        if (q.current) {
          desc += `**Now Playing:** [${q.current.title}](${q.current.uri})\n\n`;
        }

        if (slice.length > 0) {
          desc += slice.map((t, i) =>
            `\`${i + 1}.\` **${t.title}** — ${trackResolver.formatDuration(t.duration)}`
          ).join("\n");
        } else {
          desc += "*No more tracks in the queue.*";
        }

        const embed = new EmbedBuilder()
          .setColor(KURUMI_COLOR)
          .setTitle("📋 Queue")
          .setDescription(desc)
          .setFooter({ text: `Page 1/${totalPages} • ${q.tracks.length} tracks` });
        await interaction.followUp({ embeds: [embed], ephemeral: true });
        break;
      }

      case "music_refresh":
        // Just refresh the embed
        break;

      default:
        break;
    }

    if (shouldUpdateEmbed && q.current) {
      try {
        const np = buildNowPlaying(q);
        await interaction.editReply(np);
        q.nowPlayingMessage = interaction.message;
      } catch (_) {}
    }
  } catch (err) {
    console.error("[music] Button error:", err);
  }

  return true;
}

module.exports = { handleMusicInteraction, handleMusicButton, setDb, MUSIC_COMMANDS };
