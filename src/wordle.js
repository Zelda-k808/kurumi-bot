const fs = require("fs");
const path = require("path");
const https = require("https");
const db = require("./database");

const MAX_GUESSES = 6;
const DATA_DIR = path.join(__dirname, "..", "data");
const WORDS_PATH = path.join(DATA_DIR, "wordle-words.json");
const FALLBACK_PATH = path.join(DATA_DIR, "wordle-fallback.txt");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFallback() {
  try {
    const text = fs.readFileSync(FALLBACK_PATH, "utf8");
    return text.trim().split(/\r?\n/).filter((w) => w.length === 5).map((w) => w.toLowerCase());
  } catch {
    return [];
  }
}

let ANSWERS = loadFallback();
let VALID_SET = new Set(ANSWERS);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 15000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject)
      .setTimeout(15000, () => reject(new Error("timeout")));
  });
}

async function loadWordList() {
  ensureDataDir();
  if (fs.existsSync(WORDS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(WORDS_PATH, "utf8"));
      if (Array.isArray(data.answers) && data.answers.length && Array.isArray(data.valid) && data.valid.length) {
        ANSWERS = data.answers.map((w) => w.toLowerCase());
        VALID_SET = new Set(data.valid.map((w) => w.toLowerCase()));
        console.log(`[wordle] Loaded ${ANSWERS.length} answers, ${VALID_SET.size} valid words from cache.`);
        return;
      }
    } catch (e) {
      console.error("[wordle] cache corrupt:", e.message);
    }
  }

  try {
    const text = await fetchText("https://raw.githubusercontent.com/tabatkins/wordle-list/main/words");
    const words = text
      .trim()
      .split(/\r?\n/)
      .filter((w) => w.length === 5)
      .map((w) => w.toLowerCase());
    if (words.length < 1000) throw new Error("word list too short");
    const valid = [...new Set(words)];
    fs.writeFileSync(WORDS_PATH, JSON.stringify({ answers: valid, valid }, null, 2), "utf8");
    ANSWERS = valid;
    VALID_SET = new Set(valid);
    console.log(`[wordle] Downloaded ${valid.length} words.`);
  } catch (e) {
    console.error("[wordle] Download failed, using fallback:", e.message);
    if (!ANSWERS.length) {
      ANSWERS = ["about", "above", "acute", "admit", "adopt", "apple", "beach", "brain", "bread", "break", "brush", "build", "camel", "chair", "charm", "chase", "check", "child", "clean", "clear", "clock", "cloud", "coast", "count", "court", "cover", "crash", "dance", "dream", "dress", "drive", "earth", "eight", "enemy", "enjoy", "enter", "equal", "error", "event", "every", "exact", "exist", "extra", "faith", "false", "field", "fight", "final", "first", "flame", "flash", "fleet", "flesh", "float", "floor", "focus", "force", "forge", "frame", "front", "fruit", "fully", "funny", "glass", "globe", "grace", "grade", "grain", "grand", "grant", "grape", "graph", "grass", "grave", "great", "green", "greet", "group", "guard", "guest", "guide", "happy", "heart", "heavy", "horse", "hotel", "house", "human", "humor", "ideal", "image", "index", "inner", "input", "issue", "judge", "juice", "knife", "knock", "known", "label", "large", "laser", "later", "laugh", "layer", "learn", "lease", "least", "leave", "legal", "lemon", "level", "light", "limit", "local", "lower", "lucky", "lunch", "magic", "major", "maker", "match", "maybe", "media", "metal", "meter", "might", "model", "money", "month", "moral", "motor", "mount", "mouse", "mouth", "movie", "music", "night", "noise", "north", "novel", "nurse", "ocean", "offer", "often", "order", "organ", "other", "ought", "paint", "panel", "paper", "party", "peace", "phone", "photo", "piano", "piece", "pilot", "pitch", "place", "plain", "plane", "plant", "plate", "point", "pound", "power", "press", "price", "pride", "prime", "print", "prize", "proof", "proud", "prove", "pulse", "punch", "queen", "quick", "quiet", "quite", "radio", "raise", "range", "rapid", "ratio", "reach", "react", "ready", "refer", "reply", "right", "rigid", "river", "roman", "rough", "round", "route", "royal", "rural", "rusty", "salad", "sales", "sauce", "scale", "scare", "scene", "scope", "score", "sense", "serve", "seven", "shake", "shame", "shape", "share", "sharp", "sheep", "sheet", "shelf", "shell", "shift", "shine", "shirt", "shock", "shoot", "short", "shown", "silly", "since", "skill", "sleep", "slice", "slide", "slope", "small", "smart", "smile", "smith", "smoke", "snake", "sorry", "sound", "south", "space", "spare", "spark", "speak", "speed", "spell", "spend", "spice", "spill", "split", "spoke", "spoon", "sport", "spray", "stack", "staff", "stage", "stain", "stair", "stake", "stamp", "stand", "stare", "start", "state", "steak", "steam", "steel", "steep", "stick", "still", "stock", "stone", "store", "storm", "story", "stove", "strap", "straw", "strip", "stuck", "study", "stuff", "style", "sugar", "suite", "sunny", "super", "surge", "swear", "sweat", "sweep", "sweet", "swift", "swing", "sword", "table", "taste", "teach", "teeth", "thank", "theme", "there", "these", "thick", "thief", "thing", "think", "third", "those", "three", "throw", "tight", "tired", "title", "today", "token", "tooth", "topic", "total", "touch", "tough", "towel", "tower", "toxic", "trace", "track", "trade", "trail", "train", "trait", "treat", "trend", "trial", "tribe", "trick", "troop", "truck", "truly", "trunk", "trust", "truth", "twice", "uncle", "under", "union", "unity", "until", "upper", "upset", "urban", "usage", "usual", "valid", "value", "video", "virus", "visit", "vital", "vocal", "voice", "waste", "watch", "water", "weary", "weave", "wedge", "weigh", "weird", "whale", "wheel", "where", "which", "while", "white", "whole", "whose", "width", "windy", "woman", "women", "world", "worry", "worse", "worst", "worth", "would", "wound", "write", "wrong", "yield", "young", "youth"];
      VALID_SET = new Set(ANSWERS);
    }
  }
}

