/* ───────────── Music Slash Command Definitions ───────────── */

const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { getPresetNames } = require("./filters");

const filterChoices = getPresetNames().map((n) => ({ name: n, value: n }));

const musicCommands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or playlist from YouTube, Spotify, SoundCloud, and more.")
    .addStringOption((o) =>
      o.setName("query").setDescription("Song name, URL, or playlist link").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current track."),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume playback."),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track."),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue."),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the currently playing track with controls."),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("View the current music queue.")
    .addIntegerOption((o) =>
      o.setName("page").setDescription("Page number").setMinValue(1).setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set playback volume (0-100).")
    .addIntegerOption((o) =>
      o.setName("level").setDescription("Volume level 0-100").setMinValue(0).setMaxValue(100).setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a position in the current track.")
    .addStringOption((o) =>
      o.setName("time").setDescription("Time position (e.g. 1:30, 90s, 2m30s)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Shuffle the queue."),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Cycle loop mode: Off → Track → Queue."),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue by position.")
    .addIntegerOption((o) =>
      o.setName("position").setDescription("Track position (1-indexed)").setMinValue(1).setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different position in the queue.")
    .addIntegerOption((o) =>
      o.setName("from").setDescription("Current position").setMinValue(1).setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("to").setDescription("New position").setMinValue(1).setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear all tracks from the queue (keeps current track)."),

  new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Apply an audio filter preset.")
    .addStringOption((o) =>
      o.setName("preset")
        .setDescription("Filter preset name")
        .setRequired(true)
        .addChoices(...filterChoices)
    ),

  new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Show lyrics for the current or a specific track.")
    .addStringOption((o) =>
      o.setName("query").setDescription("Song name (leave empty for current track)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Toggle autoplay — queue similar tracks when the queue ends."),

  new SlashCommandBuilder()
    .setName("247")
    .setDescription("Toggle 24/7 mode — stay in voice channel permanently."),

  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Manage your personal playlists.")
    .addSubcommand((s) =>
      s.setName("save")
        .setDescription("Save the current queue as a playlist.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Playlist name").setRequired(true).setMaxLength(50)
        )
    )
    .addSubcommand((s) =>
      s.setName("load")
        .setDescription("Load a saved playlist into the queue.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Playlist name").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName("list")
        .setDescription("Show your saved playlists.")
    )
    .addSubcommand((s) =>
      s.setName("delete")
        .setDescription("Delete a saved playlist.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Playlist name").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName("info")
        .setDescription("Show tracks in a saved playlist.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Playlist name").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("djrole")
    .setDescription("Set a DJ role to restrict music control commands.")
    .addRoleOption((o) =>
      o.setName("role").setDescription("The DJ role (leave empty to clear)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("musicchannel")
    .setDescription("Lock music commands to a specific text channel.")
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("Text channel (leave empty to clear)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),
];

const musicCommandData = musicCommands.map((c) => c.toJSON());

module.exports = { musicCommands, musicCommandData };
