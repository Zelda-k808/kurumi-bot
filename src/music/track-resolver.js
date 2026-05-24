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
function normalizeTrack(track, requesterId, requesterName) {
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
    requesterName: requesterName || requesterId,
  };
}

/**
 * Format duration in ms to "m:ss" or "h:mm:ss".
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms === 0) return "0:00";
  if (!ms || ms < 0) return "LIVE";
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
 * @param {string} [requesterName] — Discord display name
 * @returns {Promise<{ tracks: object[], playlistName: string|null, source: string }>}
 */
async function resolve(query, requesterId, requesterName) {
  const node = getNode();
  const trimmed = query.trim();

  if (isUrl(trimmed)) {
    const source = detectSource(trimmed);
    const result = await node.rest.resolve(trimmed);
    if (!result || result.loadType === "empty" || result.loadType === "error") {
      return { tracks: [], playlistName: null, source };
    }
    return processResult(result, requesterId, requesterName, source, trimmed);
  }

  // 1. Try SoundCloud Search
  let result = await node.rest.resolve(`scsearch:${trimmed}`);
  if (result && result.loadType !== "empty" && result.loadType !== "error" && result.data && result.data.length > 0) {
    return processResult(result, requesterId, requesterName, "soundcloud", trimmed);
  }

  // 2. Fallback: Try Spotify Search
  console.log(`[music] SoundCloud search empty/error for "${trimmed}" — trying Spotify fallback…`);
  result = await node.rest.resolve(`spsearch:${trimmed}`);
  if (result && result.loadType !== "empty" && result.loadType !== "error" && result.data && result.data.length > 0) {
    return processResult(result, requesterId, requesterName, "spotify", trimmed);
  }

  // 3. Fallback: Try Apple Music Search
  console.log(`[music] Spotify search empty/error for "${trimmed}" — trying Apple Music fallback…`);
  result = await node.rest.resolve(`amsearch:${trimmed}`);
  if (result && result.loadType !== "empty" && result.loadType !== "error" && result.data && result.data.length > 0) {
    return processResult(result, requesterId, requesterName, "applemusic", trimmed);
  }

  // All searches failed
  return { tracks: [], playlistName: null, source: "search" };
}

/**
 * Check if a raw or normalized track is a SoundCloud Go+ preview (unplayable 30s clip).
 * The encoded (base64) track data embeds the stream URL; preview tracks contain "/preview/hls".
 */
function isSoundCloudPreview(track) {
  try {
    const encoded = track.encoded || track.track || "";
    if (!encoded) return false;
    const decoded = Buffer.from(encoded, "base64").toString("binary");
    return decoded.includes("/preview/hls") || decoded.includes("/preview/");
  } catch {
    return false;
  }
}

/**
 * Process a Lavalink resolve result into normalized tracks.
 */
function processResult(result, requesterId, requesterName, source, originalQuery) {
  switch (result.loadType) {
    case "track": {
      const raw = result.data;
      if (isSoundCloudPreview(raw)) {
        console.log(`[music] Skipping SoundCloud preview track: ${raw.info?.title || "unknown"}`);
        return { tracks: [], playlistName: null, source };
      }
      const track = normalizeTrack(raw, requesterId, requesterName);
      return { tracks: [track], playlistName: null, source };
    }

    case "playlist": {
      const tracks = (result.data.tracks || [])
        .filter((t) => {
          if (isSoundCloudPreview(t)) {
            console.log(`[music] Filtering out SoundCloud preview: ${t.info?.title || "unknown"}`);
            return false;
          }
          return true;
        })
        .map((t) => normalizeTrack(t, requesterId, requesterName));
      const name = result.data.info?.name || result.data.name || null;
      return { tracks, playlistName: name, source };
    }

    case "search": {
      // Filter out SoundCloud preview tracks before selection
      const allRaw = (result.data || []).filter((t) => {
        if (isSoundCloudPreview(t)) {
          console.log(`[music] Filtering out SoundCloud preview from search: ${t.info?.title || "unknown"}`);
          return false;
        }
        return true;
      });
      const allTracks = allRaw.map((t) => normalizeTrack(t, requesterId, requesterName));
      if (allTracks.length === 0) {
        return { tracks: [], playlistName: null, source };
      }

      const queryLower = (originalQuery || "").toLowerCase();
      const unwantedKeywords = [
        "slowed", "reverb", "nightcore", "instrumental", "sped up",
        "speed up", "remix", "cover", "remake", "acoustic",
        "tribute", "fanmade", "fan-made", "mashup"
      ];
      const userAskedForSpecial = unwantedKeywords.some((word) => queryLower.includes(word));

      let selected = allTracks[0];

      if (!userAskedForSpecial) {
        // Try to find the first result that doesn't have unwanted keywords in the title
        const cleanTrack = allTracks.find((track) => {
          const titleLower = (track.title || "").toLowerCase();
          return !unwantedKeywords.some((word) => titleLower.includes(word));
        });
        if (cleanTrack) {
          selected = cleanTrack;
        }
      }

      return { tracks: [selected], playlistName: null, source };
    }

    default:
      return { tracks: [], playlistName: null, source };
  }
}

module.exports = { resolve, formatDuration, normalizeTrack, isUrl, detectSource };