function randomAnswer() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

function gradeGuess(answer, guess) {
  const result = Array(5).fill("absent");
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

function gradeToEmojis(grades, colorblind) {
  if (colorblind) {
    return grades.map((g) => (g === "correct" ? "🟦" : g === "present" ? "🟧" : "⬛")).join("");
  }
  return grades.map((g) => (g === "correct" ? "🟩" : g === "present" ? "🟨" : "⬛")).join("");
}

function buildKeyboard(guesses) {
  const state = {};
  const rank = { correct: 3, present: 2, absent: 1 };
  for (const { word, grades } of guesses) {
    for (let i = 0; i < 5; i++) {
      const ch = word[i].toUpperCase();
      const g = grades[i];
      const cur = state[ch];
      if (cur === undefined) {
        state[ch] = g;
      } else if (rank[g] > rank[cur]) {
        state[ch] = g;
      }
    }
  }
  const rows = ["Q W E R T Y U I O P", "A S D F G H J K L", "Z X C V B N M"];
  return rows
    .map((row) =>
      row
        .split(" ")
        .map((ch) => {
          const s = state[ch];
          if (s === "correct") return `**${ch}**`;
          if (s === "present") return `*${ch}*`;
          if (s === "absent") return `~~${ch}~~`;
          return ch;
        })
        .join(" ")
    )
    .join("\n");
}

function formatBoard(game) {
  if (!game.guesses.length) return "_No guesses yet._";
  const rows = game.guesses.map(({ word, grades }) => `${gradeToEmojis(grades, game.colorblind)} \`${word.toUpperCase()}\``);
  const kb = buildKeyboard(game.guesses);
  return rows.join("\n") + "\n\n**Keyboard**\n" + kb;
}

function validateHardMode(guesses, newGuess) {
  if (!guesses.length) return { ok: true };
  const requiredPos = {};
  const requiredCounts = {};
  for (const { word, grades } of guesses) {
    const w = [...word];
    const correctCounts = {};
    for (let i = 0; i < 5; i++) {
      if (grades[i] === "correct") {
        requiredPos[i] = w[i];
        correctCounts[w[i]] = (correctCounts[w[i]] || 0) + 1;
      }
    }
    const presentCounts = {};
    for (let i = 0; i < 5; i++) {
      if (grades[i] === "present") presentCounts[w[i]] = (presentCounts[w[i]] || 0) + 1;
    }
    for (const ch of Object.keys(presentCounts)) {
      const min = (correctCounts[ch] || 0) + presentCounts[ch];
      if (!requiredCounts[ch] || min > requiredCounts[ch]) requiredCounts[ch] = min;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (requiredPos[i] && newGuess[i] !== requiredPos[i]) {
      return { ok: false, reason: `Hard mode: position ${i + 1} must be **${requiredPos[i].toUpperCase()}**` };
    }
  }
  const guessCounts = {};
  for (const ch of newGuess) guessCounts[ch] = (guessCounts[ch] || 0) + 1;
  for (const [ch, min] of Object.entries(requiredCounts)) {
    if ((guessCounts[ch] || 0) < min) {
      return { ok: false, reason: `Hard mode: guess must contain **${min}** ${min > 1 ? "copies" : "copy"} of **${ch.toUpperCase()}**` };
    }
  }
  return { ok: true };
}

async function recordResult(userId, won, guessesUsed, hardMode) {
  const s = await db.getWordleStats(userId);
  s.games_played++;
  if (hardMode) s.hard_played++;
  if (won) {
    s.games_won++;
    s.current_streak++;
    if (s.current_streak > s.max_streak) s.max_streak = s.current_streak;
    s.guess_dist[guessesUsed - 1]++;
    if (hardMode) s.hard_won++;
  } else {
    s.current_streak = 0;
  }
  await db.setWordleStats(userId, s);
}

function buildShare(game) {
  const lines = game.guesses.map(({ grades }) => gradeToEmojis(grades, game.colorblind));
  const header = `Kurumi Wordle ${game.won ? game.guesses.length : "X"}/${MAX_GUESSES}`;
  return [header, ...lines].join("\n");
}

async function startNewGame(userId) {
  const p = await db.getPrefs(userId);
  const answer = randomAnswer();
  const game = { answer, guesses: [], hard_mode: p.hard_mode, colorblind: p.colorblind };
  await db.setWordleGame(userId, game);
  const modeLine = p.hard_mode ? "\n🎯 **Hard mode** is on — revealed hints must be used." : "";
  const cbLine = p.colorblind ? "\n🔲 **Colorblind mode** is on (🟦🟧⬛)." : "";
  return {
    text: `New **Wordle** — 6 guesses, 5 letters.${modeLine}${cbLine}\nUse **\`/wordle guess\`** or **\`kurumi wordle guess <word>\`**\n**\`/wordle status\`** shows your board.`,
    ephemeral: true,
  };
}

async function getStatus(userId) {
  const game = await db.getWordleGame(userId);
  if (!game) return { text: "No active game. Start with **`/wordle new`**.", ephemeral: true };
  return {
    text: `**Your Wordle** (${game.guesses.length}/${MAX_GUESSES})${game.hard_mode ? " 🎯 Hard" : ""}${game.colorblind ? " 🔲" : ""}\n${formatBoard(game)}`,
    ephemeral: true,
  };
}

async function submitGuess(userId, raw) {
  const game = await db.getWordleGame(userId);
  if (!game) return { text: "No active game. Use **`/wordle new`** first.", ephemeral: true };

  const guess = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (guess.length !== 5) return { text: "Your guess must be **exactly 5 letters** (A–Z).", ephemeral: true };
  if (!VALID_SET.has(guess)) return { text: "That word is **not in my dictionary**. Try another.", ephemeral: true };

  if (game.hard_mode) {
    const hard = validateHardMode(game.guesses, guess);
    if (!hard.ok) return { text: hard.reason, ephemeral: true };
  }

  const grades = gradeGuess(game.answer, guess);
  game.guesses.push({ word: guess, grades });
  await db.setWordleGame(userId, game);

  const row = `${gradeToEmojis(grades, game.colorblind)} \`${guess.toUpperCase()}\``;
  const board = formatBoard(game);

  if (guess === game.answer) {
    await db.setWordleLastGame(userId, { answer: game.answer, guesses: game.guesses, won: true, givenUp: false, colorblind: game.colorblind });
    await recordResult(userId, true, game.guesses.length, game.hard_mode);
    await db.deleteWordleGame(userId);
    const lastGame = await db.getWordleLastGame(userId);
    const share = buildShare(lastGame);
    return {
      text: `${row}\n\n**Solved** in **${game.guesses.length}** guess(es)! 🎉\n\n${board}\n\n**Share:**\n\`\`\`\n${share}\n\`\`\``,
      ephemeral: true,
    };
  }

  if (game.guesses.length >= MAX_GUESSES) {
    const ans = game.answer.toUpperCase();
    await db.setWordleLastGame(userId, { answer: game.answer, guesses: game.guesses, won: false, givenUp: false, colorblind: game.colorblind });
    await recordResult(userId, false, 0, game.hard_mode);
    await db.deleteWordleGame(userId);
    return {
      text: `${row}\n\n**Out of guesses.** The word was **${ans}**.\n\n${board}`,
      ephemeral: true,
    };
  }

  return {
    text: `${row}\n\n**${MAX_GUESSES - game.guesses.length}** guess(es) left.\n\n${board}`,
    ephemeral: true,
  };
}

async function giveUp(userId) {
  const game = await db.getWordleGame(userId);
  if (!game) return { text: "No active game to surrender.", ephemeral: true };
  const ans = game.answer.toUpperCase();
  await db.setWordleLastGame(userId, { answer: game.answer, guesses: game.guesses, won: false, givenUp: true, colorblind: game.colorblind });
  await recordResult(userId, false, 0, game.hard_mode);
  await db.deleteWordleGame(userId);
  return {
    text: `You **gave up**. The word was **${ans}**.\n\n${formatBoard(game)}`,
    ephemeral: true,
  };
}

async function getStats(userId) {
  const s = await db.getWordleStats(userId);
  const winRate = s.games_played ? Math.round((s.games_won / s.games_played) * 100) : 0;
  const hardRate = s.hard_played ? Math.round((s.hard_won / s.hard_played) * 100) : 0;
  const max = Math.max(...s.guess_dist, 1);
  const bars = s.guess_dist
    .map((n, i) => {
      const filled = Math.round((n / max) * 8);
      const bar = "▓".repeat(filled) + "░".repeat(8 - filled);
      return `${i + 1} ${bar} ${n}`;
    })
    .join("\n");
  return {
    text:
      `**Your Wordle Stats**\n` +
      `Games: **${s.games_played}** · Wins: **${s.games_won}** · Win %: **${winRate}%**\n` +
      `Current streak: **${s.current_streak}** · Max streak: **${s.max_streak}**\n` +
      (s.hard_played ? `Hard mode: **${s.hard_won}/${s.hard_played}** won (**${hardRate}%**)\n` : "") +
      `\n**Guess Distribution**\n${bars}`,
    ephemeral: true,
  };
}

async function getShare(userId) {
  const g = await db.getWordleLastGame(userId);
  if (!g) return { text: "No completed game to share. Finish a game first!", ephemeral: true };
  const share = buildShare(g);
  return { text: `\`\`\`\n${share}\n\`\`\``, ephemeral: false };
}

async function toggleHardMode(userId) {
  const p = await db.getPrefs(userId);
  p.hard_mode = !p.hard_mode;
  await db.setPrefs(userId, p);
  const state = p.hard_mode ? "ON" : "OFF";
  return { text: `Hard mode is now **${state}** for your next game.`, ephemeral: true };
}

async function toggleColorblind(userId) {
  const p = await db.getPrefs(userId);
  p.colorblind = !p.colorblind;
  await db.setPrefs(userId, p);
  const state = p.colorblind ? "ON" : "OFF";
  return { text: `Colorblind mode is now **${state}** (🟦🟧⬛).`, ephemeral: true };
}

module.exports = {
  loadWordList,
  startNewGame,
  getStatus,
  submitGuess,
  giveUp,
  getStats,
  getShare,
  toggleHardMode,
  toggleColorblind,
  MAX_GUESSES,
  gradeGuess,
  gradeToEmojis,
  isValidWord: (w) => VALID_SET.has(w),
  pickRandomAnswer: randomAnswer,
  buildKeyboard,
  getOrCreatePrefs: (uid) => db.getPrefs(uid),
};
