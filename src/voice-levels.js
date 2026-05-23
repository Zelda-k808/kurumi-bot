/** Voice XP: 100 XP/minute. Level n→n+1 needs 1000 + n×100 XP. */

const XP_PER_MINUTE = 100;
const BASE_LEVEL_XP = 1000;
const LEVEL_XP_STEP = 100;

function xpRequiredForLevelUp(currentLevel) {
  return BASE_LEVEL_XP + currentLevel * LEVEL_XP_STEP;
}

function totalXpForLevel(level) {
  if (level <= 0) return 0;
  return level * BASE_LEVEL_XP + (LEVEL_XP_STEP * level * (level - 1)) / 2;
}

function levelFromTotalXp(totalXp) {
  let level = 0;
  while (totalXp >= totalXpForLevel(level + 1)) level += 1;
  return level;
}

function progressInLevel(totalXp) {
  const level = levelFromTotalXp(totalXp);
  const floor = totalXpForLevel(level);
  const need = xpRequiredForLevelUp(level);
  const inLevel = totalXp - floor;
  return { level, inLevel, need, totalXp, floor };
}

function progressBar(fraction, width = 12) {
  const pct = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(pct * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function formatXp(n) {
  return Number(n).toLocaleString("en-US");
}

function formatVoiceTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = {
  XP_PER_MINUTE,
  xpRequiredForLevelUp,
  totalXpForLevel,
  levelFromTotalXp,
  progressInLevel,
  progressBar,
  formatXp,
  formatVoiceTime,
};
