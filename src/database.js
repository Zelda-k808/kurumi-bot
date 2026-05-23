const path = require("path");
const fs = require("fs");
const { createClient } = require("@libsql/client");

/* ───────────── Client setup ───────────── */

const TURSO_URL = (process.env.TURSO_DATABASE_URL || "").trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || "").trim();

let client;

if (TURSO_URL) {
  // Cloud mode — both laptop and Render connect to the same Turso database
  client = createClient({
    url: TURSO_URL,
    authToken: TURSO_TOKEN || undefined,
  });
  console.log("[DB] Turso cloud →", TURSO_URL.replace(/\/\/.*@/, "//***@"));
} else {
  // Local fallback — file-based SQLite for development / offline work
  const DB_DIR = path.join(__dirname, "..", "data");
  const DB_PATH = path.join(DB_DIR, "kurumi.db");
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  client = createClient({ url: `file:${DB_PATH}` });
  console.log("[DB] local file →", DB_PATH);
}

/* ───────────── Helpers ───────────── */

/** Run a single SQL statement, return the ResultSet. */
async function run(sql, args = []) {
  return client.execute({ sql, args });
}

/** Run a single SQL statement, return the first row or null. */
async function get(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows[0] || null;
}

/** Run a single SQL statement, return all rows. */
async function all(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows;
}

/* ───────────── Schema init ───────────── */

