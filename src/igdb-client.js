/* IGDB v4 via Twitch OAuth — https://api-docs.igdb.com */

const IGDB_BASE = "https://api.igdb.com/v4";
const TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token";

let tokenCache = { accessToken: null, expiresAt: 0 };

function credentials() {
  const clientId = (process.env.IGDB_CLIENT_ID || process.env.TWITCH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.IGDB_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function isConfigured() {
  return !!credentials();
}

async function getAccessToken() {
  const cred = credentials();
  if (!cred) return null;

  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60_000) {
    return { clientId: cred.clientId, accessToken: tokenCache.accessToken };
  }

  const url = `${TWITCH_TOKEN}?client_id=${encodeURIComponent(cred.clientId)}&client_secret=${encodeURIComponent(cred.clientSecret)}&grant_type=client_credentials`;
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) {
    console.error("[igdb] token HTTP", res.status);
    return null;
  }

  const data = await res.json();
  if (!data.access_token) return null;

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return { clientId: cred.clientId, accessToken: data.access_token };
}

/**
 * @param {string} endpoint e.g. "games"
 * @param {string} body Apicalypse query
 */
async function query(endpoint, body) {
  const auth = await getAccessToken();
  if (!auth) return null;

  const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": auth.clientId,
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "text/plain",
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 401) {
    tokenCache = { accessToken: null, expiresAt: 0 };
    return null;
  }
  if (!res.ok) {
    console.error(`[igdb] ${endpoint} HTTP`, res.status);
    return null;
  }
  return res.json();
}

function yearFromUnix(ts) {
  if (!ts) return null;
  return String(new Date(ts * 1000).getUTCFullYear());
}

function mapGame(g) {
  const dev =
    (g.involved_companies || []).find((c) => c.developer)?.company?.name ||
    (g.involved_companies || [])[0]?.company?.name ||
    null;

  return {
    name: g.name,
    aliases: [],
    year: yearFromUnix(g.first_release_date),
    platforms: (g.platforms || []).map((p) => p.name).filter(Boolean).slice(0, 6),
    genre: (g.genres || []).map((x) => x.name).slice(0, 3).join(", "),
    developer: dev,
    series: g.franchises?.[0]?.name || null,
    rating: g.rating != null ? `${Math.round(g.rating)}/100` : null,
    facts: String(g.summary || "")
      .replace(/<[^>]+>/g, "")
      .slice(0, 280),
  };
}

/** Search games by name; returns normalized entries for gaming-knowledge. */
async function searchGames(searchText, limit = 4) {
  const q = String(searchText || "").trim().replace(/"/g, "");
  if (!q) return [];

  const body = [
    `search "${q}";`,
    "fields name,summary,first_release_date,rating,",
    "platforms.name,genres.name,franchises.name,",
    "involved_companies.developer,involved_companies.company.name;",
    `limit ${limit};`,
  ].join(" ");

  const rows = await query("games", body);
  if (!Array.isArray(rows)) return [];
  return rows.map(mapGame).filter((e) => e.name);
}

/** Top-rated games for cache building (offset in pages of `limit`). */
async function fetchTopGames(limit = 50, offset = 0) {
  const body = [
    "fields name,summary,first_release_date,rating,",
    "platforms.name,genres.name,franchises.name,",
    "involved_companies.developer,involved_companies.company.name;",
    "where rating > 75 & first_release_date > 0;",
    "sort rating desc;",
    `limit ${limit};`,
    `offset ${offset};`,
  ].join(" ");

  const rows = await query("games", body);
  if (!Array.isArray(rows)) return [];
  return rows.map(mapGame).filter((e) => e.name);
}

module.exports = {
  isConfigured,
  searchGames,
  fetchTopGames,
  query,
};
