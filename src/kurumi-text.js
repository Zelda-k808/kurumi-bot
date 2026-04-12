/** Match "kurumi" wake word (any letter casing), then a command. */
const WAKE = /^kurumi\b\s*(.*)$/is;

const VOICE = new Set(["join", "leave", "status", "ping"]);

const KURUMI_HELP =
  "**Kurumi text commands** (message must **start** with `kurumi` — any caps):\n" +
  "`kurumi` alone · `kurumi join` · `kurumi leave` · `kurumi status` · `kurumi ping`\n" +
  "`kurumi wordle new` · `kurumi wordle guess <word>` · `kurumi wordle status`\n" +
  "`kurumi daily guess <word>` · `kurumi daily status` · chat: **`kurumi hi`** etc.\n" +
  "`kurumi help` — this list";

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
    if (sub === "guess" && tokens.length === 3) {
      const word = tokens[2].toLowerCase().replace(/[^a-z]/g, "");
      if (word.length === 5) return { type: "wordle", sub: "guess", word };
    }
    return { type: "unknown_command" };
  }

  if (head === "daily") {
    const sub = (tokens[1] || "").toLowerCase();
    if (sub === "status" && tokens.length === 2) return { type: "daily", sub: "status" };
    if (sub === "guess" && tokens.length === 3) {
      const word = tokens[2].toLowerCase().replace(/[^a-z]/g, "");
      if (word.length === 5) return { type: "daily", sub: "guess", word };
    }
    return { type: "unknown_command" };
  }

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
    head !== "help" &&
    !/^(hi|hey|hello|yo|sup|gm|gn|morning|bye|goodbye|cya|thanks|thank|thx)$/i.test(head)
  ) {
    return { type: "unknown_command" };
  }

  return { type: "chat", text: rest };
}

module.exports = { parseKurumiLine, KURUMI_HELP };
