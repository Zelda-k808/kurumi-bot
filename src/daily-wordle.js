const { EmbedBuilder } = require("discord.js");
const { getPartsInZone, formatTimeAmPmVerbose } = require("./time-util");
const wordle = require("./wordle");
const db = require("./database");

const DEFAULT_TZ = process.env.WORDLE_DAILY_TZ || "UTC";
const DAILY_HOUR = Number.parseInt(process.env.WORDLE_DAILY_HOUR || "8", 10);

function getSchedule(guildId) {
  const row = db.getDailySchedule(guildId);
  if (!row) return null;
  return { channelId: row.channel_id, timezone: row.timezone, lastPostedDate: row.last_posted || "" };
}

function setSchedule(guildId, channelId, timezone) {
  const tz = (timezone && String(timezone).trim()) || DEFAULT_TZ;
  if (!getPartsInZone(new Date(), tz)) throw new Error("Invalid IANA timezone (example: Asia/Tokyo, America/New_York).");
  db.setDailySchedule(guildId, channelId, tz, DAILY_HOUR);
}

function clearSchedule(guildId) {
  db.deleteDailySchedule(guildId);
}

function getTodayAnswer(guildId, timezone) {
  const parts = getPartsInZone(new Date(), timezone);
  if (!parts) return null;
  let ans = db.getDailyAnswer(guildId, parts.ymd);
  if (!ans) {
    const word = wordle.pickRandomAnswer();
    db.setDailyAnswer(guildId, parts.ymd, word);
    ans = { answer: word };
  }
  return { word: ans.answer, ymd: parts.ymd };
}

function ensureUserDaily(guildId, userId, ymd) {
  let prog = db.getDailyProgress(guildId, ymd, userId);
  if (!prog) {
    prog = { guesses: [], solved: false, lost: false, guess_count: 0, solved_at: null };
    db.setDailyProgress(guildId, ymd, userId, prog);
  }
  return prog;
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
  const guessesArr = JSON.parse(game.guesses || "[]");
  guessesArr.push({ word: guess, grades });
  game.guesses = JSON.stringify(guessesArr);
  game.guess_count = guessesArr.length;
  db.setDailyProgress(guildId, today.ymd, userId, game);

  const prefs = wordle.getOrCreatePrefs(userId);
  const row = `${wordle.gradeToEmojis(grades, prefs.colorblind)} \`${guess.toUpperCase()}\``;
  const board = guessesArr
    .map(({ word, grades: g }) => `${wordle.gradeToEmojis(g, prefs.colorblind)} \`${word.toUpperCase()}\``)
    .join("\n");
  const kb = wordle.buildKeyboard(guessesArr);

  if (guess === today.word) {
    game.solved = true;
    game.solved_at = Date.now();
    db.setDailyProgress(guildId, today.ymd, userId, game);
    return {
      ok: true,
      text: `${row}\n\n**Splendid**, Master — you solved **today's** daily in **${guessesArr.length}** try/tries! 🎉\n\n${board}\n\n**Keyboard**\n${kb}`
    };
  }

  if (guessesArr.length >= wordle.MAX_GUESSES) {
    game.lost = true;
    db.setDailyProgress(guildId, today.ymd, userId, game);
    return {
      ok: true,
      text: `${row}\n\nThe sands have run out, Master. Today's word was **${today.word.toUpperCase()}**.\n\n${board}\n\n**Keyboard**\n${kb}`
    };
  }

  return {
    ok: true,
    text: `${row}\n\n**${wordle.MAX_GUESSES - guessesArr.length}** guess(es) remain for **today's** daily, Master.\n\n${board}\n\n**Keyboard**\n${kb}`
  };
}

