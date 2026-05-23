const path = require("path");
const fs = require("fs");

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  console.error("[DB] better-sqlite3 not installed. Run: npm install");
  process.exit(1);
}

const DB_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "kurumi.db");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      username      TEXT,
      first_seen    INTEGER DEFAULT (unixepoch()),
      last_seen     INTEGER DEFAULT (unixepoch()),
      message_count INTEGER DEFAULT 0,
      mood_pref     TEXT DEFAULT 'neutral'
    );

    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id       TEXT PRIMARY KEY,
      hard_mode     INTEGER DEFAULT 0,
      colorblind    INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wordle_stats (
      user_id       TEXT PRIMARY KEY,
      games_played  INTEGER DEFAULT 0,
      games_won     INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      max_streak    INTEGER DEFAULT 0,
      hard_won      INTEGER DEFAULT 0,
      hard_played   INTEGER DEFAULT 0,
      guess_dist    TEXT DEFAULT '[]',
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wordle_games (
      user_id       TEXT PRIMARY KEY,
      answer        TEXT,
      guesses       TEXT DEFAULT '[]',
      hard_mode     INTEGER DEFAULT 0,
      colorblind    INTEGER DEFAULT 0,
      created_at    INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wordle_last_games (
      user_id       TEXT PRIMARY KEY,
      answer        TEXT,
      guesses       TEXT DEFAULT '[]',
      won           INTEGER DEFAULT 0,
      given_up      INTEGER DEFAULT 0,
      colorblind    INTEGER DEFAULT 0,
      ended_at      INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_schedules (
      guild_id      TEXT PRIMARY KEY,
      channel_id    TEXT NOT NULL,
      timezone      TEXT DEFAULT 'UTC',
      daily_hour    INTEGER DEFAULT 8,
      last_posted   TEXT,
      enabled       INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS daily_answers (
      guild_id      TEXT NOT NULL,
      ymd           TEXT NOT NULL,
      answer        TEXT NOT NULL,
      posted_at     INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (guild_id, ymd)
    );

    CREATE TABLE IF NOT EXISTS daily_progress (
      guild_id      TEXT NOT NULL,
      ymd           TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      guesses       TEXT DEFAULT '[]',
      solved        INTEGER DEFAULT 0,
      lost          INTEGER DEFAULT 0,
      guess_count   INTEGER DEFAULT 0,
      solved_at     INTEGER,
      PRIMARY KEY (guild_id, ymd, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      guild_id      TEXT,
      content       TEXT NOT NULL,
      bot_reply     TEXT,
      sentiment     REAL DEFAULT 0,
      intent        TEXT,
      created_at    INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS bot_state (
      key           TEXT PRIMARY KEY,
      value         TEXT,
      updated_at    INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_voice_xp (
      guild_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      username      TEXT,
      total_xp      INTEGER DEFAULT 0,
      voice_seconds INTEGER DEFAULT 0,
      updated_at    INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_voice_xp_guild_xp
      ON user_voice_xp (guild_id, total_xp DESC);
  `);
}

init();

/* ───────────── Users ───────────── */

function ensureUser(userId, username) {
  const upsert = db.prepare(`
    INSERT INTO users (user_id, username, last_seen, message_count)
    VALUES (?, ?, unixepoch(), 1)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      last_seen = unixepoch(),
      message_count = message_count + 1
  `);
  upsert.run(userId, username || null);
}

function getUser(userId) {
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
}

function getAllUsers() {
  return db.prepare("SELECT * FROM users ORDER BY last_seen DESC").all();
}

/* ───────────── User Prefs ───────────── */

function getPrefs(userId) {
  const row = db.prepare("SELECT * FROM user_prefs WHERE user_id = ?").get(userId);
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO user_prefs (user_id) VALUES (?)").run(userId);
    return { hard_mode: 0, colorblind: 0 };
  }
  return { hard_mode: !!row.hard_mode, colorblind: !!row.colorblind };
}

function setPrefs(userId, prefs) {
  db.prepare(`
    INSERT INTO user_prefs (user_id, hard_mode, colorblind)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      hard_mode = excluded.hard_mode,
      colorblind = excluded.colorblind
  `).run(userId, prefs.hard_mode ? 1 : 0, prefs.colorblind ? 1 : 0);
}

/* ───────────── Wordle Stats ───────────── */

function getWordleStats(userId) {
  const row = db.prepare("SELECT * FROM wordle_stats WHERE user_id = ?").get(userId);
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO wordle_stats (user_id) VALUES (?)").run(userId);
    return { games_played: 0, games_won: 0, current_streak: 0, max_streak: 0, hard_won: 0, hard_played: 0, guess_dist: [] };
  }
  return {
    games_played: row.games_played,
    games_won: row.games_won,
    current_streak: row.current_streak,
    max_streak: row.max_streak,
    hard_won: row.hard_won,
    hard_played: row.hard_played,
    guess_dist: JSON.parse(row.guess_dist),
  };
}

function setWordleStats(userId, stats) {
  db.prepare(`
    INSERT INTO wordle_stats (user_id, games_played, games_won, current_streak, max_streak, hard_won, hard_played, guess_dist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      games_played = excluded.games_played,
      games_won = excluded.games_won,
      current_streak = excluded.current_streak,
      max_streak = excluded.max_streak,
      hard_won = excluded.hard_won,
      hard_played = excluded.hard_played,
      guess_dist = excluded.guess_dist
  `).run(
    userId,
    stats.games_played,
    stats.games_won,
    stats.current_streak,
    stats.max_streak,
    stats.hard_won,
    stats.hard_played,
    JSON.stringify(stats.guess_dist)
  );
}

/* ───────────── Wordle Games ───────────── */

function getWordleGame(userId) {
  const row = db.prepare("SELECT * FROM wordle_games WHERE user_id = ?").get(userId);
  if (!row) return null;
  return {
    answer: row.answer,
    guesses: JSON.parse(row.guesses),
    hard_mode: !!row.hard_mode,
    colorblind: !!row.colorblind,
    created_at: row.created_at,
  };
}

function setWordleGame(userId, game) {
  db.prepare(`
    INSERT INTO wordle_games (user_id, answer, guesses, hard_mode, colorblind, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      answer = excluded.answer,
      guesses = excluded.guesses,
      hard_mode = excluded.hard_mode,
      colorblind = excluded.colorblind,
      created_at = excluded.created_at
  `).run(userId, game.answer, JSON.stringify(game.guesses), game.hard_mode ? 1 : 0, game.colorblind ? 1 : 0, game.created_at || Math.floor(Date.now() / 1000));
}

function deleteWordleGame(userId) {
  db.prepare("DELETE FROM wordle_games WHERE user_id = ?").run(userId);
}

/* ───────────── Wordle Last Games ───────────── */

function getWordleLastGame(userId) {
  const row = db.prepare("SELECT * FROM wordle_last_games WHERE user_id = ?").get(userId);
  if (!row) return null;
  return {
    answer: row.answer,
    guesses: JSON.parse(row.guesses),
    won: !!row.won,
    givenUp: !!row.given_up,
    colorblind: !!row.colorblind,
  };
}

function setWordleLastGame(userId, lastGame) {
  db.prepare(`
    INSERT INTO wordle_last_games (user_id, answer, guesses, won, given_up, colorblind, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      answer = excluded.answer,
      guesses = excluded.guesses,
      won = excluded.won,
      given_up = excluded.given_up,
      colorblind = excluded.colorblind,
      ended_at = excluded.ended_at
  `).run(
    userId,
    lastGame.answer,
    JSON.stringify(lastGame.guesses),
    lastGame.won ? 1 : 0,
    lastGame.givenUp ? 1 : 0,
    lastGame.colorblind ? 1 : 0
  );
}

/* ───────────── Daily Schedules ───────────── */

function getDailySchedule(guildId) {
  return db.prepare("SELECT * FROM daily_schedules WHERE guild_id = ?").get(guildId);
}

function setDailySchedule(guildId, channelId, timezone, hour) {
  db.prepare(`
    INSERT INTO daily_schedules (guild_id, channel_id, timezone, daily_hour)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      timezone = excluded.timezone,
      daily_hour = excluded.daily_hour
  `).run(guildId, channelId, timezone, hour);
}

function deleteDailySchedule(guildId) {
  db.prepare("DELETE FROM daily_schedules WHERE guild_id = ?").run(guildId);
}

function getAllSchedules() {
  return db.prepare("SELECT * FROM daily_schedules WHERE enabled = 1").all();
}

/* ───────────── Daily Answers ───────────── */

function getDailyAnswer(guildId, ymd) {
  return db.prepare("SELECT * FROM daily_answers WHERE guild_id = ? AND ymd = ?").get(guildId, ymd);
}

function setDailyAnswer(guildId, ymd, answer) {
  db.prepare(`
    INSERT INTO daily_answers (guild_id, ymd, answer)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, ymd) DO UPDATE SET
      answer = excluded.answer,
      posted_at = unixepoch()
  `).run(guildId, ymd, answer);
}

/* ───────────── Daily Progress ───────────── */

function getDailyProgress(guildId, ymd, userId) {
  return db.prepare("SELECT * FROM daily_progress WHERE guild_id = ? AND ymd = ? AND user_id = ?").get(guildId, ymd, userId);
}

function getAllDailyProgressForDay(guildId, ymd) {
  return db.prepare("SELECT * FROM daily_progress WHERE guild_id = ? AND ymd = ?").all(guildId, ymd);
}

function setDailyProgress(guildId, ymd, userId, progress) {
  db.prepare(`
    INSERT INTO daily_progress (guild_id, ymd, user_id, guesses, solved, lost, guess_count, solved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, ymd, user_id) DO UPDATE SET
      guesses = excluded.guesses,
      solved = excluded.solved,
      lost = excluded.lost,
      guess_count = excluded.guess_count,
      solved_at = excluded.solved_at
  `).run(
    guildId, ymd, userId,
    JSON.stringify(progress.guesses),
    progress.solved ? 1 : 0,
    progress.lost ? 1 : 0,
    progress.guess_count,
    progress.solved_at || null
  );
}

/* ───────────── Chat History ───────────── */

function logChat(userId, guildId, content, botReply, sentiment, intent) {
  db.prepare(`
    INSERT INTO chat_history (user_id, guild_id, content, bot_reply, sentiment, intent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, guildId || null, content, botReply || null, sentiment || 0, intent || null);
}

function getRecentChat(userId, limit = 5) {
  return db.prepare(`
    SELECT * FROM chat_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

function getTopIntents(userId, limit = 3) {
  return db.prepare(`
    SELECT intent, COUNT(*) as cnt
    FROM chat_history
    WHERE user_id = ? AND intent IS NOT NULL
    GROUP BY intent
    ORDER BY cnt DESC
    LIMIT ?
  `).all(userId, limit);
}

/* ───────────── Bot State ───────────── */

function getState(key, defaultValue) {
  const row = db.prepare("SELECT value FROM bot_state WHERE key = ?").get(key);
  return row ? row.value : defaultValue;
}

function setState(key, value) {
  db.prepare(`
    INSERT INTO bot_state (key, value, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value);
}

/* ───────────── Leaderboard helper ───────────── */

function getDailyLeaderboard(guildId, ymd) {
  return db.prepare(`
    SELECT user_id, guess_count, solved_at
    FROM daily_progress
    WHERE guild_id = ? AND ymd = ? AND (solved = 1 OR lost = 1)
    ORDER BY solved DESC, guess_count ASC, solved_at ASC
  `).all(guildId, ymd);
}

/* ───────────── Voice XP / levels ───────────── */

function ensureUserVoiceXp(guildId, userId, username) {
  db.prepare(`
    INSERT INTO user_voice_xp (guild_id, user_id, username, total_xp, voice_seconds)
    VALUES (?, ?, ?, 0, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      username = COALESCE(excluded.username, user_voice_xp.username),
      updated_at = unixepoch()
  `).run(guildId, userId, username || null);
}

function addVoiceXp(guildId, userId, username, xp, voiceSeconds) {
  ensureUserVoiceXp(guildId, userId, username);
  db.prepare(`
    UPDATE user_voice_xp
    SET total_xp = total_xp + ?,
        voice_seconds = voice_seconds + ?,
        username = COALESCE(?, username),
        updated_at = unixepoch()
    WHERE guild_id = ? AND user_id = ?
  `).run(xp, voiceSeconds, username || null, guildId, userId);
}

function getUserVoiceXp(guildId, userId) {
  return db.prepare(
    "SELECT * FROM user_voice_xp WHERE guild_id = ? AND user_id = ?"
  ).get(guildId, userId);
}

function getVoiceLeaderboard(guildId, limit, offset) {
  return db.prepare(`
    SELECT user_id, username, total_xp, voice_seconds
    FROM user_voice_xp
    WHERE guild_id = ? AND total_xp > 0
    ORDER BY total_xp DESC, voice_seconds DESC
    LIMIT ? OFFSET ?
  `).all(guildId, limit, offset);
}

function getVoiceLeaderboardCount(guildId) {
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM user_voice_xp WHERE guild_id = ? AND total_xp > 0"
  ).get(guildId);
  return row?.c || 0;
}

function getUserVoiceRank(guildId, userId) {
  const u = getUserVoiceXp(guildId, userId);
  if (!u || u.total_xp <= 0) return 0;
  const row = db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM user_voice_xp
    WHERE guild_id = ? AND total_xp > ?
  `).get(guildId, u.total_xp);
  return row?.rank || 1;
}

module.exports = {
  db,
  init,
  ensureUser,
  getUser,
  getAllUsers,
  getPrefs,
  setPrefs,
  getWordleStats,
  setWordleStats,
  getWordleGame,
  setWordleGame,
  deleteWordleGame,
  getWordleLastGame,
  setWordleLastGame,
  getDailySchedule,
  setDailySchedule,
  deleteDailySchedule,
  getAllSchedules,
  getDailyAnswer,
  setDailyAnswer,
  getDailyProgress,
  getAllDailyProgressForDay,
  setDailyProgress,
  getDailyLeaderboard,
  logChat,
  getRecentChat,
  getTopIntents,
  getState,
  setState,
  ensureUserVoiceXp,
  addVoiceXp,
  getUserVoiceXp,
  getVoiceLeaderboard,
  getVoiceLeaderboardCount,
  getUserVoiceRank,
};
