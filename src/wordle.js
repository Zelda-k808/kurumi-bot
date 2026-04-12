/**
 * Lightweight Wordle: one active game per Discord user id.
 * Same word list is used for answers and allowed guesses.
 */

const MAX_GUESSES = 6;

/** Curated 5-letter lowercase words (answers + valid guesses). */
const WORD_LIST = [
  "about", "above", "acute", "admit", "adopt", "adult", "after", "again", "agent", "agree", "ahead", "alarm", "album", "alert", "alien", "align", "alike", "alive", "allow", "alone", "along", "alter", "amber", "amend", "angel", "anger", "angle", "angry", "apart", "apple", "apply", "arena", "argue", "arise", "armor", "array", "arrow", "aside", "asset", "audio", "audit", "avoid", "award", "aware", "badly", "baker", "bases", "basic", "beach", "began", "begin", "being", "below", "bench", "billy", "birth", "black", "blade", "blank", "blast", "blaze", "bleed", "blend", "bless", "blind", "block", "blood", "bloom", "blown", "board", "boast", "brain", "brand", "brass", "brave", "bread", "break", "brick", "brief", "bring", "broad", "broke", "brown", "brush", "build", "built", "buyer", "cabin", "cable", "camel", "canal", "candy", "carry", "carve", "catch", "cause", "chain", "chair", "chalk", "champ", "chaos", "charm", "chart", "chase", "cheap", "check", "chess", "chest", "chief", "child", "chili", "chill", "china", "chord", "chose", "chunk", "civic", "civil", "claim", "clash", "class", "clean", "clear", "clerk", "click", "climb", "clock", "close", "cloth", "cloud", "coach", "coast", "could", "count", "court", "cover", "crack", "craft", "crash", "crawl", "crazy", "cream", "creek", "crime", "crisp", "cross", "crowd", "crown", "crush", "curve", "cycle", "daily", "dance", "dated", "dealt", "death", "debut", "delay", "delta", "demon", "dense", "depth", "diary", "digit", "diner", "dirty", "disco", "dodge", "donor", "doubt", "dozen", "draft", "drama", "drain", "drawn", "dream", "dress", "drill", "drink", "drive", "drove", "dying", "eager", "early", "earth", "eight", "elbow", "elect", "elite", "empty", "enemy", "enjoy", "enter", "entry", "equal", "error", "event", "every", "exact", "exist", "extra", "faint", "faith", "false", "fancy", "fault", "feast", "fence", "ferry", "fever", "fewer", "fiber", "field", "fifth", "fifty", "fight", "final", "first", "fixed", "flame", "flash", "fleet", "flesh", "float", "flock", "floor", "fluid", "flush", "flyer", "focus", "force", "forge", "forth", "found", "frame", "frank", "fraud", "fresh", "front", "frost", "fruit", "fully", "funny", "giant", "given", "glass", "globe", "glory", "glove", "going", "grace", "grade", "grain", "grand", "grant", "grape", "graph", "grass", "grave", "great", "green", "greet", "grill", "gross", "group", "grown", "guard", "guess", "guest", "guide", "habit", "happy", "harry", "harsh", "heart", "heavy", "hello", "hence", "hobby", "horse", "hotel", "house", "human", "humor", "hurry", "ideal", "image", "imply", "index", "inner", "input", "issue", "japan", "jelly", "jewel", "joint", "judge", "juice", "knife", "knock", "known", "label", "large", "laser", "later", "laugh", "layer", "learn", "lease", "least", "leave", "legal", "lemon", "level", "light", "limit", "local", "loose", "lorry", "lower", "lucky", "lunch", "lying", "magic", "major", "maker", "march", "match", "maybe", "mayor", "medal", "media", "mercy", "merge", "merit", "messy", "metal", "meter", "might", "minor", "model", "money", "month", "moral", "motor", "mount", "mouse", "mouth", "movie", "music", "naked", "nasty", "naval", "needs", "nerve", "never", "newly", "night", "ninth", "noise", "north", "noted", "novel", "nurse", "occur", "ocean", "offer", "often", "order", "organ", "other", "ought", "paint", "panel", "paper", "party", "patch", "pause", "peace", "pearl", "pedal", "penny", "perch", "phase", "phone", "photo", "piano", "piece", "pilot", "pitch", "place", "plain", "plane", "plant", "plate", "point", "polar", "porch", "pound", "power", "press", "price", "pride", "prime", "print", "prior", "prize", "proof", "proud", "prove", "pulse", "punch", "queen", "query", "quick", "quiet", "quite", "radio", "raise", "rally", "ranch", "range", "rapid", "ratio", "reach", "react", "ready", "realm", "rebel", "refer", "relax", "reply", "rider", "ridge", "rifle", "right", "rigid", "ripen", "risky", "river", "roach", "roast", "robot", "rocky", "roman", "rough", "round", "route", "royal", "rural", "rusty", "sadly", "saint", "salad", "sales", "sandy", "sauce", "scale", "scare", "scarf", "scene", "scent", "scope", "score", "scout", "scrap", "scrub", "seize", "sense", "serve", "seven", "shade", "shake", "shall", "shame", "shape", "share", "sharp", "shave", "sheep", "sheet", "shelf", "shell", "shift", "shine", "shirt", "shock", "shoot", "short", "shown", "shrug", "silly", "since", "sixth", "skill", "skirt", "slate", "sleep", "slice", "slide", "slope", "small", "smart", "smile", "smith", "smoke", "snack", "snake", "snowy", "sober", "solar", "solid", "solve", "sorry", "sound", "south", "space", "spare", "spark", "speak", "speed", "spell", "spend", "spent", "spice", "spike", "spill", "spine", "spite", "split", "spoke", "spoon", "sport", "spray", "squad", "stack", "staff", "stage", "stain", "stair", "stake", "stale", "stamp", "stand", "stare", "start", "state", "steak", "steam", "steel", "steep", "stick", "still", "stock", "stone", "stood", "store", "storm", "story", "stove", "strap", "straw", "strip", "stuck", "study", "stuff", "style", "sugar", "suite", "sunny", "super", "surge", "swamp", "swarm", "swear", "sweat", "sweep", "sweet", "swift", "swing", "sword", "table", "taken", "taste", "teach", "teeth", "tempo", "tenth", "thank", "theft", "their", "theme", "there", "these", "thick", "thief", "thing", "think", "third", "those", "three", "threw", "throw", "thumb", "tiger", "tight", "timer", "tired", "title", "toast", "today", "token", "tooth", "topic", "total", "touch", "tough", "towel", "tower", "toxic", "trace", "track", "trade", "trail", "train", "trait", "trash", "treat", "trend", "trial", "tribe", "trick", "tried", "troop", "truck", "truly", "trunk", "trust", "truth", "twice", "uncle", "under", "undue", "union", "unity", "until", "upper", "upset", "urban", "usage", "usual", "valid", "value", "video", "virus", "visit", "vital", "vocal", "voice", "waste", "watch", "water", "weary", "weave", "wedge", "weigh", "weird", "whale", "wheel", "where", "which", "while", "white", "whole", "whose", "width", "windy", "witch", "woman", "women", "world", "worry", "worse", "worst", "worth", "would", "wound", "write", "wrong", "yacht", "yearn", "yield", "young", "youth"
];

