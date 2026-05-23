/* ───────────── Queue Manager — per-guild music queue ───────────── */

const { getShoukaku, getNode } = require("./shoukaku-client");
const trackResolver = require("./track-resolver");
const { getPreset } = require("./filters");

const DEFAULT_VOLUME = parseInt(process.env.MUSIC_DEFAULT_VOLUME, 10) || 80;
const IDLE_TIMEOUT_MS = parseInt(process.env.MUSIC_IDLE_TIMEOUT_MS, 10) || 300_000;

/** Loop modes */
const LOOP = { OFF: 0, TRACK: 1, QUEUE: 2 };
const LOOP_LABELS = { [LOOP.OFF]: "Off", [LOOP.TRACK]: "Track", [LOOP.QUEUE]: "Queue" };

/** @type {Map<string, GuildQueue>} */
const queues = new Map();

class GuildQueue {
  /**
   * @param {string} guildId
   * @param {string} textChannelId
   * @param {string} voiceChannelId
   */
  constructor(guildId, textChannelId, voiceChannelId) {
    this.guildId = guildId;
    this.textChannelId = textChannelId;
    this.voiceChannelId = voiceChannelId;
    /** @type {object[]} */
    this.tracks = [];
    /** @type {object | null} */
    this.current = null;
    this.loop = LOOP.OFF;
    this.volume = DEFAULT_VOLUME;
    this.paused = false;
    this.activeFilter = null;
    this.autoplay = false;
    this.stay247 = false;
    /** @type {import("shoukaku").Player | null} */
    this.player = null;
    /** @type {NodeJS.Timeout | null} */
    this.idleTimer = null;
    /** @type {import("discord.js").Message | null} */
    this.nowPlayingMessage = null;
    /** Callback when track starts — set by integration layer */
    this.onTrackStart = null;
    /** Callback when queue ends — set by integration layer */
    this.onQueueEnd = null;
    /** Callback when track errors — set by integration layer */
    this.onTrackError = null;
  }

  /** Connect to voice and create a Lavalink player. */
  async connect() {
    const sk = getShoukaku();
    const node = getNode();

    this.player = await node.joinChannel({
      guildId: this.guildId,
      channelId: this.voiceChannelId,
      shardId: 0,
      deaf: true,
    });

    // Apply default volume
    await this.player.setGlobalVolume(this.volume);

    // Track end event
    this.player.on("end", async (data) => {
      if (data.reason === "replaced") return; // Seek / filter change
      await this._handleTrackEnd();
    });

    // Track stuck / exception
    this.player.on("stuck", (data) => {
      console.warn(`[music] Track stuck in guild ${this.guildId}:`, data);
      this._handleTrackEnd().catch(console.error);
    });

    this.player.on("exception", (data) => {
      console.error(`[music] Track exception in guild ${this.guildId}:`, data);
      if (this.onTrackError) this.onTrackError(this, data);
      this._handleTrackEnd().catch(console.error);
    });

    this.player.on("closed", (data) => {
      console.warn(`[music] Voice connection closed in guild ${this.guildId}:`, data);
    });

    this._clearIdleTimer();
  }

  /** Disconnect from voice and clean up. */
  async disconnect() {
    this._clearIdleTimer();
    if (this.player) {
      try {
        const sk = getShoukaku();
        await sk.leaveVoiceChannel(this.guildId);
      } catch (_) {}
      this.player = null;
    }
    this.tracks = [];
    this.current = null;
    this.paused = false;
    this.nowPlayingMessage = null;
    queues.delete(this.guildId);
  }

  /**
   * Add tracks to the queue and start playing if idle.
   * @param {object[]} tracks — normalized track objects
   * @returns {number} number of tracks added
   */
  async enqueue(tracks) {
    if (!tracks.length) return 0;
    this.tracks.push(...tracks);
    this._clearIdleTimer();

    if (!this.current) {
      await this._playNext();
    }
    return tracks.length;
  }

  /** Skip the current track. */
  async skip() {
    if (!this.player) return false;
    await this.player.stopTrack();
    return true;
  }

  /** Stop playback and clear the queue. */
  async stop() {
    this.tracks = [];
    this.current = null;
    this.loop = LOOP.OFF;
    if (this.player) {
      await this.player.stopTrack();
    }
    if (!this.stay247) {
      await this.disconnect();
    } else {
      this._startIdleTimer();
    }
    return true;
  }

  /** Pause playback. */
  async pause() {
    if (!this.player || this.paused) return false;
    await this.player.setPaused(true);
    this.paused = true;
    return true;
  }

  /** Resume playback. */
  async resume() {
    if (!this.player || !this.paused) return false;
    await this.player.setPaused(false);
    this.paused = false;
    return true;
  }

  /** Toggle pause/resume. */
  async togglePause() {
    return this.paused ? this.resume() : this.pause();
  }