async function init() {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      username      TEXT,
      first_seen    INTEGER DEFAULT (unixepoch()),
      last_seen     INTEGER DEFAULT (unixepoch()),
      message_count INTEGER DEFAULT 0,
      mood_pref     TEXT DEFAULT 'neutral'
    )`,
    `CREATE TABLE IF NOT EXISTS user_prefs (
      user_id       TEXT PRIMARY KEY,
      hard_mode     INTEGER DEFAULT 0,
      colorblind    INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS wordle_stats (
      user_id       TEXT PRIMARY KEY,
      games_played  INTEGER DEFAULT 0,
      games_won     INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      max_streak    INTEGER DEFAULT 0,
      hard_won      INTEGER DEFAULT 0,
      hard_played   INTEGER DEFAULT 0,
      guess_dist    TEXT DEFAULT '[]'
    )`,
    `CREATE TABLE IF NOT EXISTS wordle_games (
      user_id       TEXT PRIMARY KEY,
      answer        TEXT,
      guesses       TEXT DEFAULT '[]',
      hard_mode     INTEGER DEFAULT 0,
      colorblind    INTEGER DEFAULT 0,
      created_at    INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS wordle_last_games (
      user_id       TEXT PRIMARY KEY,
      answer        TEXT,
      guesses       TEXT DEFAULT '[]',
      won           INTEGER DEFAULT 0,
      given_up      INTEGER DEFAULT 0,
      colorblind    INTEGER DEFAULT 0,
      ended_at      INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS daily_schedules (
      guild_id      TEXT PRIMARY KEY,
      channel_id    TEXT NOT NULL,
      timezone      TEXT DEFAULT 'UTC',
      daily_hour    INTEGER DEFAULT 8,
      last_posted   TEXT,
      enabled       INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS daily_answers (
      guild_id      TEXT NOT NULL,
      ymd           TEXT NOT NULL,
      answer        TEXT NOT NULL,
      posted_at     INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (guild_id, ymd)
    )`,
    `CREATE TABLE IF NOT EXISTS daily_progress (
      guild_id      TEXT NOT NULL,
      ymd           TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      guesses       TEXT DEFAULT '[]',
      solved        INTEGER DEFAULT 0,
      lost          INTEGER DEFAULT 0,
      guess_count   INTEGER DEFAULT 0,
      solved_at     INTEGER,
      PRIMARY KEY (guild_id, ymd, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      guild_id      TEXT,
      content       TEXT NOT NULL,
      bot_reply     TEXT,
      sentiment     REAL DEFAULT 0,
      intent        TEXT,
      created_at    INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS bot_state (
      key           TEXT PRIMARY KEY,
      value         TEXT,
      updated_at    INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS user_voice_xp (
      guild_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      username      TEXT,
      total_xp      INTEGER DEFAULT 0,
      voice_seconds INTEGER DEFAULT 0,
      updated_at    INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (guild_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_voice_xp_guild_xp
      ON user_voice_xp (guild_id, total_xp DESC)`,
    `CREATE TABLE IF NOT EXISTS music_playlists (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      name          TEXT NOT NULL,
      tracks        TEXT DEFAULT '[]',
      created_at    INTEGER DEFAULT (unixepoch()),
      updated_at    INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS music_settings (
      guild_id          TEXT PRIMARY KEY,
      dj_role_id        TEXT,
      music_channel_id  TEXT,
      default_volume    INTEGER DEFAULT 80,
      stay_24_7         INTEGER DEFAULT 0,
      autoplay          INTEGER DEFAULT 0,
      idle_timeout_ms   INTEGER DEFAULT 300000
    )`,
  ], "write");
}

/* ───────────── Users ───────────── */

async function ensureUser(userId, username) {
  await run(`
    INSERT INTO users (user_id, username, last_seen, message_count)
    VALUES (?, ?, unixepoch(), 1)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      last_seen = unixepoch(),
      message_count = message_count + 1
  `, [userId, username || null]);
}

async function getUser(userId) {
  return get("SELECT * FROM users WHERE user_id = ?", [userId]);
}

async function getAllUsers() {
  return all("SELECT * FROM users ORDER BY last_seen DESC");
}

/* ───────────── User Prefs ───────────── */

async function getPrefs(userId) {
  const row = await get("SELECT * FROM user_prefs WHERE user_id = ?", [userId]);
  if (!row) {
    await run("INSERT OR IGNORE INTO user_prefs (user_id) VALUES (?)", [userId]);
    return { hard_mode: 0, colorblind: 0 };
  }
  return { hard_mode: !!row.hard_mode, colorblind: !!row.colorblind };
}

async function setPrefs(userId, prefs) {
  await run(`
    INSERT INTO user_prefs (user_id, hard_mode, colorblind)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      hard_mode = excluded.hard_mode,
      colorblind = excluded.colorblind
  `, [userId, prefs.hard_mode ? 1 : 0, prefs.colorblind ? 1 : 0]);
}

/* ───────────── Wordle Stats ───────────── */

async function getWordleStats(userId) {
  const row = await get("SELECT * FROM wordle_stats WHERE user_id = ?", [userId]);
  if (!row) {
    await run("INSERT OR IGNORE INTO wordle_stats (user_id) VALUES (?)", [userId]);
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

async function setWordleStats(userId, stats) {
  await run(`
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
  `, [
    userId,
    stats.games_played,
    stats.games_won,
    stats.current_streak,
    stats.max_streak,
    stats.hard_won,
    stats.hard_played,
    JSON.stringify(stats.guess_dist),
  ]);
}

/* ───────────── Wordle Games ───────────── */

async function getWordleGame(userId) {
  const row = await get("SELECT * FROM wordle_games WHERE user_id = ?", [userId]);
  if (!row) return null;
  return {
    answer: row.answer,
    guesses: JSON.parse(row.guesses),
    hard_mode: !!row.hard_mode,
    colorblind: !!row.colorblind,
    created_at: row.created_at,
  };
}

async function setWordleGame(userId, game) {
  await run(`
    INSERT INTO wordle_games (user_id, answer, guesses, hard_mode, colorblind, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      answer = excluded.answer,
      guesses = excluded.guesses,
      hard_mode = excluded.hard_mode,
      colorblind = excluded.colorblind,
      created_at = excluded.created_at
  `, [userId, game.answer, JSON.stringify(game.guesses), game.hard_mode ? 1 : 0, game.colorblind ? 1 : 0, game.created_at || Math.floor(Date.now() / 1000)]);
}

async function deleteWordleGame(userId) {
  await run("DELETE FROM wordle_games WHERE user_id = ?", [userId]);
}

/* ───────────── Wordle Last Games ───────────── */

async function getWordleLastGame(userId) {
  const row = await get("SELECT * FROM wordle_last_games WHERE user_id = ?", [userId]);
  if (!row) return null;
  return {
    answer: row.answer,
    guesses: JSON.parse(row.guesses),
    won: !!row.won,
    givenUp: !!row.given_up,
    colorblind: !!row.colorblind,
  };
}

async function setWordleLastGame(userId, lastGame) {
  await run(`
    INSERT INTO wordle_last_games (user_id, answer, guesses, won, given_up, colorblind, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      answer = excluded.answer,
      guesses = excluded.guesses,
      won = excluded.won,
      given_up = excluded.given_up,
      colorblind = excluded.colorblind,
      ended_at = excluded.ended_at
  `, [
    userId,
    lastGame.answer,
    JSON.stringify(lastGame.guesses),
    lastGame.won ? 1 : 0,
    lastGame.givenUp ? 1 : 0,
    lastGame.colorblind ? 1 : 0,
  ]);
}

/* ───────────── Daily Schedules ───────────── */

async function getDailySchedule(guildId) {
  return get("SELECT * FROM daily_schedules WHERE guild_id = ?", [guildId]);
}

async function setDailySchedule(guildId, channelId, timezone, hour) {
  await run(`
    INSERT INTO daily_schedules (guild_id, channel_id, timezone, daily_hour)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      timezone = excluded.timezone,
      daily_hour = excluded.daily_hour
  `, [guildId, channelId, timezone, hour]);
}

async function deleteDailySchedule(guildId) {
  await run("DELETE FROM daily_schedules WHERE guild_id = ?", [guildId]);
}

async function getAllSchedules() {
  return all("SELECT * FROM daily_schedules WHERE enabled = 1");
}

/* ───────────── Daily Answers ───────────── */

async function getDailyAnswer(guildId, ymd) {
  return get("SELECT * FROM daily_answers WHERE guild_id = ? AND ymd = ?", [guildId, ymd]);
}

async function setDailyAnswer(guildId, ymd, answer) {
  await run(`
    INSERT INTO daily_answers (guild_id, ymd, answer)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, ymd) DO UPDATE SET
      answer = excluded.answer,
      posted_at = unixepoch()
  `, [guildId, ymd, answer]);
}

/* ───────────── Daily Progress ───────────── */

async function getDailyProgress(guildId, ymd, userId) {
  return get("SELECT * FROM daily_progress WHERE guild_id = ? AND ymd = ? AND user_id = ?", [guildId, ymd, userId]);
}

async function getAllDailyProgressForDay(guildId, ymd) {
  return all("SELECT * FROM daily_progress WHERE guild_id = ? AND ymd = ?", [guildId, ymd]);
}

async function setDailyProgress(guildId, ymd, userId, progress) {
  await run(`
    INSERT INTO daily_progress (guild_id, ymd, user_id, guesses, solved, lost, guess_count, solved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, ymd, user_id) DO UPDATE SET
      guesses = excluded.guesses,
      solved = excluded.solved,
      lost = excluded.lost,
      guess_count = excluded.guess_count,
      solved_at = excluded.solved_at
  `, [
    guildId, ymd, userId,
    JSON.stringify(progress.guesses),
    progress.solved ? 1 : 0,
    progress.lost ? 1 : 0,
    progress.guess_count,
    progress.solved_at || null,
  ]);
}

/* ───────────── Chat History ───────────── */

async function logChat(userId, guildId, content, botReply, sentiment, intent) {
  await run(`
    INSERT INTO chat_history (user_id, guild_id, content, bot_reply, sentiment, intent)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [userId, guildId || null, content, botReply || null, sentiment || 0, intent || null]);
}

async function getRecentChat(userId, limit = 5) {
  return all(`
    SELECT * FROM chat_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [userId, limit]);
}

async function getTopIntents(userId, limit = 3) {
  return all(`
    SELECT intent, COUNT(*) as cnt
    FROM chat_history
    WHERE user_id = ? AND intent IS NOT NULL
    GROUP BY intent
    ORDER BY cnt DESC
    LIMIT ?
  `, [userId, limit]);
}

/* ───────────── Bot State ───────────── */

async function getState(key, defaultValue) {
  const row = await get("SELECT value FROM bot_state WHERE key = ?", [key]);
  return row ? row.value : defaultValue;
}

async function setState(key, value) {
  await run(`
    INSERT INTO bot_state (key, value, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `, [key, value]);
}

/* ───────────── Leaderboard helper ───────────── */

async function getDailyLeaderboard(guildId, ymd) {
  return all(`
    SELECT user_id, guess_count, solved_at
    FROM daily_progress
    WHERE guild_id = ? AND ymd = ? AND (solved = 1 OR lost = 1)
    ORDER BY solved DESC, guess_count ASC, solved_at ASC
  `, [guildId, ymd]);
}

/* ───────────── Voice XP / levels ───────────── */

async function ensureUserVoiceXp(guildId, userId, username) {
  await run(`
    INSERT INTO user_voice_xp (guild_id, user_id, username, total_xp, voice_seconds)
    VALUES (?, ?, ?, 0, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      username = COALESCE(excluded.username, user_voice_xp.username),
      updated_at = unixepoch()
  `, [guildId, userId, username || null]);
}

async function addVoiceXp(guildId, userId, username, xp, voiceSeconds) {
  await ensureUserVoiceXp(guildId, userId, username);
  await run(`
    UPDATE user_voice_xp
    SET total_xp = total_xp + ?,
        voice_seconds = voice_seconds + ?,
        username = COALESCE(?, username),
        updated_at = unixepoch()
    WHERE guild_id = ? AND user_id = ?
  `, [xp, voiceSeconds, username || null, guildId, userId]);
}

async function getUserVoiceXp(guildId, userId) {
  return get(
    "SELECT * FROM user_voice_xp WHERE guild_id = ? AND user_id = ?",
    [guildId, userId]
  );
}

async function getVoiceLeaderboard(guildId, limit, offset) {
  return all(`
    SELECT user_id, username, total_xp, voice_seconds
    FROM user_voice_xp
    WHERE guild_id = ? AND total_xp > 0
    ORDER BY total_xp DESC, voice_seconds DESC
    LIMIT ? OFFSET ?
  `, [guildId, limit, offset]);
}

async function getVoiceLeaderboardCount(guildId) {
  const row = await get(
    "SELECT COUNT(*) AS c FROM user_voice_xp WHERE guild_id = ? AND total_xp > 0",
    [guildId]
  );
  return row?.c || 0;
}

async function getUserVoiceRank(guildId, userId) {
  const u = await getUserVoiceXp(guildId, userId);
  if (!u || u.total_xp <= 0) return 0;
  const row = await get(`
    SELECT COUNT(*) + 1 AS rank FROM user_voice_xp
    WHERE guild_id = ? AND total_xp > ?
  `, [guildId, u.total_xp]);
  return row?.rank || 1;
}

/* ───────────── Music Playlists ───────────── */

async function getPlaylist(userId, name) {
  return get("SELECT * FROM music_playlists WHERE user_id = ? AND name = ?", [userId, name]);
}

async function savePlaylist(userId, name, tracks) {
  await run(`
    INSERT INTO music_playlists (user_id, name, tracks, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(user_id, name) DO UPDATE SET
      tracks = excluded.tracks,
      updated_at = excluded.updated_at
  `, [userId, name, JSON.stringify(tracks)]);
}

async function deletePlaylist(userId, name) {
  await run("DELETE FROM music_playlists WHERE user_id = ? AND name = ?", [userId, name]);
}

async function getUserPlaylists(userId) {
  return all("SELECT * FROM music_playlists WHERE user_id = ? ORDER BY updated_at DESC", [userId]);
}

async function getPlaylistCount(userId) {
  const row = await get("SELECT COUNT(*) AS c FROM music_playlists WHERE user_id = ?", [userId]);
  return row?.c || 0;
}

/* ───────────── Music Settings (per guild) ───────────── */

async function getMusicSettings(guildId) {
  return get("SELECT * FROM music_settings WHERE guild_id = ?", [guildId]);
}

async function setMusicSettings(guildId, settings) {
  await run(`
    INSERT INTO music_settings (guild_id, dj_role_id, music_channel_id, default_volume, stay_24_7, autoplay, idle_timeout_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      dj_role_id = excluded.dj_role_id,
      music_channel_id = excluded.music_channel_id,
      default_volume = excluded.default_volume,
      stay_24_7 = excluded.stay_24_7,
      autoplay = excluded.autoplay,
      idle_timeout_ms = excluded.idle_timeout_ms
  `, [
    guildId,
    settings.dj_role_id || null,
    settings.music_channel_id || null,
    settings.default_volume ?? 80,
    settings.stay_24_7 ? 1 : 0,
    settings.autoplay ? 1 : 0,
    settings.idle_timeout_ms ?? 300000,
  ]);
}

module.exports = {
  client,
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
  // Music
  getPlaylist,
  savePlaylist,
  deletePlaylist,
  getUserPlaylists,
  getPlaylistCount,
  getMusicSettings,
  setMusicSettings,
};