function dailyStatus(guildId, userId) {
  const sch = getSchedule(guildId);
  if (!sch) {
    return "No **daily Wordle** is configured here. A moderator may use **`/dailywordle setup`** to begin.";
  }
  const today = getTodayAnswer(guildId, sch.timezone);
  if (!today) return "Could not read today's puzzle.";

  const game = db.getDailyProgress(guildId, today.ymd, userId);
  const guessesArr = game ? JSON.parse(game.guesses || "[]") : [];
  const n = guessesArr.length;
  const prefs = wordle.getOrCreatePrefs(userId);
  const lines = guessesArr.length
    ? guessesArr
        .map(({ word, grades }) => `${wordle.gradeToEmojis(grades, prefs.colorblind)} \`${word.toUpperCase()}\``)
        .join("\n")
    : "_No guesses yet today._";
  let tail = "";
  if (game?.solved) tail = "\n\n_You have **solved** today's daily._";
  else if (game?.lost) tail = "\n\n_You are **out of guesses** for today._";
  return `**Daily Wordle** (${today.ymd}) — you have used **${n}/${wordle.MAX_GUESSES}** guesses.\n${lines}${tail}`;
}

function getLeaderboard(guildId) {
  const sch = getSchedule(guildId);
  if (!sch) {
    return { ok: false, text: "This server has **no daily Wordle** configured. A moderator may use **`/dailywordle setup`** to begin." };
  }
  const today = getTodayAnswer(guildId, sch.timezone);
  if (!today) return { ok: false, text: "Could not resolve today's puzzle." };

  const entries = db.getDailyLeaderboard(guildId, today.ymd);
  if (!entries.length) {
    return { ok: true, text: `**Daily Wordle Leaderboard** (${today.ymd})\n\n_No one has played today's daily yet._` };
  }

  let text = `**Daily Wordle Leaderboard** (${today.ymd})\n`;
  text += `_Sorted by: solved → guesses → speed_\n\n`;
  entries.slice(0, 20).forEach((e, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•";
    const status = e.solved ? `🟩 ${e.guess_count}/${wordle.MAX_GUESSES}` : e.lost ? "⬛ X/6" : `${e.guess_count}/${wordle.MAX_GUESSES}`;
    text += `${medal} <@${e.user_id}> — ${status}\n`;
  });

  return { ok: true, text };
}

/**
 * Call once per minute from the bot client.
 * @param {import("discord.js").Client} client
 */
async function tickDailyPost(client) {
  const now = new Date();
  const schedules = db.getAllSchedules();
  for (const schRow of schedules) {
    const guildId = schRow.guild_id;
    const parts = getPartsInZone(now, schRow.timezone);
    if (!parts) continue;

    if (parts.hour !== DAILY_HOUR || parts.minute !== 0) continue;
    if (schRow.last_posted === parts.ymd) continue;

    let ans = db.getDailyAnswer(guildId, parts.ymd);
    if (!ans) {
      db.setDailyAnswer(guildId, parts.ymd, wordle.pickRandomAnswer());
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    let channel = guild.channels.cache.get(schRow.channel_id);
    if (!channel) {
      channel = await guild.channels.fetch(schRow.channel_id).catch(() => null);
    }
    if (!channel || !channel.isTextBased()) continue;

    const when = formatTimeAmPmVerbose(now, schRow.timezone);
    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle("Daily Wordle — a new word awaits, Master")
      .setDescription(
        `The clock strikes **eight** — a new word awaits this server today (**${parts.ymd}**).\n\n` +
          "Everyone shares **one** secret word until midnight (in this schedule's timezone).\n" +
          "• Slash: **`/dailywordle guess`**\n" +
          "• Text: **`kurumi daily guess <word>`**\n" +
          "• Progress: **`/dailywordle status`** or **`kurumi daily status`**\n" +
          "• Leaderboard: **`/dailywordle leaderboard`**\n\n" +
          `_Posted at ${when} (${schRow.timezone})_`
      )
      .setFooter({ text: "Kurumi · same word for all — six guesses each" });

    try {
      await channel.send({ embeds: [embed] });
      db.setDailySchedule(guildId, schRow.channel_id, schRow.timezone, DAILY_HOUR);
    } catch (e) {
      console.error("[daily-wordle] post failed", guildId, e);
    }
  }
}

module.exports = {
  getSchedule,
  setSchedule,
  clearSchedule,
  getTodayAnswer,
  submitDailyGuess,
  dailyStatus,
  getLeaderboard,
  tickDailyPost,
  DEFAULT_TZ,
  DAILY_HOUR,
};
