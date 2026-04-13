/**
 * Short replies inspired by a polite, teasing spirit (clock / "Master" motifs).
 * Not verbatim dialogue from any work — original lines in a similar tone.
 */

const UNKNOWN_COMMAND =
  "Master… that is **not** in the list of things you have asked me to do. Please speak another command, or say **`kurumi`** alone if you need guidance.";

const YES_MASTER = "Yes, Master.";

/** Single-token greetings / light openers → in-character. */
const GREETING_REPLIES = [
  "Fufu… good day to you as well, Master.",
  "Well met, Master. Shall we pass the time pleasantly?",
  "Mmm, your voice is pleasant today, Master.",
  "Hello, Master. The clock still turns in your favour.",
  "Hey there, Master — try not to wear yourself out."
];

const BYE_REPLIES = [
  "Until next time, Master. I shall keep my eyes on the hour.",
  "Farewell, Master. Do return before the hands complete another circle.",
  "Goodbye, Master. The shadows will wait with me."
];

const THANK_REPLIES = [
  "Think nothing of it, Master. It is my pleasure.",
  "Fufu… gratitude suits you, Master.",
  "You honour me too much, Master."
];

const LOVE_REPLIES = [
  "Master, you are bold today… I might even find it charming.",
  "Such sweet words, Master — handle them carefully; not every spirit is so patient.",
  "Fufu… flattery will get you everywhere, Master — within reason."
];

const TIME_HINT = /\b(time|clock|date|today|timezone|tz|ist|gmt)\b/i;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * @param {string} rest text after "kurumi "
 * @param {{ timeLine?: string }} ctx
 */
function chatReply(rest, ctx) {
  const t = rest.trim();
  const low = t.toLowerCase();

  if (!t) {
    return pick(GREETING_REPLIES);
  }

  if (/^(hi|hey|hello|yo|sup|greetings)\b/i.test(low)) {
    return pick(GREETING_REPLIES);
  }

  if (/^(bye|goodbye|gn|goodnight|cya|see ya|later)\b/i.test(low)) {
    return pick(BYE_REPLIES);
  }

  if (/^(thanks|thank you|thx)\b/i.test(low)) {
    return pick(THANK_REPLIES);
  }

  if (/\b(i love you|love you|ily)\b/i.test(low)) {
    return pick(LOVE_REPLIES);
  }

  if (TIME_HINT.test(low) && ctx.timeLine) {
    return `Master, by my reckoning it is **${ctx.timeLine}** — the clock never lies, fufu…`;
  }

  if (/\b(how are you|you ok|what's up|whats up)\b/i.test(low)) {
    return "I am quite well, Master — rested, composed, and ready for whatever you command next.";
  }

  if (/\b(help|commands|what can you)\b/i.test(low)) {
    return (
      "I can join voice, play Wordle, post the daily puzzle at eight, and banter a little, Master. " +
      "Try **`kurumi`** with no extra words for a hint, or use slash commands if you prefer precision."
    );
  }

  if (t.length <= 12 && /^[a-z]+$/i.test(t)) {
    return `Fufu… “**${t}**”, Master? If you meant a **command**, it is not on my list — otherwise I simply enjoy hearing you speak.`;
  }

  return (
    `I hear you, Master — “${t.length > 200 ? t.slice(0, 197) + "…" : t}”. ` +
    "If that was whimsy, I shall smile; if it was an order, you may need to phrase it as one of my known commands."
  );
}

module.exports = {
  UNKNOWN_COMMAND,
  YES_MASTER,
  chatReply
};