  /**
   * Seek to a position in the current track.
   * @param {number} positionMs
   */
  async seek(positionMs) {
    if (!this.player || !this.current) return false;
    const clamped = Math.max(0, Math.min(positionMs, this.current.duration));
    await this.player.seekTo(clamped);
    return true;
  }

  /**
   * Set volume (0-100).
   * @param {number} vol
   */
  async setVolume(vol) {
    const v = Math.max(0, Math.min(100, vol));
    this.volume = v;
    if (this.player) {
      await this.player.setGlobalVolume(v);
    }
    return v;
  }

  /** Shuffle the queue (not the current track). */
  shuffle() {
    if (this.tracks.length < 2) return false;
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    return true;
  }

  /**
   * Move a track from one position to another.
   * @param {number} from — 1-indexed
   * @param {number} to — 1-indexed
   */
  move(from, to) {
    const f = from - 1;
    const t = to - 1;
    if (f < 0 || f >= this.tracks.length || t < 0 || t >= this.tracks.length) return false;
    const [track] = this.tracks.splice(f, 1);
    this.tracks.splice(t, 0, track);
    return true;
  }

  /**
   * Remove a track by 1-indexed position.
   * @param {number} position
   * @returns {object|null}
   */
  remove(position) {
    const idx = position - 1;
    if (idx < 0 || idx >= this.tracks.length) return null;
    return this.tracks.splice(idx, 1)[0];
  }

  /** Clear all tracks from the queue (keeps current playing). */
  clear() {
    this.tracks = [];
    return true;
  }

  /** Cycle loop mode: Off → Track → Queue → Off. */
  cycleLoop() {
    this.loop = (this.loop + 1) % 3;
    return this.loop;
  }

  /** Set a specific loop mode. */
  setLoop(mode) {
    this.loop = mode;
  }

  /**
   * Apply an audio filter preset.
   * @param {string} presetName
   */
  async setFilter(presetName) {
    if (!this.player) return null;
    const preset = getPreset(presetName);
    if (!preset) return null;

    await this.player.setFilters(preset.filters);
    this.activeFilter = presetName === "clear" ? null : presetName;
    return preset;
  }

  /** Get current player position in ms. */
  getPosition() {
    return this.player?.position ?? 0;
  }

  /** Get total queue duration in ms. */
  getQueueDuration() {
    return this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  }

  // ──── Internal ────

  /** Play the next track in the queue. */
  async _playNext() {
    if (!this.player) return;

    // Loop track mode — replay current
    if (this.loop === LOOP.TRACK && this.current) {
      await this.player.playTrack({ track: { encoded: this.current.encoded } });
      if (this.onTrackStart) this.onTrackStart(this);
      return;
    }

    // Loop queue mode — push current to end before shifting
    if (this.loop === LOOP.QUEUE && this.current) {
      this.tracks.push(this.current);
    }

    const next = this.tracks.shift();
    if (!next) {
      this.current = null;
      if (this.onQueueEnd) this.onQueueEnd(this);
      if (!this.stay247) {
        this._startIdleTimer();
      }
      return;
    }

    this.current = next;
    await this.player.playTrack({ track: { encoded: next.encoded } });
    if (this.onTrackStart) this.onTrackStart(this);
  }

  /** Handle the end of a track. */
  async _handleTrackEnd() {
    await this._playNext();
  }

  _startIdleTimer() {
    this._clearIdleTimer();
    if (this.stay247) return;
    this.idleTimer = setTimeout(() => {
      console.log(`[music] Idle timeout — leaving guild ${this.guildId}`);
      this.disconnect().catch(console.error);
    }, IDLE_TIMEOUT_MS);
  }

  _clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ──── Public API ────

/**
 * Get or create a guild queue.
 * @param {string} guildId
 * @param {string} textChannelId
 * @param {string} voiceChannelId
 * @returns {GuildQueue}
 */
function getOrCreate(guildId, textChannelId, voiceChannelId) {
  let q = queues.get(guildId);
  if (!q) {
    q = new GuildQueue(guildId, textChannelId, voiceChannelId);
    queues.set(guildId, q);
  } else {
    q.textChannelId = textChannelId;
    if (voiceChannelId) q.voiceChannelId = voiceChannelId;
  }
  return q;
}

/**
 * Get an existing queue for a guild.
 * @param {string} guildId
 * @returns {GuildQueue | undefined}
 */
function get(guildId) {
  return queues.get(guildId);
}

/**
 * Check if a guild has an active queue.
 * @param {string} guildId
 * @returns {boolean}
 */
function has(guildId) {
  return queues.has(guildId);
}

/**
 * Delete a guild's queue.
 * @param {string} guildId
 */
function remove(guildId) {
  const q = queues.get(guildId);
  if (q) q.disconnect().catch(() => {});
  queues.delete(guildId);
}

/** Get all active queues. */
function getAll() {
  return queues;
}

module.exports = {
  getOrCreate,
  get,
  has,
  remove,
  getAll,
  GuildQueue,
  LOOP,
  LOOP_LABELS,
};