const WORD_SET = new Set(WORD_LIST);

/** @type {Map<string, { answer: string, guesses: { word: string, grades: string[] }[] }>} */
const games = new Map();

function randomAnswer() {
  return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
}

/**
 * @param {string} answer
 * @param {string} guess lowercase 5 chars
 * @returns {('correct'|'present'|'absent')[]}
 */
function gradeGuess(answer, guess) {
  const result = /** @type {('correct'|'present'|'absent')[]} */ (
    Array(5).fill("absent")
  );
  const ans = [...answer];
  const g = [...guess];
  const used = Array(5).fill(false);

  for (let i = 0; i < 5; i++) {
    if (g[i] === ans[i]) {
      result[i] = "correct";
      used[i] = true;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === "correct") continue;
    const ch = g[i];
    const j = ans.findIndex((c, k) => c === ch && !used[k]);
    if (j !== -1) {
      result[i] = "present";
      used[j] = true;
    }
  }
  return result;
}

function gradeToEmojis(grades) {
  return grades.map((g) => (g === "correct" ? "🟩" : g === "present" ? "🟨" : "⬛")).join("");
}

function formatBoard(game) {
  if (game.guesses.length === 0) return "_No guesses yet._";
  return game.guesses
    .map(
      ({ word, grades }) =>
        `${gradeToEmojis(grades)} \`${word.toUpperCase()}\``
    )
    .join("\n");
}

/**
 * @param {string} userId
 * @returns {{ text: string, ephemeral?: boolean }}
 */
function startNewGame(userId) {
  const answer = randomAnswer();
  games.set(userId, { answer, guesses: [] });
  return {
    text:
      "New **Wordle** — 6 guesses, 5 letters (this bot’s word list only).\n" +
      "Use **`/wordle guess`** with your word.\n" +
      "`/wordle status` shows your board.",
    ephemeral: true
  };
}

/**
 * @param {string} userId
 */
function getStatus(userId) {
  const game = games.get(userId);
  if (!game) {
    return { text: "No active game. Start with **`/wordle new`**.", ephemeral: true };
  }
  return {
    text: `**Your Wordle** (${game.guesses.length}/${MAX_GUESSES})\n${formatBoard(game)}`,
    ephemeral: true
  };
}

/**
 * @param {string} userId
 * @param {string} raw
 */
function submitGuess(userId, raw) {
  const game = games.get(userId);
  if (!game) {
    return { text: "No active game. Use **`/wordle new`** first.", ephemeral: true };
  }

  const guess = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (guess.length !== 5) {
    return { text: "Your guess must be **exactly 5 letters** (A–Z).", ephemeral: true };
  }
  if (!WORD_SET.has(guess)) {
    return { text: "That word is **not in this bot’s word list**. Try another.", ephemeral: true };
  }

  const grades = gradeGuess(game.answer, guess);
  game.guesses.push({ word: guess, grades });

  const row = `${gradeToEmojis(grades)} \`${guess.toUpperCase()}\``;
  const board = formatBoard(game);

  if (guess === game.answer) {
    games.delete(userId);
    return {
      text: `${row}\n\nYou **won** in **${game.guesses.length}** guess(es)! 🎉\n\n${board}`,
      ephemeral: true
    };
  }

  if (game.guesses.length >= MAX_GUESSES) {
    const ans = game.answer.toUpperCase();
    games.delete(userId);
    return {
      text: `${row}\n\n**Out of guesses.** The word was **${ans}**.\n\n${board}`,
      ephemeral: true
    };
  }

  return {
    text: `${row}\n\n**${MAX_GUESSES - game.guesses.length}** guess(es) left.\n\n${board}`,
    ephemeral: true
  };
}

module.exports = { startNewGame, getStatus, submitGuess };
