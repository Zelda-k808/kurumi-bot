/** Match "kurumi" wake word (any letter casing), then a command. */
const WAKE = /^kurumi\b\s*(.*)$/is;

const VOICE = new Set(["join", "leave", "status", "ping"]);

const MUSIC_SIMPLE = new Set([
  "skip", "stop", "pause", "resume", "np", "nowplaying",
  "shuffle", "loop", "clear", "autoplay", "247",
]);

const KURUMI_HELP =
  "**Kurumi text commands** (message must **start** with `kurumi` — any caps):\n" +
  "`kurumi` alone · `kurumi join` · `kurumi leave` · `kurumi status` · `kurumi ping`\n" +
  "`kurumi wordle new` · `kurumi wordle guess <word>` · `kurumi wordle status`\n" +
  "`kurumi wordle stats` · `kurumi wordle share` · `kurumi wordle hardmode` · `kurumi wordle colorblind` · `kurumi wordle giveup`\n" +
  "`kurumi daily guess <word>` · `kurumi daily status` · `kurumi daily leaderboard`\n" +
  "`kurumi leaderboard` · `kurumi rank` — voice XP leaderboard (100 XP/min in VC)\n" +
  "**Music:** `kurumi play <query>` · `kurumi skip` · `kurumi stop` · `kurumi pause` · `kurumi resume`\n" +
  "`kurumi np` · `kurumi queue` · `kurumi volume <0-100>` · `kurumi shuffle` · `kurumi loop`\n" +
  "`kurumi filter <name>` · `kurumi lyrics` · `kurumi playlist save/load/list/delete <name>`\n" +
  "chat: **`kurumi hi`** etc. · `kurumi help` — this list";

/**
 * @param {string} content
 * @returns {null | { type: string, [key: string]: unknown }}
 */
function parseKurumiLine(content) {
  const m = String(content || "").trim().match(WAKE);
  if (!m) return null;

  const rest = m[1].trim();

  if (!rest) return { type: "yes_master" };

  if (/^help$/i.test(rest)) return { type: "help" };

  const tokens = rest.split(/\s+/).filter(Boolean);
  const head = tokens[0].toLowerCase();

  if (head === "wordle") {
    const sub = (tokens[1] || "").toLowerCase();
    if (sub === "new" && tokens.length === 2) return { type: "wordle", sub: "new" };
    if (sub === "status" && tokens.length === 2) return { type: "wordle", sub: "status" };
    if (sub === "stats" && tokens.length === 2) return { type: "wordle", sub: "stats" };
    if (sub === "share" && tokens.length === 2) return { type: "wordle", sub: "share" };
    if (sub === "hardmode" && tokens.length === 2) return { type: "wordle", sub: "hardmode" };
    if (sub === "colorblind" && tokens.length === 2) return { type: "wordle", sub: "colorblind" };
    if (sub === "giveup" && tokens.length === 2) return { type: "wordle", sub: "giveup" };
    if (sub === "guess" && tokens.length === 3) {
      const word = tokens[2].toLowerCase().replace(/[^a-z]/g, "");
      if (word.length === 5) return { type: "wordle", sub: "guess", word };
    }
    return { type: "unknown_command" };
  }

  if (head === "leaderboard" || head === "lb" || head === "rank" || head === "levels") {
    const page = Math.max(1, parseInt(tokens[1], 10) || 1);
    return {
      type: "leaderboard",
      page: Number.isFinite(page) ? page : 1,
      self: head === "rank" || head === "levels",
    };
  }

  if (head === "daily") {
    const sub = (tokens[1] || "").toLowerCase();
    if (sub === "status" && tokens.length === 2) return { type: "daily", sub: "status" };
    if (sub === "leaderboard" && tokens.length === 2) return { type: "daily", sub: "leaderboard" };
    if (sub === "guess" && tokens.length === 3) {
      const word = tokens[2].toLowerCase().replace(/[^a-z]/g, "");
      if (word.length === 5) return { type: "daily", sub: "guess", word };
    }
    return { type: "unknown_command" };
  }

  // ──── Music commands ────
  if (head === "play" && tokens.length >= 2) {
    return { type: "music", cmd: "play", query: tokens.slice(1).join(" ") };
  }

  if (head === "queue" || head === "q") {
    const page = parseInt(tokens[1], 10) || 1;
    return { type: "music", cmd: "queue", page };
  }

  if (head === "volume" || head === "vol") {
    const level = parseInt(tokens[1], 10);
    if (tokens.length >= 2 && !isNaN(level)) return { type: "music", cmd: "volume", level };
    return { type: "music", cmd: "volume", level: null };
  }

  if (head === "seek" && tokens.length >= 2) {
    return { type: "music", cmd: "seek", time: tokens[1] };
  }

  if (head === "filter" && tokens.length >= 2) {
    return { type: "music", cmd: "filter", preset: tokens[1].toLowerCase() };
  }

  if (head === "lyrics") {
    const query = tokens.length >= 2 ? tokens.slice(1).join(" ") : null;
    return { type: "music", cmd: "lyrics", query };
  }

  if (head === "remove" && tokens.length >= 2) {
    const pos = parseInt(tokens[1], 10);
    if (!isNaN(pos)) return { type: "music", cmd: "remove", position: pos };
  }

  if (head === "move" && tokens.length >= 3) {
    const from = parseInt(tokens[1], 10);
    const to = parseInt(tokens[2], 10);
    if (!isNaN(from) && !isNaN(to)) return { type: "music", cmd: "move", from, to };
  }

  if (head === "playlist" || head === "pl") {
    const sub = (tokens[1] || "").toLowerCase();
    if (sub === "save" && tokens.length >= 3) return { type: "music", cmd: "playlist", sub: "save", name: tokens.slice(2).join(" ") };
    if (sub === "load" && tokens.length >= 3) return { type: "music", cmd: "playlist", sub: "load", name: tokens.slice(2).join(" ") };
    if (sub === "delete" && tokens.length >= 3) return { type: "music", cmd: "playlist", sub: "delete", name: tokens.slice(2).join(" ") };
    if (sub === "info" && tokens.length >= 3) return { type: "music", cmd: "playlist", sub: "info", name: tokens.slice(2).join(" ") };
    if (sub === "list" || !sub) return { type: "music", cmd: "playlist", sub: "list" };
    return { type: "unknown_command" };
  }

  if (MUSIC_SIMPLE.has(head)) {
    return { type: "music", cmd: head === "np" ? "nowplaying" : head };
  }
  // ──── End music ────

  if (tokens.length === 1 && VOICE.has(head)) {
    return { type: "voice", cmd: head };
  }

  if (
    tokens.length === 1 &&
    /^[a-z]+$/i.test(head) &&
    head.length >= 2 &&
    !VOICE.has(head) &&
    head !== "wordle" &&
    head !== "daily" &&
    head !== "leaderboard" &&
    head !== "lb" &&
    head !== "rank" &&
    head !== "levels" &&
    head !== "help" &&
    !MUSIC_SIMPLE.has(head) &&
    head !== "play" && head !== "queue" && head !== "q" &&
    head !== "volume" && head !== "vol" && head !== "seek" &&
    head !== "filter" && head !== "lyrics" && head !== "remove" &&
    head !== "move" && head !== "playlist" && head !== "pl" &&
    !/^(hi|hey|hello|yo|sup|gm|gn|morning|bye|goodbye|cya|thanks|thank|thx)$/i.test(head)
  ) {
    return { type: "unknown_command" };
  }

  return { type: "chat", text: rest };
}

module.exports = { parseKurumiLine, KURUMI_HELP };
