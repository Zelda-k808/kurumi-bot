/** Match "kurumi" wake word (any letter casing), then a command. */
const WAKE = /^kurumi\b\s*(.*)$/is;

const KURUMI_HELP =
  "**Kurumi text commands** (message must **start** with `kurumi` — any caps):\n" +
  "`kurumi join` · `kurumi leave` · `kurumi status` · `kurumi ping`\n" +
  "`kurumi wordle new` · `kurumi wordle guess <word>` · `kurumi wordle status`";

/**
 * @param {string} content
 * @returns {null | { type: string, [key: string]: unknown }}
 */
function parseKurumiLine(content) {
  const m = String(content || "").trim().match(WAKE);
  if (!m) return null;

  const rest = m[1].trim();
  if (!rest) return { type: "help" };

  const tokens = rest.split(/\s+/).filter(Boolean);
  const head = tokens[0].toLowerCase();

  if (head === "wordle") {
    const sub = (tokens[1] || "").toLowerCase();
    if (sub === "new" && tokens.length === 2) return { type: "wordle", sub: "new" };
    if (sub === "status" && tokens.length === 2) return { type: "wordle", sub: "status" };
    if (sub === "guess" && tokens.length === 3) {
      const word = tokens[2].toLowerCase().replace(/[^a-z]/g, "");
      if (word.length === 5) return { type: "wordle", sub: "guess", word };
      return {
        type: "unknown",
        text: "Guess must be **one** 5-letter word (letters only), e.g. **`kurumi wordle guess slate`**."
      };
    }
    return {
      type: "unknown",
      text: "Wordle: **`kurumi wordle new`** · **`kurumi wordle guess crate`** · **`kurumi wordle status`**"
    };
  }

  if (tokens.length === 1 && ["join", "leave", "status", "ping"].includes(head)) {
    return { type: "voice", cmd: head };
  }

  return {
    type: "unknown",
    text: `Unknown command. ${KURUMI_HELP}`
  };
}

module.exports = { parseKurumiLine, KURUMI_HELP };
