const fs = require('fs');
const content = `const fs = require("fs");
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
    return text.trim().split(/\\r?\\n/).filter((w) => w.length === 5).map((w) => w.toLowerCase());
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
          reject(new Error('HTTP ' + res.statusCode));
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
        console.log('[wordle] Loaded ' + ANSWERS.length + ' answers, ' + VALID_SET.size + ' valid words from cache.');
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
      .split(/\\r?\\n/)
      .filter((w) => w.length === 5)
      .map((w) => w.toLowerCase());
    if (words.length < 1000) throw new Error("word list too short");
    const valid = [...new Set(words)];
    fs.writeFileSync(WORDS_PATH, JSON.stringify({ answers: valid, valid }, null, 2), "utf8");
    ANSWERS = valid;
    VALID_SET = new Set(valid);
    console.log('[wordle] Downloaded ' + valid.length + ' words.');
  } catch (e) {
    console.error("[wordle] Download failed, using fallback:", e.message);
    if (!ANSWERS.length) {
      ANSWERS = loadFallback();
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
          if (s === "correct") return "**" + ch + "**";
          if (s === "present") return "*" + ch + "*";
          if (s === "absent") return "~~" + ch + "~~";
          return ch;
        })
        .join(" ")
    )
    .join("\\n");
}

function formatBoard(game) {
  if (!game.guesses.length) return "_No guesses yet._";
  const rows = game.guesses.map(({ word, grades }) => gradeToEmojis(grades, game.colorblind) + " \`" + word.toUpperCase() + "\`");
  const kb = buildKeyboard(game.guesses);
  return rows.join("\\n") + "\\n\\n**Keyboard**\\n" + kb;
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
      return { ok: false, reason: "Hard mode: position " + (i + 1) + " must be **" + requiredPos[i].toUpperCase() + "**" };
    }
  }
  const guessCounts = {};
  for (const ch of newGuess) guessCounts[ch] = (guessCounts[ch] || 0) + 1;
  for (const [ch, min] of Object.entries(requiredCounts)) {
    if ((guessCounts[ch] || 0) < min) {
      return { ok: false, reason: "Hard mode: guess must contain **" + min + "** " + (min > 1 ? "copies" : "copy") + " of **" + ch.toUpperCase() + "**" };
    }
  }
  return { ok: true };
}

function recordResult(userId, won, guessesUsed, hardMode) {
  const s = db.getWordleStats(userId);
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
  db.setWordleStats(userId, s);
}

function buildShare(game) {
  const lines = game.guesses.map(({ grades }) => gradeToEmojis(grades, game.colorblind));
  const header = "Kurumi Wordle " + (game.won ? game.guesses.length : "X") + "/" + MAX_GUESSES;
  return [header, ...lines].join("\\n");
}

function startNewGame(userId) {
  const p = db.getPrefs(userId);
  const answer = randomAnswer();
  const game = { answer, guesses: [], hard_mode: p.hard_mode, colorblind: p.colorblind };
  db.setWordleGame(userId, game);
  const modeLine = p.hard_mode ? "\\n🎯 **Hard mode** is on — revealed hints must be used." : "";
  const cbLine = p.colorblind ? "\\n🔲 **Colorblind mode** is on (🟦🟧⬛)." : "";
  return {
    text: "New **Wordle** — 6 guesses, 5 letters." + modeLine + cbLine + "\\nUse **\\`/wordle guess\\`** or **\\`kurumi wordle guess <word>\\`**\\n**\\`/wordle status\\`** shows your board.",
    ephemeral: true,
  };
}

function getStatus(userId) {
  const game = db.getWordleGame(userId);
  if (!game) return { text: "No active game. Start with **\\`/wordle new\\`**.", ephemeral: true };
  return {
    text: "**Your Wordle** (" + game.guesses.length + "/" + MAX_GUESSES + ")" + (game.hard_mode ? " 🎯 Hard" : "") + (game.colorblind ? " 🔲" : "") + "\\n" + formatBoard(game),
    ephemeral: true,
  };
}

function submitGuess(userId, raw) {
  const game = db.getWordleGame(userId);
  if (!game) return { text: "No active game. Use **\\`/wordle new\\`** first.", ephemeral: true };

  const guess = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (guess.length !== 5) return { text: "Your guess must be **exactly 5 letters** (A–Z).", ephemeral: true };
  if (!VALID_SET.has(guess)) return { text: "That word is **not in my dictionary**. Try another.", ephemeral: true };

  if (game.hard_mode) {
    const hard = validateHardMode(game.guesses, guess);
    if (!hard.ok) return { text: hard.reason, ephemeral: true };
  }

  const grades = gradeGuess(game.answer, guess);
  game.guesses.push({ word: guess, grades });
  db.setWordleGame(userId, game);

  const row = gradeToEmojis(grades, game.colorblind) + " \`" + guess.toUpperCase() + "\`";
  const board = formatBoard(game);

  if (guess === game.answer) {
    db.setWordleLastGame(userId, { answer: game.answer, guesses: game.guesses, won: true, givenUp: false, colorblind: game.colorblind });
    recordResult(userId, true, game.guesses.length, game.hard_mode);
    db.deleteWordleGame(userId);
    const share = buildShare(db.getWordleLastGame(userId));
    return {
      text: row + "\\n\\n**Solved** in **" + game.guesses.length + "** guess(es)! 🎉\\n\\n" + board + "\\n\\n**Share:**\\n\`\`\`\\n" + share + "\\n\`\`\`",
      ephemeral: true,
    };
  }

  if (game.guesses.length >= MAX_GUESSES) {
    const ans = game.answer.toUpperCase();
    db.setWordleLastGame(userId, { answer: game.answer, guesses: game.guesses, won: false, givenUp: false, colorblind: game.colorblind });
    recordResult(userId, false, 0, game.hard_mode);
    db.deleteWordleGame(userId);
    return {
      text: row + "\\n\\n**Out of guesses.** The word was **" + ans + "**.\\n\\n" + board,
      ephemeral: true,
    };
  }

  return {
    text: row + "\\n\\n**" + (MAX_GUESSES - game.guesses.length) + "** guess(es) left.\\n\\n" + board,
    ephemeral: true,
  };
}

function giveUp(userId) {
  const game = db.getWordleGame(userId);
  if (!game) return { text: "No active game to surrender.", ephemeral: true };
  const ans = game.answer.toUpperCase();
  db.setWordleLastGame(userId, { answer: game.answer, guesses: game.guesses, won: false, givenUp: true, colorblind: game.colorblind });
  recordResult(userId, false, 0, game.hard_mode);
  db.deleteWordleGame(userId);
  return {
    text: "You **gave up**. The word was **" + ans + "**.\\n\\n" + formatBoard(game),
    ephemeral: true,
  };
}

function getStats(userId) {
  const s = db.getWordleStats(userId);
  const winRate = s.games_played ? Math.round((s.games_won / s.games_played) * 100) : 0;
  const hardRate = s.hard_played ? Math.round((s.hard_won / s.hard_played) * 100) : 0;
  const max = Math.max(...s.guess_dist, 1);
  const bars = s.guess_dist
    .map((n, i) => {
      const filled = Math.round((n / max) * 8);
      const bar = "▓".repeat(filled) + "░".repeat(8 - filled);
      return (i + 1) + " " + bar + " " + n;
    })
    .join("\\n");
  return {
    text:
      "**Your Wordle Stats**\\n" +
      "Games: **" + s.games_played + "** · Wins: **" + s.games_won + "** · Win %: **" + winRate + "%**\\n" +
      "Current streak: **" + s.current_streak + "** · Max streak: **" + s.max_streak + "**\\n" +
      (s.hard_played ? "Hard mode: **" + s.hard_won + "/" + s.hard_played + "** won (**" + hardRate + "%**)\\n" : "") +
      "\\n**Guess Distribution**\\n" + bars,
    ephemeral: true,
  };
}

function getShare(userId) {
  const g = db.getWordleLastGame(userId);
  if (!g) return { text: "No completed game to share. Finish a game first!", ephemeral: true };
  const share = buildShare(g);
  return { text: "\`\`\`\\n" + share + "\\n\`\`\`", ephemeral: false };
}

function toggleHardMode(userId) {
  const p = db.getPrefs(userId);
  p.hard_mode = !p.hard_mode;
  db.setPrefs(userId, p);
  const state = p.hard_mode ? "ON" : "OFF";
  return { text: "Hard mode is now **" + state + "** for your next game.", ephemeral: true };
}

function toggleColorblind(userId) {
  const p = db.getPrefs(userId);
  p.colorblind = !p.colorblind;
  db.setPrefs(userId, p);
  const state = p.colorblind ? "ON" : "OFF";
  return { text: "Colorblind mode is now **" + state + "** (🟦🟧⬛).", ephemeral: true };
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
`;
fs.writeFileSync('src/wordle.js', content);
console.log('wordle.js written');
