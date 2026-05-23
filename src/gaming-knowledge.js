/* Gaming context for Kurumi — local index + optional IGDB online lookup */

const fs = require("fs");
const path = require("path");
const igdb = require("./igdb-client");

const MAX_CONTEXT = 2200;

const GAMING_RE =
  /\b(game|games|gaming|gamer|videogame|video game|playstation|ps[1-5]|xbox|nintendo|switch|wii|pc game|steam|esports|e-sports|mmorpg|rpg|fps|moba|roguelike|soulslike|zelda|mario|pokemon|fortnite|minecraft|elden ring|gta|cod|call of duty|final fantasy|resident evil|halo|overwatch|league of legends|dota|cs2|csgo|bg3|baldur|balatro|dark souls|bloodborne|sekiro|metroid|kirby|sonic|persona|monster hunter|diablo|starcraft|warcraft|wow|world of warcraft|elder scrolls|skyrim|fallout|mass effect|dragon age|hollow knight|celeste|hades|undertale|deltarune|stardew|animal crossing|smash bros|tekken|street fighter|mortal kombat|assassin'?s creed|far cry|watch dogs|cyberpunk|witcher|borderlands|destiny|apex|valorant|neon|viper|agent|patch notes|operator|ops|server|pubg|rocket league|among us|roblox|genshin|honkai|ffxiv|ff14|jrpg|crpg|indie game|retro game|arcade|atari|nes|snes|n64|gamecube|gba|ds|3ds|psp|vita|dreamcast|saturn|genesis|megadrive|tetris|pac-man|donkey kong|legend of zelda|breath of the wild|tears of the kingdom|botw|totk|reference|refrence|san andreas|free to play|f2p)\b/i;

let franchiseIndex = null;
let cacheIndex = null;

function loadJson(file) {
  const p = path.join(__dirname, "..", "data", file);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error("[gaming-knowledge] load", file, e.message);
    return null;
  }
}

function loadIndexes() {
  if (!franchiseIndex) {
    const data = loadJson("gaming-franchises.json");
    franchiseIndex = Array.isArray(data) ? data : [];
  }
  if (!cacheIndex) {
    const data = loadJson("gaming-cache.json");
    cacheIndex = Array.isArray(data) ? data : [];
  }
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGamingQuery(text) {
  return GAMING_RE.test(String(text || ""));
}

function scoreEntry(query, entry) {
  const q = normalize(query);
  if (!q) return 0;
  const names = [entry.name, ...(entry.aliases || [])].map(normalize);
  let best = 0;
  for (const n of names) {
    if (!n) continue;
    if (n === q) best = Math.max(best, 100);
    else if (n.includes(q) || q.includes(n)) best = Math.max(best, 70);
    else {
      const qw = q.split(" ");
      const hits = qw.filter((w) => w.length > 2 && n.includes(w)).length;
      if (hits) best = Math.max(best, 30 + hits * 15);
    }
  }
  return best;
}

function searchLocal(query, limit = 5) {
  loadIndexes();
  const all = [...franchiseIndex, ...cacheIndex];
  const scored = all
    .map((e) => ({ e, s: scoreEntry(query, e) }))
    .filter((x) => x.s > 25)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return scored.map((x) => x.e);
}

function formatEntry(e) {
  const parts = [`${e.name}${e.year ? ` (${e.year})` : ""}`];
  if (e.platforms?.length) parts.push(`Platforms: ${e.platforms.join(", ")}`);
  if (e.genre) parts.push(`Genre: ${e.genre}`);
  if (e.developer) parts.push(`Developer: ${e.developer}`);
  if (e.series) parts.push(`Series: ${e.series}`);
  if (e.facts) parts.push(e.facts);
  if (e.rating) parts.push(`Rating: ${e.rating}`);
  return parts.join(". ");
}

async function fetchOnline(query) {
  if (!igdb.isConfigured()) return [];
  try {
    return await igdb.searchGames(query, 4);
  } catch (err) {
    console.error("[gaming-knowledge] IGDB:", err.message);
    return [];
  }
}

/**
 * Build factual gaming context to inject before the user message.
 * @param {string} userMessage
 * @param {{ forceLookup?: boolean }} opts
 * @returns {Promise<string|null>}
 */
async function buildContext(userMessage, opts = {}) {
  const force = opts.forceLookup || false;
  if (!force && !isGamingQuery(userMessage)) return null;

  const local = searchLocal(userMessage, 4);
  let remote = [];
  if (igdb.isConfigured() && (force || local.length === 0 || local.length < 3)) {
    remote = await fetchOnline(userMessage);
  }

  const seen = new Set();
  const entries = [];
  for (const e of [...local, ...remote]) {
    const k = normalize(e.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    entries.push(e);
    if (entries.length >= 5) break;
  }

  const era =
    "Gaming eras: Arcade/early consoles (1970s–80s), 16-bit (SNES/Genesis), 3D revolution (PS1/N64), online/MMO boom (2000s), HD/open-world (PS3/360), live-service & indie renaissance (2010s–now).";

  let block =
    "You are an expert on video games across all eras, platforms, and genres. Use the reference facts below when relevant; you may add widely known lore and mechanics. Stay in character as Kurumi.\n" +
    era;

  if (entries.length) {
    block += "\n\nReference (games matching this chat):\n";
    for (const e of entries) {
      block += `- ${formatEntry(e)}\n`;
    }
  } else if (force) {
    block +=
      "\n\nNo game match in database for this query. Say you could not verify specifics and suggest the user check official patch notes or wiki — do NOT invent abilities.";
  } else {
    block +=
      "\n\nNo exact match in the local index — answer from general gaming knowledge. If unsure on obscure titles, say what you know and offer to discuss something similar.";
  }

  if (block.length > MAX_CONTEXT) block = `${block.slice(0, MAX_CONTEXT - 1)}…`;
  return block;
}

function reload() {
  franchiseIndex = null;
  cacheIndex = null;
  loadIndexes();
}

module.exports = {
  isGamingQuery,
  buildContext,
  searchLocal,
  reload,
  igdbConfigured: igdb.isConfigured,
};
