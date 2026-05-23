/* ───────────── Track Resolver — turns user input into Lavalink tracks ───────────── */

const { getNode } = require("./shoukaku-client");

/** Platform URL patterns */
const URL_PATTERNS = {
  youtube: /(?:youtube\.com|youtu\.be)\//i,
  spotify: /open\.spotify\.com\//i,
  soundcloud: /soundcloud\.com\//i,
  applemusic: /music\.apple\.com\//i,
  deezer: /deezer\.com\//i,
  bandcamp: /bandcamp\.com\//i,
  twitch: /twitch\.tv\//i,
  vimeo: /vimeo\.com\//i,
};

/**
 * Detect if a string is a URL.
 * @param {string} query
 */
function isUrl(query) {
  return /^https?:\/\//i.test(query.trim());
}

/**
 * Detect the source platform from a URL.
 * @param {string} url
 * @returns {string}
 */
function detectSource(url) {
  for (const [name, pattern] of Object.entries(URL_PATTERNS)) {
    if (pattern.test(url)) return name;
  }
  return "unknown";
}

/**
 * Normalize a Lavalink track into a clean object.
 * @param {object} track — raw Shoukaku track
 * @param {string} requesterId — Discord user ID
 * @returns {object}
 */
function normalizeTrack(track, requesterId) {
  const info = track.info || {};
  return {
    encoded: track.encoded || track.track,
    title: info.title || "Unknown Title",
    author: info.author || "Unknown Artist",
    duration: info.length || 0,
    uri: info.uri || "",
    artworkUrl: info.artworkUrl || info.thumbnail || null,
    sourceName: info.sourceName || "unknown",
    isStream: info.isStream || false,
    requesterId,
  };
}

/**
 * Format duration in ms to "m:ss" or "h:mm:ss".
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!ms || ms <= 0) return "LIVE";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Resolve a user query into an array of normalized tracks.
 * @param {string} query — URL or search text
 * @param {string} requesterId — Discord user ID
 * @returns {Promise<{ tracks: object[], playlistName: string|null, source: string }>}
 */
async function resolve(query, requesterId) {
  const node = getNode();
  const trimmed = query.trim();

  let searchQuery;
  let source = "search";

  if (isUrl(trimmed)) {
    // Direct URL — let Lavalink handle it
    searchQuery = trimmed;
    source = detectSource(trimmed);
  } else {
    // Text search — default to YouTube search
    searchQuery = `ytsearch:${trimmed}`;
    source = "youtube";
  }

  const result = await node.rest.resolve(searchQuery);

  if (!result || result.loadType === "empty" || result.loadType === "error") {
    // Try SoundCloud fallback if YouTube search fails
    if (!isUrl(trimmed) && !searchQuery.startsWith("scsearch:")) {
      const scResult = await node.rest.resolve(`scsearch:${trimmed}`);
      if (scResult && scResult.loadType !== "empty" && scResult.loadType !== "error") {
        return processResult(scResult, requesterId, "soundcloud");
      }
    }
    return { tracks: [], playlistName: null, source };
  }

  return processResult(result, requesterId, source);
}

/**
 * Process a Lavalink resolve result into normalized tracks.
 */
function processResult(result, requesterId, source) {
  switch (result.loadType) {
    case "track": {
      const track = normalizeTrack(result.data, requesterId);
      return { tracks: [track], playlistName: null, source };
    }

    case "playlist": {
      const tracks = (result.data.tracks || []).map((t) => normalizeTrack(t, requesterId));
      const name = result.data.info?.name || result.data.name || null;
      return { tracks, playlistName: name, source };
    }

    case "search": {
      const tracks = (result.data || []).map((t) => normalizeTrack(t, requesterId));
      // Return only the first result for search
      return { tracks: tracks.slice(0, 1), playlistName: null, source };
    }

    default:
      return { tracks: [], playlistName: null, source };
  }
}

module.exports = { resolve, formatDuration, normalizeTrack, isUrl, detectSource };
