/**
 * Local time parts for an IANA timezone (uses Intl; no extra deps).
 * @param {Date} date
 * @param {string} timeZone e.g. "America/New_York"
 */
function getPartsInZone(date, timeZone) {
  if (!timeZone || typeof timeZone !== "string") return null;
  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false
    });
    const parts = dtf.formatToParts(date);
    const pick = (t) => parts.find((p) => p.type === t)?.value ?? "";
    return {
      ymd: `${pick("year")}-${pick("month")}-${pick("day")}`,
      hour: parseInt(pick("hour"), 10),
      minute: parseInt(pick("minute"), 10),
      weekday: pick("weekday")
    };
  } catch {
    return null;
  }
}

/** Human-readable instant for embeds / chat (24h). */
function formatDateTimeInZone(date, timeZone) {
  if (!timeZone || typeof timeZone !== "string") return date.toISOString();
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** India-friendly: weekday + date + 12h clock + AM/PM + zone abbreviation (uses Asia/Kolkata for IST). */
function formatTimeAmPmVerbose(date, timeZone) {
  if (!timeZone || typeof timeZone !== "string") timeZone = "Asia/Kolkata";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZoneName: "short"
    }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short"
      }).format(date);
    } catch {
      return date.toISOString();
    }
  }
}

/** Default clock for “kurumi what time” when no daily schedule: India (IST). */
const DEFAULT_DISPLAY_TIMEZONE = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";

module.exports = { getPartsInZone, formatDateTimeInZone, formatTimeAmPmVerbose, DEFAULT_DISPLAY_TIMEZONE };
