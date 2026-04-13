const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");
const { getPartsInZone, formatTimeAmPmVerbose } = require("./time-util");
const wordle = require("./wordle");

const DATA_PATH = path.join(__dirname, "..", "data", "daily-wordle.json");
const DEFAULT_TZ = process.env.WORDLE_DAILY_TZ || "UTC";
const DAILY_HOUR = Number.parseInt(process.env.WORDLE_DAILY_HOUR || "8", 10);

/** @type {{ schedules: Record<string, { channelId: string, timezone: string, lastPostedDate: string }>, answers: Record<string, string> }}} */
let cache = { schedules: {}, answers: {} };

/** @type {Map<string, Map<string, { ymd: string, guesses: { word: string, grades: string[] }[], solved?: boolean, lost?: boolean }>>} */
const dailyProgress = new Map();

function ensureDataDir() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    cache = JSON.parse(raw);
    if (!cache.schedules) cache.schedules = {};
    if (!cache.answers) cache.answers = {};
  } catch {
    cache = { schedules: {}, answers: {} };
    save();
  }
}

function save() {
  ensureDataDir();
  fs.writeFileSync(DATA_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function answerKey(guildId, ymd) {
  return `${guildId}:${ymd}`;
}

function getSchedule(guildId) {
  return cache.schedules[guildId] ?? null;
}

function setSchedule(guildId, channelId, timezone) {
  const tz = (timezone && String(timezone).trim()) || DEFAULT_TZ;
  if (!getPartsInZone(new Date(), tz)) throw new Error("Invalid IANA timezone (example: Asia/Tokyo, America/New_York).");
  cache.schedules[guildId] = { channelId, timezone: tz, lastPostedDate: "" };
  save();
}

function clearSchedule(guildId) {
  delete cache.schedules[guildId];
  save();
}

function getTodayAnswer(guildId, timezone) {
  const parts = getPartsInZone(new Date(), timezone);
  if (!parts) return null;
  const key = answerKey(guildId, parts.ymd);
  if (!cache.answers[key]) {
    cache.answers[key] = wordle.pickRandomAnswer();
    save();
  }
  return { word: cache.answers[key], ymd: parts.ymd, key };
}

function getUserDailyGame(guildId, userId) {
  const g = dailyProgress.get(guildId);
  if (!g) return null;
  return g.get(userId) ?? null;
}

function ensureUserDaily(guildId, userId, ymd) {
  if (!dailyProgress.has(guildId)) dailyProgress.set(guildId, new Map());
  const m = dailyProgress.get(guildId);
  if (!m.has(userId)) m.set(userId, { ymd, guesses: [] });
  const st = m.get(userId);
  if (st.ymd !== ymd) {
    st.ymd = ymd;
    st.guesses = [];
    st.solved = false;
    st.lost = false;
  }
  return st;
}

function resetGuildProgress(guildId) {
  dailyProgress.delete(guildId);
}

function submitDailyGuess(guildId, userId, rawGuess) {
  const sch = getSchedule(guildId);
  if (!sch) {
    return { ok: false, text: "This server has **no daily Wordle channel** yet. Ask a moderator to run **`/dailywordle setup`**." };
  }

  const today = getTodayAnswer(guildId, sch.timezone);
  if (!today) return { ok: false, text: "Could not resolve today's puzzle (timezone issue)." };

  const guess = String(rawGuess || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (guess.length !== 5) {
    return { ok: false, text: "Daily guess must be **exactly 5 letters**, Master." };
  }
  if (!wordle.isValidWord(guess)) {
    return { ok: false, text: "That word is **not** in my dictionary for this game, Master." };
  }

  const game = ensureUserDaily(guildId, userId, today.ymd);
  if (game.solved) {
    return { ok: true, text: "You have **already solved** today's daily word, Master. Fufu… await tomorrow's strike of eight." };
  }
  if (game.lost) {
    return {
      ok: true,
      text: "You are **out of guesses** for today's daily, Master. The clock must turn once more before you may try again."
    };
  }

  const grades = wordle.gradeGuess(today.word, guess);
  game.guesses.push({ word: guess, grades });
  const row = `${wordle.gradeToEmojis(grades)} \`${guess.toUpperCase()}\``;
  const board = game.guesses
    .map(
      ({ word, grades: g }) =>
        `${wordle.gradeToEmojis(g)} \`${word.toUpperCase()}\``
    )
    .join("\n");

  if (guess === today.word) {
    game.solved = true;
    return {
      ok: true,
      text: `${row}\n\n**Splendid**, Master — you solved **today's** daily in **${game.guesses.length}** try/tries! 🎉\n\n${board}`
    };
  }

  if (game.guesses.length >= wordle.MAX_GUESSES) {
    game.lost = true;
    return {
      ok: true,
      text: `${row}\n\nThe sands have run out, Master. Today's word was **${today.word.toUpperCase()}**.\n\n${board}`
    };
  }

  return {
    ok: true,
    text: `${row}\n\n**${wordle.MAX_GUESSES - game.guesses.length}** guess(es) remain for **today's** daily, Master.\n\n${board}`
  };
}

function dailyStatus(guildId, userId) {
  const sch = getSchedule(guildId);
  if (!sch) {
    return "No **daily Wordle** is configured here. A moderator may use **`/dailywordle setup`**.";
  }
  const today = getTodayAnswer(guildId, sch.timezone);
  if (!today) return "Could not read today's puzzle.";
  const game = getUserDailyGame(guildId, userId);
  if (game && game.ymd !== today.ymd) {
    game.ymd = today.ymd;
    game.guesses = [];
    game.solved = false;
    game.lost = false;
  }
  const n = game?.guesses.length ?? 0;
  const lines = game?.guesses.length
    ? game.guesses
        .map(
          ({ word, grades }) =>
            `${wordle.gradeToEmojis(grades)} \`${word.toUpperCase()}\``
        )
        .join("\n")
    : "_No guesses yet today._";
  let tail = "";
  if (game?.solved) tail = "\n\n_You have **solved** today's daily._";
  else if (game?.lost) tail = "\n\n_You are **out of guesses** for today._";
  return `**Daily Wordle** (${today.ymd}) — you have used **${n}/${wordle.MAX_GUESSES}** guesses.\n${lines}${tail}`;
}

/**
 * Call once per minute from the bot client.
 * @param {import("discord.js").Client} client
 */
async function tickDailyPost(client) {
  const now = new Date();
  for (const [guildId, sch] of Object.entries(cache.schedules)) {
    const parts = getPartsInZone(now, sch.timezone);
    if (!parts) continue;

    if (parts.hour !== DAILY_HOUR || parts.minute !== 0) continue;
    if (sch.lastPostedDate === parts.ymd) continue;

    const key = answerKey(guildId, parts.ymd);
    if (!cache.answers[key]) {
      cache.answers[key] = wordle.pickRandomAnswer();
      save();
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    let channel = guild.channels.cache.get(sch.channelId);
    if (!channel) {
      channel = await guild.channels.fetch(sch.channelId).catch(() => null);
    }
    if (!channel || !channel.isTextBased()) continue;

    const when = formatTimeAmPmVerbose(now, sch.timezone);
    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle("Daily Wordle — good morning, Master")
      .setDescription(
        `The clock strikes **eight** — a new word awaits this server today (**${parts.ymd}**).\n\n` +
          "Everyone shares **one** secret word until midnight (in this schedule's timezone).\n" +
          "• Slash: **`/dailywordle guess`**\n" +
          "• Text: **`kurumi daily guess crate`**\n" +
          "• Progress: **`/dailywordle status`** or **`kurumi daily status`**\n\n" +
          `_Posted at ${when} (${sch.timezone})_`
      )
      .setFooter({ text: "Kurumi · same word for all — six guesses each" });

    try {
      await channel.send({ embeds: [embed] });
      sch.lastPostedDate = parts.ymd;
      save();
      resetGuildProgress(guildId);
    } catch (e) {
      console.error("[daily-wordle] post failed", guildId, e);
    }
  }
}

load();

module.exports = {
  load,
  getSchedule,
  setSchedule,
  clearSchedule,
  getTodayAnswer,
  submitDailyGuess,
  dailyStatus,
  tickDailyPost,
  DEFAULT_TZ,
  DAILY_HOUR
};
