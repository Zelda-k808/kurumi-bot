/* ───────────── Lyrics Client — LRCLIB (free, no API key) ───────────── */

const LRCLIB_BASE = "https://lrclib.net/api";
const DISCORD_MAX = 4000; // Embed description limit

/**
 * Search for lyrics by track title and artist.
 * @param {string} title
 * @param {string} [artist]
 * @returns {Promise<{ title: string, artist: string, lyrics: string, synced: boolean } | null>}
 */
async function searchLyrics(title, artist) {
  try {
    const params = new URLSearchParams();
    if (artist) {
      params.set("track_name", title);
      params.set("artist_name", artist);
    } else {
      params.set("q", title);
    }

    // Try exact match first
    if (artist) {
      const exact = await _fetchLrclib(`/get?${params.toString()}`);
      if (exact && (exact.plainLyrics || exact.syncedLyrics)) {
        return {
          title: exact.trackName || title,
          artist: exact.artistName || artist || "Unknown",
          lyrics: exact.plainLyrics || _stripSync(exact.syncedLyrics),
          synced: !!exact.syncedLyrics,
        };
      }
    }

    // Fall back to search
    const searchParams = new URLSearchParams({ q: `${title} ${artist || ""}`.trim() });
    const results = await _fetchLrclib(`/search?${searchParams.toString()}`);
    if (!results || !Array.isArray(results) || results.length === 0) return null;

    const best = results[0];
    if (!best.plainLyrics && !best.syncedLyrics) return null;

    return {
      title: best.trackName || title,
      artist: best.artistName || artist || "Unknown",
      lyrics: best.plainLyrics || _stripSync(best.syncedLyrics),
      synced: !!best.syncedLyrics,
    };
  } catch (err) {
    console.error("[lyrics] Error:", err.message);
    return null;
  }
}

/**
 * Paginate lyrics text into chunks that fit Discord embed descriptions.
 * @param {string} lyrics
 * @param {number} [maxLen]
 * @returns {string[]}
 */
function paginateLyrics(lyrics, maxLen = DISCORD_MAX) {
  if (!lyrics) return [];
  if (lyrics.length <= maxLen) return [lyrics];

  const pages = [];
  const lines = lyrics.split("\n");
  let current = "";

  for (const line of lines) {
    if ((current + "\n" + line).length > maxLen - 20) {
      pages.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current.trim()) pages.push(current.trim());
  return pages;
}

// ──── Internal ────

async function _fetchLrclib(path) {
  const url = `${LRCLIB_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Kurumi-Bot/1.0 (Discord Music Bot)",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json();
}

function _stripSync(syncedLyrics) {
  if (!syncedLyrics) return "";
  // Remove [mm:ss.xx] timestamps
  return syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, "").trim();
}

module.exports = { searchLyrics, paginateLyrics };
